/**
 * Classification helper for `DELETE /api/extension/social-post/storage/files/[fileId]`.
 *
 * The extension's `uploadToStorage` step stores files at
 * `${user_id}/${project_id}/posts/${mediaFolder}/${fileId}` where `fileId` is
 * `${Date.now()}-${uuid8}-${originalFilename}` (e.g. `1729000000000-a1b2c3d4-clip.mp4`).
 *
 * The list endpoint returns Supabase's storage object UUID for each file (which
 * the extension may pass back as `fileId`).
 *
 * The route param can therefore be one of three things:
 *  - **path**   – contains a `/`; treat as `${user_id}/<value>` (legacy / explicit `?path=`).
 *  - **uuid**   – matches the storage.objects UUID; resolve to the real path via RPC.
 *  - **basename** – the bare upload `fileId` (or any other final path segment); resolve
 *                   by suffix match (`o.name ends with '/'+basename`) under the user prefix.
 *
 * Pure function so it can be unit-tested without Supabase.
 */

export const STORAGE_OBJECT_UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StorageDeleteIdKind = "path" | "uuid" | "basename" | "empty";

export interface StorageDeleteIdClassification {
	kind: StorageDeleteIdKind;
	value: string;
}

export function classifyStorageDeleteId(raw: unknown): StorageDeleteIdClassification {
	const trimmed = typeof raw === "string" ? raw.trim() : "";
	if (!trimmed) return { kind: "empty", value: "" };
	if (trimmed.includes("/")) return { kind: "path", value: trimmed };
	if (STORAGE_OBJECT_UUID_RE.test(trimmed)) return { kind: "uuid", value: trimmed };
	return { kind: "basename", value: trimmed };
}

/**
 * Pick the buckets to search based on a `?private=` query param value.
 * - `"true"`     → only the private bucket
 * - `"false"` / missing → search both (so a basename / UUID resolves regardless of where it lives)
 *
 * Callers should still respect an *explicit* request — e.g. when the extension
 * passes both `?path=` and `?private=true`, write to the private bucket only.
 */
export function resolveBucketsForDelete(
	privateParam: string | null | undefined,
	publicBucket: string,
	privateBucket: string,
): string[] {
	if (privateParam === "true") return [privateBucket];
	return [publicBucket, privateBucket];
}

/**
 * Strip a leading `${user_id}/` from a storage object name to produce the
 * relative path the extension can pass back as `?path=` (or store on a row).
 */
export function relativeStoragePath(objectName: string, userId: string): string {
	const prefix = `${userId}/`;
	return objectName.startsWith(prefix) ? objectName.slice(prefix.length) : objectName;
}
