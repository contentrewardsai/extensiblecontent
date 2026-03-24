import { getServiceSupabase } from "@/lib/supabase-service";

export async function getInternalUserIdForWhopUser(whopUserId: string): Promise<string | null> {
	const supabase = getServiceSupabase();
	const { data } = await supabase.from("users").select("id").eq("whop_user_id", whopUserId).maybeSingle();
	return data?.id ?? null;
}

/**
 * Ensures a `users` row exists for this Whop subject (same strategy as extension OAuth).
 */
export async function ensureInternalUserFromWhop(
	whopUserId: string,
	profile?: { email?: string | null; name?: string | null; username?: string | null },
): Promise<string> {
	const supabase = getServiceSupabase();
	const existing = await getInternalUserIdForWhopUser(whopUserId);
	if (existing) return existing;

	const email = profile?.email?.trim() || `${whopUserId}@whop.placeholder`;
	const name =
		profile?.name?.trim() ||
		(profile?.username ? `@${profile.username}` : null) ||
		null;

	const { data: upserted, error } = await supabase
		.from("users")
		.upsert(
			{
				email,
				whop_user_id: whopUserId,
				name,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "email" },
		)
		.select("id")
		.single();

	if (error || !upserted) {
		throw new Error(error?.message ?? "Failed to create user");
	}

	return upserted.id as string;
}
