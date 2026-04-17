import assert from "node:assert/strict";
import { reconcileExpiredGrants } from "../lib/shotstack-expiry";

// ---------------------------------------------------------------------------
// In-memory mock of the slice of `SupabaseClient` reconcileExpiredGrants
// touches: a `from('shotstack_credit_ledger')` builder that supports `.select`
// + `.eq` + `.order` for reads and `.insert` for writes.
// ---------------------------------------------------------------------------

interface Row {
	id: string;
	user_id: string;
	kind: "grant" | "debit" | "expiry" | "adjustment";
	credits: number;
	expires_at: string | null;
	created_at: string;
	source_grant_id: string | null;
	whop_membership_id: string | null;
	whop_product_id: string | null;
	period_start: string | null;
	description?: string | null;
}

interface MockState {
	rows: Row[];
	autoIdCounter: number;
}

function makeMock(initialRows: Row[]) {
	const state: MockState = { rows: [...initialRows], autoIdCounter: 0 };
	const supabase = {
		from(table: string) {
			if (table !== "shotstack_credit_ledger") {
				throw new Error(`unexpected from(${table})`);
			}
			let scopedRows: Row[] = state.rows.slice();
			const builder: Record<string, unknown> = {
				select: (_cols: string) => builder,
				eq: (col: string, val: string) => {
					scopedRows = scopedRows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
					return builder;
				},
				order: (_col: string, _opts: { ascending: boolean }) => {
					scopedRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
					return Promise.resolve({ data: scopedRows, error: null });
				},
				insert: (rows: Partial<Row>[]) => {
					for (const r of rows) {
						state.autoIdCounter += 1;
						state.rows.push({
							id: r.id ?? `auto-${state.autoIdCounter}`,
							user_id: r.user_id ?? "user",
							kind: r.kind ?? "grant",
							credits: r.credits ?? 0,
							expires_at: r.expires_at ?? null,
							created_at: r.created_at ?? new Date().toISOString(),
							source_grant_id: r.source_grant_id ?? null,
							whop_membership_id: r.whop_membership_id ?? null,
							whop_product_id: r.whop_product_id ?? null,
							period_start: r.period_start ?? null,
							description: r.description ?? null,
						});
					}
					return Promise.resolve({ data: null, error: null });
				},
			};
			return builder;
		},
	} as unknown as Parameters<typeof reconcileExpiredGrants>[0];
	return { supabase, state };
}

const USER = "user-1";

function grant(id: string, credits: number, createdAt: string, expiresAt: string | null): Row {
	return {
		id,
		user_id: USER,
		kind: "grant",
		credits,
		expires_at: expiresAt,
		created_at: createdAt,
		source_grant_id: null,
		whop_membership_id: `mem-${id}`,
		whop_product_id: "prod_test",
		period_start: createdAt,
	};
}

function debit(id: string, credits: number, createdAt: string): Row {
	return {
		id,
		user_id: USER,
		kind: "debit",
		credits,
		expires_at: null,
		created_at: createdAt,
		source_grant_id: null,
		whop_membership_id: null,
		whop_product_id: null,
		period_start: null,
	};
}

function balance(state: MockState): number {
	return state.rows.reduce((acc, r) => acc + Number(r.credits), 0);
}

