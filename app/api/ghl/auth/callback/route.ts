import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import {
	exchangeCodeForToken,
	getLocationTokenFromAgency,
} from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/ghl/auth/callback
 *
 * GHL redirects here with ?code=...&state=... after the user authorizes.
 * We exchange the code for tokens and store them.
 *
 * If the token is Company-level (agency), we store the connection and redirect
 * to a location selection page. If Location-level, we store both connection
 * and location and redirect to success.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		return new Response(`GHL OAuth error: ${error}`, { status: 400 });
	}
	if (!code || !stateParam) {
		return new Response("Missing code or state", { status: 400 });
	}

	let stateData: { userId: string };
	try {
		stateData = JSON.parse(Buffer.from(stateParam, "base64url").toString());
	} catch {
		return new Response("Invalid state", { status: 400 });
	}

	const { userId } = stateData;
	if (!userId) {
		return new Response("Missing userId in state", { status: 400 });
	}

	// Try Location first (sub-account direct install), fall back to Company
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
	const now = new Date().toISOString();
	const expiresAt = new Date(
		Date.now() + tokenData.expires_in * 1000,
	).toISOString();

	// Upsert connection (one per user + companyId)
	const { data: connection, error: connErr } = await supabase
		.from("ghl_connections")
		.upsert(
			{
				user_id: userId,
				company_id: tokenData.companyId,
				user_type: userType,
				access_token: tokenData.access_token,
				refresh_token: tokenData.refresh_token,
				token_expires_at: expiresAt,
				scopes: tokenData.scope,
				ghl_user_id: tokenData.userId ?? null,
				updated_at: now,
			},
			{ onConflict: "user_id,company_id", ignoreDuplicates: false },
		)
		.select("id")
		.single();

	if (connErr || !connection) {
		// If upsert failed due to missing unique constraint, insert fresh
		const { data: inserted, error: insertErr } = await supabase
			.from("ghl_connections")
			.insert({
				user_id: userId,
				company_id: tokenData.companyId,
				user_type: userType,
				access_token: tokenData.access_token,
				refresh_token: tokenData.refresh_token,
				token_expires_at: expiresAt,
				scopes: tokenData.scope,
				ghl_user_id: tokenData.userId ?? null,
				updated_at: now,
			})
			.select("id")
			.single();

		if (insertErr || !inserted) {
			console.error("[ghl-callback] DB error:", connErr, insertErr);
			return new Response("Failed to store connection", { status: 500 });
		}

		return handlePostConnection(
			request,
			inserted.id,
			userId,
			tokenData,
			userType,
			supabase,
		);
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
		// Direct sub-account install: store location immediately
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
			{ onConflict: "connection_id,location_id" },
		);

		// Redirect to success
		const successUrl = new URL("/api/ghl/auth/success", origin);
		successUrl.searchParams.set("locationId", tokenData.locationId);
		return Response.redirect(successUrl.toString());
	}

	// Agency install: redirect to location selection
	const selectUrl = new URL("/api/ghl/auth/select-locations", origin);
	selectUrl.searchParams.set("connectionId", connectionId);
	return Response.redirect(selectUrl.toString());
}
