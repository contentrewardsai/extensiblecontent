import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanTier } from "@/lib/plan-tiers";

/**
 * Append-only ShotStack credit ledger.
 *
 * Why a ledger? Earlier we kept a running counter on `users.shotstack_credits`,
 * which made billing history opaque ("how did I end up at 12 credits?") and
 * made it impossible to honour the 3-month rollover grace period. A ledger
 * row per grant/debit gives us:
 *
 *   * an itemised billing history page (the user requested this);
 *   * automatic expiry of unused credits (each grant has its own `expires_at`);
 *   * idempotency on monthly subscription renewals (`(user_id,
 *     whop_membership_id, period_start)` is unique).
 *
 * The cached `users.shotstack_credits` column is kept in sync after every
 * write so existing read paths (extension API, ShotStack queue) stay fast and
 * don't need to be migrated all at once.
 */

export type ShotstackCreditEntryKind = "grant" | "debit" | "expiry" | "adjustment";

export interface ShotstackCreditEntry {
	id: string;
	user_id: string;
	kind: ShotstackCreditEntryKind;
	credits: number;
	description: string | null;
	whop_product_id: string | null;
	whop_plan_id: string | null;
	whop_payment_id: string | null;
	whop_membership_id: string | null;
	period_start: string | null;
	period_end: string | null;
	expires_at: string | null;
	shotstack_render_id: string | null;
	source_grant_id: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
}

export async function getSpendableCredits(
	supabase: SupabaseClient,
	userId: string,
): Promise<number> {
	const { data, error } = await supabase.rpc("shotstack_spendable_credits", { p_user_id: userId });
	if (error) {
		console.error("[shotstack-ledger] spendable rpc failed:", error);
		return 0;
	}
	return Number(data ?? 0);
}

/**
 * Recompute the cached `users.shotstack_credits` from the ledger. Cheap
 * enough to call after every mutation — `shotstack_spendable_credits` is a
 * single SQL aggregate.
 */
export async function refreshCachedCreditBalance(
	supabase: SupabaseClient,
	userId: string,
): Promise<number> {
	const balance = await getSpendableCredits(supabase, userId);
	await supabase
		.from("users")
		.update({
			shotstack_credits: balance,
			updated_at: new Date().toISOString(),
		})
		.eq("id", userId);
	return balance;
}

export interface RecordDebitInput {
	userId: string;
	credits: number;
	shotstackRenderId: string;
	description?: string;
	metadata?: Record<string, unknown>;
}

export async function recordRenderDebit(
	supabase: SupabaseClient,
	{ userId, credits, shotstackRenderId, description, metadata }: RecordDebitInput,
): Promise<number> {
	if (credits <= 0) return getSpendableCredits(supabase, userId);

	const { error } = await supabase.from("shotstack_credit_ledger").insert({
		user_id: userId,
		kind: "debit",
		credits: -Math.abs(credits),
		description: description ?? `Render ${shotstackRenderId}`,
		shotstack_render_id: shotstackRenderId,
		metadata: metadata ?? {},
	});
	if (error) {
		console.error("[shotstack-ledger] debit insert failed:", error);
		throw new Error(error.message);
	}
	return refreshCachedCreditBalance(supabase, userId);
}

export interface GrantSubscriptionCreditsInput {
	userId: string;
	tier: PlanTier;
	whopMembershipId: string;
	whopPlanId?: string | null;
	whopPaymentId?: string | null;
	periodStart: Date;
	periodEnd?: Date | null;
}

/**
 * Idempotently grant a billing period's credits for a Whop subscription.
 *
 * - Skips silently if a row for this `(user, membership, period_start)`
 *   already exists (handles webhook retries and multiple `payment.succeeded`
 *   events for the same period).
 * - Sets `expires_at = period_start + creditRolloverMonths`.
 * - Updates the cached balance on success.
 *
 * Returns the new spendable balance. If the grant was a no-op (already
 * applied) the returned balance still reflects the current ledger state.
 */
export async function grantSubscriptionCredits(
	supabase: SupabaseClient,
	input: GrantSubscriptionCreditsInput,
): Promise<{ balance: number; granted: boolean; entry?: ShotstackCreditEntry }> {
	const {
		userId,
		tier,
		whopMembershipId,
		whopPlanId = null,
		whopPaymentId = null,
		periodStart,
		periodEnd = null,
	} = input;

	if (tier.shotstackCreditsPerPeriod <= 0) {
		return { balance: await getSpendableCredits(supabase, userId), granted: false };
	}

	const expiresAt = new Date(periodStart.getTime());
	expiresAt.setMonth(expiresAt.getMonth() + tier.creditRolloverMonths);

	const { data: existing } = await supabase
		.from("shotstack_credit_ledger")
		.select("id")
		.eq("user_id", userId)
		.eq("kind", "grant")
		.eq("whop_membership_id", whopMembershipId)
		.eq("period_start", periodStart.toISOString())
		.maybeSingle();

	if (existing?.id) {
		return { balance: await getSpendableCredits(supabase, userId), granted: false };
	}

	const { data: inserted, error } = await supabase
		.from("shotstack_credit_ledger")
		.insert({
			user_id: userId,
			kind: "grant",
			credits: tier.shotstackCreditsPerPeriod,
			description: `${tier.name} subscription · ${tier.shotstackCreditsPerPeriod} ShotStack minutes`,
			whop_product_id: tier.productId,
			whop_plan_id: whopPlanId,
			whop_payment_id: whopPaymentId,
			whop_membership_id: whopMembershipId,
			period_start: periodStart.toISOString(),
			period_end: periodEnd ? periodEnd.toISOString() : null,
			expires_at: expiresAt.toISOString(),
		})
		.select("*")
		.single();

	if (error) {
		// Unique-violation (race with a concurrent webhook): treat as no-op.
		if (error.code === "23505") {
			return { balance: await getSpendableCredits(supabase, userId), granted: false };
		}
		console.error("[shotstack-ledger] grant insert failed:", error);
		throw new Error(error.message);
	}

	const balance = await refreshCachedCreditBalance(supabase, userId);
	return { balance, granted: true, entry: inserted as ShotstackCreditEntry };
}

export async function recordAdjustment(
	supabase: SupabaseClient,
	{
		userId,
		credits,
		description,
		metadata,
	}: { userId: string; credits: number; description: string; metadata?: Record<string, unknown> },
): Promise<number> {
	if (credits === 0) return getSpendableCredits(supabase, userId);
	const { error } = await supabase.from("shotstack_credit_ledger").insert({
		user_id: userId,
		kind: "adjustment",
		credits,
		description,
		metadata: metadata ?? {},
	});
	if (error) throw new Error(error.message);
	return refreshCachedCreditBalance(supabase, userId);
}

/**
 * Page through a user's ledger for the billing-history UI. Newest first.
 */
export async function listLedgerEntries(
	supabase: SupabaseClient,
	userId: string,
	{ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ShotstackCreditEntry[]> {
	const { data, error } = await supabase
		.from("shotstack_credit_ledger")
		.select("*")
		.eq("user_id", userId)
		.order("created_at", { ascending: false })
		.range(offset, offset + limit - 1);
	if (error) {
		console.error("[shotstack-ledger] list failed:", error);
		return [];
	}
	return (data ?? []) as ShotstackCreditEntry[];
}
