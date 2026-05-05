import type { NextRequest } from "next/server";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { assertProjectQuota, ProjectQuotaError } from "@/lib/project-quota";
import { resolveStorageTarget, describeFallback, type ResolveStorageInput } from "@/lib/storage-destination";
import { uploadToGhlMediaLibraryByUrl } from "@/lib/ghl-media-upload";
import { POST_MEDIA_BUCKET_PUBLIC, POST_MEDIA_BUCKET_PRIVATE } from "@/lib/storage-post-media";
import { getServiceSupabase } from "@/lib/supabase-service";
import { getMemberProjectIdsForUser, shotstackListOrFilter } from "@/lib/whop-shotstack-template-routes";

/** Map a MIME type to a file extension. */
function mimeToExt(mime: string): string {
	const m = mime.toLowerCase();
	if (m.includes("webm")) return "webm";
	if (m.includes("wav")) return "wav";
	if (m.includes("audio/mp4") || m.includes("m4a")) return "m4a";
	if (m.includes("audio/mpeg") || m.includes("mp3")) return "mp3";
	if (m.includes("audio/ogg")) return "ogg";
	if (m.includes("image/png")) return "png";
	if (m.includes("image/jpeg") || m.includes("image/jpg")) return "jpg";
	if (m.includes("image/webp")) return "webp";
	return "mp4";
}

interface AuthResult {
	ok: true;
	internalUserId: string;
}

// ────────────────────────────────────────────────────────────────────────────
// PRESIGNED UPLOAD — Step 1: Get a signed upload URL
// ────────────────────────────────────────────────────────────────────────────

export interface PresignedInput {
	filename: string;
	content_type: string;
	size_bytes: number;
	template_id: string;
	project_id?: string | null;
	private?: boolean;
	/** GHL context (optional). */
	locationId?: string | null;
	companyId?: string | null;
}

