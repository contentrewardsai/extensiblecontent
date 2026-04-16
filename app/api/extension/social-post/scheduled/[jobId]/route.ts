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
 * DELETE: Cancel a scheduled post via backend proxy.
 * Query: ?profile_username=
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { jobId } = await params;
	const profileUsername = request.nextUrl.searchParams.get("profile_username") ?? "";
	const supabase = getSupabase();

	const result = await proxyUploadPostRequest(
		supabase, user.user_id, profileUsername,
		"DELETE", `/api/uploadposts/schedule/${encodeURIComponent(jobId)}`,
	);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json(result.json, { status: result.status });
}
