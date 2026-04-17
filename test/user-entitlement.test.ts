import assert from "node:assert/strict";
import { isUserEntitled } from "../lib/user-entitlement";

// ---------------------------------------------------------------------------
// Mock Supabase client. `isUserEntitled` makes up to 3 reads:
//   1. users(has_upgraded) by id            → maybeSingle()
//   2. project_members(project_id) by user  → returns array of { project_id }
//   3. projects(owner_id) joined to users
//      .in("id", projectIds).eq("owner.has_upgraded", true).limit(1)
// We model the chained builder with a tiny state machine that records the
// active table, the .in()/.eq() filters, and resolves to the seeded rows.
// ---------------------------------------------------------------------------

interface Seed {
	users: Record<string, { has_upgraded: boolean }>; // id → row
	memberships: Array<{ user_id: string; project_id: string }>; // join table
	projects: Record<string, { owner_id: string }>; // project_id → owner_id
}

function makeSupabase(seed: Seed) {
	const supabase = {
		from(table: string) {
			let activeUserId: string | null = null;
			let inIds: string[] | null = null;
			let needsPaidOwner = false;
			const builder: Record<string, unknown> = {
				select: (_cols: string) => builder,
				eq: (col: string, val: unknown) => {
					if (table === "users" && col === "id") activeUserId = String(val);
					if (table === "project_members" && col === "user_id") activeUserId = String(val);
					if (table === "projects" && col === "owner.has_upgraded" && val === true) {
						needsPaidOwner = true;
					}
					return builder;
				},
				in: (_col: string, ids: string[]) => {
					inIds = ids;
					return builder;
				},
				limit: (_n: number) => builder,
				maybeSingle: async () => {
					if (table === "users" && activeUserId) {
						const row = seed.users[activeUserId];
						return { data: row ?? null, error: null };
					}
					return { data: null, error: null };
				},
				then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
					if (table === "project_members" && activeUserId) {
						const rows = seed.memberships
							.filter((m) => m.user_id === activeUserId)
							.map((m) => ({ project_id: m.project_id }));
						return resolve({ data: rows, error: null });
					}
					if (table === "projects" && inIds) {
						const matching = inIds
							.map((id) => seed.projects[id])
							.filter((p): p is { owner_id: string } => !!p);
						const rows = matching
							.filter((p) => !needsPaidOwner || seed.users[p.owner_id]?.has_upgraded === true)
							.map((p) => ({
								owner_id: p.owner_id,
								owner: { has_upgraded: seed.users[p.owner_id]?.has_upgraded ?? false },
							}));
						return resolve({ data: rows, error: null });
					}
					return resolve({ data: [], error: null });
				},
			};
			return builder;
		},
	};
	return supabase as unknown as Parameters<typeof isUserEntitled>[0];
}

void (async () => {
	// 1. Paid user → entitled, reason=paid (and project lookup is skipped).
	{
		const supabase = makeSupabase({
			users: { "u-paid": { has_upgraded: true } },
			memberships: [],
			projects: {},
		});
		const out = await isUserEntitled(supabase, "u-paid");
		assert.deepEqual(out, { entitled: true, reason: "paid" });
	}

	// 2. Free user with no projects → not entitled.
	{
		const supabase = makeSupabase({
			users: { "u-free": { has_upgraded: false } },
			memberships: [],
			projects: {},
		});
		const out = await isUserEntitled(supabase, "u-free");
		assert.deepEqual(out, { entitled: false, reason: null });
	}

	// 3. Free user, member of a project owned by ANOTHER free user → not entitled.
	{
		const supabase = makeSupabase({
			users: {
				"u-free": { has_upgraded: false },
				"u-other-free": { has_upgraded: false },
			},
			memberships: [{ user_id: "u-free", project_id: "p-1" }],
			projects: { "p-1": { owner_id: "u-other-free" } },
		});
		const out = await isUserEntitled(supabase, "u-free");
		assert.deepEqual(out, { entitled: false, reason: null });
	}

	// 4. Free user, member of a project owned by a PAID user → entitled via project.
	{
		const supabase = makeSupabase({
			users: {
				"u-free": { has_upgraded: false },
				"u-paid-owner": { has_upgraded: true },
			},
			memberships: [{ user_id: "u-free", project_id: "p-paid" }],
			projects: { "p-paid": { owner_id: "u-paid-owner" } },
		});
		const out = await isUserEntitled(supabase, "u-free");
		assert.deepEqual(out, { entitled: true, reason: "project_member" });
	}

	// 5. Empty user id is a defensive no-op.
	{
		const supabase = makeSupabase({ users: {}, memberships: [], projects: {} });
		const out = await isUserEntitled(supabase, "");
		assert.deepEqual(out, { entitled: false, reason: null });
	}

	// 6. Mixed memberships: at least one paid sponsor wins.
	{
		const supabase = makeSupabase({
			users: {
				"u-free": { has_upgraded: false },
				"u-other-free": { has_upgraded: false },
				"u-paid-owner": { has_upgraded: true },
			},
			memberships: [
				{ user_id: "u-free", project_id: "p-free" },
				{ user_id: "u-free", project_id: "p-paid" },
			],
			projects: {
				"p-free": { owner_id: "u-other-free" },
				"p-paid": { owner_id: "u-paid-owner" },
			},
		});
		const out = await isUserEntitled(supabase, "u-free");
		assert.deepEqual(out, { entitled: true, reason: "project_member" });
	}

	console.log("user-entitlement.test.ts ok");
})();
