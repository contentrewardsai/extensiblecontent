import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_TIER_MAX_STORAGE_BYTES } from "@/lib/plan-tiers";

/**
 * Storage quota enforcement for the post-media buckets.
 *
 * Two caps stack:
 *   1. Owner cap — per-user limit driven by the owner's active subscription
 *      tier. Stored on `users.max_storage_bytes` and materialized by
 *      `lib/plan-entitlements.ts` whenever a Whop webhook arrives. Free
 *      users get **0 bytes** (`FREE_TIER_MAX_STORAGE_BYTES`); paid tiers
 *      raise it to 10 / 40 / 100 GB. The column default is also 0.
 *   2. Project cap (`projects.quota_bytes`) — optional per-project sub-cap set
 *      by the owner. Null means "no sub-cap; share the owner's pool with the
 *      project's siblings".
 *
 * All file paths live under the *owner's* user prefix (`${owner_id}/...`), so
 * collaborators uploading on a shared project still consume the owner's pool.
 * That's how an invited free user can still upload to a paying owner's
 * project even though their own cap is 0.
 */

/**
 * Fallback owner cap when the row is missing entirely. Same value as
 * `FREE_TIER_MAX_STORAGE_BYTES` (now 0), so a missing row behaves the same
 * as an unentitled free user.
 *
 * @deprecated Read from `users.max_storage_bytes` via `getOwnerStorageStats`.
 *   Re-exports `FREE_TIER_MAX_STORAGE_BYTES` for callers that need a
 *   compile-time constant.
 */
export const OWNER_DEFAULT_MAX_BYTES = FREE_TIER_MAX_STORAGE_BYTES;
export const POST_MEDIA_BUCKETS = ["post-media", "post-media-private"] as const;

export class ProjectQuotaError extends Error {
	readonly status: number;
	readonly code: "owner_full" | "project_full";
	constructor(code: "owner_full" | "project_full", message: string, status = 413) {
		super(message);
		this.name = "ProjectQuotaError";
		this.code = code;
		this.status = status;
	}
}

export interface OwnerStorageStats {
	usedBytes: number;
	maxBytes: number;
	availableBytes: number;
}

export interface ProjectStorageStats {
	usedBytes: number;
	quotaBytes: number | null;
	availableBytes: number | null;
}

interface BucketStatsRow {
	bucket_id: string;
	file_count: number;
	total_bytes: number;
}

function sumTotalBytes(rows: BucketStatsRow[] | null | undefined): number {
	if (!rows) return 0;
	return rows.reduce((acc, row) => acc + Number(row.total_bytes ?? 0), 0);
}

/**
 * Look up the owner's effective storage cap from `users.max_storage_bytes`.
 * Falls back to `FREE_TIER_MAX_STORAGE_BYTES` if the row is missing or the
 * value is not a positive integer (defensive — the column is `NOT NULL` with
 * a default in the schema).
 */
export async function getOwnerMaxStorageBytes(
	supabase: SupabaseClient,
	ownerId: string,
): Promise<number> {
	const { data, error } = await supabase
		.from("users")
		.select("max_storage_bytes")
		.eq("id", ownerId)
		.maybeSingle();
	if (error) {
		console.warn(`[project-quota] getOwnerMaxStorageBytes lookup failed for ${ownerId}:`, error);
		return FREE_TIER_MAX_STORAGE_BYTES;
	}
	const raw = (data as { max_storage_bytes: number | string | null } | null)?.max_storage_bytes;
	const n = raw == null ? NaN : Number(raw);
	if (!Number.isFinite(n) || n <= 0) return FREE_TIER_MAX_STORAGE_BYTES;
	return Math.floor(n);
}

/**
 * Sum bytes across both post-media buckets for the owner's user prefix.
 */
export async function getOwnerStorageStats(
	supabase: SupabaseClient,
	ownerId: string,
): Promise<OwnerStorageStats> {
	const [{ data, error }, maxBytes] = await Promise.all([
		supabase.rpc("get_user_storage_stats", {
			p_user_prefix: `${ownerId}/`,
			p_bucket_ids: POST_MEDIA_BUCKETS as unknown as string[],
		}),
		getOwnerMaxStorageBytes(supabase, ownerId),
	]);
	if (error) {
		throw new Error(`getOwnerStorageStats: ${error.message}`);
	}
	const usedBytes = sumTotalBytes(data as BucketStatsRow[] | null);
	return {
		usedBytes,
		maxBytes,
		availableBytes: Math.max(0, maxBytes - usedBytes),
	};
}

/**
 * Per-project byte usage, scoped to the owner's prefix.
 */
export async function getProjectStorageStats(
	supabase: SupabaseClient,
	ownerId: string,
	projectId: string,
	quotaBytes: number | null,
): Promise<ProjectStorageStats> {
	const { data, error } = await supabase.rpc("get_project_storage_bytes", {
		p_owner_prefix: `${ownerId}/`,
		p_project_id: projectId,
		p_bucket_ids: POST_MEDIA_BUCKETS as unknown as string[],
	});
	if (error) {
		throw new Error(`getProjectStorageStats: ${error.message}`);
	}
	const usedBytes = sumTotalBytes(data as BucketStatsRow[] | null);
	return {
		usedBytes,
		quotaBytes,
		availableBytes: quotaBytes == null ? null : Math.max(0, quotaBytes - usedBytes),
	};
}

interface AssertProjectQuotaOptions {
	ownerId: string;
	projectId: string;
	quotaBytes: number | null;
	addBytes: number;
}

/**
 * Throw `ProjectQuotaError` when the upload would push past either cap.
 * `quotaBytes` of `null` skips the project sub-cap check.
 */
export async function assertProjectQuota(
	supabase: SupabaseClient,
	{ ownerId, projectId, quotaBytes, addBytes }: AssertProjectQuotaOptions,
): Promise<{ owner: OwnerStorageStats; project: ProjectStorageStats }> {
	const safeAdd = Number.isFinite(addBytes) && addBytes > 0 ? Math.floor(addBytes) : 0;
	const [owner, project] = await Promise.all([
		getOwnerStorageStats(supabase, ownerId),
		getProjectStorageStats(supabase, ownerId, projectId, quotaBytes),
	]);

	if (owner.usedBytes + safeAdd > owner.maxBytes) {
		throw new ProjectQuotaError(
			"owner_full",
			`Project owner has only ${owner.availableBytes} bytes free of ${owner.maxBytes}.`,
		);
	}
	if (
		project.quotaBytes != null &&
		project.usedBytes + safeAdd > project.quotaBytes
	) {
		throw new ProjectQuotaError(
			"project_full",
			`Project has only ${project.availableBytes} bytes free of ${project.quotaBytes}.`,
		);
	}

	return { owner, project };
}

/**
 * Validate a proposed quota: must be a non-negative integer (or null) and must
 * not exceed the owner cap. Returns the normalized value.
 */
export function normalizeQuotaInput(raw: unknown): number | null {
	if (raw == null || raw === "") return null;
	if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
		return Math.floor(raw);
	}
	if (typeof raw === "string" && raw.trim()) {
		const n = Number(raw.trim());
		if (Number.isFinite(n) && n >= 0) return Math.floor(n);
	}
	throw new ProjectQuotaError("project_full", "quota_bytes must be a non-negative integer or null", 400);
}
