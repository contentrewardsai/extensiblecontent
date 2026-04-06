import assert from "node:assert/strict";
import { parseSidebarListQuery, SIDEBAR_LIST_MAX_LIMIT } from "../lib/sidebar-list-query";

function parse(qs: string) {
	return parseSidebarListQuery(new URL(`https://x.test/api/extension/sidebars${qs}`));
}

{
	const r = parse("");
	assert.ok(r.ok);
	if (r.ok) {
		assert.equal(r.sinceIso, null);
		assert.equal(r.limit, null);
	}
}
{
	const r = parse("?since=2026-01-15T12:00:00.000Z");
	assert.ok(r.ok);
	if (r.ok && r.sinceIso) assert.ok(r.sinceIso.includes("2026"));
}
{
	const r = parse("?since=not-a-date");
	assert.ok(!r.ok);
}
{
	const r = parse("?limit=10");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.limit, 10);
}
{
	const r = parse("?limit=%2010%20");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.limit, 10);
}
{
	const r = parse("?omit_connected=1");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.omitConnected, true);
}
{
	const r = parse("?omit_connected=false");
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.omitConnected, false);
}
{
	const r = parse("?limit=0");
	assert.ok(!r.ok);
}
{
	const r = parse(`?limit=${SIDEBAR_LIST_MAX_LIMIT + 1}`);
	assert.ok(!r.ok);
}
{
	const r = parse("?limit=3.5");
	assert.ok(!r.ok);
}

console.log("unit-tests: sidebar-list-query OK");
