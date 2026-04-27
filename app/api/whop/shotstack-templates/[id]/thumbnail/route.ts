import type { NextRequest } from "next/server";
import { uploadTemplateThumbnail } from "@/lib/shotstack-thumbnail-upload";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";

/**
 * PUT /api/whop/shotstack-templates/:id/thumbnail?experienceId=...
 *
 * FormData: file (PNG/WebP/JPEG)
 *
 * Uploads the captured Fabric-canvas thumbnail for a user-owned template.
 * Built-ins reject with 409; the clone-on-save flow captures the thumbnail
 * on the resulting copy instead.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const experienceId = request.nextUrl.searchParams.get("experienceId");
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;
	const { id } = await params;

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
	const bytes = await file.arrayBuffer();
	const res = await uploadTemplateThumbnail({
		internalUserId: auth.internalUserId,
		templateId: id,
		contentType: file.type || "image/png",
		bytes,
	});
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json({
		ok: true,
		thumbnail_url: res.thumbnailUrl,
		thumbnail_updated_at: res.thumbnailUpdatedAt,
	});
}
