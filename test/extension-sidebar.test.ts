import assert from "node:assert/strict";
import {
	coerceActiveProjectId,
	parseActiveProjectIdForUpdate,
	sidebarWithConnected,
	SIDEBAR_CONNECTED_THRESHOLD_MS,
} from "../lib/extension-sidebar";
import type { Sidebar } from "../lib/types/sidebars";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

assert.equal(coerceActiveProjectId(null), null);
assert.equal(coerceActiveProjectId(undefined), null);
assert.equal(coerceActiveProjectId(""), null);
assert.equal(coerceActiveProjectId("  "), null);
assert.equal(coerceActiveProjectId("not-uuid"), null);
assert.equal(coerceActiveProjectId(validUuid), validUuid);

{
	const o = parseActiveProjectIdForUpdate(undefined);
	assert.equal(o.kind, "omit");
}
{
	const s = parseActiveProjectIdForUpdate(null);
	assert.equal(s.kind, "set");
	if (s.kind === "set") assert.equal(s.id, null);
}
{
	const s = parseActiveProjectIdForUpdate("  ");
	assert.equal(s.kind, "set");
	if (s.kind === "set") assert.equal(s.id, null);
}
{
	const s = parseActiveProjectIdForUpdate(validUuid);
	assert.equal(s.kind, "set");
	if (s.kind === "set") assert.equal(s.id, validUuid);
}
{
	const e = parseActiveProjectIdForUpdate("nope");
	assert.equal(e.kind, "error");
}

function row(lastSeenMs: number): Sidebar {
	return {
		id: "1",
		user_id: "u",
		window_id: "w",
		sidebar_name: "n",
		last_seen: new Date(lastSeenMs).toISOString(),
		active_project_id: null,
		ip_address: null,
		created_at: "",
		updated_at: "",
	};
}

const now = Date.now();
assert.equal(sidebarWithConnected(row(now - 30 * 60 * 1000)).connected, true);
assert.equal(sidebarWithConnected(row(now - 2 * 60 * 60 * 1000)).connected, false);
assert.equal(sidebarWithConnected(row(now - SIDEBAR_CONNECTED_THRESHOLD_MS)).connected, false);

console.log("unit-tests: extension-sidebar OK");
