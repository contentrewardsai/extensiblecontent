import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET = "post-media";
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024; // 500 MB default

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Return user's storage quota info.
 * Queries storage.objects directly to count all files recursively under the user's prefix.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const prefix = `${user.user_id}/`;

	const { data: objects, error } = await supabase
		.schema("storage")
		.from("objects")
		.select("metadata")
		.eq("bucket_id", BUCKET)
		.like("name", `${prefix}%`);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	let totalBytes = 0;
	let fileCount = 0;
	for (const obj of objects ?? []) {
		const meta = obj.metadata as Record<string, unknown> | null;
		if (typeof meta?.size === "number") totalBytes += meta.size;
		fileCount++;
	}

	return Response.json({
		ok: true,
		bucket: BUCKET,
		used_bytes: totalBytes,
		max_bytes: DEFAULT_MAX_BYTES,
		file_count: fileCount,
	});
}
