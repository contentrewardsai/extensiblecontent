import { PLAN_TIERS, type PlanTier } from "@/lib/plan-tiers";
import { whopsdk } from "@/lib/whop-sdk";

/**
 * Resolve a Whop-hosted checkout URL for each tier.
 *
 * Tiers can have multiple plans (e.g. monthly + yearly). We pick one
 * "default" plan per tier — by default the cheapest renewal plan, falling
 * back to any plan if none are renewals — and return its `purchase_url`.
 *
 * Override the auto-pick by setting `WHOP_DEFAULT_PLAN_<PRODUCTID>` env vars
 * (case-insensitive matching). This is the escape hatch when you want
 * "Upgrade" to take users to a specific promo plan.
 *
 * Results are cached in-process for 5 minutes since plans rarely change.
 */

interface ResolvedPlan {
	planId: string;
	purchaseUrl: string;
	initialPrice: number | null;
	currency: string | null;
	billingPeriod: number | null;
	planType: string | null;
	title: string | null;
}

export interface TierCheckout {
	tier: PlanTier;
	plan: ResolvedPlan | null;
	error?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; entries: TierCheckout[] } | null = null;

function envOverridePlanId(productId: string): string | null {
	const key = `WHOP_DEFAULT_PLAN_${productId.toUpperCase()}`;
	const v = process.env[key];
	return v && v.trim().length > 0 ? v.trim() : null;
}

async function resolveTier(tier: PlanTier): Promise<TierCheckout> {
	const override = envOverridePlanId(tier.productId);
	try {
		if (override) {
			const plan = await whopsdk.plans.retrieve(override);
			return {
				tier,
				plan: {
					planId: plan.id,
					purchaseUrl: plan.purchase_url,
					initialPrice: plan.initial_price,
					currency: plan.currency ?? null,
					billingPeriod: plan.billing_period,
					planType: plan.plan_type,
					title: plan.title,
				},
			};
		}

		const companyId = process.env.WHOP_COMPANY_ID;
		if (!companyId) {
			return { tier, plan: null, error: "WHOP_COMPANY_ID is not set" };
		}

		const candidates: ResolvedPlan[] = [];
		for await (const p of whopsdk.plans.list({
			company_id: companyId,
			product_ids: [tier.productId],
			first: 25,
		})) {
			candidates.push({
				planId: p.id,
				purchaseUrl: p.purchase_url,
				initialPrice: p.initial_price,
				currency: p.currency ?? null,
				billingPeriod: p.billing_period,
				planType: p.plan_type,
				title: p.title,
			});
		}
		if (candidates.length === 0) {
			return { tier, plan: null, error: "No plans found for product" };
		}

		// Prefer the cheapest renewal plan (i.e. the entry-level monthly sub).
		const renewal = candidates
			.filter((c) => c.planType === "renewal")
			.sort((a, b) => (a.initialPrice ?? Infinity) - (b.initialPrice ?? Infinity));
		const picked = renewal[0] ?? candidates[0];
		return { tier, plan: picked };
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Failed to resolve plan";
		return { tier, plan: null, error: msg };
	}
}

export async function getTierCheckouts(): Promise<TierCheckout[]> {
	if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
		return cache.entries;
	}
	const entries = await Promise.all(PLAN_TIERS.map((t) => resolveTier(t)));
	cache = { fetchedAt: Date.now(), entries };
	return entries;
}

export function clearTierCheckoutCache(): void {
	cache = null;
}
