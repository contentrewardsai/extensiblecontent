import assert from "node:assert/strict";
import {
	batchHeartbeatSidebars,
	normalizeBackendIdsForHeartbeat,
	SIDEBAR_HEARTBEAT_BATCH_MAX,
} from "../lib/sidebar-heartbeat";

const a = "550e8400-e29b-41d4-a716-446655440000";
const b = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

void (async () => {
	{
		const r = normalizeBackendIdsForHeartbeat([a, b]);
		assert.ok(!("error" in r));
		if (!("error" in r)) assert.deepEqual(r, [a, b]);
	}
	{
		const r = normalizeBackendIdsForHeartbeat([a, `  ${a}  `]);
		assert.ok(!("error" in r));
		if (!("error" in r)) assert.deepEqual(r, [a]);
	}
	{
		const r = normalizeBackendIdsForHeartbeat("x");
		assert.ok("error" in r);
	}
	{
		const r = normalizeBackendIdsForHeartbeat([]);
		assert.ok("error" in r);
	}
	{
		const r = normalizeBackendIdsForHeartbeat([a, "not-uuid"]);
		assert.ok("error" in r);
	}
	{
		const many = Array.from({ length: SIDEBAR_HEARTBEAT_BATCH_MAX + 1 }, () => a);
		const r = normalizeBackendIdsForHeartbeat(many);
		assert.ok("error" in r);
	}

	const fake = {
		from() {
			return this;
		},
		select() {
			return this;
		},
		eq() {
			return this;
		},
		in() {
			return Promise.resolve({ data: [], error: null });
		},
	};
	const r = await batchHeartbeatSidebars(fake as never, "user-1", [a]);
	assert.ok(!("error" in r));
	if (!("error" in r)) {
		assert.equal(r.updated, 0);
		assert.deepEqual(r.ids, []);
	}

	console.log("unit-tests: sidebar-heartbeat OK");
})();
