import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { NextRequest } from "next/server";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/**
 * POST /api/ghl/external-auth/validate
 *
 * GHL calls this during app installation (API Key/Basic Auth mode).
 * Receives the connection key the user pasted, validates it,
 * and links the GHL location(s) to the Whop user.
 *
 * Body from GHL: { connectionKey, companyId, approveAllLocations, locationId, excludedLocations }
 */
export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const connectionKey = String(body.connectionKey || "").trim();
	if (!connectionKey) {
		return Response.json(
			{ error: "Connection key is required" },
			{ status: 400 },
		);
	}

	const supabase = getSupabase();
	const hash = hashKey(connectionKey);

	const { data: keyRow, error: keyErr } = await supabase
		.from("ghl_connection_keys")
		.select("id, user_id, is_active")
		.eq("key_hash", hash)
		.eq("is_active", true)
		.maybeSingle();

	if (keyErr || !keyRow) {
		return Response.json(
			{ error: "Invalid or expired connection key" },
			{ status: 401 },
		);
	}

	// Mark key as used
	await supabase
		.from("ghl_connection_keys")
		.update({ used_at: new Date().toISOString() })
		.eq("id", keyRow.id);

	// Store GHL install context if companyId is provided
	const companyId = String(body.companyId || "");
	if (companyId) {
		await supabase.from("ghl_connections").upsert(
			{
				user_id: keyRow.user_id,
				company_id: companyId,
				user_type: "Company",
				access_token: "external-auth",
				refresh_token: "external-auth",
				token_expires_at: new Date(
					Date.now() + 365 * 24 * 60 * 60 * 1000,
				).toISOString(),
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "user_id,company_id" },
		);

		// Handle location IDs if provided
		const locationIds = body.locationId as string[] | null;
		if (Array.isArray(locationIds) && locationIds.length > 0) {
			const { data: conn } = await supabase
				.from("ghl_connections")
				.select("id")
				.eq("user_id", keyRow.user_id)
				.eq("company_id", companyId)
				.single();

			if (conn) {
				for (const locId of locationIds) {
					await supabase.from("ghl_locations").upsert(
						{
							connection_id: conn.id,
							user_id: keyRow.user_id,
							location_id: locId,
							access_token: "external-auth",
							refresh_token: "external-auth",
							token_expires_at: new Date(
								Date.now() + 365 * 24 * 60 * 60 * 1000,
							).toISOString(),
							is_active: true,
							updated_at: new Date().toISOString(),
						},
						{ onConflict: "connection_id,location_id" },
					);
				}
			}
		}
	}

	return Response.json({
		ok: true,
		userId: keyRow.user_id,
		message: "Connection verified successfully",
	});
}
