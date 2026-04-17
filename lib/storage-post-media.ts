import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Helpers for the user-facing **Uploads** page that mirror the layout the
 * extension's `uploadToStorage` step writes:
 *   {user_id}/{project_id}/posts/{photos|videos|documents}/{fileId}
 *
 * Files live in two buckets:
 *   - `post-media`         — public-readable; we build direct public URLs.
 *   - `post-media-private` — read-protected; we mint short-lived signed URLs.
 *
 * Listings come from the `list_user_storage_files` RPC (defined in
 * `supabase/migrations/20250416000002_storage_rpc_functions.sql`) so we don't
 * have to walk every folder by hand.
 */

export const POST_MEDIA_BUCKET_PUBLIC = "post-media";
export const POST_MEDIA_BUCKET_PRIVATE = "post-media-private";
export const POST_MEDIA_FOLDERS = ["photos", "videos", "documents"] as const;
export type PostMediaFolder = (typeof POST_MEDIA_FOLDERS)[number];

const PRIVATE_URL_TTL_SECONDS = 60 * 60; // 1 hour

export interface PostMediaFile {
	/** Supabase storage object UUID (stable, can be passed to delete route). */
	id: string;
	/** Bucket the object lives in. */
	bucket: typeof POST_MEDIA_BUCKET_PUBLIC | typeof POST_MEDIA_BUCKET_PRIVATE;
	/** Just the filename (last path segment). */
	name: string;
	/** Path under `${owner_id}/` — e.g. `proj-uuid/posts/videos/file.mp4`. */
	relativePath: string;
	/** Project id parsed from the path, or `null` for legacy/unstructured objects. */
	projectId: string | null;
	/** Project owner id (the prefix this file lives under). */
	ownerId: string;
	/** `photos|videos|documents` parsed from the path, or `null` if non-standard. */
	mediaFolder: PostMediaFolder | null;
	/** Public URL (`post-media`) or signed URL (`post-media-private`). */
	url: string;
	sizeBytes: number;
	contentType: string | null;
	createdAt: string | null;
	isPrivate: boolean;
}

interface RawListedObject {
	id: string;
	bucket_id: string;
	name: string;
	metadata: Record<string, unknown> | null;
	created_at: string | null;
}

function parseProjectAndFolder(relativePath: string): {
	projectId: string | null;
	mediaFolder: PostMediaFolder | null;
} {
	const parts = relativePath.split("/");
	if (parts.length >= 4 && parts[1] === "posts" && (POST_MEDIA_FOLDERS as readonly string[]).includes(parts[2])) {
		return { projectId: parts[0], mediaFolder: parts[2] as PostMediaFolder };
	}
	return { projectId: null, mediaFolder: null };
}

/**
 * List up to `limit` of the user's most recent post-media files across both
 * buckets and resolve URLs (public for public bucket, signed for private).
 *
 * Default limit is 500; caller can lower it for paginated views.
 */