export async function handlePresignedUpload(
	body: PresignedInput,
	auth: AuthResult,
): Promise<Response> {
	const supabase = getServiceSupabase();
	const { internalUserId } = auth;
	const { filename, content_type, size_bytes, template_id } = body;
	const isPrivate = body.private === true;

	if (!filename || !template_id) {
		return Response.json({ error: "filename and template_id are required" }, { status: 400 });
	}

	// Resolve project
	let project_id: string;
	let owner_id: string;
	const requestedProjectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
	try {
		if (requestedProjectId) {
			const m = await assertProjectAccess(supabase, requestedProjectId, internalUserId, "editor");
			project_id = m.projectId;
			owner_id = m.ownerId;
		} else {
			project_id = await ensureUserDefaultProjectId(supabase, internalUserId);
			const m = await assertProjectAccess(supabase, project_id, internalUserId, "editor");
			owner_id = m.ownerId;
		}
	} catch (err) {
		if (err instanceof ProjectAccessError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}

	// Quota check
	const { data: projectRow } = await supabase.from("projects").select("quota_bytes").eq("id", project_id).maybeSingle();
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

	// Verify template access
	const memberProjectIds = await getMemberProjectIdsForUser(internalUserId);
	const orVis = shotstackListOrFilter(internalUserId, memberProjectIds);
	const { data: templateRow, error: templateErr } = await supabase
		.from("shotstack_templates")
		.select("id")
		.eq("id", template_id)
		.or(orVis)
		.maybeSingle();
	if (templateErr || !templateRow) {
		return Response.json({ error: "Template not found" }, { status: 404 });
	}

	// Build path and create signed upload URL
	const ext = mimeToExt(content_type || "video/mp4");
	const renderId = crypto.randomUUID();
	const timestamp = Date.now();
	const fileFilename = `${timestamp}_${renderId}.${ext}`;
	const bucket = isPrivate ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
	const filePath = `${owner_id}/${project_id}/generations/${template_id}/${fileFilename}`;

	const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(filePath);
	if (error || !data) {
		return Response.json({ error: error?.message ?? "Failed to create upload URL" }, { status: 500 });
	}

	// Build the public read URL (for non-private buckets).
	// Include ?download=<filename> so browsers get a Content-Disposition header
	// with the correct filename and extension, even when accessed directly.
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const downloadName = encodeURIComponent(filename || `render.${ext}`);
	const fileUrl = isPrivate
		? ""
		: `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}?download=${downloadName}`;
	// Also keep a raw URL without Content-Disposition for GHL import (some APIs choke on query params)
	const fileUrlRaw = isPrivate ? "" : `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;

	return Response.json({
		ok: true,
		upload_url: data.signedUrl,
		upload_token: data.token,
		file_url: fileUrl,
		file_url_raw: fileUrlRaw,
		file_path: filePath,
		bucket,
		render_id: renderId,
		content_type: content_type || "video/mp4",
		project_id,
		owner_id,
		template_id,
		private: isPrivate,
	});
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIRM UPLOAD — Step 2: Register in DB + optional GHL import
// ────────────────────────────────────────────────────────────────────────────

export interface ConfirmInput {
	file_url: string;
	file_path: string;
	render_id: string;
	template_id: string;
	content_type?: string;
	size_bytes?: number;
	project_id?: string | null;
	private?: boolean;
	/** GHL context. */
	locationId?: string | null;
	companyId?: string | null;
	/** Extra snapshot data to store on the render row. */
	edit_snapshot?: Record<string, unknown> | null;
	/** Surface identifier (e.g. "browser", "editor"). */
	source?: string;
	/** Whop experience context. */
	experienceId?: string | null;
	/** When true, the client already uploaded directly to GHL — skip re-upload. */
	ghl_direct?: boolean;
	ghl_url?: string;
	ghl_media_id?: string;
	ghl_location_id?: string;
	ghl_company_id?: string;
}

export async function handleConfirmUpload(
	body: ConfirmInput,
	auth: AuthResult,
): Promise<Response> {
	const supabase = getServiceSupabase();
	const { internalUserId } = auth;
	const { file_url, file_path, render_id, template_id, content_type } = body;
	const locationId = body.locationId || null;
	const companyId = body.companyId || null;

	if (!file_url || !template_id || !render_id) {
		return Response.json({ error: "file_url, template_id, and render_id are required" }, { status: 400 });
	}

	// Re-verify project access
	let project_id: string;
	let owner_id: string;
	const requestedProjectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
	try {
		if (requestedProjectId) {
			const m = await assertProjectAccess(supabase, requestedProjectId, internalUserId, "editor");
			project_id = m.projectId;
			owner_id = m.ownerId;
		} else {
			project_id = await ensureUserDefaultProjectId(supabase, internalUserId);
			const m = await assertProjectAccess(supabase, project_id, internalUserId, "editor");
			owner_id = m.ownerId;
		}
	} catch (err) {
		if (err instanceof ProjectAccessError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}

	// Determine storage type and metadata
	let storageType: "supabase" | "ghl" = "supabase";
	let storageMeta: Record<string, unknown> = {
		supabase_bucket: body.private ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC,
		supabase_path: file_path,
	};
	let fallbackReason: string | null = null;
	let fallbackDetail: string | null = null;
	let finalFileUrl = file_url;

	if (body.ghl_direct && body.ghl_url) {
		// Client already uploaded directly to GHL — just record the result.
		storageType = "ghl";
		finalFileUrl = body.ghl_url;
		storageMeta = {
			ghl_location_id: body.ghl_location_id || locationId,
			ghl_company_id: body.ghl_company_id || companyId,
			ghl_media_id: body.ghl_media_id || "",
			ghl_direct_upload: true,
		};
	} else if (locationId) {
		// Legacy path: try GHL import-by-URL from the Supabase copy
		const resolveInput: ResolveStorageInput = {
			internalUserId,
			projectId: project_id,
			activeGhlContext: { locationId, companyId },
		};
		const target = await resolveStorageTarget(resolveInput);
		if (target.type === "ghl") {
			try {
				const ext = mimeToExt(content_type || "video/mp4");
				const ghlResult = await uploadToGhlMediaLibraryByUrl({
					internalUserId,
					locationId: target.locationId,
					filename: `render.${ext}`,
					fileUrl: file_url,
				});
				storageType = "ghl";
				finalFileUrl = ghlResult.url;
				storageMeta = {
					ghl_location_id: target.locationId,
					ghl_company_id: companyId,
					ghl_media_id: ghlResult.mediaId,
					supabase_backup_url: file_url,
				};
			} catch (err) {
				const detail = err instanceof Error ? err.message : String(err);
				console.error("[confirm-upload] GHL import-by-url failed:", err);
				fallbackReason = "upload_failed";
				fallbackDetail = detail;
				storageMeta = {
					...storageMeta,
					attempted_ghl_location_id: target.locationId,
					ghl_upload_error: detail,
				};
			}
		} else if (target.fallbackReason) {
			fallbackReason = target.fallbackReason;
		}
	}

	// Insert render row
	const { error: insertErr } = await supabase.from("shotstack_renders").insert({
		user_id: owner_id,
		shotstack_render_id: render_id,
		request_json: {
			source: body.source || "browser",
			template_id,
			...(locationId ? { ghl_location_id: locationId } : {}),
			...(companyId ? { ghl_company_id: companyId } : {}),
			...(body.experienceId ? { experience_id: body.experienceId } : {}),
			edit_snapshot: body.edit_snapshot ?? {},
		},
		status: "ready",
		output_url: finalFileUrl,
		credits_used: 0,
		env: "browser",
		storage_type: storageType,
		storage_meta: storageMeta,
	});
	if (insertErr) {
		console.error("[confirm-upload] shotstack_renders insert", insertErr);
		return Response.json({ error: insertErr.message }, { status: 500 });
	}

	return Response.json({
		ok: true,
		shotstack_render_id: render_id,
		file_url: finalFileUrl,
		storage_type: storageType,
		fallback_reason: fallbackReason,
		fallback_message: fallbackReason
			? `${describeFallback(fallbackReason as "no_ghl_connection" | "no_location" | "upload_failed")}${fallbackDetail ? ` (${fallbackDetail})` : ""}`
			: null,
		project_id,
		template_id,
		owner_id,
		private: body.private ?? false,
	});
}
