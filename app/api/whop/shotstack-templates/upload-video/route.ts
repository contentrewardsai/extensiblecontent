import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import { uploadTemplateVideo } from "@/lib/shotstack-video-upload";

/**
 * POST /api/whop/shotstack-templates/upload-video?experienceId=...
 *
 * FormData: file (processed video clip)
 * Auth via Whop user token cookies + experience access check.
 *
 * Returns { url, availableBytes } on success.
 */
export async function POST(request: NextRequest) {
	const experienceId = request.nextUrl.searchParams.get("experienceId");
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ error: "Invalid multipart form" }, { status: 400 });
	}
	const file = form.get("file");
	if (!(file instanceof Blob) || file.size === 0) {
		return Response.json({ error: "file is required" }, { status: 400 });
	}

	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;

	const bytes = await file.arrayBuffer();
	const filename = file instanceof File ? file.name : `processed-clip-${Date.now()}.mp4`;
	const res = await uploadTemplateVideo({
		internalUserId: auth.internalUserId,
		contentType: file.type || "video/mp4",
		filename,
		bytes,
	});
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json({ url: res.url, availableBytes: res.availableBytes });
}
