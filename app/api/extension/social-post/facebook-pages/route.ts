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
 * GET: List Facebook pages available for posting.
 * Query: ?profile_username=
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const profileUsername = request.nextUrl.searchParams.get("profile_username") ?? "";
	const supabase = getSupabase();

	const queryParams = new URLSearchParams();
	queryParams.set("profile_username", profileUsername);

	const result = await proxyUploadPostRequest(
		supabase, user.user_id, profileUsername,
		"GET", "/api/uploadposts/facebook/pages",
		{ queryParams },
	);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json(result.json, { status: result.status });
}
