import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { handlePresignedUpload, type PresignedInput } from "@/lib/presigned-upload";

/**
 * POST /api/ghl/shotstack/presigned-upload
 *
 * Returns a Supabase signed upload URL so the browser can PUT the file
 * directly to storage — no large blobs through Vercel.
 */
export async function POST(request: NextRequest) {
	let body: PresignedInput;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const locationId = body.locationId || null;
	const companyId = body.companyId || null;
	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;

	return handlePresignedUpload(body, auth);
}
