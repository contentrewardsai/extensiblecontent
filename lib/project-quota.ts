import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Storage quota enforcement for the post-media buckets.
 *
 * Two caps stack:
 *   1. Owner cap (`OWNER_DEFAULT_MAX_BYTES`) — global per-user limit, identical
 *      to what `app/api/extension/social-post/storage/route.ts` reports.
 *   2. Project cap (`projects.quota_bytes`) — optional per-project sub-cap set
 *      by the owner. Null means "no sub-cap; share the owner's pool with the
 *      project's siblings".
 *
 * All file paths live under the *owner's* user prefix (`${owner_id}/...`), so
 * collaborators uploading on a shared project still consume the owner's pool.
 */

export const OWNER_DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
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
 * Sum bytes across both post-media buckets for the owner's user prefix.
 */
export async function getOwnerStorageStats(
	supabase: SupabaseClient,
	ownerId: string,
): Promise<OwnerStorageStats> {
	const { data, error } = await supabase.rpc("get_user_storage_stats", {
		p_user_prefix: `${ownerId}/`,
		p_bucket_ids: POST_MEDIA_BUCKETS as unknown as string[],
	});
	if (error) {
		throw new Error(`getOwnerStorageStats: ${error.message}`);
	}
	const usedBytes = sumTotalBytes(data as BucketStatsRow[] | null);
	return {
		usedBytes,
		maxBytes: OWNER_DEFAULT_MAX_BYTES,
		availableBytes: Math.max(0, OWNER_DEFAULT_MAX_BYTES - usedBytes),
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
