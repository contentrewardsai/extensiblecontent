import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True if the user has any membership (owner / editor / viewer) on the project.
 *
 * Historically this checked `projects.user_id`; with project sharing live, we
 * check membership instead so collaborators can switch a sidebar onto a shared
 * project. Use `assertProjectAccess` from `lib/project-access.ts` when you
 * need a stricter role check.
 */
export async function isProjectOwnedByUser(
	supabase: SupabaseClient,
	userId: string,
	projectId: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("project_members")
		.select("user_id")
		.eq("project_id", projectId)
		.eq("user_id", userId)
		.maybeSingle();
	if (error) {
		console.error("[sidebar-project] membership lookup:", error);
		return false;
	}
	return !!data;
}
