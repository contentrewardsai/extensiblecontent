import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const BUCKET = "post-media";
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
 * Body: { filename, content_type, size_bytes, project_id, media_type? }
 * Files are stored at {userId}/{projectId}/posts/{photos|videos|documents}/{fileId}.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		filename: string;
		content_type: string;
		size_bytes: number;
		project_id: string;
		media_type?: string;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { filename, content_type, size_bytes, project_id, media_type } = body;
	if (!filename) {
		return Response.json({ error: "filename is required" }, { status: 400 });
	}
	if (!project_id) {
		return Response.json({ error: "project_id is required" }, { status: 400 });
	}

	const mediaFolder = resolveMediaFolder(content_type || "", media_type);
	const fileId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}`;
	const filePath = `${user.user_id}/${project_id}/posts/${mediaFolder}/${fileId}`;

	const supabase = getSupabase();

	const { data, error } = await supabase.storage
		.from(BUCKET)
		.createSignedUploadUrl(filePath);

	if (error || !data) {
		return Response.json({ error: error?.message ?? "Failed to create upload URL" }, { status: 500 });
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}`;

	return Response.json({
		ok: true,
		upload_url: data.signedUrl,
		file_url: publicUrl,
		file_id: fileId,
		file_path: filePath.slice(user.user_id.length + 1),
		content_type: content_type || "application/octet-stream",
		size_bytes: size_bytes || 0,
		project_id,
		media_type: mediaFolder,
	});
}
