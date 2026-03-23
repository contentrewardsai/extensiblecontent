"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { FollowingSyncCore } = require(path.join(__dirname, "..", "extension", "following-sync-core.js"));

function account(pid, handle) {
	return { platform_id: pid, handle: handle || "h", url: "" };
}

{
	const oldIso = new Date("2025-01-01T12:00:00.000Z").toISOString();
	const newIso = new Date("2025-03-01T12:00:00.000Z").toISOString();
	const localMs = new Date("2025-02-01T12:00:00.000Z").getTime();

	const local = [
		{
			id: "srv-1",
			name: "LocalName",
			local_edited_at: localMs,
			accounts: [account("p1", "a1"), account("p2", "onlylocal")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];
	const online = [
		{
			id: "srv-1",
			name: "ServerName",
			server_updated_at: newIso,
			accounts: [account("p1", "a1")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];

	const messages = [];
	const merged = FollowingSyncCore.mergeLocalAndOnlineFollowing(local, online, {
		onFollowingStatus: (m) => messages.push(m),
	});

	assert.equal(merged.length, 1);
	assert.equal(merged[0].accounts.length, 1);
	assert.equal(merged[0].accounts[0].platform_id, "p1");
	assert.equal(merged[0].name, "ServerName");
	assert.equal(merged[0].server_updated_at, newIso);
	assert.equal(merged[0].local_edited_at, undefined);
	assert.equal(messages.length, 1);
	assert.ok(messages[0].includes("newer server"));
}

{
	const oldIso = new Date("2025-01-01T12:00:00.000Z").toISOString();
	const localMs = new Date("2025-03-02T12:00:00.000Z").getTime();

	const local = [
		{
			id: "srv-2",
			name: "LocalOnly",
			local_edited_at: localMs,
			accounts: [account("p1", "x"), account("px", "localonly")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];
	const online = [
		{
			id: "srv-2",
			name: "ServerOld",
			server_updated_at: oldIso,
			accounts: [account("p1", "x")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];

	const merged = FollowingSyncCore.mergeLocalAndOnlineFollowing(local, online);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].accounts.length, 2);
	const handles = merged[0].accounts.map((a) => a.handle).sort();
	assert.deepEqual(handles, ["localonly", "x"]);
	assert.equal(merged[0].name, "LocalOnly");
	assert.ok(typeof merged[0].local_edited_at === "number");
}

{
	const local = [
		{
			id: "srv-3",
			name: "L",
			accounts: [account("pa", "u")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];
	const online = [
		{
			id: "srv-3",
			name: "S",
			accounts: [account("pb", "v")],
			phones: [],
			emails: [],
			addresses: [],
			notes: [],
		},
	];

	const merged = FollowingSyncCore.mergeLocalAndOnlineFollowing(local, online);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].accounts.length, 2);
	assert.equal(merged[0].name, "S");
}

assert.ok(FollowingSyncCore.parseUpdatedAtMs("") === null);
assert.ok(FollowingSyncCore.parseUpdatedAtMs("not-a-date") === null);

console.log("unit-tests: following merge OK");
