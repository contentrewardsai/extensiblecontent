/**
 * Definitive list of paid Whop products (a.k.a. "access passes") this app
 * recognises and what each grants.
 *
 * Source of truth — server code uses these to:
 *   1. Decide if a user has any active subscription (via `whopsdk.memberships.list`).
 *   2. Materialize entitlements into `public.users` (`max_upload_post_accounts`,
 *      `has_upgraded`) so quota checks stay fast.
 *   3. Top up the ShotStack credit ledger every billing period and let unused
 *      credits roll over for up to `creditRolloverMonths`.
 *
 * Adding a new tier? Append it here, then run the next monthly cron. Existing
 * subscribers will start receiving the new entitlements automatically when
 * their `payment.succeeded` webhook arrives or when the reconciler runs.
 */

export interface PlanTier {
	/** Whop product / access-pass id (`prod_…`). */
	productId: string;
	/** Short, sortable rank — higher is "bigger" (used to dedupe overlapping memberships). */
	rank: number;
	/** Display name for the upgrade picker. */
	name: string;
	/** Marketing one-liner for the upgrade picker. */
	tagline: string;
	/** Bulleted features for the upgrade picker. */
	features: string[];
	/** Number of Upload-Post profiles this tier entitles the user to. */
	maxUploadPostAccounts: number;
	/** ShotStack credits granted per billing period (1 credit = 1 minute). */
	shotstackCreditsPerPeriod: number;
	/** Number of months unspent ShotStack credits remain valid for. */
	creditRolloverMonths: number;
}

export const PLAN_TIERS: readonly PlanTier[] = [
	{
		productId: "prod_SKbivMikKZ0DZ",
		rank: 1,
		name: "Starter",
		tagline: "1 connected account, 30 minutes of ShotStack rendering / month.",
		features: [
			"1 Upload-Post profile",
			"30 ShotStack minutes / month",
			"3-month credit rollover",
		],
		maxUploadPostAccounts: 1,
		shotstackCreditsPerPeriod: 30,
		creditRolloverMonths: 3,
	},
	{
		productId: "prod_ShvmpSR7s0EoH",
		rank: 2,
		name: "Growth",
		tagline: "10 connected accounts, 150 minutes of ShotStack rendering / month.",
		features: [
			"10 Upload-Post profiles",
			"150 ShotStack minutes / month",
			"3-month credit rollover",
		],
		maxUploadPostAccounts: 10,
		shotstackCreditsPerPeriod: 150,
		creditRolloverMonths: 3,
	},
	{
		productId: "prod_G67Rs4iAZtexG",
		rank: 3,
		name: "Scale",
		tagline: "25 connected accounts, 375 minutes of ShotStack rendering / month.",
		features: [
			"25 Upload-Post profiles",
			"375 ShotStack minutes / month",
			"3-month credit rollover",
		],
		maxUploadPostAccounts: 25,
		shotstackCreditsPerPeriod: 375,
		creditRolloverMonths: 3,
	},
] as const;

export const PLAN_PRODUCT_IDS: readonly string[] = PLAN_TIERS.map((t) => t.productId);

export function getPlanTier(productId: string | null | undefined): PlanTier | null {
	if (!productId) return null;
	return PLAN_TIERS.find((t) => t.productId === productId) ?? null;
}

/**
 * Pick the "best" tier from a list of tier identifiers (highest rank wins).
 * Used to combine entitlements when a user is subscribed to multiple tiers
 * — e.g. a temporary trial overlapping with a real plan.
 */
export function pickHighestTier(tiers: ReadonlyArray<PlanTier | null | undefined>): PlanTier | null {
	let best: PlanTier | null = null;
	for (const t of tiers) {
		if (!t) continue;
		if (!best || t.rank > best.rank) best = t;
	}
	return best;
}
