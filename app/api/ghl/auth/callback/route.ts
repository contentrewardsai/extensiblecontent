import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { exchangeCodeForToken } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/ghl/auth/callback
 *
 * GHL redirects here with ?code=... after the user authorizes.
 * Two scenarios:
 *   1. User-initiated (from "Connect GHL" button): state param contains userId
 *   2. GHL app installation: no state param, we exchange tokens and store them
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		return new Response(`GHL OAuth error: ${error}`, { status: 400 });
	}
	if (!code) {
		return new Response("Missing authorization code", { status: 400 });
	}

	// Try to extract userId from state (user-initiated flow)
	let userId: string | null = null;
	if (stateParam) {
		try {
			const stateData = JSON.parse(
				Buffer.from(stateParam, "base64url").toString(),
			);
			userId = stateData.userId ?? null;
		} catch {
			// State is present but not our format -- ignore it
		}
	}

	// Exchange code for tokens
	let tokenData;
	let userType: "Company" | "Location" = "Location";
	try {
		tokenData = await exchangeCodeForToken(code, "Location");
	} catch {
		try {
			userType = "Company";
			tokenData = await exchangeCodeForToken(code, "Company");
		} catch (err) {
			console.error("[ghl-callback] Token exchange failed:", err);
			return new Response("Token exchange failed", { status: 502 });
		}
	}

	userType = tokenData.userType;
	const supabase = getSupabase();
	const origin = request.nextUrl.origin;

	const now = new Date().toISOString();
	const expiresAt = new Date(
		Date.now() + tokenData.expires_in * 1000,
	).toISOString();

	// Upsert connection (one per company_id). userId may be null for
	// GHL-initiated installs — it gets set later via Connection Key linking.
	const { data: connection, error: connErr } = await supabase
		.from("ghl_connections")
		.upsert(
			{
				...(userId ? { user_id: userId } : {}),
				company_id: tokenData.companyId,
				user_type: userType,
				access_token: tokenData.access_token,
				refresh_token: tokenData.refresh_token,
				token_expires_at: expiresAt,
				scopes: tokenData.scope,
				ghl_user_id: tokenData.userId ?? null,
				updated_at: now,
			},
			{ onConflict: "company_id", ignoreDuplicates: false },
		)
		.select("id")
		.single();

	if (connErr || !connection) {
		console.error("[ghl-callback] DB error:", connErr);
		return new Response("Failed to store connection", { status: 500 });
	}

	// Grant this user access to the connection (many-to-many).
	if (userId) {
		await supabase.from("ghl_connection_users").upsert(
			{
				connection_id: connection.id,
				user_id: userId,
			},
			{ onConflict: "connection_id,user_id" },
		);
	}

	if (!userId) {
		console.log(
			"[ghl-callback] Stored tokens for companyId:",
			tokenData.companyId,
			"— no userId in state; user will be linked on Custom Page load.",
		);

		if (userType === "Location" && tokenData.locationId) {
			const expiresAt = new Date(
				Date.now() + tokenData.expires_in * 1000,
			).toISOString();
			await supabase.from("ghl_locations").upsert(
				{
					connection_id: connection.id,
					location_id: tokenData.locationId,
					access_token: tokenData.access_token,
					refresh_token: tokenData.refresh_token,
					token_expires_at: expiresAt,
					is_active: true,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "location_id" },
			);
		}

		const successUrl = new URL("/api/ghl/auth/success", origin);
		successUrl.searchParams.set("pending", "true");
		successUrl.searchParams.set("companyId", tokenData.companyId);
		return Response.redirect(successUrl.toString());
	}

	return handlePostConnection(
		request,
		connection.id,
		userId,
		tokenData,
		userType,
		supabase,
	);
}

async function handlePostConnection(
	request: NextRequest,
	connectionId: string,
	userId: string,
	tokenData: {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		companyId: string;
		locationId?: string;
		scope: string;
	},
	userType: "Company" | "Location",
	supabase: ReturnType<typeof getSupabase>,
) {
	const origin = request.nextUrl.origin;

	if (userType === "Location" && tokenData.locationId) {
		const expiresAt = new Date(
			Date.now() + tokenData.expires_in * 1000,
		).toISOString();

		await supabase.from("ghl_locations").upsert(
			{
				connection_id: connectionId,
				user_id: userId,
				location_id: tokenData.locationId,
				access_token: tokenData.access_token,
				refresh_token: tokenData.refresh_token,
				token_expires_at: expiresAt,
				is_active: true,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "location_id" },
		);

		const successUrl = new URL("/api/ghl/auth/success", origin);
		successUrl.searchParams.set("locationId", tokenData.locationId);
		return Response.redirect(successUrl.toString());
	}

	// Agency install: redirect to location selection
	const selectUrl = new URL("/api/ghl/auth/select-locations", origin);
	selectUrl.searchParams.set("connectionId", connectionId);
	return Response.redirect(selectUrl.toString());
}
