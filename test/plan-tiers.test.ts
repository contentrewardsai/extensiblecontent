import assert from "node:assert/strict";
import { test } from "node:test";
import { getPlanTier, pickHighestTier, PLAN_PRODUCT_IDS, PLAN_TIERS } from "../lib/plan-tiers";

test("PLAN_TIERS lists the three configured Whop products", () => {
	assert.deepEqual(
		[...PLAN_PRODUCT_IDS].sort(),
		["prod_G67Rs4iAZtexG", "prod_SKbivMikKZ0DZ", "prod_ShvmpSR7s0EoH"].sort(),
	);
});

test("PLAN_TIERS rows are internally consistent (positive values, monotonically increasing rank)", () => {
	let lastRank = 0;
	for (const t of PLAN_TIERS) {
		assert.ok(t.maxUploadPostAccounts > 0, `${t.name} should grant >0 profiles`);
		assert.ok(t.shotstackCreditsPerPeriod > 0, `${t.name} should grant >0 credits`);
		assert.ok(t.creditRolloverMonths >= 1, `${t.name} should roll over for at least 1 month`);
		assert.ok(t.rank > lastRank, `${t.name} rank should be strictly greater than previous`);
		lastRank = t.rank;
	}
});

test("getPlanTier handles unknown ids", () => {
	assert.equal(getPlanTier(null), null);
	assert.equal(getPlanTier(""), null);
	assert.equal(getPlanTier("prod_unknown"), null);
	const known = getPlanTier("prod_SKbivMikKZ0DZ");
	assert.ok(known);
	assert.equal(known?.maxUploadPostAccounts, 1);
});

test("pickHighestTier returns the tier with the highest rank", () => {
	const t1 = getPlanTier("prod_SKbivMikKZ0DZ");
	const t2 = getPlanTier("prod_ShvmpSR7s0EoH");
	const t3 = getPlanTier("prod_G67Rs4iAZtexG");
	assert.equal(pickHighestTier([]), null);
	assert.equal(pickHighestTier([null, undefined]), null);
	assert.equal(pickHighestTier([t1, null]), t1);
	assert.equal(pickHighestTier([t1, t3, t2]), t3);
});
