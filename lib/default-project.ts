import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the project_id to use when an extension call doesn't provide one.
 *
 * Resolution order:
 *  1. `users.default_project_id` if set and the project still exists for this user.
 *  2. The user's most recently updated project (and persist it as the new default).
 *  3. Create a fresh `"Default"` project for the user, persist it as the default,
 *     and return its id.
 *
 * The returned id is always a real `projects.id` owned by the caller — safe to
 * embed in storage paths like `${user_id}/${project_id}/posts/...`.
 *
 * `defaultName` controls the name of the auto-created project (only used in
 * branch 3); pass a different value if a feature wants a more specific label.
 */
export async function ensureUserDefaultProjectId(
	supabase: SupabaseClient,
	userId: string,
	defaultName = "Default",
): Promise<string> {
	if (!userId) throw new Error("ensureUserDefaultProjectId: userId is required");

	const { data: userRow, error: userErr } = await supabase
		.from("users")
		.select("default_project_id")
		.eq("id", userId)
		.single();

	if (userErr) {
		throw new Error(`ensureUserDefaultProjectId: ${userErr.message}`);
	}

	const currentDefault = userRow?.default_project_id ?? null;
	if (currentDefault) {
		const { data: project } = await supabase
			.from("projects")
			.select("id")
			.eq("id", currentDefault)
			.eq("owner_id", userId)
			.maybeSingle();
		if (project?.id) return project.id;
	}

	const { data: existing } = await supabase
		.from("projects")
		.select("id")
		.eq("owner_id", userId)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (existing?.id) {
		await supabase
			.from("users")
			.update({ default_project_id: existing.id, updated_at: new Date().toISOString() })
			.eq("id", userId);
		return existing.id;
	}

	const { data: created, error: createErr } = await supabase
		.from("projects")
		.insert({ user_id: userId, owner_id: userId, name: defaultName })
		.select("id")
		.single();

	if (createErr || !created?.id) {
		throw new Error(`ensureUserDefaultProjectId: failed to create default project: ${createErr?.message ?? "no row returned"}`);
	}

	await supabase
		.from("users")
		.update({ default_project_id: created.id, updated_at: new Date().toISOString() })
		.eq("id", userId);

	return created.id;
}
