import assert from "node:assert/strict";
import {
	normalizeRegisterSidebarName,
	normalizeRegisterWindowId,
	parseExclusiveSidebarLookup,
	parseSidebarRowUuid,
} from "../lib/sidebar-lookup-parse";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

{
	const r = parseExclusiveSidebarLookup({});
	assert.ok(!r.ok);
	if (!r.ok) assert.equal(r.error.includes("required"), true);
}
{
	const r = parseExclusiveSidebarLookup({ sidebar_id: "  x  ", window_id: " y " });
	assert.ok(!r.ok);
	if (!r.ok) assert.ok(r.error.includes("not both"));
}
{
	const r = parseExclusiveSidebarLookup({ sidebar_id: "  " });
	assert.ok(!r.ok);
}
{
	const r = parseExclusiveSidebarLookup({ sidebar_id: validUuid });
	assert.ok(r.ok);
	if (r.ok && "sidebar_id" in r) assert.equal(r.sidebar_id, validUuid);
}
{
	const r = parseExclusiveSidebarLookup({ sidebar_id: "not-a-uuid" });
	assert.ok(!r.ok);
	if (!r.ok) assert.ok(r.error.includes("UUID"));
}
{
	const r = parseExclusiveSidebarLookup({ window_id: "  w  " });
	assert.ok(r.ok);
	if (r.ok && "window_id" in r) assert.equal(r.window_id, "w");
}
{
	const r = parseExclusiveSidebarLookup({ sidebar_id: 1 as unknown as string });
	assert.ok(!r.ok);
}

assert.ok(!normalizeRegisterWindowId("").ok);
assert.ok(!normalizeRegisterWindowId("a".repeat(513)).ok);
assert.ok(normalizeRegisterWindowId("  ok  ").ok);

assert.ok(!normalizeRegisterSidebarName("").ok);
assert.ok(!normalizeRegisterSidebarName("a".repeat(257)).ok);
assert.ok(normalizeRegisterSidebarName("  n  ").ok);

assert.ok(!parseSidebarRowUuid("").ok);
assert.ok(!parseSidebarRowUuid("xyz").ok);
assert.ok(parseSidebarRowUuid(`  ${validUuid}  `).ok);

console.log("unit-tests: sidebar-lookup-parse OK");
