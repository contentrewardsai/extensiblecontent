import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { assertProjectQuota, ProjectQuotaError } from "@/lib/project-quota";
import { recordAdjustment } from "@/lib/shotstack-ledger";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";
const SIGNED_URL_EXPIRY = 3600;

/**
 * Refund the credit debit for `renderId` so the user isn't charged for a
 * render they couldn't store. We only refund the `credits_used` recorded on
 * `shotstack_renders` (matches what `queueShotStackRender` debited) and
 * write an adjustment so the billing-history page shows the offset clearly.
 */
async function refundRenderCredits(
	supabase: SupabaseClient,
	userId: string,
	renderId: string,
	reason: string,
): Promise<void> {
	const { data } = await supabase
		.from("shotstack_renders")
		.select("credits_used")
		.eq("shotstack_render_id", renderId)
		.eq("user_id", userId)
		.maybeSingle();
	const credits = Number((data as { credits_used: number | null } | null)?.credits_used ?? 0);
	if (!Number.isFinite(credits) || credits <= 0) return;
	try {
		await recordAdjustment(supabase, {
			userId,
			credits,
			description: `Refund for render ${renderId} (${reason})`,
			metadata: { shotstack_render_id: renderId, reason },
		});
	} catch (err) {
		console.error("[store-render] refund adjustment failed:", err);
	}
}

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Download a ShotStack CDN render output and persist to Supabase Storage.
 * Called after a successful render to preserve the output before CDN URLs expire (24h).
 * Stored at {userId}/{projectId}/generations/{templateId}/{timestamp}_{renderId}.{format}
 * inside the shared post-media bucket.
 * Body: { renderId, url, project_id, template_id, environment?, format?, durationSeconds?, private? }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		renderId: string;
		url: string;
		project_id: string;
		template_id: string;
		environment?: string;
		format?: string;
		durationSeconds?: number;
		private?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { renderId, url, project_id, template_id, format } = body;
	const isPrivate = body.private === true;
	const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
	if (!renderId || !url) {
		return Response.json({ error: "renderId and url are required" }, { status: 400 });
	}
	if (!project_id) {
		return Response.json({ error: "project_id is required" }, { status: 400 });
	}
	if (!template_id) {
		return Response.json({ error: "template_id is required" }, { status: 400 });
	}

	const supabase = getSupabase();

	// Resolve project membership first (editor required to write into the
	// project). The project owner is the storage-cap holder — files live
	// under the owner's prefix so an editor uploading on a shared project
	// counts against the owner's pool. Same convention as the social-post
	// storage upload route.
	let owner_id: string;
	try {
		const membership = await assertProjectAccess(supabase, project_id, user.user_id, "editor");
		owner_id = membership.ownerId;
	} catch (err) {
		if (err instanceof ProjectAccessError) {
			return Response.json({ error: err.message }, { status: err.status });
		}
		throw err;
	}

	// Verify the render exists and belongs to the project owner. With
	// project-shared rendering an actor (collaborator) can store a render
	// they triggered against the owner's wallet — but only if they have
	// editor access to the project the render was scoped to (already
	// asserted above).
	const { data: render } = await supabase
		.from("shotstack_renders")
		.select("id")
		.eq("shotstack_render_id", renderId)
		.eq("user_id", owner_id)
		.maybeSingle();

	if (!render) {
		return Response.json({ error: "Render not found" }, { status: 404 });
	}

	const { data: projectRow } = await supabase
		.from("projects")
		.select("quota_bytes")
		.eq("id", project_id)
		.maybeSingle();
	const quotaBytes = (projectRow?.quota_bytes as number | null) ?? null;

	// Fetch the rendered file from CDN
	let fileBuffer: ArrayBuffer;
	let contentType: string;
	try {
		const cdnRes = await fetch(url);
		if (!cdnRes.ok) {
			return Response.json({ error: `Failed to fetch render: HTTP ${cdnRes.status}` }, { status: 502 });
		}
		contentType = cdnRes.headers.get("content-type") ?? "video/mp4";
		fileBuffer = await cdnRes.arrayBuffer();
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Failed to fetch render from CDN";
		return Response.json({ error: msg }, { status: 502 });
	}

	// Quota check before the storage write. If we'd blow past the owner's
	// cap (or the project sub-cap), refund the render credit so the user
	// isn't charged for output they can't keep, and surface a 413.
	try {
		await assertProjectQuota(supabase, {
			ownerId: owner_id,
			projectId: project_id,
			quotaBytes,
			addBytes: fileBuffer.byteLength,
		});
	} catch (err) {
		if (err instanceof ProjectQuotaError) {
			// Refund the *owner's* wallet — that's where the debit landed
			// (queueShotStackRender uses the project owner as the wallet
			// holder, not the actor).
			await refundRenderCredits(supabase, owner_id, renderId, err.code);
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		throw err;
	}

	const ext = format || "mp4";
	const timestamp = Date.now();
	const filePath = `${owner_id}/${project_id}/generations/${template_id}/${timestamp}_${renderId}.${ext}`;

	const { error: uploadError } = await supabase.storage
		.from(bucket)
		.upload(filePath, fileBuffer, {
			contentType,
			upsert: true,
		});

	if (uploadError) {
		return Response.json({ error: uploadError.message }, { status: 500 });
	}

	let fileUrl: string;
	if (isPrivate) {
		const { data: signed } = await supabase.storage
			.from(bucket)
			.createSignedUrl(filePath, SIGNED_URL_EXPIRY);
		fileUrl = signed?.signedUrl ?? "";
	} else {
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
		fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
	}

	await supabase
		.from("shotstack_renders")
		.update({
			output_url: fileUrl,
			updated_at: new Date().toISOString(),
		})
		.eq("shotstack_render_id", renderId)
		.eq("user_id", owner_id);

	return Response.json({
		ok: true,
		file_url: fileUrl,
		file_path: filePath.slice(owner_id.length + 1),
		project_id,
		owner_id,
		template_id,
		private: isPrivate,
	});
}
