import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { forwardUploadPostMultipart } from "@/lib/upload-post-forward";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Proxy Upload-Post photo/video upload (Method B - cloud posting).
 * Extension sends multipart form like Upload-Post API, plus:
 * - account_id: our upload_post_accounts.id
 * - endpoint: "photos" | "video" (for /api/upload_photos or /api/upload)
 *
 * We verify user owns the account, then forward to Upload-Post with our key
 * and user=upload_post_username.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return Response.json({ error: "multipart/form-data required" }, { status: 400 });
	}

	const formData = await request.formData();
	const supabase = getSupabase();
	const result = await forwardUploadPostMultipart(supabase, user.user_id, formData);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json(result.json, { status: result.status });
}
