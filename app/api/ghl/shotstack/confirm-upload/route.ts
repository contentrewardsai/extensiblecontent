import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { handleConfirmUpload, type ConfirmInput } from "@/lib/presigned-upload";

/**
 * POST /api/ghl/shotstack/confirm-upload
 *
 * Called after the browser has PUT the file directly to Supabase.
 * Registers the render in the DB and optionally imports into the
 * GHL Media Library by URL (no large blobs through Vercel).
 */
export async function POST(request: NextRequest) {
	let body: ConfirmInput;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const locationId = body.locationId || null;
	const companyId = body.companyId || null;
	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;

	return handleConfirmUpload(body, auth);
}
