import type { NextRequest } from "next/server";
import { getLocationTokenFromAgency } from "@/lib/ghl";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * POST /api/ghl/locations/activate
 *
 * Body: { userId, locationId, connectionId }
 *
 * Mints a location-scoped token from the Company-level token and stores it.
 * Called from the Whop-side location picker when the user clicks "Activate"
 * on a sub-account.
 */
export async function POST(request: NextRequest) {
	let body: { userId?: string; locationId?: string; connectionId?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { userId, locationId, connectionId } = body;
	if (!userId || !locationId || !connectionId) {
		return Response.json(
			{ error: "userId, locationId, and connectionId are required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("connection_id", connectionId)
		.eq("user_id", userId)
		.maybeSingle();

	if (!access) {
		return Response.json(
			{ error: "No access to this connection" },
			{ status: 403 },
		);
	}

	const { data: conn } = await supabase
		.from("ghl_connections")
		.select("id, company_id, access_token")
		.eq("id", connectionId)
		.single();

	if (!conn) {
		return Response.json(
			{ error: "Connection not found" },
			{ status: 404 },
		);
	}

	try {
		const locToken = await getLocationTokenFromAgency(
			conn.access_token,
			conn.company_id,
			locationId,
		);

		const expiresAt = new Date(
			Date.now() + locToken.expires_in * 1000,
		).toISOString();

		await supabase.from("ghl_locations").upsert(
			{
				connection_id: conn.id,
				user_id: userId,
				location_id: locationId,
				location_name:
					locToken.locationId === locationId ? undefined : undefined,
				access_token: locToken.access_token,
				refresh_token: locToken.refresh_token,
				token_expires_at: expiresAt,
				is_active: true,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "location_id" },
		);

		return Response.json({ activated: true, locationId });
	} catch (err) {
		console.error(
			"[ghl-locations-activate] failed for",
			locationId,
			err,
		);
		return Response.json(
			{
				error: "Failed to activate location",
				detail: err instanceof Error ? err.message : "Unknown error",
			},
			{ status: 502 },
		);
	}
}
