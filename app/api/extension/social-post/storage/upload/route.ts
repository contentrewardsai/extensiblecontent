import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { assertProjectQuota, ProjectQuotaError } from "@/lib/project-quota";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";
const SIGNED_URL_EXPIRY = 3600; // 1 hour
const VALID_MEDIA_TYPES = ["photos", "videos", "documents"] as const;
type MediaType = (typeof VALID_MEDIA_TYPES)[number];

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function resolveMediaFolder(contentType: string, explicitType?: string): MediaType {
	if (explicitType && VALID_MEDIA_TYPES.includes(explicitType as MediaType)) {
		return explicitType as MediaType;
	}
	if (contentType.startsWith("video/")) return "videos";
	if (contentType.startsWith("image/")) return "photos";
	return "documents";
}

/**
 * POST: Get a presigned upload URL for user's storage.
 * Body: { filename, content_type, size_bytes, project_id?, media_type?, private? }
 * Files are stored at {ownerId}/{projectId}/posts/{photos|videos|documents}/{fileId}
 * — note `ownerId` is the **project owner**, not the actor, so collaborators
 * uploading on a shared project still consume the owner's storage cap.
 *
 * `project_id` is optional. When omitted (or blank), the server resolves a
 * project automatically via `ensureUserDefaultProjectId` (caller's own
 * default), so older extension builds and ad-hoc uploads still work.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		filename: string;
		content_type: string;
		size_bytes: number;
		project_id?: string | null;
		media_type?: string;
		private?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { filename, content_type, size_bytes, media_type } = body;
	const isPrivate = body.private === true;
	if (!filename) {
		return Response.json({ error: "filename is required" }, { status: 400 });
	}

	const supabase = getSupabase();

	const requestedProjectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
	let project_id: string;
	let project_id_source: "request" | "default";
	let owner_id: string;
	if (requestedProjectId) {
		try {
			const membership = await assertProjectAccess(
				supabase,
				requestedProjectId,
				user.user_id,
				"editor",
			);
			project_id = membership.projectId;
			owner_id = membership.ownerId;
		} catch (err) {
			if (err instanceof ProjectAccessError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			throw err;
		}
		project_id_source = "request";
	} else {
		try {
			project_id = await ensureUserDefaultProjectId(supabase, user.user_id);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to resolve default project";
			return Response.json({ error: message }, { status: 500 });
		}
		owner_id = user.user_id;
		project_id_source = "default";
	}

	const { data: projectRow } = await supabase
		.from("projects")
		.select("quota_bytes")
		.eq("id", project_id)
		.maybeSingle();
	const quotaBytes = (projectRow?.quota_bytes as number | null) ?? null;

	try {
		await assertProjectQuota(supabase, {
			ownerId: owner_id,
			projectId: project_id,
			quotaBytes,
			addBytes: typeof size_bytes === "number" ? size_bytes : 0,
		});
	} catch (err) {
		if (err instanceof ProjectQuotaError) {
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		throw err;
	}

	const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
	const mediaFolder = resolveMediaFolder(content_type || "", media_type);
	const fileId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}`;
	const filePath = `${owner_id}/${project_id}/posts/${mediaFolder}/${fileId}`;

	const { data, error } = await supabase.storage
		.from(bucket)
		.createSignedUploadUrl(filePath);

	if (error || !data) {
		return Response.json({ error: error?.message ?? "Failed to create upload URL" }, { status: 500 });
	}

	let fileUrl: string;
	if (isPrivate) {
		const { data: signed, error: signErr } = await supabase.storage
			.from(bucket)
			.createSignedUrl(filePath, SIGNED_URL_EXPIRY);
		fileUrl = signed?.signedUrl ?? "";
		if (signErr) {
			fileUrl = "";
		}
	} else {
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
		fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
	}

	await recordProjectAudit(supabase, {
		projectId: project_id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "file.created",
		targetType: "file",
		targetId: filePath,
		after: {
			file_id: fileId,
			size_bytes: size_bytes ?? 0,
			content_type: content_type ?? null,
			media_type: mediaFolder,
			private: isPrivate,
		},
	});

	return Response.json({
		ok: true,
		upload_url: data.signedUrl,
		file_url: fileUrl,
		file_id: fileId,
		file_path: filePath.slice(owner_id.length + 1),
		content_type: content_type || "application/octet-stream",
		size_bytes: size_bytes || 0,
		project_id,
		project_id_source,
		owner_id,
		media_type: mediaFolder,
		private: isPrivate,
	});
}
