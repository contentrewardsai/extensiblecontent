import type { SupabaseClient } from "@supabase/supabase-js";

/** True if `projectId` exists and `projects.user_id` matches (extension API guard). */
export async function isProjectOwnedByUser(
	supabase: SupabaseClient,
	userId: string,
	projectId: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("projects")
		.select("id")
		.eq("id", projectId)
		.eq("user_id", userId)
		.maybeSingle();
	if (error) {
		console.error("[sidebar-project] project lookup:", error);
		return false;
	}
	return !!data;
}
