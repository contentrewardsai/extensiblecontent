import assert from "node:assert/strict";
import {
	STORAGE_OBJECT_UUID_RE,
	classifyStorageDeleteId,
	relativeStoragePath,
	resolveBucketsForDelete,
} from "../lib/storage-object-resolve";

// --- STORAGE_OBJECT_UUID_RE ---

assert.equal(STORAGE_OBJECT_UUID_RE.test("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), true);
assert.equal(STORAGE_OBJECT_UUID_RE.test("A1B2C3D4-E5F6-7890-ABCD-EF1234567890"), true);
// uuid-shaped but not the right length
assert.equal(STORAGE_OBJECT_UUID_RE.test("a1b2c3d4-e5f6-7890-abcd-ef123456789"), false);
// upload basename (Date.now()-uuid8-name) is *not* a UUID
assert.equal(STORAGE_OBJECT_UUID_RE.test("1729000000000-a1b2c3d4-clip.mp4"), false);
// extra trailing data
assert.equal(STORAGE_OBJECT_UUID_RE.test("a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"), false);

// --- classifyStorageDeleteId ---

assert.deepEqual(classifyStorageDeleteId(undefined), { kind: "empty", value: "" });
assert.deepEqual(classifyStorageDeleteId(null), { kind: "empty", value: "" });
assert.deepEqual(classifyStorageDeleteId(""), { kind: "empty", value: "" });
assert.deepEqual(classifyStorageDeleteId("   "), { kind: "empty", value: "" });
assert.deepEqual(classifyStorageDeleteId(123 as unknown), { kind: "empty", value: "" });

// Anything with a slash is treated as a relative path (legacy behavior).
assert.deepEqual(
	classifyStorageDeleteId("proj-abc/posts/videos/clip.mp4"),
	{ kind: "path", value: "proj-abc/posts/videos/clip.mp4" },
);
assert.deepEqual(
	classifyStorageDeleteId("  proj/posts/photos/x.png  "),
	{ kind: "path", value: "proj/posts/photos/x.png" },
);

// Storage object UUIDs come back from the list endpoint as bare ids.
assert.deepEqual(
	classifyStorageDeleteId("a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
	{ kind: "uuid", value: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
);
assert.deepEqual(
	classifyStorageDeleteId(" A1B2C3D4-E5F6-7890-ABCD-EF1234567890 "),
	{ kind: "uuid", value: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890" },
);

// The extension's `uploadToStorage` step builds fileId = `${Date.now()}-${uuid8}-${filename}`
// — has dashes but is not a valid UUID, so it falls through to basename resolution.
assert.deepEqual(
	classifyStorageDeleteId("1729000000000-a1b2c3d4-clip.mp4"),
	{ kind: "basename", value: "1729000000000-a1b2c3d4-clip.mp4" },
);
assert.deepEqual(
	classifyStorageDeleteId("photo.png"),
	{ kind: "basename", value: "photo.png" },
);
// LIKE special characters in user filenames must NOT be classified as uuid/path
// — the SQL helper handles them safely with `right(name, ...)` matching.
assert.deepEqual(
	classifyStorageDeleteId("100%_off_banner.jpg"),
	{ kind: "basename", value: "100%_off_banner.jpg" },
);

// --- resolveBucketsForDelete ---

assert.deepEqual(
	resolveBucketsForDelete(null, "post-media", "post-media-private"),
	["post-media", "post-media-private"],
);
assert.deepEqual(
	resolveBucketsForDelete(undefined, "post-media", "post-media-private"),
	["post-media", "post-media-private"],
);
assert.deepEqual(
	resolveBucketsForDelete("false", "post-media", "post-media-private"),
	["post-media", "post-media-private"],
);
// Only `?private=true` (literal string from URLSearchParams) restricts to private.
assert.deepEqual(
	resolveBucketsForDelete("true", "post-media", "post-media-private"),
	["post-media-private"],
);

// --- relativeStoragePath ---

assert.equal(
	relativeStoragePath("user-uuid/proj-abc/posts/videos/clip.mp4", "user-uuid"),
	"proj-abc/posts/videos/clip.mp4",
);
// Already relative → unchanged.
assert.equal(
	relativeStoragePath("proj/posts/videos/x.mp4", "user-uuid"),
	"proj/posts/videos/x.mp4",
);
// Defensive: make sure another user_id that is a prefix of this user's UUID
// is NOT accidentally stripped (the prefix check requires the trailing slash).
assert.equal(
	relativeStoragePath("user-uuid-22/proj/posts/x.mp4", "user-uuid"),
	"user-uuid-22/proj/posts/x.mp4",
);

console.log("storage-object-resolve.test.ts ok");
