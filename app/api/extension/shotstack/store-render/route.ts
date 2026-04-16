import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET = "shotstack-output";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Download a ShotStack CDN render output and persist to Supabase Storage.
 * Called after a successful render to preserve the output before CDN URLs expire (24h).
 * Body: { renderId, url, environment, format?, durationSeconds? }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		renderId: string;
		url: string;
		environment?: string;
		format?: string;
		durationSeconds?: number;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { renderId, url, format } = body;
	if (!renderId || !url) {
		return Response.json({ error: "renderId and url are required" }, { status: 400 });
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
	const filePath = `${user.user_id}/${renderId}.${ext}`;

	const { error: uploadError } = await supabase.storage
		.from(BUCKET)
		.upload(filePath, fileBuffer, {
			contentType,
			upsert: true,
		});

	if (uploadError) {
		return Response.json({ error: uploadError.message }, { status: 500 });
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const fileUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}`;

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
		file_id: filePath,
	});
}
