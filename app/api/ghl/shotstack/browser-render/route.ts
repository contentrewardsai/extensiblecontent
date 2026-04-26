import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { assertProjectQuota, ProjectQuotaError } from "@/lib/project-quota";
import { POST_MEDIA_BUCKET_PRIVATE, POST_MEDIA_BUCKET_PUBLIC } from "@/lib/storage-post-media";
import { getMemberProjectIdsForUser, shotstackListOrFilter } from "@/lib/whop-shotstack-template-routes";

const SIGNED_URL_EXPIRY = 3600;

function getServiceSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST /api/ghl/shotstack/browser-render
 *
 * Mirror of /api/whop/shotstack/browser-render, but authenticates via the
 * `ec_whop_user` cookie and (optionally) verifies GHL linkage. The client
 * sends `locationId`/`companyId` in the form data so we can cross-check.
 *
 * FormData: locationId?, companyId?, template_id, file, project_id?, private?
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

	// See /api/whop/shotstack/browser-render — we derive ext from the blob MIME
	// so WebM fallbacks don't end up with a .mp4 filename.
	const rawType = file.type && file.type !== "application/octet-stream" ? file.type : "";
	const isWebm = rawType.includes("webm");
	const contentType = rawType || (isWebm ? "video/webm" : "video/mp4");
	const ext = isWebm ? "webm" : "mp4";
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

	const bucket = isPrivate ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
	const renderId = crypto.randomUUID();
	const timestamp = Date.now();
	const filePath = `${owner_id}/${project_id}/generations/${template_id}/${timestamp}_${renderId}.${ext}`;

	const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, fileBuffer, {
		contentType,
		upsert: true,
	});
	if (uploadError) {
		return Response.json({ error: uploadError.message }, { status: 500 });
	}

	let fileUrl: string;
	if (isPrivate) {
		const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(filePath, SIGNED_URL_EXPIRY);
		fileUrl = signed?.signedUrl ?? "";
	} else {
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
		fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
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
		output_url: fileUrl,
		credits_used: 0,
		env: "browser",
	});
	if (insertErr) {
		console.error("[ghl browser-render] shotstack_renders insert", insertErr);
		return Response.json({ error: insertErr.message }, { status: 500 });
	}

	return Response.json({
		ok: true,
		shotstack_render_id: renderId,
		file_url: fileUrl,
		project_id,
		template_id,
		owner_id,
		private: isPrivate,
	});
}
