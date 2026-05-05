import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { resolveStorageTarget, type ResolveStorageInput } from "@/lib/storage-destination";
import { getValidTokenForLocation } from "@/lib/ghl";
import { handlePresignedUpload, type PresignedInput } from "@/lib/presigned-upload";

const GHL_API_BASE = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
const GHL_MEDIAS_API_VERSION = "2021-07-28";

/**
 * POST /api/ghl/shotstack/resolve-upload-target
 *
 * Resolves whether the client should upload directly to HighLevel or fall back
 * to Supabase. When GHL is the target, returns a short-lived OAuth token so
 * the browser can POST the blob straight to HighLevel's medias API — no large
 * payloads through Vercel.
 */
export async function POST(request: NextRequest) {
	let body: PresignedInput & { locationId?: string; companyId?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const locationId = body.locationId || null;
	const companyId = body.companyId || null;
	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;

	const { internalUserId } = auth;

	if (locationId) {
		const resolveInput: ResolveStorageInput = {
			internalUserId,
			projectId: typeof body.project_id === "string" ? body.project_id.trim() || undefined : undefined,
			activeGhlContext: { locationId, companyId },
		};

		try {
			const target = await resolveStorageTarget(resolveInput);
			if (target.type === "ghl") {
				const { token } = await getValidTokenForLocation(internalUserId, target.locationId);
				const uploadUrl = new URL(`${GHL_API_BASE}/medias/upload-file`);
				uploadUrl.searchParams.set("altId", target.locationId);
				uploadUrl.searchParams.set("altType", "location");

				return Response.json({
					target: "ghl",
					upload_url: uploadUrl.toString(),
					token,
					location_id: target.locationId,
					company_id: target.companyId,
					api_version: GHL_MEDIAS_API_VERSION,
				});
			}
		} catch (err) {
			console.error("[resolve-upload-target] GHL resolution failed, falling back to Supabase:", err);
		}
	}

	// Fall back to Supabase presigned upload
	const presignResponse = await handlePresignedUpload(body, auth);
	const presignJson = await presignResponse.json();

	return Response.json({
		target: "supabase",
		...presignJson,
	});
}
