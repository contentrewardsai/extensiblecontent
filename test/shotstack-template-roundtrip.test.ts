import assert from "node:assert/strict";

/**
 * Round-trip test for ShotStack generator templates saved via
 * `POST /api/extension/shotstack-templates` and reloaded via
 * `GET /api/extension/shotstack-templates`.
 *
 * The backend stores the full ShotStack `edit` JSON verbatim in the
 * `shotstack_templates.edit` JSONB column. The extension's editor embeds
 * metadata in `edit.merge` using `__CFS_*` entries (notably
 * `__CFS_UNDO_HISTORY`, which holds a JSON-stringified `{ fabricHead, patches }`
 * capped at `maxHistory = 100`).
 *
 * This test inlines a faithful copy of `serializeEditorMeta` /
 * `deserializeEditorMeta` from
 * `ExtensibleContentExtension/generator/editor/unified-editor.js` and simulates
 * the cloud round-trip via `JSON.parse(JSON.stringify(...))`, which is a
 * superset of what Postgres JSONB does to a JSON value.
 *
 * If you change the serializer shape in the extension, mirror the changes here
 * so regressions (e.g. dropping `__CFS_UNDO_HISTORY` on reload) are caught
 * before they ship.
 */

const CFS_META_PREFIX = "__CFS_";
const CFS_META_KEYS: Record<string, string> = {
	TEMPLATE_ID: "id",
	TEMPLATE_NAME: "name",
	DESCRIPTION: "description",
	OUTPUT_TYPE: "outputType",
	PRESET_ID: "outputPresetId",
	DEFAULT_WORKFLOW_ID: "defaultWorkflowId",
};

type MergeEntry = { find: string; replace: string };

interface EditorExt {
	id?: string;
	name?: string;
	description?: string;
	outputType?: string;
	outputPresetId?: string;
	defaultWorkflowId?: string;
	inputSchema?: Array<Record<string, unknown>>;
	_undoHistory?: { fabricHead: unknown; patches: Array<Record<string, unknown>> };
}

function serializeEditorMeta(ext: EditorExt): MergeEntry[] {
	if (!ext || typeof ext !== "object") return [];
	const entries: MergeEntry[] = [];
	for (const metaKey of Object.keys(CFS_META_KEYS)) {
		const extKey = CFS_META_KEYS[metaKey];
		const val = (ext as Record<string, unknown>)[extKey];
		if (val != null && val !== "") {
			entries.push({ find: CFS_META_PREFIX + metaKey, replace: String(val) });
		}
	}
	if (Array.isArray(ext.inputSchema) && ext.inputSchema.length) {
		entries.push({ find: `${CFS_META_PREFIX}INPUT_SCHEMA`, replace: JSON.stringify(ext.inputSchema) });
	}
	if (ext._undoHistory) {
		entries.push({ find: `${CFS_META_PREFIX}UNDO_HISTORY`, replace: JSON.stringify(ext._undoHistory) });
	}
	return entries;
}

function deserializeEditorMeta(mergeArray: MergeEntry[] | undefined): EditorExt | null {
	if (!Array.isArray(mergeArray)) return null;
	const meta: EditorExt = {};
	let found = false;
	for (const m of mergeArray) {
		if (!m) continue;
		const key = m.find != null ? String(m.find) : "";
		if (key.indexOf(CFS_META_PREFIX) !== 0) continue;
		found = true;
		const suffix = key.slice(CFS_META_PREFIX.length);
		if (suffix === "INPUT_SCHEMA") {
			try {
				meta.inputSchema = JSON.parse(m.replace);
			} catch {}
			continue;
		}
		if (suffix === "UNDO_HISTORY") {
			try {
				meta._undoHistory = JSON.parse(m.replace);
			} catch {}
			continue;
		}
		const extKey = CFS_META_KEYS[suffix];
		if (extKey) (meta as Record<string, unknown>)[extKey] = m.replace != null ? m.replace : "";
	}
	return found ? meta : null;
}

/**
 * Simulate the full POST → storage → GET cycle. The backend inserts the JSON
 * verbatim into a JSONB column and re-serializes it on read, which is
 * equivalent to a JSON.stringify/parse round-trip.
 */
function cloudRoundTrip<T>(payload: T): T {
	return JSON.parse(JSON.stringify(payload)) as T;
}

const MAX_HISTORY = 100;

