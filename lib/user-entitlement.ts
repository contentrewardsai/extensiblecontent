import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Entitlement check used by every "premium" gate in the extension API.
 *
 * A user is **entitled** when:
 *   - They have an active paid Whop subscription (`users.has_upgraded = true`).
 *   - Or they are a member (any role) of at least one project whose `owner_id`
 *     points at a paid (`has_upgraded`) user. That covers the "free user
 *     invited to a paying user's project" case: they don't get the global
 *     library, but the paying owner is footing the bill so they get
 *     project-scoped access (workflows, templates, remote sidebar control).
 *
 * Returns `{ entitled, reason }`. `reason` is the *why* — the upgrade-screen
 * uses it to switch the CTA from "buy a plan" to "you're already in via
 * project X" when applicable.
 */

export type EntitlementReason = "paid" | "project_member";

export interface UserEntitlement {
	entitled: boolean;
	reason: EntitlementReason | null;
}

const NOT_ENTITLED: UserEntitlement = { entitled: false, reason: null };

/**
 * Resolve the user's entitlement. Single round-trip per branch:
 *   1. Read `users.has_upgraded` for the actor.
 *   2. If false, look up the actor's `project_members` rows joined to
 *      `projects.owner_id` -> `users.has_upgraded`. Any match wins.
 *
 * Errors are logged and treated as "not entitled" so a transient DB blip
 * never accidentally elevates a free user.
 */
export async function isUserEntitled(
	supabase: SupabaseClient,
	userId: string,
): Promise<UserEntitlement> {
	if (!userId) return NOT_ENTITLED;

	const { data: actor, error: actorErr } = await supabase
		.from("users")
		.select("has_upgraded")
		.eq("id", userId)
		.maybeSingle();
	if (actorErr) {
		console.warn(`[user-entitlement] users lookup failed for ${userId}:`, actorErr);
		return NOT_ENTITLED;
	}
	if ((actor as { has_upgraded?: boolean } | null)?.has_upgraded) {
		return { entitled: true, reason: "paid" };
	}

	// Two-step lookup avoids relying on PostgREST's FK-name resolution for
	// embedded selects: (a) collect distinct project IDs the user is a
	// member of, (b) ask whether any of those projects is owned by a paid
	// user. Returns early as soon as we find a paying sponsor.
	const { data: memberships, error: memberErr } = await supabase
		.from("project_members")
		.select("project_id")
		.eq("user_id", userId);

	if (memberErr) {
		console.warn(`[user-entitlement] project_members lookup failed for ${userId}:`, memberErr);
		return NOT_ENTITLED;
	}

	const projectIds = Array.from(
		new Set(
			((memberships ?? []) as Array<{ project_id: string | null }>)
				.map((m) => m.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);
	if (projectIds.length === 0) return NOT_ENTITLED;

	const { data: ownerRows, error: ownerErr } = await supabase
		.from("projects")
		.select("owner_id, owner:users!inner(has_upgraded)")
		.in("id", projectIds)
		.eq("owner.has_upgraded", true)
		.limit(1);

	if (ownerErr) {
		console.warn(`[user-entitlement] sponsoring-owner lookup failed for ${userId}:`, ownerErr);
		return NOT_ENTITLED;
	}
	if ((ownerRows ?? []).length > 0) {
		return { entitled: true, reason: "project_member" };
	}
	return NOT_ENTITLED;
}

/**
 * Convenience: returns just the boolean. Use when you only need the gate
 * decision and don't care about the reason.
 */
export async function userIsEntitled(
	supabase: SupabaseClient,
	userId: string,
): Promise<boolean> {
	return (await isUserEntitled(supabase, userId)).entitled;
}
