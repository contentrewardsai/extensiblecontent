import type { NextRequest } from "next/server";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { assertProjectQuota, ProjectQuotaError } from "@/lib/project-quota";
import { describeFallback } from "@/lib/storage-destination";
import { performStorageUpload } from "@/lib/storage-upload";
import { getServiceSupabase } from "@/lib/supabase-service";
import { getMemberProjectIdsForUser, shotstackListOrFilter } from "@/lib/whop-shotstack-template-routes";

/** Map a MIME type to a file extension. Handles audio, video, and image. */
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

/**
 * POST /api/ghl/shotstack/browser-render
 *
 * Mirror of /api/whop/shotstack/browser-render for the GHL Custom Page surface.
 * The active `locationId`/`companyId` (from the GHL Custom Page context) are
 * passed through to the resolver so an upload initiated from inside GHL
 * defaults to that location's Media Library.
 */
export async function POST(request: NextRequest) {
	const supabase = getServiceSupabase();
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ error: "Invalid multipart form" }, { status: 400 });
	}
	const template_id = String(form.get("template_id") ?? "");
	const locationId = String(form.get("locationId") ?? "") || null;
	const companyId = String(form.get("companyId") ?? "") || null;
	const p = form.get("project_id");
	const projectIdForm = typeof p === "string" && p.trim() ? p.trim() : null;
	const isPrivate = form.get("private") === "true" || form.get("private") === "on";
	const file = form.get("file");
	if (!template_id) {
		return Response.json({ error: "template_id is required" }, { status: 400 });
	}
	if (!(file instanceof Blob) || file.size === 0) {
		return Response.json({ error: "file is required" }, { status: 400 });
	}

	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;
	const { internalUserId } = auth;

	let project_id: string;
	let owner_id: string;
	try {
		if (projectIdForm) {
			const m = await assertProjectAccess(supabase, projectIdForm, internalUserId, "editor");
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

	const memberProjectIds = await getMemberProjectIdsForUser(internalUserId);
	const orVis = shotstackListOrFilter(internalUserId, memberProjectIds);
	const { data: templateRow, error: templateErr } = await supabase
		.from("shotstack_templates")
		.select("id, edit, user_id, is_builtin")
		.eq("id", template_id)
		.or(orVis)
		.maybeSingle();
	if (templateErr || !templateRow) {
		return Response.json({ error: "Template not found" }, { status: 404 });
	}

	// Derive extension and content type from the blob's MIME. The client may also
	// send an explicit `content_type` form field (e.g. audio exports send "audio/wav").
	const rawType = file.type && file.type !== "application/octet-stream" ? file.type : "";
	const clientType = String(form.get("content_type") ?? "").trim();
	const contentType = rawType || clientType || "video/mp4";
	const ext = mimeToExt(contentType);
	const fileBuffer = await file.arrayBuffer();

	const { data: projectRow } = await supabase.from("projects").select("quota_bytes").eq("id", project_id).maybeSingle();
	const quotaBytes = (projectRow?.quota_bytes as number | null) ?? null;
	try {
		await assertProjectQuota(supabase, {
			ownerId: owner_id,
			projectId: project_id,
			quotaBytes,
			addBytes: fileBuffer.byteLength,
		});
	} catch (err) {
		if (err instanceof ProjectQuotaError) {
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		throw err;
	}

	const renderId = crypto.randomUUID();
	const timestamp = Date.now();
	const filename = `${timestamp}_${renderId}.${ext}`;

	let uploadResult;
	try {
		uploadResult = await performStorageUpload({
			resolve: {
				internalUserId,
				projectId: project_id,
				// Active GHL context from the Custom Page — resolver uses it first
				// when picking a location for GHL uploads.
				activeGhlContext: { locationId, companyId },
			},
			supabasePathPrefix: `${owner_id}/${project_id}/generations/${template_id}`,
			filename,
			contentType,
			bytes: fileBuffer,
			privateSupabase: isPrivate,
		});
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
	}

	const { error: insertErr } = await supabase.from("shotstack_renders").insert({
		user_id: owner_id,
		shotstack_render_id: renderId,
		request_json: {
			source: "browser",
			template_id,
			ghl_location_id: locationId,
			ghl_company_id: companyId,
			edit_snapshot: templateRow.edit ?? {},
		},
		status: "ready",
		output_url: uploadResult.fileUrl,
		credits_used: 0,
		env: "browser",
		storage_type: uploadResult.storageType,
		storage_meta: uploadResult.storageMeta,
	});
	if (insertErr) {
		console.error("[ghl browser-render] shotstack_renders insert", insertErr);
		return Response.json({ error: insertErr.message }, { status: 500 });
	}

	return Response.json({
		ok: true,
		shotstack_render_id: renderId,
		file_url: uploadResult.fileUrl,
		storage_type: uploadResult.storageType,
		fallback_reason: uploadResult.fallbackReason ?? null,
		fallback_message: uploadResult.fallbackReason
			? `${describeFallback(uploadResult.fallbackReason)}${uploadResult.fallbackDetail ? ` (${uploadResult.fallbackDetail})` : ""}`
			: null,
		project_id,
		template_id,
		owner_id,
		private: isPrivate,
	});
}
