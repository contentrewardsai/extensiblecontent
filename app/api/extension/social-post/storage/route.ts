import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKETS = ["post-media", "post-media-private"];
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB default (shared across both buckets)

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Return user's storage quota info.
 * Uses get_user_storage_stats RPC to query across both buckets.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();

	const { data, error } = await supabase.rpc("get_user_storage_stats", {
		p_user_prefix: `${user.user_id}/`,
		p_bucket_ids: BUCKETS,
	});

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const rows = (data ?? []) as { bucket_id: string; file_count: number; total_bytes: number }[];
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

	return Response.json({
		ok: true,
		used_bytes: totalBytes,
		max_bytes: DEFAULT_MAX_BYTES,
		file_count: fileCount,
		public_count: publicCount,
		private_count: privateCount,
	});
}
