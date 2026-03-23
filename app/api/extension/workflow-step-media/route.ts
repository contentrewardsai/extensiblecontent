import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET = "workflow-data";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

async function userCanAccessWorkflow(
	supabase: SupabaseClient,
	workflow: { created_by: string },
	workflowId: string,
	userId: string,
): Promise<boolean> {
	if (workflow.created_by === userId) return true;
	const { data } = await supabase
		.from("workflow_added_by")
		.select("user_id")
		.eq("workflow_id", workflowId)
		.eq("user_id", userId)
		.single();
	return !!data;
}

function extensionForFile(file: File): string {
	const fromName = /\.([a-zA-Z0-9]{1,12})$/.exec(file.name || "");
	if (fromName) return `.${fromName[1].toLowerCase()}`;
	const mime = (file.type || "").toLowerCase();
	const map: Record<string, string> = {
		"image/jpeg": ".jpg",
		"image/jpg": ".jpg",
		"image/png": ".png",
		"image/webp": ".webp",
		"image/gif": ".gif",
		"image/svg+xml": ".svg",
		"video/mp4": ".mp4",
		"video/webm": ".webm",
		"audio/mpeg": ".mp3",
		"audio/webm": ".webm",
		"audio/wav": ".wav",
		"audio/mp4": ".m4a",
	};
	return map[mime] ?? ".bin";
}

function sanitizePathSegment(raw: string, maxLen: number): string {
	const s = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
	return (s || "block").slice(0, maxLen);
}

/**
 * POST multipart FormData: file, workflow_id (UUID), step_index (non-negative int),
 * block_id, kind (opaque tag for logging / future use).
 * Returns { url } — public object URL; bucket should allow public read or use a CDN in front.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return Response.json({ error: "Invalid multipart body" }, { status: 400 });
	}

	const file = formData.get("file");
	const workflowIdRaw = formData.get("workflow_id");
	const stepIndexRaw = formData.get("step_index");
	const blockIdRaw = formData.get("block_id");
	const kindRaw = formData.get("kind");

	if (!(file instanceof File) || file.size === 0) {
		return Response.json({ error: "file is required and must be non-empty" }, { status: 400 });
	}
	if (typeof workflowIdRaw !== "string" || !UUID_RE.test(workflowIdRaw.trim())) {
		return Response.json({ error: "workflow_id must be a UUID" }, { status: 400 });
	}
	if (typeof stepIndexRaw !== "string" && typeof stepIndexRaw !== "number") {
		return Response.json({ error: "step_index is required" }, { status: 400 });
	}
	const stepIndexStr = String(stepIndexRaw).trim();
	const stepIndex = Number.parseInt(stepIndexStr, 10);
	if (!Number.isFinite(stepIndex) || stepIndex < 0 || String(stepIndex) !== stepIndexStr) {
		return Response.json({ error: "step_index must be a non-negative integer" }, { status: 400 });
	}
	if (typeof blockIdRaw !== "string" || !blockIdRaw.trim()) {
		return Response.json({ error: "block_id is required" }, { status: 400 });
	}
	if (typeof kindRaw !== "string" || !kindRaw.trim()) {
		return Response.json({ error: "kind is required" }, { status: 400 });
	}

	const workflowId = workflowIdRaw.trim();
	const blockSeg = sanitizePathSegment(blockIdRaw.trim(), 128);
	const kindSeg = sanitizePathSegment(kindRaw.trim(), 64);

	const maxBytes = Number.parseInt(process.env.WORKFLOW_STEP_MEDIA_MAX_BYTES || "", 10);
	const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 4_500_000;
	if (file.size > limit) {
		return Response.json(
			{ error: `file too large (max ${limit} bytes)` },
			{ status: 413 },
		);
	}

	let supabase: ReturnType<typeof getSupabase>;
	try {
		supabase = getSupabase();
	} catch {
		return Response.json({ error: "Storage not configured" }, { status: 503 });
	}

	const { data: existing, error: wfError } = await supabase
		.from("workflows")
		.select("created_by")
		.eq("id", workflowId)
		.eq("archived", false)
		.single();

	if (wfError || !existing) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	const canAccess = await userCanAccessWorkflow(supabase, existing, workflowId, user.user_id);
	if (!canAccess) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	const ext = extensionForFile(file);
	const objectName = `${randomUUID()}${ext}`;
	const objectPath = `${user.user_id}/${workflowId}/step-${stepIndex}/${kindSeg}/${blockSeg}/${objectName}`;

	const body = await file.arrayBuffer();
	const contentType = file.type && file.type.length > 0 ? file.type : "application/octet-stream";

	const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, body, {
		contentType,
		upsert: false,
	});

	if (uploadError) {
		console.error("[workflow-step-media] upload:", uploadError.message);
		return Response.json({ error: "Upload failed" }, { status: 500 });
	}

	const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
	return Response.json({ url: pub.publicUrl });
}
