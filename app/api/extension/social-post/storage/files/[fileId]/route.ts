import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import {
	assertProjectAccess,
	listAccessibleProjects,
	ProjectAccessError,
} from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import {
	classifyStorageDeleteId,
	relativeStoragePath,
	resolveBucketsForDelete,
} from "@/lib/storage-object-resolve";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * DELETE: Delete an uploaded file from a project's storage.
 *
 * Project sharing complicates path resolution: files live under the **owner's**
 * prefix, not the actor's. The route now needs a `?project_id=` query param so
 * we know which owner's prefix to look under, and the actor must be at least
 * an editor on that project.
 *
 * Path resolution order (within the owner prefix):
 *  1. `?path=<relative path>` — `${ownerId}/${path}` (preferred when extension
 *     stores `file_path` from the upload response).
 *  2. Route param contains `/` — treat as a relative path.
 *  3. Route param is a UUID — `storage.objects.id` lookup scoped to owner prefix.
 *  4. Otherwise treat as a basename and find by suffix match under owner prefix.
 *
 * Without `project_id`, we fall back to scanning every project the user can
 * access and resolving by UUID/basename — slower, but keeps existing
 * extension calls working.
 */
export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ fileId: string }> },
) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { fileId } = await params;
	const explicitPath = request.nextUrl.searchParams.get("path");
	const privateParam = request.nextUrl.searchParams.get("private");
	const isPrivate = privateParam === "true";
	const projectIdParam = request.nextUrl.searchParams.get("project_id");

	const supabase = getSupabase();
	const classification = classifyStorageDeleteId(fileId);
	const explicitRelative = explicitPath ?? (classification.kind === "path" ? classification.value : null);

	// When path is explicit, the first segment is the project id. Use it to
	// resolve the owner and assert editor access.
	if (explicitRelative != null) {
		const [pathProjectId, ...rest] = explicitRelative.split("/");
		const projectIdToUse = projectIdParam ?? pathProjectId;
		if (!projectIdToUse) {
			return Response.json({ error: "project_id required for path-based delete" }, { status: 400 });
		}

		let ownerId: string;
		try {
			const membership = await assertProjectAccess(supabase, projectIdToUse, user.user_id, "editor");
			ownerId = membership.ownerId;
		} catch (e) {
			if (e instanceof ProjectAccessError) return Response.json({ error: e.message }, { status: e.status });
			throw e;
		}

		const relativeUnderOwner = projectIdParam && !rest.length
			? explicitRelative
			: explicitRelative;
		const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
		const filePath = `${ownerId}/${relativeUnderOwner}`;
		const { error } = await supabase.storage.from(bucket).remove([filePath]);
		if (error) return Response.json({ error: error.message }, { status: 500 });

		await recordProjectAudit(supabase, {
			projectId: projectIdToUse,
			actorUserId: user.user_id,
			source: resolveEditSource(request, "user"),
			action: "file.deleted",
			targetType: "file",
			targetId: filePath,
			before: { file_path: relativeUnderOwner, private: isPrivate },
		});

		return Response.json({ ok: true, bucket, path: relativeUnderOwner });
	}

	if (classification.kind === "empty") {
		return Response.json({ error: "fileId is required" }, { status: 400 });
	}

	// UUID / basename: look up across either the requested project or every
	// accessible project.
	const buckets = resolveBucketsForDelete(privateParam, BUCKET_PUBLIC, BUCKET_PRIVATE);
	const ownersToSearch: { ownerId: string; projectId: string }[] = [];

	if (projectIdParam) {
		try {
			const membership = await assertProjectAccess(supabase, projectIdParam, user.user_id, "editor");
			ownersToSearch.push({ ownerId: membership.ownerId, projectId: membership.projectId });
		} catch (e) {
			if (e instanceof ProjectAccessError) return Response.json({ error: e.message }, { status: e.status });
			throw e;
		}
	} else {
		const accessible = await listAccessibleProjects(supabase, user.user_id);
		// Editor+ only — viewers shouldn't ever be the actor for a delete.
		for (const p of accessible) {
			if (p.role === "editor" || p.role === "owner") {
				ownersToSearch.push({ ownerId: p.owner_id, projectId: p.id });
			}
		}
	}

	for (const { ownerId, projectId } of ownersToSearch) {
		const { data, error: rpcError } = await supabase.rpc("resolve_user_storage_object", {
			p_user_prefix: `${ownerId}/`,
			p_bucket_ids: buckets,
			p_object_id: classification.kind === "uuid" ? classification.value : null,
			p_basename: classification.kind === "basename" ? classification.value : null,
		});
		if (rpcError) {
			return Response.json({ error: rpcError.message }, { status: 500 });
		}
		const rows = (data ?? []) as { bucket_id: string; name: string }[];
		const row = rows.length > 0 ? rows[0] : null;
		if (!row) continue;

		const { error: removeError } = await supabase.storage.from(row.bucket_id).remove([row.name]);
		if (removeError) {
			return Response.json({ error: removeError.message }, { status: 500 });
		}

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: user.user_id,
			source: resolveEditSource(request, "user"),
			action: "file.deleted",
			targetType: "file",
			targetId: row.name,
			before: { file_path: relativeStoragePath(row.name, ownerId), private: row.bucket_id === BUCKET_PRIVATE },
		});

		return Response.json({
			ok: true,
			bucket: row.bucket_id,
			path: relativeStoragePath(row.name, ownerId),
			project_id: projectId,
		});
	}

	return Response.json({ error: "File not found" }, { status: 404 });
}
