import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET_PUBLIC = "post-media";
const BUCKET_PRIVATE = "post-media-private";
const SIGNED_URL_EXPIRY = 3600;

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

	// Verify render belongs to user
	const { data: render } = await supabase
		.from("shotstack_renders")
		.select("id")
		.eq("shotstack_render_id", renderId)
		.eq("user_id", user.user_id)
		.single();

	if (!render) {
		return Response.json({ error: "Render not found" }, { status: 404 });
	}

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

	const ext = format || "mp4";
	const timestamp = Date.now();
	const filePath = `${user.user_id}/${project_id}/generations/${template_id}/${timestamp}_${renderId}.${ext}`;

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

	// Update the render record with the permanent Supabase URL
	await supabase
		.from("shotstack_renders")
		.update({
			output_url: fileUrl,
			updated_at: new Date().toISOString(),
		})
		.eq("shotstack_render_id", renderId)
		.eq("user_id", user.user_id);

	return Response.json({
		ok: true,
		file_url: fileUrl,
		file_path: filePath.slice(user.user_id.length + 1),
		project_id,
		template_id,
		private: isPrivate,
	});
}