export async function listUserPostMediaFiles(
	supabase: SupabaseClient,
	userId: string,
	{ limit = 500, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<PostMediaFile[]> {
	if (!userId) return [];

	const userPrefix = `${userId}/`;

	const { data, error } = await supabase.rpc("list_user_storage_files", {
		p_user_prefix: userPrefix,
		p_bucket_ids: [POST_MEDIA_BUCKET_PUBLIC, POST_MEDIA_BUCKET_PRIVATE],
		p_limit: limit,
		p_offset: offset,
	});

	if (error) {
		console.error("[storage-post-media] list rpc failed:", error.message);
		return [];
	}

	const files = mapRawRowsToFiles((data ?? []) as RawListedObject[], userPrefix, userId);
	await resolvePrivateUrls(supabase, files);
	return files;
}

/**
 * List post-media files across **multiple owner prefixes** — used by the
 * dashboard "Uploads" page so a user can see files in projects they own *and*
 * projects they collaborate on (which live under another owner's prefix).
 *
 * Each owner is queried in its own RPC call so we never accidentally surface
 * files from prefixes the caller can't access.
 */
export async function listPostMediaFilesForOwners(
	supabase: SupabaseClient,
	owners: Array<{ ownerId: string; projectIds: string[] }>,
	{ limit = 500 }: { limit?: number } = {},
): Promise<PostMediaFile[]> {
	const out: PostMediaFile[] = [];
	for (const { ownerId, projectIds } of owners) {
		if (!ownerId || projectIds.length === 0) continue;
		const ownerPrefix = `${ownerId}/`;
		const { data, error } = await supabase.rpc("list_user_storage_files", {
			p_user_prefix: ownerPrefix,
			p_bucket_ids: [POST_MEDIA_BUCKET_PUBLIC, POST_MEDIA_BUCKET_PRIVATE],
			p_limit: limit,
			p_offset: 0,
		});
		if (error) {
			console.error("[storage-post-media] owner list failed:", ownerId, error.message);
			continue;
		}
		const rows = (data ?? []) as RawListedObject[];
		const allowed = new Set(projectIds);
		const files = mapRawRowsToFiles(rows, ownerPrefix, ownerId).filter(
			(f) => f.projectId == null || allowed.has(f.projectId),
		);
		out.push(...files);
	}
	out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
	await resolvePrivateUrls(supabase, out);
	return out.slice(0, limit);
}

function mapRawRowsToFiles(rows: RawListedObject[], ownerPrefix: string, ownerId: string): PostMediaFile[] {
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
	const out: PostMediaFile[] = [];
	for (const row of rows) {
		const isPrivate = row.bucket_id === POST_MEDIA_BUCKET_PRIVATE;
		const bucket = isPrivate ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
		const relativePath = row.name.startsWith(ownerPrefix) ? row.name.slice(ownerPrefix.length) : row.name;
		const { projectId, mediaFolder } = parseProjectAndFolder(relativePath);
		const filename = relativePath.split("/").pop() ?? relativePath;
		const sizeBytes = typeof row.metadata?.size === "number" ? (row.metadata.size as number) : 0;
		const contentType = (row.metadata?.mimetype as string | undefined) ?? null;

		out.push({
			id: row.id,
			bucket,
			name: filename,
			relativePath,
			projectId,
			ownerId,
			mediaFolder,
			url: isPrivate
				? ""
				: `${supabaseUrl}/storage/v1/object/public/${bucket}/${row.name.split("/").map(encodeURIComponent).join("/")}`,
			sizeBytes,
			contentType,
			createdAt: row.created_at,
			isPrivate,
		});
	}
	return out;
}

async function resolvePrivateUrls(supabase: SupabaseClient, files: PostMediaFile[]): Promise<void> {
	const privateFiles = files.filter((f) => f.isPrivate && !f.url);
	if (privateFiles.length === 0) return;
	const fullPaths = privateFiles.map((f) => `${f.ownerId}/${f.relativePath}`);
	const { data: signed } = await supabase.storage
		.from(POST_MEDIA_BUCKET_PRIVATE)
		.createSignedUrls(fullPaths, PRIVATE_URL_TTL_SECONDS);
	if (!Array.isArray(signed)) return;
	const byPath = new Map<string, string>();
	for (const s of signed) {
		if (s?.path && s?.signedUrl) byPath.set(s.path, s.signedUrl);
	}
	for (const f of privateFiles) {
		const fullPath = `${f.ownerId}/${f.relativePath}`;
		const url = byPath.get(fullPath);
		if (url) f.url = url;
	}
}

export interface ProjectFolderGroup {
	projectId: string;
	projectName: string;
	ownerId: string | null;
	role: "owner" | "editor" | "viewer" | null;
	quotaBytes: number | null;
	folders: Array<{
		folder: PostMediaFolder | "other";
		files: PostMediaFile[];
	}>;
	totalFiles: number;
	totalBytes: number;
}

export interface ProjectGroupContext {
	id: string;
	name: string;
	ownerId: string;
	role: "owner" | "editor" | "viewer";
	quotaBytes: number | null;
	usedBytes: number;
}

/**
 * Group already-listed files by `projectId` and then by `mediaFolder`. Pass a
 * `projectContext` map (keyed by project id) to attach role / owner / quota
 * info — required so the UI can render shared-by chips and per-project usage
 * bars without a second database round-trip.
 *
 * Files whose path doesn't follow the canonical layout are bucketed under a
 * synthetic `_unsorted` project so users can still see (and clean up) legacy
 * uploads.
 */
export function groupPostMediaByProject(
	files: PostMediaFile[],
	projectContext: Record<string, ProjectGroupContext>,
): ProjectFolderGroup[] {
	const byProject = new Map<string, PostMediaFile[]>();
	for (const f of files) {
		const key = f.projectId ?? "_unsorted";
		const arr = byProject.get(key);
		if (arr) arr.push(f);
		else byProject.set(key, [f]);
	}

	// Make sure every project the user can see shows up, even when it has no files yet.
	for (const projectId of Object.keys(projectContext)) {
		if (!byProject.has(projectId)) byProject.set(projectId, []);
	}

	const groups: ProjectFolderGroup[] = [];
	for (const [projectId, projectFiles] of byProject) {
		const folderMap = new Map<PostMediaFolder | "other", PostMediaFile[]>();
		for (const f of projectFiles) {
			const folderKey = f.mediaFolder ?? "other";
			const arr = folderMap.get(folderKey);
			if (arr) arr.push(f);
			else folderMap.set(folderKey, [f]);
		}

		const folders: ProjectFolderGroup["folders"] = [];
		const order: Array<PostMediaFolder | "other"> = ["photos", "videos", "documents", "other"];
		for (const f of order) {
			const arr = folderMap.get(f);
			if (arr && arr.length > 0) folders.push({ folder: f, files: arr });
		}

		const ctx = projectContext[projectId];
		const totalBytes = ctx?.usedBytes ?? projectFiles.reduce((acc, f) => acc + f.sizeBytes, 0);
		groups.push({
			projectId,
			projectName:
				projectId === "_unsorted"
					? "Unsorted (legacy)"
					: ctx?.name ?? `Project ${projectId.slice(0, 8)}`,
			ownerId: ctx?.ownerId ?? null,
			role: ctx?.role ?? null,
			quotaBytes: ctx?.quotaBytes ?? null,
			folders,
			totalFiles: projectFiles.length,
			totalBytes,
		});
	}

	groups.sort((a, b) => {
		if (a.projectId === "_unsorted") return 1;
		if (b.projectId === "_unsorted") return -1;
		return a.projectName.localeCompare(b.projectName);
	});

	return groups;
}

/**
 * Resolve the canonical media folder from a content type or explicit override.
 * Mirrors `resolveMediaFolder` in the upload route so the page UI and the API
 * agree.
 */
export function resolvePostMediaFolder(
	contentType: string | null | undefined,
	explicit?: string | null,
): PostMediaFolder {
	const e = explicit ? String(explicit).toLowerCase() : "";
	if ((POST_MEDIA_FOLDERS as readonly string[]).includes(e)) return e as PostMediaFolder;
	const ct = (contentType || "").toLowerCase();
	if (ct.startsWith("video/")) return "videos";
	if (ct.startsWith("image/")) return "photos";
	return "documents";
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
