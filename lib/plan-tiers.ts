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
	/**
	 * Max bytes of post-media storage the user is allowed to consume across
	 * every project they own. Counts both `post-media` and `post-media-private`.
	 * Files in projects shared with the user count against the *project owner's*
	 * cap, not the actor's, so this is the right column to read for the owner.
	 */
	maxStorageBytes: number;
	/**
	 * Direct Whop-hosted checkout URL (`https://whop.com/checkout/plan_…`)
	 * for this tier's default monthly plan. Used as a fallback "buy" link
	 * when the Whop SDK is unable to resolve the per-plan `purchase_url`
	 * dynamically (e.g. when `WHOP_COMPANY_ID` is missing or the API key
	 * lacks the `plan:read` scope and returns 403). The user lands
	 * straight on Whop's checkout page with the right plan pre-selected.
	 */
	productUrl: string;
	/**
	 * Static, human-readable price label shown when the live Whop API
	 * lookup is unavailable. Format mirrors what `formatPriceLabel` would
	 * render for a renewal plan.
	 */
	priceLabel: string;
}

/** 1 GB in bytes — used for plan storage caps. */
const GB = 1024 * 1024 * 1024;

/**
 * Storage cap granted to users with no active subscription. Mirrors the value
 * we used to hardcode as `OWNER_DEFAULT_MAX_BYTES` in lib/project-quota.ts so
 * existing free users see no change.
 */
export const FREE_TIER_MAX_STORAGE_BYTES = 500 * 1024 * 1024;

export const PLAN_TIERS: readonly PlanTier[] = [
	{
		productId: "prod_SKbivMikKZ0DZ",
		rank: 1,
		name: "Starter",
		tagline: "1 connected account, 30 minutes of ShotStack rendering / month, 10 GB storage.",
		features: [
			"1 Upload-Post profile",
			"30 ShotStack minutes / month",
			"3-month credit rollover",
			"10 GB project storage",
		],
		maxUploadPostAccounts: 1,
		shotstackCreditsPerPeriod: 30,
		creditRolloverMonths: 3,
		maxStorageBytes: 10 * GB,
		productUrl: "https://whop.com/checkout/plan_pb0EZHlOAE9oB",
		priceLabel: "$10 / month",
	},
	{
		productId: "prod_ShvmpSR7s0EoH",
		rank: 2,
		name: "Growth",
		tagline: "10 connected accounts, 150 minutes of ShotStack rendering / month, 40 GB storage.",
		features: [
			"10 Upload-Post profiles",
			"150 ShotStack minutes / month",
			"3-month credit rollover",
			"40 GB project storage",
		],
		maxUploadPostAccounts: 10,
		shotstackCreditsPerPeriod: 150,
		creditRolloverMonths: 3,
		maxStorageBytes: 40 * GB,
		productUrl: "https://whop.com/checkout/plan_QzLWj1xHWgSFx",
		priceLabel: "$40 / month",
	},
	{
		productId: "prod_G67Rs4iAZtexG",
		rank: 3,
		name: "Scale",
		tagline: "25 connected accounts, 375 minutes of ShotStack rendering / month, 100 GB storage.",
		features: [
			"25 Upload-Post profiles",
			"375 ShotStack minutes / month",
			"3-month credit rollover",
			"100 GB project storage",
		],
		maxUploadPostAccounts: 25,
		shotstackCreditsPerPeriod: 375,
		creditRolloverMonths: 3,
		maxStorageBytes: 100 * GB,
		productUrl: "https://whop.com/checkout/plan_bRJeYMEMUFGDI",
		priceLabel: "$100 / month",
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
