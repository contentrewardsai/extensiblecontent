import { getTierCheckouts } from "@/lib/plan-checkout-urls";
import { PLAN_TIERS } from "@/lib/plan-tiers";

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
	let checkouts: Awaited<ReturnType<typeof getTierCheckouts>>;
	try {
		checkouts = await getTierCheckouts();
	} catch {
		// Whop SDK unavailable / unauthenticated — fall back to product URLs.
		checkouts = [];
	}
	const byProductId = new Map(checkouts.map((c) => [c.tier.productId, c]));

	// Always emit one entry per known tier, falling back to the static
	// product URL + price label when the live Whop SDK lookup fails or
	// returns 403. This keeps the upgrade screen functional even when the
	// company-scoped API key isn't configured in this environment.
	const plans: PlanCheckoutResponseEntry[] = PLAN_TIERS.map((tier) => {
		const checkout = byProductId.get(tier.productId);
		const plan = checkout?.plan ?? null;
		const livePrice = plan ? formatPriceLabel(plan) : null;
		return {
			productId: tier.productId,
			rank: tier.rank,
			name: tier.name,
			tagline: tier.tagline,
			features: tier.features,
			maxUploadPostAccounts: tier.maxUploadPostAccounts,
			shotstackCreditsPerPeriod: tier.shotstackCreditsPerPeriod,
			maxStorageBytes: tier.maxStorageBytes,
			purchaseUrl: plan?.purchaseUrl ?? tier.productUrl,
			priceLabel: livePrice ?? tier.priceLabel,
			error: plan ? undefined : checkout?.error,
		};
	});
	return Response.json({ plans });
}
