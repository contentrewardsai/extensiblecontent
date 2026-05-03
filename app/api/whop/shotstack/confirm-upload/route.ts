import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import { handleConfirmUpload, type ConfirmInput } from "@/lib/presigned-upload";

/**
 * POST /api/whop/shotstack/confirm-upload
 *
 * Whop mirror of the GHL confirm upload route.
 */
export async function POST(request: NextRequest) {
	let body: ConfirmInput & { experienceId?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const experienceId = body.experienceId || "";
	if (!experienceId) {
		return Response.json({ error: "experienceId is required" }, { status: 400 });
	}

	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;

	// Pass experience context for the render row
	body.experienceId = experienceId;
	return handleConfirmUpload(body, auth);
}
