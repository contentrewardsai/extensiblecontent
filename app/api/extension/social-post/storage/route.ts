import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { listAccessibleProjects } from "@/lib/project-access";
import {
	getOwnerMaxStorageBytes,
	getProjectStorageStats,
	POST_MEDIA_BUCKETS,
} from "@/lib/project-quota";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET: Return user's storage quota info plus per-project usage rows.
 *
 * The top-level `used_bytes` / `limit_bytes` fields stay user-scoped (they
 * count files where the caller is the owner) so older extension builds keep
 * working. The new `projects` array exposes per-project usage and quota for
 * shared and owned projects so the dashboard / extension can render per-bar
 * usage without extra round-trips.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();

	const [{ data: ownerStatsRows, error: ownerErr }, ownerMaxBytes] = await Promise.all([
		supabase.rpc("get_user_storage_stats", {
			p_user_prefix: `${user.user_id}/`,
			p_bucket_ids: POST_MEDIA_BUCKETS as unknown as string[],
		}),
		getOwnerMaxStorageBytes(supabase, user.user_id),
	]);
	if (ownerErr) {
		return Response.json({ error: ownerErr.message }, { status: 500 });
	}

	const rows = (ownerStatsRows ?? []) as { bucket_id: string; file_count: number; total_bytes: number }[];
	let totalBytes = 0;
	let fileCount = 0;
	let publicCount = 0;
	let privateCount = 0;

	for (const row of rows) {
		totalBytes += Number(row.total_bytes);
		fileCount += Number(row.file_count);
		if (row.bucket_id === "post-media-private") {
			privateCount = Number(row.file_count);
		} else {
			publicCount = Number(row.file_count);
		}
	}

	const accessible = await listAccessibleProjects(supabase, user.user_id);

	const projects: Array<{
		project_id: string;
		name: string;
		owner_id: string;
		role: "owner" | "editor" | "viewer";
		used_bytes: number;
		quota_bytes: number | null;
	}> = [];

	for (const project of accessible) {
		try {
			const stats = await getProjectStorageStats(supabase, project.owner_id, project.id, project.quota_bytes);
			projects.push({
				project_id: project.id,
				name: project.name,
				owner_id: project.owner_id,
				role: project.role,
				used_bytes: stats.usedBytes,
				quota_bytes: project.quota_bytes,
			});
		} catch (e) {
			console.error("[storage] per-project stats failed:", project.id, e);
		}
	}

	return Response.json({
		ok: true,
		used_bytes: totalBytes,
		// `max_bytes` and `limit_bytes` are aliases. The extension reads
		// `limit_bytes` / `limitBytes` (background/service-worker.js GET_STORAGE_INFO);
		// older internal callers read `max_bytes`. Keep both so neither breaks.
		max_bytes: ownerMaxBytes,
		limit_bytes: ownerMaxBytes,
		file_count: fileCount,
		public_count: publicCount,
		private_count: privateCount,
		projects,
	});
}
