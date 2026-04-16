import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

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
 * Body: { filename, content_type, size_bytes, project_id, media_type?, private? }
 * Files are stored at {userId}/{projectId}/posts/{photos|videos|documents}/{fileId}.
 * When private=true, the file goes into post-media-private and file_url is a signed URL.
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
		private?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { filename, content_type, size_bytes, project_id, media_type } = body;
	const isPrivate = body.private === true;
	if (!filename) {
		return Response.json({ error: "filename is required" }, { status: 400 });
	}
	if (!project_id) {
		return Response.json({ error: "project_id is required" }, { status: 400 });
	}

	const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET_PUBLIC;
	const mediaFolder = resolveMediaFolder(content_type || "", media_type);
	const fileId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}`;
	const filePath = `${user.user_id}/${project_id}/posts/${mediaFolder}/${fileId}`;

	const supabase = getSupabase();

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

	return Response.json({
		ok: true,
		upload_url: data.signedUrl,
		file_url: fileUrl,
		file_id: fileId,
		file_path: filePath.slice(user.user_id.length + 1),
		content_type: content_type || "application/octet-stream",
		size_bytes: size_bytes || 0,
		project_id,
		media_type: mediaFolder,
		private: isPrivate,
	});
}
