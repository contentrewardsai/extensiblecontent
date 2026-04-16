import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET = "post-media";
const MEDIA_FOLDERS = ["photos", "videos", "documents"];

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: List uploaded files in user's storage.
 * Query: ?page=&limit=&project_id=&media_type=
 *
 * When project_id is provided, lists files under {userId}/{projectId}/posts/{media_type}/.
 * When neither filter is given, queries storage.objects directly to list all files recursively.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 100, 1000);
	const page = Math.max(Number(request.nextUrl.searchParams.get("page")) || 0, 0);
	const offset = page * limit;
	const projectId = request.nextUrl.searchParams.get("project_id") || null;
	const mediaType = request.nextUrl.searchParams.get("media_type") || null;

	const supabase = getSupabase();
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

	if (projectId && mediaType && MEDIA_FOLDERS.includes(mediaType)) {
		const prefix = `${user.user_id}/${projectId}/posts/${mediaType}`;
		const { data: files, error } = await supabase.storage
			.from(BUCKET)
			.list(prefix, { limit, offset, sortBy: { column: "created_at", order: "desc" } });

		if (error) return Response.json({ error: error.message }, { status: 500 });

		const mapped = (files ?? []).filter((f) => f.id).map((f) => ({
			id: f.id,
			name: f.name,
			path: `${projectId}/posts/${mediaType}/${f.name}`,
			url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${prefix}/${f.name}`,
			size: (f.metadata as Record<string, unknown> | undefined)?.size ?? 0,
			content_type: (f.metadata as Record<string, unknown> | undefined)?.mimetype ?? null,
			created_at: f.created_at,
			project_id: projectId,
			media_type: mediaType,
		}));

		return Response.json({ ok: true, files: mapped, page, limit, project_id: projectId, media_type: mediaType });
	}

	if (projectId) {
		const allFiles: Record<string, unknown>[] = [];
		for (const folder of MEDIA_FOLDERS) {
			const prefix = `${user.user_id}/${projectId}/posts/${folder}`;
			const { data: files } = await supabase.storage
				.from(BUCKET)
				.list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
			for (const f of files ?? []) {
				if (!f.id) continue;
				allFiles.push({
					id: f.id,
					name: f.name,
					path: `${projectId}/posts/${folder}/${f.name}`,
					url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${prefix}/${f.name}`,
					size: (f.metadata as Record<string, unknown> | undefined)?.size ?? 0,
					content_type: (f.metadata as Record<string, unknown> | undefined)?.mimetype ?? null,
					created_at: f.created_at,
					project_id: projectId,
					media_type: folder,
				});
			}
		}
		allFiles.sort((a, b) => {
			const da = a.created_at as string | undefined;
			const db = b.created_at as string | undefined;
			return (db ?? "").localeCompare(da ?? "");
		});
		const paged = allFiles.slice(offset, offset + limit);
		return Response.json({ ok: true, files: paged, page, limit, project_id: projectId });
	}

	// No filters: query storage.objects directly for all files under this user
	const prefix = `${user.user_id}/`;
	const { data: objects, error } = await supabase
		.schema("storage")
		.from("objects")
		.select("id, name, metadata, created_at")
		.eq("bucket_id", BUCKET)
		.like("name", `${prefix}%`)
		.order("created_at", { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) return Response.json({ error: error.message }, { status: 500 });

	const mapped = (objects ?? []).map((obj) => {
		const relativePath = obj.name.slice(prefix.length);
		const meta = obj.metadata as Record<string, unknown> | null;
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
			url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${obj.name}`,
			size: (typeof meta?.size === "number" ? meta.size : 0),
			content_type: meta?.mimetype ?? null,
			created_at: obj.created_at,
			project_id: objProjectId,
			media_type: objMediaType,
		};
	});

	return Response.json({ ok: true, files: mapped, page, limit });
}
