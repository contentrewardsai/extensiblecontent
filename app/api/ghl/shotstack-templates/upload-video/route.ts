import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { uploadTemplateVideo } from "@/lib/shotstack-video-upload";

/**
 * POST /api/ghl/shotstack-templates/upload-video
 *
 * FormData: file, locationId?, companyId?
 * Auth via ec_whop_user cookie; GHL linkage re-verified when
 * locationId or companyId is provided.
 *
 * Returns { url, availableBytes } on success.
 */
export async function POST(request: NextRequest) {
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

	const bytes = await file.arrayBuffer();
	const filename = file instanceof File ? file.name : `processed-clip-${Date.now()}.mp4`;
	const res = await uploadTemplateVideo({
		internalUserId: auth.internalUserId,
		contentType: file.type || "video/mp4",
		filename,
		bytes,
		locationId: locationId ?? undefined,
		companyId: companyId ?? undefined,
	});
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json({ url: res.url, availableBytes: res.availableBytes });
}
