import type { NextRequest } from "next/server";
import { loadStoragePreferences, updateStoragePreferences } from "@/lib/storage-preferences-service";
import { getInternalUserForExperience } from "@/lib/whop-experience-api-auth";

/**
 * GET /api/whop/storage-preferences?experienceId=...
 * PUT /api/whop/storage-preferences?experienceId=...  body: { preferred_storage?, preferred_ghl_location_id? }
 *
 * User-level storage-destination preferences for the Whop experience surface.
 * The returned `linked_ghl_locations` powers the GHL-location dropdown.
 */
export async function GET(request: NextRequest) {
	const experienceId = request.nextUrl.searchParams.get("experienceId");
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;
	return Response.json(await loadStoragePreferences(auth.internalUserId));
}

export async function PUT(request: NextRequest) {
	const experienceId = request.nextUrl.searchParams.get("experienceId");
	if (!experienceId) {
		return Response.json({ error: "experienceId query parameter is required" }, { status: 400 });
	}
	const auth = await getInternalUserForExperience(request, experienceId);
	if (!auth.ok) return auth.response;

	let body: { preferred_storage?: string; preferred_ghl_location_id?: string | null };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const res = await updateStoragePreferences(auth.internalUserId, body);
	if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
	return Response.json(res.prefs);
}
