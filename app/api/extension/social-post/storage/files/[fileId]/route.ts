import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * DELETE: Delete an uploaded file from user's storage.
 * Supports nested paths via ?path= query param (e.g. {projectId}/posts/videos/{fileId}).
 * Use ?private=true to delete from the private bucket.
 * Falls back to fileId route param for backward compatibility with flat storage.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { fileId } = await params;
	const relativePath = request.nextUrl.searchParams.get("path") || fileId;
	const isPrivate = request.nextUrl.searchParams.get("private") === "true";
	const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
	const supabase = getSupabase();

	const filePath = `${user.user_id}/${relativePath}`;

	const { error } = await supabase.storage
		.from(bucket)
		.remove([filePath]);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json({ ok: true });
}
