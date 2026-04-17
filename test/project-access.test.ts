import assert from "node:assert/strict";
import {
	assertProjectAccess,
	getProjectMembership,
	listAccessibleProjects,
	ProjectAccessError,
	resolveProjectOwnerId,
	roleSatisfies,
} from "../lib/project-access";

// ---------------------------------------------------------------------------
// Pure helper: roleSatisfies — the rank ordering must be viewer < editor < owner.
// ---------------------------------------------------------------------------

assert.equal(roleSatisfies("owner", "viewer"), true);
assert.equal(roleSatisfies("owner", "editor"), true);
assert.equal(roleSatisfies("owner", "owner"), true);
assert.equal(roleSatisfies("editor", "viewer"), true);
assert.equal(roleSatisfies("editor", "editor"), true);
assert.equal(roleSatisfies("editor", "owner"), false);
assert.equal(roleSatisfies("viewer", "viewer"), true);
assert.equal(roleSatisfies("viewer", "editor"), false);
assert.equal(roleSatisfies("viewer", "owner"), false);

// ---------------------------------------------------------------------------
// Tiny mock that mimics the ~chained query builder shape we use in lib/.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface MockTableState {
	rows: Row[];
}

function makeBuilder(rows: Row[]) {
	let filtered = rows.slice();
	const builder: Record<string, unknown> = {};
	const ret = (): typeof builder => builder;
	builder.select = ret;
	builder.eq = (col: string, val: unknown) => {
		filtered = filtered.filter((r) => r[col] === val);
		return builder;
	};
	builder.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });
	builder.single = async () =>
		filtered[0]
			? { data: filtered[0], error: null }
			: { data: null, error: { message: "Row not found" } };
	builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
		resolve({ data: filtered, error: null });
	return builder;
}

function makeSupabase(state: Record<string, MockTableState>) {
	return {
		from(table: string) {
			const t = state[table];
			if (!t) throw new Error(`Unknown table ${table}`);
			return makeBuilder(t.rows);
		},
	} as unknown as Parameters<typeof getProjectMembership>[0];
}

// ---------------------------------------------------------------------------
// getProjectMembership / assertProjectAccess: full role-by-required matrix.
// ---------------------------------------------------------------------------

void (async () => {
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const EDITOR_ID = "22222222-2222-2222-2222-222222222222";
const VIEWER_ID = "33333333-3333-3333-3333-333333333333";
const STRANGER_ID = "44444444-4444-4444-4444-444444444444";

const supa = makeSupabase({
	projects: { rows: [{ id: PROJECT_ID, owner_id: OWNER_ID }] },
	project_members: {
		rows: [
			{ project_id: PROJECT_ID, user_id: OWNER_ID, role: "owner" },
			{ project_id: PROJECT_ID, user_id: EDITOR_ID, role: "editor" },
			{ project_id: PROJECT_ID, user_id: VIEWER_ID, role: "viewer" },
		],
	},
});

{
	const m = await getProjectMembership(supa, PROJECT_ID, OWNER_ID);
	assert.ok(m, "owner should have membership");
	assert.equal(m?.role, "owner");
	assert.equal(m?.ownerId, OWNER_ID);
}

assert.equal(await getProjectMembership(supa, PROJECT_ID, STRANGER_ID), null);
assert.equal(await getProjectMembership(supa, "missing-project", OWNER_ID), null);

const matrix: Array<{ user: string; required: "viewer" | "editor" | "owner"; ok: boolean }> = [
	// Owner can do anything.
	{ user: OWNER_ID, required: "viewer", ok: true },
	{ user: OWNER_ID, required: "editor", ok: true },
	{ user: OWNER_ID, required: "owner", ok: true },
	// Editor: viewer + editor only.
	{ user: EDITOR_ID, required: "viewer", ok: true },
	{ user: EDITOR_ID, required: "editor", ok: true },
	{ user: EDITOR_ID, required: "owner", ok: false },
	// Viewer: viewer only.
	{ user: VIEWER_ID, required: "viewer", ok: true },
	{ user: VIEWER_ID, required: "editor", ok: false },
	{ user: VIEWER_ID, required: "owner", ok: false },
];

for (const { user, required, ok } of matrix) {
	if (ok) {
		const m = await assertProjectAccess(supa, PROJECT_ID, user, required);
		assert.equal(m.role !== "viewer" || required === "viewer", true);
	} else {
		await assert.rejects(
			() => assertProjectAccess(supa, PROJECT_ID, user, required),
			(e: unknown) => e instanceof ProjectAccessError && e.status === 403,
		);
	}
}

// Stranger: any required role must yield 404 (so we don't leak project existence).
for (const required of ["viewer", "editor", "owner"] as const) {
	await assert.rejects(
		() => assertProjectAccess(supa, PROJECT_ID, STRANGER_ID, required),
		(e: unknown) => e instanceof ProjectAccessError && e.status === 404,
	);
}

// Missing project: 404 even for the would-be owner.
await assert.rejects(
	() => assertProjectAccess(supa, "ghost-project", OWNER_ID, "viewer"),
	(e: unknown) => e instanceof ProjectAccessError && e.status === 404,
);

// resolveProjectOwnerId: success and missing-project paths.
assert.equal(await resolveProjectOwnerId(supa, PROJECT_ID), OWNER_ID);
await assert.rejects(
	() => resolveProjectOwnerId(supa, "ghost-project"),
	(e: unknown) => e instanceof ProjectAccessError && e.status === 404,
);

// ---------------------------------------------------------------------------
// listAccessibleProjects: pulls from project_members + nested projects join.
// We model the join as the supabase-js v2 result shape: projects can be either
// an object or a single-element array.
// ---------------------------------------------------------------------------

{
	const projectsByUser = makeSupabase({
		project_members: {
			rows: [
				{
					user_id: VIEWER_ID,
					role: "viewer",
					projects: {
						id: PROJECT_ID,
						name: "Shared",
						description: null,
						quota_bytes: null,
						owner_id: OWNER_ID,
						created_at: "2025-01-01T00:00:00Z",
						updated_at: "2025-01-02T00:00:00Z",
					},
				},
				{
					user_id: VIEWER_ID,
					role: "owner",
					projects: [
						{
							id: "p2",
							name: "Mine",
							description: "x",
							quota_bytes: 1234,
							owner_id: VIEWER_ID,
							created_at: "2025-01-01T00:00:00Z",
							updated_at: "2025-01-03T00:00:00Z",
						},
					],
				},
				// Garbage rows we expect to filter out.
				{ user_id: VIEWER_ID, role: "viewer", projects: null },
				{ user_id: VIEWER_ID, role: "weirdo", projects: { id: "p3", owner_id: VIEWER_ID } },
				// Another user should not show up via the user_id eq filter.
				{ user_id: STRANGER_ID, role: "owner", projects: { id: "p4", owner_id: STRANGER_ID } },
			],
		},
	});

	const list = await listAccessibleProjects(projectsByUser, VIEWER_ID);
	assert.equal(list.length, 2);
	// Sorted by updated_at desc — `Mine` was updated 2025-01-03.
	assert.equal(list[0].id, "p2");
	assert.equal(list[0].role, "owner");
	assert.equal(list[1].id, PROJECT_ID);
	assert.equal(list[1].role, "viewer");

	assert.deepEqual(await listAccessibleProjects(projectsByUser, ""), []);
}

console.log("project-access.test.ts ok");
})();
