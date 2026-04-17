import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { countUploadPostAccountsForUser } from "@/lib/upload-post-account-limits";
import { isUserEntitled } from "@/lib/user-entitlement";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Pro / upgrade flag plus Upload-Post (Connected) account counts for
 * the extension UI.
 *
 * Response shape:
 *   - `has_upgraded` / `pro`: legacy `users.has_upgraded` flag (paid subscription).
 *   - `entitled`: true when the user can access premium features. Currently
 *     `has_upgraded || (member of a project owned by a paid user)`. Use this
 *     in the extension to gate the upgrade nag — a free user invited to a
 *     paying user's project shouldn't be told to upgrade.
 *   - `entitled_via`: `'paid' | 'project_member' | null` so the UI can
 *     surface "you have access via project X" instead of "buy a plan".
 *   - `num_accounts` / `max_accounts`: upload-post account quota (unchanged).
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
	const [num_accounts, entitlement] = await Promise.all([
		countUploadPostAccountsForUser(supabase, user.user_id),
		isUserEntitled(supabase, user.user_id),
	]);

	return Response.json({
		has_upgraded,
		pro: has_upgraded,
		entitled: entitlement.entitled,
		entitled_via: entitlement.reason,
		num_accounts,
		max_accounts,
	});
}
