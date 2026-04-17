import assert from "node:assert/strict";
import {
	assertProjectQuota,
	getOwnerStorageStats,
	getProjectStorageStats,
	normalizeQuotaInput,
	OWNER_DEFAULT_MAX_BYTES,
	POST_MEDIA_BUCKETS,
	ProjectQuotaError,
} from "../lib/project-quota";

// Stand-in cap for "paid user" tests. We can't use OWNER_DEFAULT_MAX_BYTES
// any more because the free-tier default is now 0 — a fallback that would
// fail almost every quota assertion below. Pick something well above the
// numbers the assertions add to keep arithmetic legible.
const PAID_TIER_TEST_CAP = 1_000_000_000; // 1 GB

// ---------------------------------------------------------------------------
// normalizeQuotaInput — accepts non-negative integers / numeric strings /
// null / empty string. Anything else → ProjectQuotaError(400).
// ---------------------------------------------------------------------------

assert.equal(normalizeQuotaInput(null), null);
assert.equal(normalizeQuotaInput(undefined), null);
assert.equal(normalizeQuotaInput(""), null);
assert.equal(normalizeQuotaInput(0), 0);
assert.equal(normalizeQuotaInput(1024), 1024);
assert.equal(normalizeQuotaInput(1024.9), 1024);
assert.equal(normalizeQuotaInput("4096"), 4096);
assert.equal(normalizeQuotaInput("  100 "), 100);

assert.throws(() => normalizeQuotaInput(-1), ProjectQuotaError);
assert.throws(() => normalizeQuotaInput("-2"), ProjectQuotaError);
assert.throws(() => normalizeQuotaInput("abc"), ProjectQuotaError);
assert.throws(() => normalizeQuotaInput({}), ProjectQuotaError);
assert.throws(() => normalizeQuotaInput(Number.NaN), ProjectQuotaError);
assert.throws(() => normalizeQuotaInput(Number.POSITIVE_INFINITY), ProjectQuotaError);

// Quota errors carry status codes — 400 for input validation.
try {
	normalizeQuotaInput(-1);
	assert.fail("expected throw");
} catch (e) {
	assert.ok(e instanceof ProjectQuotaError);
	if (e instanceof ProjectQuotaError) {
		assert.equal(e.status, 400);
		assert.equal(e.code, "project_full");
	}
}

// ---------------------------------------------------------------------------
// Mocks for the three RPCs the quota helpers call:
//   - get_user_storage_stats(p_user_prefix, p_bucket_ids)  → owner totals
//   - get_project_storage_bytes(p_owner_prefix, p_project_id, p_bucket_ids) → project totals
// ---------------------------------------------------------------------------

interface RpcResult {
	rows: Array<{ bucket_id: string; file_count: number; total_bytes: number }>;
}

function makeSupabaseRpc(
	handlers: Partial<{
		get_user_storage_stats: (args: Record<string, unknown>) => RpcResult | Error;
		get_project_storage_bytes: (args: Record<string, unknown>) => RpcResult | Error;
		/**
		 * Override the value `getOwnerMaxStorageBytes` reads off
		 * `users.max_storage_bytes`. Defaults to PAID_TIER_TEST_CAP so most
		 * tests can pretend the owner is a paid user with plenty of room;
		 * pass `null` or 0 to exercise the free-tier fallback (which is now
		 * also 0, since `FREE_TIER_MAX_STORAGE_BYTES` was lowered).
		 */
		users_max_storage_bytes: number | null;
	}>,
) {
	const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
	const ownerCap =
		"users_max_storage_bytes" in handlers
			? (handlers.users_max_storage_bytes as number | null)
			: PAID_TIER_TEST_CAP;
	const supabase = {
		async rpc(fn: string, args: Record<string, unknown>) {
			rpcCalls.push({ fn, args });
			const handler = handlers[fn as keyof typeof handlers];
			if (typeof handler !== "function") return { data: [], error: null };
			const out = (handler as (args: Record<string, unknown>) => RpcResult | Error)(args);
			if (out instanceof Error) return { data: null, error: { message: out.message } };
			return { data: out.rows, error: null };
		},
		from(table: string) {
			if (table !== "users") {
				throw new Error(`unexpected from(${table})`);
			}
			const builder = {
				select: (_cols: string) => builder,
				eq: (_col: string, _val: string) => builder,
				async maybeSingle() {
					return { data: { max_storage_bytes: ownerCap }, error: null };
				},
			};
			return builder;
		},
	} as unknown as Parameters<typeof getOwnerStorageStats>[0];
	return { supabase, rpcCalls };
}

// ---------------------------------------------------------------------------
// getOwnerStorageStats — sums across both buckets, reports remaining capacity.
// ---------------------------------------------------------------------------

void (async () => {
{
	const { supabase, rpcCalls } = makeSupabaseRpc({
		get_user_storage_stats: () => ({
			rows: [
				{ bucket_id: "post-media", file_count: 3, total_bytes: 1_000_000 },
				{ bucket_id: "post-media-private", file_count: 2, total_bytes: 2_500_000 },
			],
		}),
	});
	const stats = await getOwnerStorageStats(supabase, "owner-1");
	assert.equal(stats.usedBytes, 3_500_000);
	assert.equal(stats.maxBytes, PAID_TIER_TEST_CAP);
	assert.equal(stats.availableBytes, PAID_TIER_TEST_CAP - 3_500_000);
	// Verify the RPC contract — owner prefix needs the trailing slash.
	assert.equal(rpcCalls[0].args.p_user_prefix, "owner-1/");
	assert.deepEqual(rpcCalls[0].args.p_bucket_ids, [...POST_MEDIA_BUCKETS]);
}

// availableBytes never goes negative even when used > max.
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ({
			rows: [{ bucket_id: "post-media", file_count: 1, total_bytes: PAID_TIER_TEST_CAP * 2 }],
		}),
	});
	const stats = await getOwnerStorageStats(supabase, "owner-2");
	assert.equal(stats.availableBytes, 0);
}

