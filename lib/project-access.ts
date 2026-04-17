import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Membership-based access checks for `public.projects`.
 *
 * Replaces the historical `.eq("user_id", userId)` pattern: callers ask whether
 * a user can `view` / `edit` / `own` a project, and helpers below resolve the
 * project owner so storage paths always live under the owner's user prefix
 * (which keeps `get_user_storage_stats` attributing every byte to the owner).
 */

export type ProjectRole = "owner" | "editor" | "viewer";

const ROLE_RANK: Record<ProjectRole, number> = {
	viewer: 1,
	editor: 2,
	owner: 3,
};

export interface ProjectMembership {
	role: ProjectRole;
	ownerId: string;
	projectId: string;
}

export class ProjectAccessError extends Error {
	readonly status: number;
	constructor(message: string, status = 403) {
		super(message);
		this.name = "ProjectAccessError";
		this.status = status;
	}
}

function normalizeRole(raw: unknown): ProjectRole | null {
	if (raw === "owner" || raw === "editor" || raw === "viewer") return raw;
	return null;
}

/**
 * Resolve the actor's role on `projectId`, plus the project owner's user id.
 * Returns `null` when the project doesn't exist or the user isn't a member.
 */
export async function getProjectMembership(
	supabase: SupabaseClient,
	projectId: string,
	userId: string,
): Promise<ProjectMembership | null> {
	if (!projectId || !userId) return null;

	const [{ data: project }, { data: member }] = await Promise.all([
		supabase.from("projects").select("id, owner_id").eq("id", projectId).maybeSingle(),
		supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", userId)
			.maybeSingle(),
	]);

	if (!project?.id) return null;
	const role = normalizeRole(member?.role);
	if (!role) return null;

	return {
		role,
		ownerId: project.owner_id as string,
		projectId: project.id as string,
	};
}

/**
 * Resolve the project owner without checking membership. Throws if missing.
 */
export async function resolveProjectOwnerId(
	supabase: SupabaseClient,
	projectId: string,
): Promise<string> {
	const { data, error } = await supabase
		.from("projects")
		.select("owner_id")
		.eq("id", projectId)
		.maybeSingle();
	if (error) {
		throw new ProjectAccessError(error.message, 500);
	}
	if (!data?.owner_id) {
		throw new ProjectAccessError("Project not found", 404);
	}
	return data.owner_id as string;
}

/**
 * Throw `ProjectAccessError` with 404/403 if the user can't act on `projectId`
 * at the requested role. Returns the resolved membership on success.
 */
export async function assertProjectAccess(
	supabase: SupabaseClient,
	projectId: string,
	userId: string,
	required: ProjectRole = "viewer",
): Promise<ProjectMembership> {
	const membership = await getProjectMembership(supabase, projectId, userId);
	if (!membership) {
		throw new ProjectAccessError("Project not found", 404);
	}
	if (ROLE_RANK[membership.role] < ROLE_RANK[required]) {
		throw new ProjectAccessError(`Requires ${required} role on project`, 403);
	}
	return membership;
}

/**
 * Whether the actor can act at `required` role. Pure utility; used by guard
 * helpers and unit tests.
 */
export function roleSatisfies(actor: ProjectRole, required: ProjectRole): boolean {
	return ROLE_RANK[actor] >= ROLE_RANK[required];
}

export interface ProjectListEntry {
	id: string;
	name: string;
	description: string | null;
	quota_bytes: number | null;
	owner_id: string;
	role: ProjectRole;
	created_at: string;
	updated_at: string;
}

/**
 * Return every project the user can access (owned + member-of), oldest-first
 * for the owner row, then by `updated_at desc`.
 */
export async function listAccessibleProjects(
	supabase: SupabaseClient,
	userId: string,
): Promise<ProjectListEntry[]> {
	if (!userId) return [];

	const { data: memberRows, error: memberErr } = await supabase
		.from("project_members")
		.select("role, projects:project_id(id, name, description, quota_bytes, owner_id, created_at, updated_at)")
		.eq("user_id", userId);

	if (memberErr) throw new ProjectAccessError(memberErr.message, 500);

	const out: ProjectListEntry[] = [];
	for (const row of memberRows ?? []) {
		const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
		if (!project?.id) continue;
		const role = normalizeRole(row.role);
		if (!role) continue;
		out.push({
			id: project.id as string,
			name: (project.name as string) ?? "",
			description: (project.description as string | null) ?? null,
			quota_bytes: (project.quota_bytes as number | null) ?? null,
			owner_id: project.owner_id as string,
			role,
			created_at: project.created_at as string,
			updated_at: project.updated_at as string,
		});
	}

	out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	return out;
}
