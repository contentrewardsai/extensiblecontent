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
 * Placeholder values inserted by `webhooks` and `connect-whop/callback` when a
 * `ghl_locations` row is created before the actual GHL OAuth install completes.
 * Sending these to /oauth/token returns a 401 ("Invalid refresh token") that
 * looks like a generic auth failure but actually means "this connection was
 * never finished".
 */
const PLACEHOLDER_TOKENS = new Set(["pending", "pending-link"]);

function isPlaceholderToken(t: string | null | undefined): boolean {
	return !t || PLACEHOLDER_TOKENS.has(t);
}

/**
 * Returns a valid access token for a ghl_locations row, refreshing if needed.
 *
 * HighLevel OAuth notes:
 *   - access_token  → 24h
 *   - refresh_token → up to 1 year, but **rotates on every refresh**.
 *     The old refresh_token is invalidated immediately (or after a short grace
 *     period). If we ever fail to persist the rotated value, the next call
 *     here sends a stale token and HighLevel returns 401, locking the user
 *     out until they reconnect.
 *
 * To make that lockout impossible we:
 *   1. Refuse to call /oauth/token with a placeholder refresh_token (never
 *      had a real token; user needs to install the GHL app first).
 *   2. Validate the refresh response actually contains both an access_token
 *      AND a refresh_token; if rotation didn't happen, keep the existing one.
 *   3. Throw if the DB write fails — better to surface the error to the caller
 *      than to silently return an access_token whose paired refresh_token was
 *      never persisted.
 */
export async function getValidLocationToken(
	ghlLocationDbId: string,
): Promise<string> {
	const supabase = getSupabase();

	const { data: loc, error } = await supabase
		.from("ghl_locations")
		.select(
			"id, location_id, access_token, refresh_token, token_expires_at, connection_id, is_active",
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

	if (isPlaceholderToken(loc.refresh_token)) {
		throw new Error(
			`GHL location ${loc.location_id ?? ghlLocationDbId} has placeholder tokens — the user needs to install / reconnect the GHL app to populate real OAuth credentials.`,
		);
	}

	console.log(
		`[ghl] refreshing token for location ${loc.location_id ?? ghlLocationDbId} (expired ${Math.round((Date.now() - expiresAt) / 1000)}s ago)`,
	);

	const refreshed = await refreshAccessToken(loc.refresh_token, "Location");

	if (!refreshed.access_token) {
		throw new Error("GHL refresh returned no access_token");
	}

	// HighLevel always rotates, but be defensive: if rotation somehow didn't
	// happen, keep the existing refresh_token rather than persisting `undefined`
	// and locking the user out on the next call.
	const nextRefreshToken = refreshed.refresh_token || loc.refresh_token;
	if (!refreshed.refresh_token) {
		console.warn(
			`[ghl] refresh response did not include a new refresh_token for location ${loc.location_id ?? ghlLocationDbId} — keeping existing one`,
		);
	}

	const newExpiresAt = new Date(
		Date.now() + refreshed.expires_in * 1000,
	).toISOString();

	const { error: updateErr } = await supabase
		.from("ghl_locations")
		.update({
			access_token: refreshed.access_token,
			refresh_token: nextRefreshToken,
			token_expires_at: newExpiresAt,
			updated_at: new Date().toISOString(),
		})
		.eq("id", ghlLocationDbId);

	if (updateErr) {
		// Do NOT return the access_token here — we just used (and therefore
		// invalidated) the previous refresh_token at HighLevel. If we don't
		// persist the new one, the next refresh call will fail with 401 and
		// the user will be locked out. Better to fail loudly now so the
		// caller can surface a "please reconnect" message.
		console.error(
			`[ghl] failed to persist rotated tokens for location ${loc.location_id ?? ghlLocationDbId}:`,
			updateErr,
		);
		throw new Error(
			`Failed to persist refreshed GHL tokens — please reconnect HighLevel: ${updateErr.message}`,
		);
	}

	console.log(
		`[ghl] rotated tokens for location ${loc.location_id ?? ghlLocationDbId} (next expiry ${newExpiresAt})`,
	);

	return refreshed.access_token;
}

/**
 * Looks up an active ghl_locations row for a user + GHL locationId, checking
 * access via the many-to-many ghl_connection_users join table, then returns a
 * valid token. Multiple Whop users can share access to the same GHL company.
 */
export async function getValidTokenForLocation(
	userId: string,
	locationId: string,
): Promise<{ token: string; ghlLocationDbId: string }> {
	const supabase = getSupabase();

	// Find the location record and verify the user has access via the
	// connection-level join table (many-to-many).
	const { data: loc, error } = await supabase
		.from("ghl_locations")
		.select("id, connection_id")
		.eq("location_id", locationId)
		.eq("is_active", true)
		.limit(1)
		.maybeSingle();

	if (error || !loc) throw new Error("GHL location not found");

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("connection_id", loc.connection_id)
		.eq("user_id", userId)
		.maybeSingle();

	if (!access) throw new Error("User does not have access to this GHL location");

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
