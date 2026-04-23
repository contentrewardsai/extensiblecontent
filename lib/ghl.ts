/**
 * GoHighLevel API client: OAuth token exchange, refresh, location tokens, and
 * authenticated fetch wrapper with automatic token renewal.
 */

import { createClient } from "@supabase/supabase-js";

const GHL_API_BASE =
	process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
const GHL_CLIENT_ID = process.env.GHL_CLIENT_ID!;
const GHL_CLIENT_SECRET = process.env.GHL_CLIENT_SECRET!;
const GHL_REDIRECT_URI = process.env.GHL_REDIRECT_URI!;

const API_VERSION = "2021-07-28";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhlTokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
	userType: "Company" | "Location";
	companyId: string;
	locationId?: string;
	userId?: string;
	isBulkInstallation?: boolean;
}

// ---------------------------------------------------------------------------
// Token exchange helpers
// ---------------------------------------------------------------------------

export async function exchangeCodeForToken(
	code: string,
	userType: "Company" | "Location",
): Promise<GhlTokenResponse> {
	const res = await fetch(`${GHL_API_BASE}/oauth/token`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: GHL_CLIENT_ID,
			client_secret: GHL_CLIENT_SECRET,
			grant_type: "authorization_code",
			code,
			user_type: userType,
			redirect_uri: GHL_REDIRECT_URI,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`GHL token exchange failed: ${res.status} ${err}`);
	}

	return res.json() as Promise<GhlTokenResponse>;
}

export async function refreshAccessToken(
	refreshToken: string,
	userType: "Company" | "Location",
): Promise<GhlTokenResponse> {
	const res = await fetch(`${GHL_API_BASE}/oauth/token`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: GHL_CLIENT_ID,
			client_secret: GHL_CLIENT_SECRET,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			user_type: userType,
			redirect_uri: GHL_REDIRECT_URI,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`GHL token refresh failed: ${res.status} ${err}`);
	}

	return res.json() as Promise<GhlTokenResponse>;
}

export async function getLocationTokenFromAgency(
	agencyAccessToken: string,
	companyId: string,
	locationId: string,
): Promise<GhlTokenResponse> {
	const res = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			Version: API_VERSION,
			Authorization: `Bearer ${agencyAccessToken}`,
		},
		body: JSON.stringify({ companyId, locationId }),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`GHL location token failed: ${res.status} ${err}`);
	}

	return res.json() as Promise<GhlTokenResponse>;
}

// ---------------------------------------------------------------------------
// DB-backed token helpers
// ---------------------------------------------------------------------------

/**
 * Returns a valid access token for a ghl_locations row, refreshing if needed.
 * Updates the DB with the new token on refresh.
 */
export async function getValidLocationToken(
	ghlLocationDbId: string,
): Promise<string> {
	const supabase = getSupabase();

	const { data: loc, error } = await supabase
		.from("ghl_locations")
		.select(
			"id, access_token, refresh_token, token_expires_at, connection_id, is_active",
		)
		.eq("id", ghlLocationDbId)
		.single();

	if (error || !loc) throw new Error("GHL location not found");
	if (!loc.is_active) throw new Error("GHL location is inactive");

	const expiresAt = new Date(loc.token_expires_at).getTime();
	const buffer = 5 * 60 * 1000; // 5 min buffer
	if (Date.now() < expiresAt - buffer) {
		return loc.access_token;
	}

	const refreshed = await refreshAccessToken(loc.refresh_token, "Location");
	const newExpiresAt = new Date(
		Date.now() + refreshed.expires_in * 1000,
	).toISOString();

	await supabase
		.from("ghl_locations")
		.update({
			access_token: refreshed.access_token,
			refresh_token: refreshed.refresh_token,
			token_expires_at: newExpiresAt,
			updated_at: new Date().toISOString(),
		})
		.eq("id", ghlLocationDbId);

	return refreshed.access_token;
}

/**
 * Looks up the first active ghl_locations row for a user + GHL locationId,
 * then returns a valid token.
 */
export async function getValidTokenForLocation(
	userId: string,
	locationId: string,
): Promise<{ token: string; ghlLocationDbId: string }> {
	const supabase = getSupabase();

	const { data: loc, error } = await supabase
		.from("ghl_locations")
		.select("id")
		.eq("user_id", userId)
		.eq("location_id", locationId)
		.eq("is_active", true)
		.limit(1)
		.single();

	if (error || !loc)
		throw new Error("No active GHL location found for this user");

	const token = await getValidLocationToken(loc.id);
	return { token, ghlLocationDbId: loc.id };
}

// ---------------------------------------------------------------------------
// Authenticated fetch wrapper
// ---------------------------------------------------------------------------

export async function ghlFetch(
	userId: string,
	locationId: string,
	path: string,
	options?: RequestInit,
): Promise<Response> {
	const { token } = await getValidTokenForLocation(userId, locationId);

	const url = `${GHL_API_BASE}${path}`;
	const res = await fetch(url, {
		...options,
		headers: {
			Accept: "application/json",
			Version: API_VERSION,
			Authorization: `Bearer ${token}`,
			...options?.headers,
		},
	});

	return res;
}
