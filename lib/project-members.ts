import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";
import { whopsdk } from "@/lib/whop-sdk";
import type { ProjectRole } from "@/lib/project-access";

/**
 * Member + invite helpers shared between extension API routes and dashboard
 * server actions.
 */

export interface ProjectMemberRow {
	project_id: string;
	user_id: string;
	role: ProjectRole;
	invited_by: string | null;
	accepted_at: string;
	created_at: string;
	updated_at: string;
	user: {
		id: string;
		name: string | null;
		email: string | null;
		whop_user_id: string | null;
	};
}

export async function listProjectMembers(
	supabase: SupabaseClient,
	projectId: string,
): Promise<ProjectMemberRow[]> {
	const { data, error } = await supabase
		.from("project_members")
		.select(`
			project_id,
			user_id,
			role,
			invited_by,
			accepted_at,
			created_at,
			updated_at,
			user:users!project_members_user_id_fkey(id, name, email, whop_user_id)
		`)
		.eq("project_id", projectId)
		.order("created_at", { ascending: true });

	if (error) {
		console.error("[project-members] list failed:", error.message);
		return [];
	}

	return (data ?? []).map((row) => {
		const userRel = Array.isArray(row.user) ? row.user[0] : row.user;
		return {
			project_id: row.project_id as string,
			user_id: row.user_id as string,
			role: row.role as ProjectRole,
			invited_by: (row.invited_by as string | null) ?? null,
			accepted_at: row.accepted_at as string,
			created_at: row.created_at as string,
			updated_at: row.updated_at as string,
			user: {
				id: (userRel?.id as string) ?? (row.user_id as string),
				name: (userRel?.name as string | null) ?? null,
				email: (userRel?.email as string | null) ?? null,
				whop_user_id: (userRel?.whop_user_id as string | null) ?? null,
			},
		};
	});
}

export type ResolveUserResult =
	| { ok: true; userId: string; alreadyExisted: boolean }
	| { ok: false; error: string; status: number };

/**
 * Resolve a user identifier (Whop user id, Whop username, email, or internal
 * user id) to an internal `users.id`.
 *
 * Strategy:
 *  1. If it looks like an internal UUID and exists in `users`, use it.
 *  2. If it starts with `user_` (Whop pattern) or matches `whop_user_id` in
 *     our `users` table, try a Whop SDK retrieve and ensure the user row.
 *  3. Otherwise treat it as an email and look up `users.email`.
 *  4. Otherwise treat as `users.name` (case-insensitive contains a `@`).
 */
export async function resolveUserIdentifier(
	supabase: SupabaseClient,
	raw: string,
): Promise<ResolveUserResult> {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, error: "Identifier is required", status: 400 };

	const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
	const looksLikeWhopId = /^user_[A-Za-z0-9]+$/.test(trimmed);
	const looksLikeEmail = trimmed.includes("@") && !trimmed.startsWith("@");
	const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;

	if (looksLikeUuid) {
		const { data } = await supabase.from("users").select("id").eq("id", trimmed).maybeSingle();
		if (data?.id) return { ok: true, userId: data.id as string, alreadyExisted: true };
	}

	if (looksLikeWhopId) {
		const { data: existing } = await supabase
			.from("users")
			.select("id")
			.eq("whop_user_id", trimmed)
			.maybeSingle();
		if (existing?.id) return { ok: true, userId: existing.id as string, alreadyExisted: true };
		try {
			const whopUser = await whopsdk.users.retrieve(trimmed);
			const u = whopUser as {
				id?: string;
				email?: string | null;
				name?: string | null;
				username?: string | null;
			};
			const userId = await ensureInternalUserFromWhop(u.id ?? trimmed, {
				email: u.email,
				name: u.name,
				username: u.username,
			});
			return { ok: true, userId, alreadyExisted: false };
		} catch (e) {
			return {
				ok: false,
				error: `Whop user not found: ${e instanceof Error ? e.message : String(e)}`,
				status: 404,
			};
		}
	}

	if (looksLikeEmail) {
		const { data } = await supabase
			.from("users")
			.select("id")
			.ilike("email", trimmed)
			.maybeSingle();
		if (data?.id) return { ok: true, userId: data.id as string, alreadyExisted: true };
		return { ok: false, error: "No user with that email — ask them to sign in once first.", status: 404 };
	}

	const { data: byUsername } = await supabase
		.from("users")
		.select("id")
		.or(`name.ilike.@${handle},name.ilike.${handle}`)
		.limit(2);
	if (byUsername && byUsername.length === 1) {
		return { ok: true, userId: byUsername[0].id as string, alreadyExisted: true };
	}
	if (byUsername && byUsername.length > 1) {
		return { ok: false, error: "Multiple users match that handle; use email or Whop user id.", status: 409 };
	}

	return { ok: false, error: "User not found. Try an email or Whop user id (user_…).", status: 404 };
}

/**
 * Generate a random URL-safe invite token.
 */
export function generateInviteToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * True if removing this membership would leave the project owner-less.
 */
export async function isLastOwner(
	supabase: SupabaseClient,
	projectId: string,
	userId: string,
): Promise<boolean> {
	const { count } = await supabase
		.from("project_members")
		.select("user_id", { count: "exact", head: true })
		.eq("project_id", projectId)
		.eq("role", "owner")
		.neq("user_id", userId);
	return (count ?? 0) === 0;
}

export interface ProjectInviteRow {
	id: string;
	project_id: string;
	role: ProjectRole;
	token: string;
	created_by: string | null;
	expires_at: string | null;
	used_by: string | null;
	used_at: string | null;
	revoked_at: string | null;
	created_at: string;
}

export async function listActiveInvites(
	supabase: SupabaseClient,
	projectId: string,
): Promise<ProjectInviteRow[]> {
	const { data, error } = await supabase
		.from("project_invites")
		.select("id, project_id, role, token, created_by, expires_at, used_by, used_at, revoked_at, created_at")
		.eq("project_id", projectId)
		.is("revoked_at", null)
		.is("used_at", null)
		.order("created_at", { ascending: false });
	if (error) {
		console.error("[project-members] list invites failed:", error.message);
		return [];
	}
	return (data ?? []) as ProjectInviteRow[];
}
