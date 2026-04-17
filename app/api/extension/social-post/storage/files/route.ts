import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, listAccessibleProjects, ProjectAccessError } from "@/lib/project-access";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";
const BUCKETS = [BUCKET_PUBLIC, BUCKET_PRIVATE] as const;
const MEDIA_FOLDERS = ["photos", "videos", "documents"];
const SIGNED_URL_EXPIRY = 3600;

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

interface FileEntry {
	id: string;
	name: string;
	path: string;
	/** Alias of `path` matching the upload response shape; pass back as `?path=` to DELETE. */
	file_path: string;
	url: string;
	size: number;
	content_type: string | null;
	created_at: string | null;
	project_id: string | null;
	owner_id: string | null;
	media_type: string | null;
	private: boolean;
}

/**
 * GET: List uploaded files visible to the user (owned + shared projects).
 * Query: ?page=&limit=&project_id=&media_type=&visibility=public|private
 *
 * Files are stored under the *owner's* user prefix, so when listing across
 * shared projects we walk every accessible project's owner prefix and merge.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 100, 1000);
	const page = Math.max(Number(request.nextUrl.searchParams.get("page")) || 0, 0);
	const offset = page * limit;
	const projectId = request.nextUrl.searchParams.get("project_id") || null;
	const mediaType = request.nextUrl.searchParams.get("media_type") || null;
	const visibility = request.nextUrl.searchParams.get("visibility") || null;

	const supabase = getSupabase();
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

	const bucketsToQuery = visibility === "public" ? [BUCKET_PUBLIC]
		: visibility === "private" ? [BUCKET_PRIVATE]
		: [...BUCKETS];

	if (projectId && mediaType && MEDIA_FOLDERS.includes(mediaType)) {
		let ownerId: string;
		try {
			const membership = await assertProjectAccess(supabase, projectId, user.user_id, "viewer");
			ownerId = membership.ownerId;
		} catch (e) {
			if (e instanceof ProjectAccessError) return Response.json({ error: e.message }, { status: e.status });
			throw e;
		}

		const allFiles: FileEntry[] = [];
		for (const bucket of bucketsToQuery) {
			const isPrivate = bucket === BUCKET_PRIVATE;
			const prefix = `${ownerId}/${projectId}/posts/${mediaType}`;
			const { data: files } = await supabase.storage
				.from(bucket)
				.list(prefix, { limit, offset, sortBy: { column: "created_at", order: "desc" } });

			for (const f of files ?? []) {
				if (!f.id) continue;
				const relPath = `${projectId}/posts/${mediaType}/${f.name}`;
				allFiles.push({
					id: f.id,
					name: f.name,
					path: relPath,
					file_path: relPath,
					url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix}/${f.name}`,
					size: ((f.metadata as Record<string, unknown> | undefined)?.size as number) ?? 0,
					content_type: ((f.metadata as Record<string, unknown> | undefined)?.mimetype as string) ?? null,
					created_at: f.created_at ?? null,
					project_id: projectId,
					owner_id: ownerId,
					media_type: mediaType,
					private: isPrivate,
				});
			}
		}

		await resolvePrivateUrls(supabase, allFiles);
		return Response.json({ ok: true, files: allFiles, page, limit, project_id: projectId, media_type: mediaType });
	}

	if (projectId) {
		let ownerId: string;
		try {
			const membership = await assertProjectAccess(supabase, projectId, user.user_id, "viewer");
			ownerId = membership.ownerId;
		} catch (e) {
			if (e instanceof ProjectAccessError) return Response.json({ error: e.message }, { status: e.status });
			throw e;
		}

		const allFiles: FileEntry[] = [];
		for (const bucket of bucketsToQuery) {
			const isPrivate = bucket === BUCKET_PRIVATE;
			for (const folder of MEDIA_FOLDERS) {
				const prefix = `${ownerId}/${projectId}/posts/${folder}`;
				const { data: files } = await supabase.storage
					.from(bucket)
					.list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
				for (const f of files ?? []) {
					if (!f.id) continue;
					const relPath = `${projectId}/posts/${folder}/${f.name}`;
					allFiles.push({
						id: f.id,
						name: f.name,
						path: relPath,
						file_path: relPath,
						url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix}/${f.name}`,
						size: ((f.metadata as Record<string, unknown> | undefined)?.size as number) ?? 0,
						content_type: ((f.metadata as Record<string, unknown> | undefined)?.mimetype as string) ?? null,
						created_at: f.created_at ?? null,
						project_id: projectId,
						owner_id: ownerId,
						media_type: folder,
						private: isPrivate,
					});
				}
			}
		}
		allFiles.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
		const paged = allFiles.slice(offset, offset + limit);
		await resolvePrivateUrls(supabase, paged);
		return Response.json({ ok: true, files: paged, page, limit, project_id: projectId });
	}

	// No project filter: list across every project the user has access to,
	// scoping each query to that project's owner prefix.
	const accessible = await listAccessibleProjects(supabase, user.user_id);
	if (accessible.length === 0) {
		return Response.json({ ok: true, files: [], page, limit });
	}

	const aggregated: FileEntry[] = [];
	for (const project of accessible) {
		const ownerPrefix = `${project.owner_id}/`;
		const { data: objects, error } = await supabase.rpc("list_user_storage_files_by_project", {
			p_owner_prefix: ownerPrefix,
			p_project_id: project.id,
			p_bucket_ids: bucketsToQuery as unknown as string[],
			p_limit: limit,
			p_offset: 0,
		});
		if (error || !objects) continue;
		const rows = objects as { id: string; bucket_id: string; name: string; metadata: Record<string, unknown> | null; created_at: string | null }[];
		for (const obj of rows) {
			const isPrivate = obj.bucket_id === BUCKET_PRIVATE;
			const relativePath = obj.name.startsWith(ownerPrefix) ? obj.name.slice(ownerPrefix.length) : obj.name;
			const parts = relativePath.split("/");
			let objMediaType: string | null = null;
			if (parts.length >= 4 && parts[1] === "posts" && MEDIA_FOLDERS.includes(parts[2])) {
				objMediaType = parts[2];
			}
			aggregated.push({
				id: obj.id,
				name: parts[parts.length - 1],
				path: relativePath,
				file_path: relativePath,
				url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${obj.bucket_id}/${obj.name}`,
				size: typeof obj.metadata?.size === "number" ? obj.metadata.size : 0,
				content_type: (obj.metadata?.mimetype as string) ?? null,
				created_at: obj.created_at,
				project_id: project.id,
				owner_id: project.owner_id,
				media_type: objMediaType,
				private: isPrivate,
			});
		}
	}

	aggregated.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
	const paged = aggregated.slice(offset, offset + limit);
	await resolvePrivateUrls(supabase, paged);
	return Response.json({ ok: true, files: paged, page, limit });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePrivateUrls(supabase: ReturnType<typeof createClient<any>>, files: FileEntry[]) {
	const privateFiles = files.filter((f) => f.private && !f.url && f.owner_id);
	if (privateFiles.length === 0) return;

	const fullPaths = privateFiles.map((f) => `${f.owner_id}/${f.path}`);
	const { data: signedUrls } = await supabase.storage
		.from(BUCKET_PRIVATE)
		.createSignedUrls(fullPaths, SIGNED_URL_EXPIRY);

	if (signedUrls) {
		for (let i = 0; i < privateFiles.length; i++) {
			if (signedUrls[i]?.signedUrl) {
				privateFiles[i].url = signedUrls[i].signedUrl;
			}
		}
	}
}
