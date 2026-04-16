import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

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
	url: string;
	size: number;
	content_type: string | null;
	created_at: string | null;
	project_id: string | null;
	media_type: string | null;
	private: boolean;
}

/**
 * GET: List uploaded files in user's storage (both public and private buckets).
 * Query: ?page=&limit=&project_id=&media_type=&visibility=public|private
 *
 * When project_id + media_type are provided, lists from that specific folder.
 * When only project_id is given, lists all media types under that project.
 * When no filters are given, queries storage.objects directly across both buckets.
 * Use visibility=public or visibility=private to filter by bucket.
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
		const allFiles: FileEntry[] = [];
		for (const bucket of bucketsToQuery) {
			const isPrivate = bucket === BUCKET_PRIVATE;
			const prefix = `${user.user_id}/${projectId}/posts/${mediaType}`;
			const { data: files } = await supabase.storage
				.from(bucket)
				.list(prefix, { limit, offset, sortBy: { column: "created_at", order: "desc" } });

			for (const f of files ?? []) {
				if (!f.id) continue;
				allFiles.push({
					id: f.id,
					name: f.name,
					path: `${projectId}/posts/${mediaType}/${f.name}`,
					url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix}/${f.name}`,
					size: ((f.metadata as Record<string, unknown> | undefined)?.size as number) ?? 0,
					content_type: ((f.metadata as Record<string, unknown> | undefined)?.mimetype as string) ?? null,
					created_at: f.created_at ?? null,
					project_id: projectId,
					media_type: mediaType,
					private: isPrivate,
				});
			}
		}

		await resolvePrivateUrls(supabase, user.user_id, allFiles);
		return Response.json({ ok: true, files: allFiles, page, limit, project_id: projectId, media_type: mediaType });
	}

	if (projectId) {
		const allFiles: FileEntry[] = [];
		for (const bucket of bucketsToQuery) {
			const isPrivate = bucket === BUCKET_PRIVATE;
			for (const folder of MEDIA_FOLDERS) {
				const prefix = `${user.user_id}/${projectId}/posts/${folder}`;
				const { data: files } = await supabase.storage
					.from(bucket)
					.list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
				for (const f of files ?? []) {
					if (!f.id) continue;
					allFiles.push({
						id: f.id,
						name: f.name,
						path: `${projectId}/posts/${folder}/${f.name}`,
						url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${bucket}/${prefix}/${f.name}`,
						size: ((f.metadata as Record<string, unknown> | undefined)?.size as number) ?? 0,
						content_type: ((f.metadata as Record<string, unknown> | undefined)?.mimetype as string) ?? null,
						created_at: f.created_at ?? null,
						project_id: projectId,
						media_type: folder,
						private: isPrivate,
					});
				}
			}
		}
		allFiles.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
		const paged = allFiles.slice(offset, offset + limit);
		await resolvePrivateUrls(supabase, user.user_id, paged);
		return Response.json({ ok: true, files: paged, page, limit, project_id: projectId });
	}

	// No filters: use RPC to query storage.objects across both buckets
	const prefix = `${user.user_id}/`;

	const { data: objects, error } = await supabase.rpc("list_user_storage_files", {
		p_user_prefix: prefix,
		p_bucket_ids: bucketsToQuery as unknown as string[],
		p_limit: limit,
		p_offset: offset,
	});

	if (error) return Response.json({ error: error.message }, { status: 500 });

	const rows = (objects ?? []) as { id: string; bucket_id: string; name: string; metadata: Record<string, unknown> | null; created_at: string | null }[];
	const allFiles: FileEntry[] = rows.map((obj) => {
		const isPrivate = obj.bucket_id === BUCKET_PRIVATE;
		const relativePath = obj.name.slice(prefix.length);
		const parts = relativePath.split("/");
		let objProjectId: string | null = null;
		let objMediaType: string | null = null;
		if (parts.length >= 4 && parts[1] === "posts" && MEDIA_FOLDERS.includes(parts[2])) {
			objProjectId = parts[0];
			objMediaType = parts[2];
		}
		return {
			id: obj.id,
			name: parts[parts.length - 1],
			path: relativePath,
			url: isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${obj.bucket_id}/${obj.name}`,
			size: (typeof obj.metadata?.size === "number" ? obj.metadata.size : 0),
			content_type: (obj.metadata?.mimetype as string) ?? null,
			created_at: obj.created_at,
			project_id: objProjectId,
			media_type: objMediaType,
			private: isPrivate,
		};
	});

	await resolvePrivateUrls(supabase, user.user_id, allFiles);
	return Response.json({ ok: true, files: allFiles, page, limit });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePrivateUrls(
	supabase: ReturnType<typeof createClient<any>>,
	userId: string,
	files: FileEntry[],
) {
	const privateFiles = files.filter((f) => f.private && !f.url);
	if (privateFiles.length === 0) return;

	const fullPaths = privateFiles.map((f) => `${userId}/${f.path}`);
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
