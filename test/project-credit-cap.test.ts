import assert from "node:assert/strict";
import {
	assertProjectShotstackCap,
	ProjectCreditCapError,
} from "../lib/project-credit-cap";

// ---------------------------------------------------------------------------
// Mock Supabase. assertProjectShotstackCap touches:
//   - projects(shotstack_monthly_credit_cap) by id     → maybeSingle()
//   - project_member_credit_overrides(monthly_credit_cap) by (project,user) → maybeSingle()
//   - rpc("project_shotstack_spent_this_month", { p_project_id, p_actor_user_id })
//
// We seed a single project + a single override, plus a per-call spend lookup
// keyed by `${projectId}|${actorUserId ?? "*"}` so tests can verify the
// helper used the right scope (member-override → actor-scoped, project-cap →
// whole-project).
// ---------------------------------------------------------------------------

interface Seed {
	projectCap: number | null;
	override?: { user_id: string; cap: number };
	spentByScope: Record<string, number>; // "projectId|actorUserId|*"
}

const PROJECT_ID = "proj-1";

function makeSupabase(seed: Seed) {
	const calls: { rpc: Array<{ project_id: string; actor_user_id: string | null }> } = {
		rpc: [],
	};
	const supabase = {
		from(table: string) {
			let activeProjectId: string | null = null;
			let activeUserId: string | null = null;
			const builder: Record<string, unknown> = {
				select: (_cols: string) => builder,
				eq: (col: string, val: unknown) => {
					if (col === "id") activeProjectId = String(val);
					if (col === "project_id") activeProjectId = String(val);
					if (col === "user_id") activeUserId = String(val);
					return builder;
				},
				maybeSingle: async () => {
					if (table === "projects") {
						return {
							data: { shotstack_monthly_credit_cap: seed.projectCap },
							error: null,
						};
					}
					if (table === "project_member_credit_overrides") {
						const ok =
							seed.override &&
							activeProjectId === PROJECT_ID &&
							activeUserId === seed.override.user_id;
						return {
							data: ok ? { monthly_credit_cap: seed.override!.cap } : null,
							error: null,
						};
					}
					return { data: null, error: null };
				},
			};
			return builder;
		},
		async rpc(fn: string, args: { p_project_id: string; p_actor_user_id: string | null }) {
			if (fn !== "project_shotstack_spent_this_month") {
				throw new Error(`unexpected rpc ${fn}`);
			}
			calls.rpc.push({ project_id: args.p_project_id, actor_user_id: args.p_actor_user_id });
			const key = `${args.p_project_id}|${args.p_actor_user_id ?? "*"}`;
			return { data: seed.spentByScope[key] ?? 0, error: null };
		},
	};
	return { supabase: supabase as unknown as Parameters<typeof assertProjectShotstackCap>[0], calls };
}

void (async () => {
	// 1. No cap, no override → never throws, returns source=none.
	{
		const { supabase, calls } = makeSupabase({ projectCap: null, spentByScope: {} });
		const out = await assertProjectShotstackCap(supabase, {
			projectId: PROJECT_ID,
			actorUserId: "u-actor",
			requestedCredits: 5,
		});
		assert.equal(out.source, "none");
		assert.equal(out.cap, null);
		// No RPC call needed when there's no cap to evaluate.
		assert.equal(calls.rpc.length, 0);
	}

	// 2. Project cap, well under → ok, source=project_cap (actor scope = null).
	{
		const { supabase, calls } = makeSupabase({
			projectCap: 100,
			spentByScope: { [`${PROJECT_ID}|*`]: 30 },
		});
		const out = await assertProjectShotstackCap(supabase, {
			projectId: PROJECT_ID,
			actorUserId: "u-actor",
			requestedCredits: 5,
		});
		assert.equal(out.source, "project_cap");
		assert.equal(out.cap, 100);
		assert.equal(out.used, 30);
		// Project-cap path scopes the spend RPC to the whole project (null actor).
		assert.equal(calls.rpc.length, 1);
		assert.equal(calls.rpc[0].actor_user_id, null);
	}

	// 3. Project cap, would exceed → throws project_cap_full.
	{
		const { supabase } = makeSupabase({
			projectCap: 100,
			spentByScope: { [`${PROJECT_ID}|*`]: 96 },
		});
		await assert.rejects(
			() =>
				assertProjectShotstackCap(supabase, {
					projectId: PROJECT_ID,
					actorUserId: "u-actor",
					requestedCredits: 5,
				}),
			(e: unknown) =>
				e instanceof ProjectCreditCapError && e.code === "project_cap_full" && e.status === 402,
		);
	}

	// 4. Member override < project cap, override is the active limit.
	{
		const { supabase, calls } = makeSupabase({
			projectCap: 1000,
			override: { user_id: "u-actor", cap: 20 },
			spentByScope: { [`${PROJECT_ID}|u-actor`]: 18 },
		});
		await assert.rejects(
			() =>
				assertProjectShotstackCap(supabase, {
					projectId: PROJECT_ID,
					actorUserId: "u-actor",
					requestedCredits: 5,
				}),
			(e: unknown) =>
				e instanceof ProjectCreditCapError && e.code === "member_cap_full" && e.cap === 20,
		);
		// Member-override path scopes the spend RPC to the actor.
		assert.equal(calls.rpc[0].actor_user_id, "u-actor");
	}

	// 5. Member override exists but for a DIFFERENT user → falls back to project cap.
	{
		const { supabase, calls } = makeSupabase({
			projectCap: 100,
			override: { user_id: "u-other", cap: 10 },
			spentByScope: { [`${PROJECT_ID}|*`]: 0 },
		});
		const out = await assertProjectShotstackCap(supabase, {
			projectId: PROJECT_ID,
			actorUserId: "u-actor",
			requestedCredits: 5,
		});
		assert.equal(out.source, "project_cap");
		assert.equal(out.cap, 100);
		assert.equal(calls.rpc[0].actor_user_id, null);
	}

	// 6. Zero requested → short-circuit, no DB calls.
	{
		const { supabase, calls } = makeSupabase({
			projectCap: 1,
			spentByScope: { [`${PROJECT_ID}|*`]: 1 },
		});
		const out = await assertProjectShotstackCap(supabase, {
			projectId: PROJECT_ID,
			actorUserId: "u-actor",
			requestedCredits: 0,
		});
		assert.equal(out.source, "none");
		assert.equal(out.requested, 0);
		assert.equal(calls.rpc.length, 0);
	}

	console.log("project-credit-cap.test.ts ok");
})();
