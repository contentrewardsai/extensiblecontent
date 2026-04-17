import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowingInsert, FollowingUpdate, FollowingWalletInsert } from "@/lib/types/following";

export type FollowingMutationError = { ok: false; error: string; status: number };
export type FollowingMutationOk = { ok: true };
export type CreateFollowingResult = { ok: true; id: string } | FollowingMutationError;

function walletRowFor(w: FollowingWalletInsert, followingId: string, userId: string) {
	return {
		following_id: followingId,
		chain: w.chain,
		address: w.address,
		network: w.network ?? null,
		label: w.label ?? null,
		watch_enabled: w.watch_enabled ?? w.watchEnabled ?? false,
		automation_enabled: w.automation_enabled ?? w.automationEnabled ?? false,
		auto_execute_swaps: w.auto_execute_swaps ?? w.autoExecuteSwaps ?? false,
		size_mode: w.size_mode ?? w.sizeMode ?? null,
		quote_mint: w.quote_mint ?? w.quoteMint ?? null,
		fixed_amount_raw: w.fixed_amount_raw ?? w.fixedAmountRaw ?? null,
		usd_amount: w.usd_amount ?? w.usdAmount ?? null,
		proportional_scale_percent: w.proportional_scale_percent ?? w.proportionalScalePercent ?? null,
		slippage_bps: w.slippage_bps ?? w.slippageBps ?? null,
		added_by: userId,
	};
}

export async function createFollowingForUser(
	supabase: SupabaseClient,
	userId: string,
	body: FollowingInsert,
): Promise<CreateFollowingResult> {
	const {
		name,
		birthday = null,
		accounts = [],
		emails = [],
		phones = [],
		addresses = [],
		notes = [],
		wallets = [],
	} = body;

	if (!name || typeof name !== "string" || !name.trim()) {
		return { ok: false, error: "name is required", status: 400 };
	}

	const { data: following, error: insertError } = await supabase
		.from("following")
		.insert({
			user_id: userId,
			name: name.trim(),
			birthday: birthday || null,
			updated_at: new Date().toISOString(),
		})
		.select()
		.single();

	if (insertError || !following) {
		return { ok: false, error: insertError?.message ?? "Failed to create following", status: 500 };
	}

	const followingId = following.id as string;

	if (accounts.length > 0) {
		await supabase.from("following_accounts").insert(
			accounts.map((a) => ({
				following_id: followingId,
				handle: a.handle ?? null,
				url: a.url ?? null,
				platform_id: a.platform_id,
			})),
		);
	}
	if (emails.length > 0) {
		await supabase.from("following_emails").insert(
			emails.map((e) => ({
				following_id: followingId,
				email: e.email,
				added_by: userId,
			})),
		);
	}
	if (phones.length > 0) {
		await supabase.from("following_phones").insert(
			phones.map((p) => ({
				following_id: followingId,
				phone_number: p.phone_number,
				added_by: userId,
			})),
		);
	}
	if (addresses.length > 0) {
		await supabase.from("following_addresses").insert(
			addresses.map((a) => ({
				following_id: followingId,
				address: a.address ?? null,
				address_2: a.address_2 ?? null,
				city: a.city ?? null,
				state: a.state ?? null,
				zip: a.zip ?? null,
				country: a.country ?? null,
				added_by: userId,
			})),
		);
	}
	if (notes.length > 0) {
		await supabase.from("following_notes").insert(
			notes.map((n) => ({
				following_id: followingId,
				note: n.note,
				added_by: userId,
				access: n.access ?? null,
				scheduled: n.scheduled ?? null,
			})),
		);
	}
	if (wallets.length > 0) {
		await supabase.from("following_wallets").insert(wallets.map((w) => walletRowFor(w, followingId, userId)));
	}

	return { ok: true, id: followingId };
}

export async function updateFollowingForUser(
	supabase: SupabaseClient,
	userId: string,
	id: string,
	body: FollowingUpdate,
): Promise<FollowingMutationOk | FollowingMutationError> {
	const { data: existing } = await supabase.from("following").select("id").eq("id", id).eq("user_id", userId).single();
	if (!existing) {
		return { ok: false, error: "Following not found", status: 404 };
	}

	const { name, birthday, accounts, emails, phones, addresses, notes, wallets } = body;

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (name !== undefined) {
		if (typeof name !== "string" || !name.trim()) {
			return { ok: false, error: "name must be a non-empty string", status: 400 };
		}
		updates.name = name.trim();
	}
	if (birthday !== undefined) updates.birthday = birthday;

	await supabase.from("following").update(updates).eq("id", id);

	if (accounts !== undefined) {
		await supabase.from("following_accounts").delete().eq("following_id", id);
		if (accounts.length > 0) {
			await supabase.from("following_accounts").insert(
				accounts.map((a) => ({
					following_id: id,
					handle: a.handle ?? null,
					url: a.url ?? null,
					platform_id: a.platform_id,
				})),
			);
		}
	}
	if (emails !== undefined) {
		await supabase.from("following_emails").delete().eq("following_id", id);
		if (emails.length > 0) {
			await supabase.from("following_emails").insert(
				emails.map((e) => ({
					following_id: id,
					email: e.email,
					added_by: userId,
				})),
			);
		}
	}
	if (phones !== undefined) {
		await supabase.from("following_phones").delete().eq("following_id", id);
		if (phones.length > 0) {
			await supabase.from("following_phones").insert(
				phones.map((p) => ({
					following_id: id,
					phone_number: p.phone_number,
					added_by: userId,
				})),
			);
		}
	}
	if (addresses !== undefined) {
		await supabase.from("following_addresses").delete().eq("following_id", id);
		if (addresses.length > 0) {
			await supabase.from("following_addresses").insert(
				addresses.map((a) => ({
					following_id: id,
					address: a.address ?? null,
					address_2: a.address_2 ?? null,
					city: a.city ?? null,
					state: a.state ?? null,
					zip: a.zip ?? null,
					country: a.country ?? null,
					added_by: userId,
				})),
			);
		}
	}
	if (notes !== undefined) {
		await supabase.from("following_notes").delete().eq("following_id", id);
		if (notes.length > 0) {
			await supabase.from("following_notes").insert(
				notes.map((n) => ({
					following_id: id,
					note: n.note,
					added_by: userId,
					access: n.access ?? null,
					scheduled: n.scheduled ?? null,
				})),
			);
		}
	}
	if (wallets !== undefined) {
		await supabase.from("following_wallets").delete().eq("following_id", id);
		if (wallets.length > 0) {
			await supabase.from("following_wallets").insert(wallets.map((w) => walletRowFor(w, id, userId)));
		}
	}

	return { ok: true };
}

export async function deleteFollowingForUser(
	supabase: SupabaseClient,
	userId: string,
	id: string,
): Promise<FollowingMutationOk | FollowingMutationError> {
	const { data: existing } = await supabase.from("following").select("id").eq("id", id).eq("user_id", userId).single();
	if (!existing) {
		return { ok: false, error: "Following not found", status: 404 };
	}

	await supabase.from("following").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
	return { ok: true };
}
