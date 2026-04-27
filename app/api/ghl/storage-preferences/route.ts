import type { NextRequest } from "next/server";
import { getInternalUserForGhl } from "@/lib/ghl-shotstack-auth";
import { loadStoragePreferences, updateStoragePreferences } from "@/lib/storage-preferences-service";

/**
 * GET /api/ghl/storage-preferences?locationId=...&companyId=...
 * PUT /api/ghl/storage-preferences?locationId=...&companyId=...  body: { preferred_storage?, preferred_ghl_location_id? }
 *
 * User-level storage-destination preferences for the GHL Custom Page surface.
 * Auth uses the `ec_whop_user` cookie plus optional GHL-context cross-check.
 */
export async function GET(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId");
	const companyId = request.nextUrl.searchParams.get("companyId");
	const auth = await getInternalUserForGhl(request, { locationId, companyId });
	if (!auth.ok) return auth.response;
	return Response.json(await loadStoragePreferences(auth.internalUserId));
}

export async function PUT(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId");
	const companyId = request.nextUrl.searchParams.get("companyId");
	const auth = await getInternalUserForGhl(request, { locationId, companyId });
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
