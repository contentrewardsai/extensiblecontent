import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { resolveUploadPostAccount, forwardUploadPostJson } from "@/lib/upload-post-proxy";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Proxy social post upload through backend.
 * Body: JSON with postType, platform, title, description, video_url/photo_urls, profile_username.
 * Routes to the appropriate Upload Post endpoint based on postType.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const profileUsername = body.profile_username as string;
	if (!profileUsername) {
		return Response.json({ error: "profile_username is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const resolved = await resolveUploadPostAccount(supabase, user.user_id, profileUsername);
	if (!resolved.ok) {
		return Response.json({ error: resolved.error }, { status: resolved.status });
	}

	const postType = (body.postType as string) || "text";
	let apiPath: string;
	switch (postType) {
		case "video":
			apiPath = "/api/upload";
			break;
		case "photo":
			apiPath = "/api/upload_photos";
			break;
		default:
			apiPath = "/api/upload_text";
			break;
	}

	const payload: Record<string, unknown> = { ...body };
	delete payload.profile_username;
	payload.user = resolved.account.upload_post_username;

	const result = await forwardUploadPostJson("POST", apiPath, resolved.account.apiKey, { body: payload });

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json(result.json, { status: result.status });
}