// Free-tier owner (cap = 0): availableBytes is 0 even with no usage.
{
	const { supabase } = makeSupabaseRpc({
		users_max_storage_bytes: 0,
		get_user_storage_stats: () => ({ rows: [] }),
	});
	const stats = await getOwnerStorageStats(supabase, "owner-free");
	assert.equal(stats.usedBytes, 0);
	assert.equal(stats.maxBytes, OWNER_DEFAULT_MAX_BYTES); // 0
	assert.equal(stats.availableBytes, 0);
}

// RPC errors propagate as plain Errors (callers catch & translate).
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => new Error("boom"),
	});
	await assert.rejects(() => getOwnerStorageStats(supabase, "owner-3"), /getOwnerStorageStats: boom/);
}

// ---------------------------------------------------------------------------
// getProjectStorageStats — null quota → null availableBytes; otherwise reports
// remaining within the sub-cap.
// ---------------------------------------------------------------------------

{
	const { supabase, rpcCalls } = makeSupabaseRpc({
		get_project_storage_bytes: () => ({
			rows: [{ bucket_id: "post-media", file_count: 1, total_bytes: 5_000 }],
		}),
	});
	const stats = await getProjectStorageStats(supabase, "owner-1", "proj-1", null);
	assert.equal(stats.usedBytes, 5_000);
	assert.equal(stats.quotaBytes, null);
	assert.equal(stats.availableBytes, null);
	assert.equal(rpcCalls[0].args.p_owner_prefix, "owner-1/");
	assert.equal(rpcCalls[0].args.p_project_id, "proj-1");
}

{
	const { supabase } = makeSupabaseRpc({
		get_project_storage_bytes: () => ({
			rows: [{ bucket_id: "post-media", file_count: 1, total_bytes: 9_000 }],
		}),
	});
	const stats = await getProjectStorageStats(supabase, "owner-1", "proj-1", 10_000);
	assert.equal(stats.availableBytes, 1_000);
}

// ---------------------------------------------------------------------------
// assertProjectQuota: ordering of failure cases + happy path.
// ---------------------------------------------------------------------------

function ownerStubBytes(used: number): RpcResult {
	return { rows: [{ bucket_id: "post-media", file_count: 0, total_bytes: used }] };
}

// Happy path: well below both caps.
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ownerStubBytes(1_000),
		get_project_storage_bytes: () => ownerStubBytes(500),
	});
	const result = await assertProjectQuota(supabase, {
		ownerId: "owner-1",
		projectId: "proj-1",
		quotaBytes: 10_000,
		addBytes: 100,
	});
	assert.equal(result.owner.usedBytes, 1_000);
	assert.equal(result.project.usedBytes, 500);
}

// Owner cap exceeded → owner_full (status 413).
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ownerStubBytes(PAID_TIER_TEST_CAP - 10),
		get_project_storage_bytes: () => ownerStubBytes(0),
	});
	await assert.rejects(
		() =>
			assertProjectQuota(supabase, {
				ownerId: "owner-1",
				projectId: "proj-1",
				quotaBytes: null,
				addBytes: 100,
			}),
		(e: unknown) => e instanceof ProjectQuotaError && e.code === "owner_full" && e.status === 413,
	);
}

// Free-tier owner (cap = 0): even a 1-byte upload triggers owner_full.
{
	const { supabase } = makeSupabaseRpc({
		users_max_storage_bytes: 0,
		get_user_storage_stats: () => ownerStubBytes(0),
		get_project_storage_bytes: () => ownerStubBytes(0),
	});
	await assert.rejects(
		() =>
			assertProjectQuota(supabase, {
				ownerId: "free-owner",
				projectId: "proj-1",
				quotaBytes: null,
				addBytes: 1,
			}),
		(e: unknown) => e instanceof ProjectQuotaError && e.code === "owner_full",
	);
}

// Project sub-cap exceeded → project_full (owner cap is fine).
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ownerStubBytes(1_000),
		get_project_storage_bytes: () => ownerStubBytes(900),
	});
	await assert.rejects(
		() =>
			assertProjectQuota(supabase, {
				ownerId: "owner-1",
				projectId: "proj-1",
				quotaBytes: 1_000,
				addBytes: 200,
			}),
		(e: unknown) => e instanceof ProjectQuotaError && e.code === "project_full",
	);
}

// addBytes is sanitized: NaN/negative is treated as 0 so we never falsely
// reject because of a bad client-side estimate.
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ownerStubBytes(PAID_TIER_TEST_CAP),
		get_project_storage_bytes: () => ownerStubBytes(0),
	});
	// Right at the cap with addBytes=0 should NOT throw.
	const r = await assertProjectQuota(supabase, {
		ownerId: "owner-1",
		projectId: "proj-1",
		quotaBytes: null,
		addBytes: Number.NaN,
	});
	assert.equal(r.owner.usedBytes, PAID_TIER_TEST_CAP);
}

// Quota of 0 means "fully blocked" — even a 1-byte upload throws project_full.
{
	const { supabase } = makeSupabaseRpc({
		get_user_storage_stats: () => ownerStubBytes(0),
		get_project_storage_bytes: () => ownerStubBytes(0),
	});
	await assert.rejects(
		() =>
			assertProjectQuota(supabase, {
				ownerId: "owner-1",
				projectId: "proj-1",
				quotaBytes: 0,
				addBytes: 1,
			}),
		(e: unknown) => e instanceof ProjectQuotaError && e.code === "project_full",
	);
}

console.log("project-quota.test.ts ok");
})();
