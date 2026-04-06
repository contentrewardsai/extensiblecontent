import assert from "node:assert/strict";
import {
	normalizeRegisterSidebarName,
	normalizeRegisterWindowId,
	parseExclusiveSidebarLookup,
} from "../lib/sidebar-lookup-parse";

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
	const r = parseExclusiveSidebarLookup({ sidebar_id: "abc" });
	assert.ok(r.ok);
	if (r.ok && "sidebar_id" in r) assert.equal(r.sidebar_id, "abc");
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

console.log("unit-tests: sidebar-lookup-parse OK");
