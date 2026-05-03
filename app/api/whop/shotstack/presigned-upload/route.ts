import type { NextRequest } from "next/server";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";
import { handlePresignedUpload, type PresignedInput } from "@/lib/presigned-upload";

/**
 * POST /api/whop/shotstack/presigned-upload
 *
 * Whop mirror of the GHL presigned upload route.
 */
export async function POST(request: NextRequest) {
	let body: PresignedInput & { experienceId?: string };
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

	return handlePresignedUpload(body, auth);
}
