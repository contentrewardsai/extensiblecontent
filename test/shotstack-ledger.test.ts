import assert from "node:assert/strict";
import { recordRenderDebit } from "../lib/shotstack-ledger";

// ---------------------------------------------------------------------------
// `recordRenderDebit` writes a debit row, then refreshes the cached
// `users.shotstack_credits` (which itself calls reconcileExpiredGrants and
// the shotstack_spendable_credits RPC). We mock all of those down to a
// minimal in-memory ledger so we can assert what gets persisted on the
// debit row — specifically the new `project_id` and `actor_user_id`
// attribution columns added in 20250421000000_free_tier_zero_and_project_caps.
// ---------------------------------------------------------------------------

interface DebitRow {
	user_id: string;
	kind: string;
	credits: number;
	description: string | null;
	shotstack_render_id: string | null;
	project_id: string | null;
	actor_user_id: string | null;
	metadata: Record<string, unknown>;
}

function makeMock() {
	const inserts: DebitRow[] = [];
	const supabase = {
		from(table: string) {
			if (table === "shotstack_credit_ledger") {
				const builder: Record<string, unknown> = {
					insert: (row: DebitRow) => {
						inserts.push(row);
						return Promise.resolve({ data: null, error: null });
					},
					// reconcileExpiredGrants reads the ledger before the debit;
					// returning an empty list is enough for these tests.
					select: (_cols: string) => builder,
					eq: (_col: string, _val: unknown) => builder,
					order: (_col: string, _opts: { ascending: boolean }) =>
						Promise.resolve({ data: [], error: null }),
				};
				return builder;
			}
			if (table === "users") {
				const builder: Record<string, unknown> = {
					update: (_row: Record<string, unknown>) => builder,
					eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: null }),
				};
				return builder;
			}
			throw new Error(`unexpected from(${table})`);
		},
		async rpc(fn: string, _args: Record<string, unknown>) {
			if (fn === "shotstack_spendable_credits") return { data: 0, error: null };
			throw new Error(`unexpected rpc ${fn}`);
		},
	} as unknown as Parameters<typeof recordRenderDebit>[0];
	return { supabase, inserts };
}

void (async () => {
	// 1. Solo-owner render: actorUserId omitted → defaults to wallet owner;
	//    project_id may be null (legacy / BYOK-style flow inside queue).
	{
		const { supabase, inserts } = makeMock();
		await recordRenderDebit(supabase, {
			userId: "owner-1",
			credits: 3,
			shotstackRenderId: "rndr-1",
		});
		assert.equal(inserts.length, 1);
		const row = inserts[0];
		assert.equal(row.user_id, "owner-1");
		assert.equal(row.kind, "debit");
		assert.equal(row.credits, -3);
		assert.equal(row.shotstack_render_id, "rndr-1");
		assert.equal(row.project_id, null);
		// Default for actor_user_id is the wallet owner so the column is
		// never null and per-actor analytics stay simple.
		assert.equal(row.actor_user_id, "owner-1");
	}

	// 2. Collaborator render: explicit actor + project are persisted as-is.
	{
		const { supabase, inserts } = makeMock();
		await recordRenderDebit(supabase, {
			userId: "owner-1",
			actorUserId: "collab-7",
			projectId: "proj-42",
			credits: 1.5,
			shotstackRenderId: "rndr-2",
			description: "Collaborator render",
			metadata: { duration_seconds: 90 },
		});
		assert.equal(inserts.length, 1);
		const row = inserts[0];
		assert.equal(row.user_id, "owner-1"); // wallet
		assert.equal(row.actor_user_id, "collab-7"); // who triggered it
		assert.equal(row.project_id, "proj-42");
		assert.equal(row.credits, -1.5);
		assert.equal(row.description, "Collaborator render");
		assert.deepEqual(row.metadata, { duration_seconds: 90 });
	}

	// 3. Zero / negative credits short-circuit and never insert.
	{
		const { supabase, inserts } = makeMock();
		const result = await recordRenderDebit(supabase, {
			userId: "owner-1",
			credits: 0,
			shotstackRenderId: "rndr-noop",
		});
		assert.equal(inserts.length, 0);
		assert.equal(result, 0);
	}

	console.log("shotstack-ledger.test.ts ok");
})();
