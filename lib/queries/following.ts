import type { SupabaseClient } from "@supabase/supabase-js";
import type { Following } from "@/lib/types/following";

export async function followingWithJoins(supabase: SupabaseClient, f: Record<string, unknown>): Promise<Following> {
	const followingId = f.id as string;

	const [accountsRes, emailsRes, phonesRes, addressesRes, notesRes] = await Promise.all([
		supabase
			.from("following_accounts")
			.select("id, following_id, handle, url, platform_id, deleted, created_at, updated_at, platforms(id, name, slug)")
			.eq("following_id", followingId)
			.eq("deleted", false),
		supabase.from("following_emails").select("*").eq("following_id", followingId).eq("deleted", false),
		supabase.from("following_phones").select("*").eq("following_id", followingId).eq("deleted", false),
		supabase.from("following_addresses").select("*").eq("following_id", followingId).eq("deleted", false),
		supabase.from("following_notes").select("*").eq("following_id", followingId).eq("deleted", false),
	]);

	const accounts = (accountsRes.data ?? []).map((r: Record<string, unknown>) => {
		const { platforms, ...rest } = r;
		return { ...rest, platform: platforms };
	});
	const emails = emailsRes.data ?? [];
	const phones = phonesRes.data ?? [];
	const addresses = addressesRes.data ?? [];
	const notes = notesRes.data ?? [];

	return {
		...f,
		accounts,
		emails,
		phones,
		addresses,
		notes,
	} as Following;
}

export async function listFollowingWithJoins(supabase: SupabaseClient, internalUserId: string): Promise<Following[]> {
	const { data: list, error } = await supabase
		.from("following")
		.select("*")
		.eq("user_id", internalUserId)
		.eq("deleted", false)
		.order("updated_at", { ascending: false });

	if (error) throw new Error(error.message);
	return Promise.all((list ?? []).map((f) => followingWithJoins(supabase, f)));
}