void (async () => {
	// -------------------------------------------------------------------
	// 1. Single grant, no spend, fully expired → expiry row of -credits.
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 30, "2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"),
		]);
		const result = await reconcileExpiredGrants(supabase, USER, new Date("2025-05-01T00:00:00Z"));
		assert.equal(result.insertedExpiries, 1);
		const inserted = state.rows.filter((r) => r.kind === "expiry");
		assert.equal(inserted.length, 1);
		assert.equal(inserted[0].credits, -30);
		assert.equal(inserted[0].source_grant_id, "g1");
		assert.equal(inserted[0].whop_membership_id, "mem-g1");
		// Ledger sum should be 0 after offsetting the grant.
		assert.equal(balance(state), 0);
	}

	// -------------------------------------------------------------------
	// 2. Partial spend before expiry: grant 30, debit -20, then expiry.
	//    The expiry row should be -10 (only the unspent remainder rolls off).
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 30, "2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"),
			debit("d1", -20, "2025-02-15T00:00:00Z"),
		]);
		const result = await reconcileExpiredGrants(supabase, USER, new Date("2025-05-01T00:00:00Z"));
		assert.equal(result.insertedExpiries, 1);
		const expiries = state.rows.filter((r) => r.kind === "expiry");
		assert.equal(expiries.length, 1);
		assert.equal(expiries[0].credits, -10);
		assert.equal(expiries[0].source_grant_id, "g1");
		// Sum: +30 - 20 - 10 = 0.
		assert.equal(balance(state), 0);
	}

	// -------------------------------------------------------------------
	// 3. Multi-grant overlap with FIFO consumption.
	//    grant1=30 (Jan, expires Apr)
	//    grant2=30 (Feb, expires May)
	//    debit -50 in Mar (consumes all 30 of grant1, then 20 of grant2)
	//    After Apr 2: grant1 fully consumed → expiry of 0 is *not* written.
	//    After May 2: grant2 has 10 left → expiry of -10 is written.
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 30, "2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"),
			grant("g2", 30, "2025-02-01T00:00:00Z", "2025-05-01T00:00:00Z"),
			debit("d1", -50, "2025-03-15T00:00:00Z"),
		]);
		// First reconcile only after Apr 1 — grant1 should expire with 0
		// remainder, so no expiry row is inserted.
		const r1 = await reconcileExpiredGrants(supabase, USER, new Date("2025-04-15T00:00:00Z"));
		assert.equal(r1.insertedExpiries, 0);
		assert.equal(state.rows.filter((r) => r.kind === "expiry").length, 0);
		// Then advance past May 1 — grant2 should expire with -10 remainder.
		const r2 = await reconcileExpiredGrants(supabase, USER, new Date("2025-05-15T00:00:00Z"));
		assert.equal(r2.insertedExpiries, 1);
		const expiries = state.rows.filter((r) => r.kind === "expiry");
		assert.equal(expiries.length, 1);
		assert.equal(expiries[0].credits, -10);
		assert.equal(expiries[0].source_grant_id, "g2");
		// Sum: 30 + 30 - 50 - 10 = 0.
		assert.equal(balance(state), 0);
	}

	// -------------------------------------------------------------------
	// 4. Idempotency: running reconcile twice in a row never inserts the
	//    same expiry twice.
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 30, "2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"),
		]);
		const r1 = await reconcileExpiredGrants(supabase, USER, new Date("2025-05-01T00:00:00Z"));
		assert.equal(r1.insertedExpiries, 1);
		const r2 = await reconcileExpiredGrants(supabase, USER, new Date("2025-05-01T00:00:00Z"));
		assert.equal(r2.insertedExpiries, 0);
		assert.equal(state.rows.filter((r) => r.kind === "expiry").length, 1);
	}

	// -------------------------------------------------------------------
	// 5. Grant whose window hasn't ended yet → no expiry row (FIFO walk
	//    leaves the bucket open).
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 30, "2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"),
		]);
		const r = await reconcileExpiredGrants(supabase, USER, new Date("2025-03-15T00:00:00Z"));
		assert.equal(r.insertedExpiries, 0);
		assert.equal(state.rows.filter((r) => r.kind === "expiry").length, 0);
	}

	// -------------------------------------------------------------------
	// 6. Grant with `expires_at = null` (e.g. a manual grant that never
	//    rolls off) is ignored regardless of how far we advance `now`.
	// -------------------------------------------------------------------
	{
		const { supabase, state } = makeMock([
			grant("g1", 100, "2025-01-01T00:00:00Z", null),
		]);
		const r = await reconcileExpiredGrants(supabase, USER, new Date("2099-01-01T00:00:00Z"));
		assert.equal(r.insertedExpiries, 0);
		assert.equal(state.rows.filter((r) => r.kind === "expiry").length, 0);
	}

	console.log("shotstack-expiry.test.ts ok");
})();
