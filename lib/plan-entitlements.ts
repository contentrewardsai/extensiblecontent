import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type PlanTier,
	PLAN_PRODUCT_IDS,
	pickHighestTier,
	getPlanTier,
} from "@/lib/plan-tiers";
import { whopsdk } from "@/lib/whop-sdk";

/**
 * Read the user's active Whop memberships, derive their effective tier from our
 * `PLAN_TIERS` table, and write the resulting entitlements back to
 * `public.users` (`max_upload_post_accounts`, `has_upgraded`).
 *
 * "Active" here means anything in a status that grants access today —
 * `active`, `trialing`, `past_due`, or `completed` (a one-time payment that's
 * still in good standing). Cancelled/expired memberships are ignored. We don't
 * grant credits here; that lives in `lib/shotstack-ledger.ts` so a single
 * source of truth for the ledger handles the monthly grant + rollover logic.
 */

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "completed"]);

export interface UserEntitlements {
	tier: PlanTier | null;
	hasUpgraded: boolean;
	maxUploadPostAccounts: number;
	activeMemberships: ResolvedMembership[];
}

export interface ResolvedMembership {
	id: string;
	productId: string;
	planId: string | null;
	status: string;
	renewalPeriodStart: string | null;
	renewalPeriodEnd: string | null;
	tier: PlanTier;
}

/**
 * Fetch the user's memberships filtered to the products this app sells.
 * Returns only memberships in a "currently grants access" state.
 */
export async function listActivePlanMemberships(whopUserId: string): Promise<ResolvedMembership[]> {
	if (!whopUserId) return [];
	const memberships: ResolvedMembership[] = [];
	try {
		const page = whopsdk.memberships.list({
			user_ids: [whopUserId],
			access_pass_ids: PLAN_PRODUCT_IDS as string[],
			first: 100,
		});
		for await (const m of page) {
			if (!ACTIVE_STATUSES.has(String(m.status))) continue;
			const tier = getPlanTier(m.product?.id);
			if (!tier) continue;
			memberships.push({
				id: m.id,
				productId: m.product.id,
				planId: m.plan?.id ?? null,
				status: String(m.status),
				renewalPeriodStart: m.renewal_period_start,
				renewalPeriodEnd: m.renewal_period_end,
				tier,
			});
		}
	} catch (err) {
		console.error("[plan-entitlements] memberships.list failed:", err);
		return [];
	}
	return memberships;
}

export function deriveEntitlements(memberships: ResolvedMembership[]): UserEntitlements {
	const tier = pickHighestTier(memberships.map((m) => m.tier));
	return {
		tier,
		hasUpgraded: !!tier,
		maxUploadPostAccounts: tier?.maxUploadPostAccounts ?? 0,
		activeMemberships: memberships,
	};
}

/**
 * Write derived entitlements onto `public.users`. Returns the row that was
 * written (or `null` when no change was needed).
 */
export async function writeUserEntitlements(
	supabase: SupabaseClient,
	internalUserId: string,
	entitlements: UserEntitlements,
): Promise<void> {
	if (!internalUserId) return;
	await supabase
		.from("users")
		.update({
			max_upload_post_accounts: entitlements.maxUploadPostAccounts,
			has_upgraded: entitlements.hasUpgraded,
			updated_at: new Date().toISOString(),
		})
		.eq("id", internalUserId);
}

/**
 * One-shot: pull memberships from Whop, derive entitlements, write to DB.
 * Safe to call from a webhook handler, server action, or cron.
 */
export async function syncUserEntitlements(
	supabase: SupabaseClient,
	{ internalUserId, whopUserId }: { internalUserId: string; whopUserId: string },
): Promise<UserEntitlements> {
	const memberships = await listActivePlanMemberships(whopUserId);
	const entitlements = deriveEntitlements(memberships);
	await writeUserEntitlements(supabase, internalUserId, entitlements);
	return entitlements;
}
