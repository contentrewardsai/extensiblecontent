import assert from "node:assert/strict";
import {
	isPlanAdmin,
	isValidAdBudgetMode,
	isValidBudgetType,
	isValidObjective,
	isValidReviewStatus,
	parsePlanId,
} from "../lib/promotion-plan";

// parsePlanId — happy paths
{
	const r = parsePlanId("spring-launch-2026");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.id, "spring-launch-2026");
}
{
	const r = parsePlanId("  Spring-Launch-2026  ");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.id, "spring-launch-2026", "trims & lowercases");
}
{
	const r = parsePlanId("ax9k");
	assert.ok(r.ok);
}

// parsePlanId — rejections
{
	const r = parsePlanId(undefined);
	assert.ok(!r.ok);
}
{
	const r = parsePlanId(123 as unknown as string);
	assert.ok(!r.ok);
}
{
	const r = parsePlanId("ab");
	assert.ok(!r.ok, "min length is 3");
}
{
	const r = parsePlanId("a".repeat(65));
	assert.ok(!r.ok, "max length is 64");
}
{
	const r = parsePlanId("-startswithdash");
	assert.ok(!r.ok, "must start with [a-z0-9]");
}
{
	const r = parsePlanId("has space");
	assert.ok(!r.ok);
}
{
	const r = parsePlanId("Has_Underscore");
	assert.ok(!r.ok);
}
{
	const r = parsePlanId("api");
	assert.ok(!r.ok, "reserved id");
	if (!r.ok) assert.ok(r.error.includes("reserved"));
}

// validators
assert.ok(isValidObjective("Sales"));
assert.ok(!isValidObjective("garbage"));
assert.ok(isValidBudgetType("monthly"));
assert.ok(isValidBudgetType("fixed"));
assert.ok(!isValidBudgetType("annual"));
assert.ok(isValidReviewStatus("approved"));
assert.ok(!isValidReviewStatus("APPROVED"));
assert.ok(isValidAdBudgetMode("dynamic"));
assert.ok(!isValidAdBudgetMode("crazy"));

// isPlanAdmin
assert.equal(isPlanAdmin({ admin_user_id: null }, "u"), false);
assert.equal(isPlanAdmin({ admin_user_id: "u" }, null), false);
assert.equal(isPlanAdmin({ admin_user_id: "u" }, "u"), true);
assert.equal(isPlanAdmin({ admin_user_id: "u" }, "v"), false);

console.log("unit-tests: promotion-plan OK");
