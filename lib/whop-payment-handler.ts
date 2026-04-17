import type { Payment } from "@whop/sdk/resources.js";
import { getPlanTier } from "@/lib/plan-tiers";
import {
	syncUserEntitlements,
} from "@/lib/plan-entitlements";
import { grantSubscriptionCredits } from "@/lib/shotstack-ledger";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";
import { whopsdk } from "@/lib/whop-sdk";

/**
 * Single entry-point for `payment.succeeded` events from Whop. Splits into:
 *
 *   1. resolve / create the internal user row from the payment's Whop user;
 *   2. work out which of our paid `PLAN_TIERS` the payment funded;
 *   3. (idempotently) grant the corresponding ShotStack credits to the
 *      ledger, with a 3-month expiry per `tier.creditRolloverMonths`;
 *   4. re-pull the user's active memberships from Whop and write the
 *      derived entitlements (`max_upload_post_accounts`, `has_upgraded`).
 *
 * Step 1 is "best effort" — we never want a misconfigured product or stale
 * payment to block other webhook handlers, so unrecognised payments are
 * logged and skipped rather than thrown.
 */
export async function handlePaymentSucceeded(payment: Payment): Promise<void> {
	if (!payment) return;
	const productId = payment.product?.id;
	const whopUserId = payment.user?.id;
	if (!productId || !whopUserId) {
		console.warn("[whop-payment] missing product/user on payment", { paymentId: payment.id });
		return;
	}

	const tier = getPlanTier(productId);
	if (!tier) {
		console.info("[whop-payment] payment is not for a tracked plan; ignoring", {
			paymentId: payment.id,
			productId,
		});
		return;
	}

	const internalUserId = await ensureInternalUserFromWhop(whopUserId, {
		email: payment.user?.email ?? null,
		name: payment.user?.name ?? null,
		username: payment.user?.username ?? null,
	});

	const supabase = getServiceSupabase();

	let periodStart = payment.paid_at ? new Date(payment.paid_at) : new Date(payment.created_at);
	let periodEnd: Date | null = null;
	const membershipId = payment.membership?.id ?? null;
	if (membershipId) {
		try {
			const membership = await whopsdk.memberships.retrieve(membershipId);
			if (membership.renewal_period_start) {
				periodStart = new Date(membership.renewal_period_start);
			}
			if (membership.renewal_period_end) {
				periodEnd = new Date(membership.renewal_period_end);
			}
		} catch (err) {
			console.warn("[whop-payment] memberships.retrieve failed; using payment dates", err);
		}
	}

	if (membershipId) {
		try {
			await grantSubscriptionCredits(supabase, {
				userId: internalUserId,
				tier,
				whopMembershipId: membershipId,
				whopPlanId: payment.plan?.id ?? null,
				whopPaymentId: payment.id,
				periodStart,
				periodEnd,
			});
		} catch (err) {
			console.error("[whop-payment] grant failed", err);
		}
	}

	try {
		await syncUserEntitlements(supabase, { internalUserId, whopUserId });
	} catch (err) {
		console.error("[whop-payment] entitlement sync failed", err);
	}
}

/**
 * For `membership.activated`/`membership.deactivated` events we don't grant
 * credits (those are funded by `payment.succeeded`) but we do re-sync the
 * cached entitlements so the dashboard reflects the change immediately.
 */
export async function handleMembershipChanged(whopUserId: string | null | undefined): Promise<void> {
	if (!whopUserId) return;
	const supabase = getServiceSupabase();
	const internalUserId = await ensureInternalUserFromWhop(whopUserId);
	try {
		await syncUserEntitlements(supabase, { internalUserId, whopUserId });
	} catch (err) {
		console.error("[whop-payment] membership-change sync failed", err);
	}
}
