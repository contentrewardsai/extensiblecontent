import assert from "node:assert/strict";
import {
	EDIT_SOURCE_HEADER,
	parseEditSource,
	recordProjectAudit,
	resolveEditSource,
} from "../lib/project-audit";

// ---------------------------------------------------------------------------
// parseEditSource — case-insensitive, whitespace-tolerant, defaults to fallback
// for missing/unknown values. The vocabulary mirrors what the Chrome extension
// stamps on workflow edits: 'user', 'backend', 'mcp'.
// ---------------------------------------------------------------------------

assert.equal(parseEditSource("user"), "user");
assert.equal(parseEditSource("USER"), "user");
assert.equal(parseEditSource(" mcp "), "mcp");
assert.equal(parseEditSource("backend"), "backend");

// Unknown / missing → fallback (default 'backend').
assert.equal(parseEditSource(undefined), "backend");
assert.equal(parseEditSource(null), "backend");
assert.equal(parseEditSource(""), "backend");
assert.equal(parseEditSource("system"), "backend");

// Custom fallback respected for both unknown and missing.
assert.equal(parseEditSource(undefined, "user"), "user");
assert.equal(parseEditSource("nonsense", "mcp"), "mcp");

// ---------------------------------------------------------------------------
// resolveEditSource — pulls from the X-Edit-Source request header. Header name
// is lowercased per Web Fetch's `Headers` semantics.
// ---------------------------------------------------------------------------

void (async () => {
function fakeRequest(headerVal: string | null): { headers: { get(name: string): string | null } } {
	return {
		headers: {
			get(name: string) {
				return name.toLowerCase() === EDIT_SOURCE_HEADER ? headerVal : null;
			},
		},
	};
}

assert.equal(resolveEditSource(fakeRequest("user")), "user");
assert.equal(resolveEditSource(fakeRequest("MCP")), "mcp");
assert.equal(resolveEditSource(fakeRequest(null)), "backend");
assert.equal(resolveEditSource(fakeRequest("garbage"), "user"), "user");
// Defensive: missing request altogether falls through cleanly.
assert.equal(resolveEditSource(undefined), "backend");
assert.equal(resolveEditSource(null, "mcp"), "mcp");

// ---------------------------------------------------------------------------
// recordProjectAudit — happy path, normalizes optional fields, swallows DB
// errors so audit logging never breaks the calling route.
// ---------------------------------------------------------------------------

function makeMockSupabase(insertImpl: (row: Record<string, unknown>) => { error: { message: string } | null }) {
	const inserted: Array<Record<string, unknown>> = [];
	const supabase = {
		from(table: string) {
			assert.equal(table, "project_audit_log");
			return {
				async insert(row: Record<string, unknown>) {
					inserted.push(row);
					return insertImpl(row);
				},
			};
		},
	} as unknown as Parameters<typeof recordProjectAudit>[0];
	return { supabase, inserted };
}

{
	const { supabase, inserted } = makeMockSupabase(() => ({ error: null }));
	await recordProjectAudit(supabase, {
		projectId: "p1",
		actorUserId: "u1",
		source: "user",
		action: "project.created",
		targetType: "project",
		targetId: "p1",
		after: { name: "Alpha" },
	});
	assert.equal(inserted.length, 1);
	assert.deepEqual(inserted[0], {
		project_id: "p1",
		actor_user_id: "u1",
		source: "user",
		action: "project.created",
		target_type: "project",
		target_id: "p1",
		before: null,
		after: { name: "Alpha" },
	});
}

// Optional fields default to null on the wire.
{
	const { supabase, inserted } = makeMockSupabase(() => ({ error: null }));
	await recordProjectAudit(supabase, {
		projectId: "p1",
		actorUserId: null,
		source: "backend",
		action: "project.synced",
	});
	assert.deepEqual(inserted[0], {
		project_id: "p1",
		actor_user_id: null,
		source: "backend",
		action: "project.synced",
		target_type: null,
		target_id: null,
		before: null,
		after: null,
	});
}

// Missing projectId / action: silently no-op (we do not insert garbage rows).
{
	const { supabase, inserted } = makeMockSupabase(() => ({ error: null }));
	await recordProjectAudit(supabase, {
		projectId: "",
		actorUserId: "u1",
		source: "user",
		action: "project.created",
	});
	await recordProjectAudit(supabase, {
		projectId: "p1",
		actorUserId: "u1",
		source: "user",
		action: "",
	});
	assert.equal(inserted.length, 0);
}

// DB error → logged + swallowed (does not throw out of recordProjectAudit).
{
	const { supabase } = makeMockSupabase(() => ({ error: { message: "rls denied" } }));
	const origErr = console.error;
	const errs: unknown[][] = [];
	console.error = (...args: unknown[]) => {
		errs.push(args);
	};
	try {
		await recordProjectAudit(supabase, {
			projectId: "p1",
			actorUserId: "u1",
			source: "user",
			action: "project.created",
		});
	} finally {
		console.error = origErr;
	}
	assert.equal(errs.length, 1);
	assert.match(String(errs[0][0]), /\[project-audit\] insert failed/);
}

console.log("project-audit.test.ts ok");
})();
