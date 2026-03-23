import type { SupabaseClient } from "@supabase/supabase-js";

/** True if the user created the workflow or is in workflow_added_by. */
export async function userCanAccessWorkflow(
	supabase: SupabaseClient,
	workflow: { created_by: string },
	workflowId: string,
	userId: string,
): Promise<boolean> {
	if (workflow.created_by === userId) return true;
	const { data } = await supabase
		.from("workflow_added_by")
		.select("user_id")
		.eq("workflow_id", workflowId)
		.eq("user_id", userId)
		.maybeSingle();
	return !!data;
}
