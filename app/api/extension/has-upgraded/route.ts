import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { countUploadPostAccountsForUser } from "@/lib/upload-post-account-limits";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Pro / upgrade flag plus Upload-Post (Connected) account counts for extension UI.
 * `num_accounts` / `max_accounts` align with POST /api/extension/social-profiles limits.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("users")
		.select("has_upgraded, max_upload_post_accounts")
		.eq("id", user.user_id)
		.single();

	if (error || !data) {
		return Response.json({ error: "User not found" }, { status: 404 });
	}

	const has_upgraded = !!data.has_upgraded;
	const max_accounts = data.max_upload_post_accounts ?? 0;
	const num_accounts = await countUploadPostAccountsForUser(supabase, user.user_id);

	return Response.json({
		has_upgraded,
		pro: has_upgraded,
		num_accounts,
		max_accounts,
	});
}
