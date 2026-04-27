import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { uploadTemplateThumbnail } from "@/lib/shotstack-thumbnail-upload";

/**
 * PUT /api/ghl/shotstack-templates/:id/thumbnail
 *
 * FormData: file, locationId?, companyId?
 * (auth via ec_whop_user cookie; GHL linkage re-verified when locationId or
 * companyId is provided.)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ error: "Invalid multipart form" }, { status: 400 });
	}
	const locationId = String(form.get("locationId") ?? "") || null;
	const companyId = String(form.get("companyId") ?? "") || null;
	const file = form.get("file");
	if (!(file instanceof Blob) || file.size === 0) {
		return Response.json({ error: "file is required" }, { status: 400 });
	}

	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;
	const { id } = await params;

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
