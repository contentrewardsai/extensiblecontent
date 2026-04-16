import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { proxyUploadPostRequest } from "@/lib/upload-post-proxy";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Fetch engagement/reach analytics via backend proxy.
 * Body: { profile_username, platform, ... }
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
	const payload: Record<string, unknown> = { ...body };
	delete payload.profile_username;
	payload.username = profileUsername;

	const result = await proxyUploadPostRequest(
		supabase, user.user_id, profileUsername,
		"POST", "/api/uploadposts/analytics",
		{ body: payload },
	);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json(result.json, { status: result.status });
}
