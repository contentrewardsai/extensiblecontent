import { getTierCheckouts } from "@/lib/plan-checkout-urls";

/**
 * Public list of upgrade plans for the extension login / upgrade screen.
 *
 * Returns the same three tiers defined in `PLAN_TIERS`, each enriched with
 * a Whop-hosted checkout URL and a formatted price label. Safe to expose
 * publicly — the response only contains marketing copy and the same
 * checkout URLs Whop would render to anyone visiting the product page.
 */

function formatPriceLabel(plan: {
	initialPrice: number | null;
	currency: string | null;
	billingPeriod: number | null;
	planType: string | null;
}): string | null {
	if (plan.initialPrice == null) return null;
	const price = plan.initialPrice.toLocaleString(undefined, {
		style: "currency",
		currency: (plan.currency ?? "USD").toUpperCase(),
		maximumFractionDigits: 2,
	});
	if (plan.planType === "renewal") {
		const days = plan.billingPeriod ?? 30;
		const interval =
			days === 30 ? "month" : days === 365 ? "year" : days === 7 ? "week" : `${days} days`;
		return `${price} / ${interval}`;
	}
	return `${price} one-time`;
}

export interface PlanCheckoutResponseEntry {
	productId: string;
	rank: number;
	name: string;
	tagline: string;
	features: readonly string[];
	maxUploadPostAccounts: number;
	shotstackCreditsPerPeriod: number;
	maxStorageBytes: number;
	purchaseUrl: string | null;
	priceLabel: string | null;
	error?: string;
}

export async function GET() {
	const checkouts = await getTierCheckouts();
	const plans: PlanCheckoutResponseEntry[] = checkouts.map(({ tier, plan, error }) => ({
		productId: tier.productId,
		rank: tier.rank,
		name: tier.name,
		tagline: tier.tagline,
		features: tier.features,
		maxUploadPostAccounts: tier.maxUploadPostAccounts,
		shotstackCreditsPerPeriod: tier.shotstackCreditsPerPeriod,
		maxStorageBytes: tier.maxStorageBytes,
		purchaseUrl: plan?.purchaseUrl ?? null,
		priceLabel: plan ? formatPriceLabel(plan) : null,
		error,
	}));
	return Response.json({ plans });
}