// ---------------------------------------------------------------------------
// 1. Full editor metadata survives POST → GET.
// ---------------------------------------------------------------------------
{
	const ext: EditorExt = {
		id: "ad-apple-notes",
		name: "Text Ad — Apple Notes",
		description: "Apple Notes–style card.",
		outputType: "image",
		outputPresetId: "instagram_square",
		inputSchema: [
			{ id: "AD_APPLE_NOTES_TITLE_1", type: "text", label: "Title" },
			{ id: "AD_APPLE_NOTES_TEXT_1", type: "text", label: "Body" },
		],
	};

	const edit = {
		timeline: { background: "#fff8e7", tracks: [] },
		output: { format: "png", size: { width: 1080, height: 1080 } },
		merge: [
			{ find: "AD_APPLE_NOTES_TITLE_1", replace: "Hello" },
			{ find: "AD_APPLE_NOTES_TEXT_1", replace: "World" },
			...serializeEditorMeta(ext),
		],
	};

	const loaded = cloudRoundTrip(edit);
	const restoredMeta = deserializeEditorMeta(loaded.merge);
	assert.ok(restoredMeta, "__CFS_* meta should be found after round-trip");
	assert.equal(restoredMeta.id, ext.id);
	assert.equal(restoredMeta.name, ext.name);
	assert.equal(restoredMeta.description, ext.description);
	assert.equal(restoredMeta.outputType, ext.outputType);
	assert.equal(restoredMeta.outputPresetId, ext.outputPresetId);
	assert.deepEqual(restoredMeta.inputSchema, ext.inputSchema);
	// User-facing merge entries are preserved verbatim.
	assert.ok(Array.isArray(loaded.merge));
	const userEntries = loaded.merge.filter((m: MergeEntry) => !m.find.startsWith(CFS_META_PREFIX));
	assert.equal(userEntries.length, 2);
	assert.deepEqual(
		userEntries.find((m: MergeEntry) => m.find === "AD_APPLE_NOTES_TEXT_1"),
		{ find: "AD_APPLE_NOTES_TEXT_1", replace: "World" },
	);
}

// ---------------------------------------------------------------------------
// 2. __CFS_UNDO_HISTORY with a full 100-entry patches array round-trips losslessly.
// ---------------------------------------------------------------------------
{
	const patches: Array<Record<string, unknown>> = [];
	for (let i = 0; i < MAX_HISTORY; i += 1) {
		patches.push({
			at: `2026-04-26T17:${String(i % 60).padStart(2, "0")}:00Z`,
			isSave: i === MAX_HISTORY - 1,
			ops: [
				{ op: "replace", path: `/timeline/tracks/0/clips/${i}/asset/text`, value: `step-${i}` },
				{ op: "add", path: `/merge/-`, value: { find: `K${i}`, replace: `v${i}` } },
			],
		});
	}
	assert.equal(patches.length, MAX_HISTORY, "baseline patches.length is capped at maxHistory");

	const undoHistory = {
		fabricHead: {
			version: "5.3.0",
			objects: [{ type: "textbox", left: 100, top: 100, text: "Step N" }],
		},
		patches,
	};

	const ext: EditorExt = { id: "blank-canvas", _undoHistory: undoHistory };
	const edit = {
		timeline: { tracks: [] },
		output: { format: "png", size: { width: 512, height: 512 } },
		merge: serializeEditorMeta(ext),
	};

	const loaded = cloudRoundTrip(edit);
	const restored = deserializeEditorMeta(loaded.merge);
	assert.ok(restored?._undoHistory, "undo history must survive round-trip");
	const restoredHistory = restored._undoHistory as typeof undoHistory;
	assert.equal(restoredHistory.patches.length, MAX_HISTORY, "all 100 patch entries preserved");
	assert.deepEqual(restoredHistory.fabricHead, undoHistory.fabricHead, "fabricHead is byte-for-byte identical");
	assert.deepEqual(restoredHistory.patches[0], undoHistory.patches[0], "first patch preserved");
	assert.deepEqual(restoredHistory.patches[MAX_HISTORY - 1], undoHistory.patches[MAX_HISTORY - 1], "last patch preserved");
	// Save-point markers survive too (used by the "Save History" dialog).
	assert.equal(restoredHistory.patches[MAX_HISTORY - 1].isSave, true);
}

// ---------------------------------------------------------------------------
// 3. Merge array with only user entries (no __CFS_*) produces `null` on
//    deserialize so the editor falls back to defaults rather than assuming
//    broken metadata.
// ---------------------------------------------------------------------------
{
	const edit = {
		merge: [
			{ find: "TITLE", replace: "Hello" },
			{ find: "BODY", replace: "World" },
		],
	};
	const loaded = cloudRoundTrip(edit);
	assert.equal(deserializeEditorMeta(loaded.merge), null);
}

// ---------------------------------------------------------------------------
// 4. UTF-8 / emoji content in merge values round-trips cleanly (JSONB is
//    UTF-8, but we want an explicit regression guard).
// ---------------------------------------------------------------------------
{
	const ext: EditorExt = { id: "color-block", name: "Colour 💡 Block" };
	const edit = {
		timeline: {},
		output: {},
		merge: [
			{ find: "SUBTITLE", replace: "こんにちは 🌸" },
			...serializeEditorMeta(ext),
		],
	};
	const loaded = cloudRoundTrip(edit);
	const meta = deserializeEditorMeta(loaded.merge);
	assert.equal(meta?.name, "Colour 💡 Block");
	const subtitle = (loaded.merge as MergeEntry[]).find((m) => m.find === "SUBTITLE");
	assert.equal(subtitle?.replace, "こんにちは 🌸");
}

console.log("shotstack-template-roundtrip.test.ts ok");
