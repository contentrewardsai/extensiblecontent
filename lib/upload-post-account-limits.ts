import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Count of upload_post_accounts for a user (same table POST /api/extension/social-profiles uses).
 */
export async function countUploadPostAccountsForUser(
	supabase: SupabaseClient,
	userId: string
): Promise<number> {
	const { count } = await supabase
		.from("upload_post_accounts")
		.select("*", { count: "exact", head: true })
		.eq("user_id", userId);
	return count ?? 0;
}
