import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFollowingForUser, updateFollowingForUser } from "../lib/following-mutations";
import { followingWithJoins } from "../lib/queries/following";

const userId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const followingId = "550e8400-e29b-41d4-a716-446655440000";

type Op =
	| { kind: "insert"; table: string; rows: unknown }
	| { kind: "delete"; table: string; where: Record<string, unknown> }
	| { kind: "update"; table: string; values: Record<string, unknown>; where: Record<string, unknown> };

interface MockOptions {
	insertedFollowingId?: string;
	existingFollowing?: { id: string } | null;
	selectByTable?: Record<string, { data: unknown; error: unknown }>;
}

function mockSupabase(opts: MockOptions = {}) {
	const ops: Op[] = [];
	const insertedId = opts.insertedFollowingId ?? followingId;
	const existing = opts.existingFollowing === undefined ? { id: followingId } : opts.existingFollowing;
	const selectByTable = opts.selectByTable ?? {};

	function from(table: string) {
		const where: Record<string, unknown> = {};
		const builder = {
			insert(rows: unknown) {
				ops.push({ kind: "insert", table, rows });
				return {
					select: () => ({
						single: async () => ({
							data: { id: insertedId, user_id: userId, name: "test" },
							error: null,
						}),
					}),
				};
			},
			delete() {
				return {
					eq(_col: string, _val: unknown) {
						ops.push({ kind: "delete", table, where: { [_col]: _val } });
						return Promise.resolve({ data: null, error: null });
					},
				};
			},
			update(values: Record<string, unknown>) {
				return {
					eq(col: string, val: unknown) {
						ops.push({ kind: "update", table, values, where: { [col]: val } });
						return Promise.resolve({ data: null, error: null });
					},
				};
			},
			select(_cols?: string) {
				return builder;
			},
			eq(col: string, val: unknown) {
				where[col] = val;
				return builder;
			},
			single: async () => {
				const tableSelect = selectByTable[table];
				if (tableSelect) return tableSelect;
				if (table === "following") return { data: existing, error: null };
				return { data: null, error: null };
			},
			maybeSingle: async () => ({ data: existing, error: null }),
			then: undefined,
		};
		return builder;
	}

	const client = { from } as unknown as SupabaseClient;
	return { client, ops };
}

void (async () => {
	// 1. createFollowingForUser persists wallets[] with snake_case + camelCase mapping.
	{
		const { client, ops } = mockSupabase();
		const result = await createFollowingForUser(client, userId, {
			name: "Alice",
			wallets: [
				{
					chain: "solana",
					address: "Sol1111111111111111111111111111111",
					network: "mainnet-beta",
					label: "Trading",
					watchEnabled: true,
					automationEnabled: false,
					sizeMode: "fixed",
					quoteMint: "So11111111111111111111111111111111111111112",
					slippageBps: 50,
				},
				{
					chain: "evm",
					address: "0xabc",
					network: "bsc",
					watch_enabled: true,
					proportional_scale_percent: 75,
				},
			],
		});

		assert.equal(result.ok, true);

		const walletInsert = ops.find((o) => o.kind === "insert" && o.table === "following_wallets");
		assert.ok(walletInsert, "expected insert into following_wallets");
		const rows = (walletInsert as { rows: Array<Record<string, unknown>> }).rows;
		assert.equal(rows.length, 2);

		assert.deepEqual(rows[0], {
			following_id: followingId,
			chain: "solana",
			address: "Sol1111111111111111111111111111111",
			network: "mainnet-beta",
			label: "Trading",
			watch_enabled: true,
			automation_enabled: false,
			auto_execute_swaps: false,
			size_mode: "fixed",
			quote_mint: "So11111111111111111111111111111111111111112",
			fixed_amount_raw: null,
			usd_amount: null,
			proportional_scale_percent: null,
			slippage_bps: 50,
			added_by: userId,
		});

		assert.equal(rows[1].chain, "evm");
		assert.equal(rows[1].watch_enabled, true);
		assert.equal(rows[1].proportional_scale_percent, 75);
		assert.equal(rows[1].label, null);
	}

	// 2. createFollowingForUser without wallets does not touch the wallets table.
	{
		const { client, ops } = mockSupabase();
		await createFollowingForUser(client, userId, { name: "NoWallets" });
		assert.equal(
			ops.find((o) => o.table === "following_wallets"),
			undefined,
		);
	}

	// 3. updateFollowingForUser with wallets=[...] deletes-then-reinserts.
	{
		const { client, ops } = mockSupabase();
		const r = await updateFollowingForUser(client, userId, followingId, {
			wallets: [{ chain: "solana", address: "NewAddr" }],
		});
		assert.equal(r.ok, true);

		const deleteOp = ops.find((o) => o.kind === "delete" && o.table === "following_wallets");
		const insertOp = ops.find((o) => o.kind === "insert" && o.table === "following_wallets");
		assert.ok(deleteOp, "expected delete on following_wallets");
		assert.ok(insertOp, "expected insert on following_wallets");
		assert.equal((insertOp as { rows: Array<Record<string, unknown>> }).rows.length, 1);
	}

	// 4. updateFollowingForUser with wallets=[] deletes but does not insert.
	{
		const { client, ops } = mockSupabase();
		await updateFollowingForUser(client, userId, followingId, { wallets: [] });
		const deleteOp = ops.find((o) => o.kind === "delete" && o.table === "following_wallets");
		const insertOp = ops.find((o) => o.kind === "insert" && o.table === "following_wallets");
		assert.ok(deleteOp);
		assert.equal(insertOp, undefined);
	}

	// 5. updateFollowingForUser without `wallets` key does not touch the wallets table.
	{
		const { client, ops } = mockSupabase();
		await updateFollowingForUser(client, userId, followingId, { name: "Renamed" });
		assert.equal(
			ops.find((o) => o.table === "following_wallets"),
			undefined,
		);
	}

	// 6. followingWithJoins selects following_wallets and exposes wallets array.
	{
		const walletRow = {
			id: "w1",
			following_id: followingId,
			chain: "solana",
			address: "Sol1",
			network: null,
			label: null,
			watch_enabled: false,
			automation_enabled: false,
			auto_execute_swaps: false,
			size_mode: null,
			quote_mint: null,
			fixed_amount_raw: null,
			usd_amount: null,
			proportional_scale_percent: null,
			slippage_bps: null,
			added_by: userId,
			deleted: false,
			created_at: "",
			updated_at: "",
		};

		const tableData: Record<string, { data: unknown[]; error: null }> = {
			following_accounts: { data: [], error: null },
			following_emails: { data: [], error: null },
			following_phones: { data: [], error: null },
			following_addresses: { data: [], error: null },
			following_notes: { data: [], error: null },
			following_wallets: { data: [walletRow], error: null },
		};

		const queryClient = {
			from(table: string) {
				const promiseShape = {
					select() {
						return this;
					},
					eq() {
						return this;
					},
					then(resolve: (v: unknown) => unknown) {
						return Promise.resolve(tableData[table] ?? { data: [], error: null }).then(resolve);
					},
				};
				return promiseShape;
			},
		} as unknown as SupabaseClient;

		const result = await followingWithJoins(queryClient, { id: followingId });
		assert.equal(result.wallets.length, 1);
		assert.equal(result.wallets[0].address, "Sol1");
		assert.equal(result.wallets[0].chain, "solana");
	}

	console.log("unit-tests: following-wallets OK");
})();
