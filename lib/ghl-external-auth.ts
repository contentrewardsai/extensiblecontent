/**
 * External Authentication OAuth provider helpers.
 * Our app acts as an OAuth provider so GHL can verify users are Whop members.
 * Uses HMAC-signed JWTs (no external dependency needed; Web Crypto API).
 */

import { createClient } from "@supabase/supabase-js";

const EXT_AUTH_CLIENT_ID = process.env.GHL_EXT_AUTH_CLIENT_ID!;
const EXT_AUTH_CLIENT_SECRET = process.env.GHL_EXT_AUTH_CLIENT_SECRET!;
const JWT_SECRET = process.env.GHL_SHARED_SECRET!;

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Client credential validation
// ---------------------------------------------------------------------------

export function validateClientCredentials(
	clientId: string,
	clientSecret: string,
): boolean {
	return clientId === EXT_AUTH_CLIENT_ID && clientSecret === EXT_AUTH_CLIENT_SECRET;
}

// ---------------------------------------------------------------------------
// Auth code management (DB-backed, short-lived)
// ---------------------------------------------------------------------------

export async function createAuthCode(
	userId: string,
	redirectUri: string,
): Promise<string> {
	const code = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
	const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

	const supabase = getSupabase();
	const { error } = await supabase.from("ghl_external_auth_codes").insert({
		code,
		user_id: userId,
		redirect_uri: redirectUri,
		expires_at: expiresAt,
	});
	if (error) throw new Error(`Failed to store auth code: ${error.message}`);

	return code;
}

export async function consumeAuthCode(
	code: string,
	_redirectUri?: string,
): Promise<string | null> {
	const supabase = getSupabase();

	const { data, error } = await supabase
		.from("ghl_external_auth_codes")
		.select("user_id, expires_at, used")
		.eq("code", code)
		.single();

	if (error || !data) return null;
	if (data.used) return null;
	if (new Date(data.expires_at) < new Date()) return null;

	await supabase
		.from("ghl_external_auth_codes")
		.update({ used: true })
		.eq("code", code);

	return data.user_id;
}

// ---------------------------------------------------------------------------
// Refresh token management (DB-backed)
// ---------------------------------------------------------------------------

export async function createRefreshToken(userId: string): Promise<string> {
	const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
	const expiresAt = new Date(
		Date.now() + 365 * 24 * 60 * 60 * 1000,
	).toISOString(); // 1 year

	const supabase = getSupabase();
	const { error } = await supabase
		.from("ghl_external_auth_refresh_tokens")
		.insert({ token, user_id: userId, expires_at: expiresAt });
	if (error)
		throw new Error(`Failed to store refresh token: ${error.message}`);

	return token;
}

export async function consumeRefreshToken(
	token: string,
): Promise<string | null> {
	const supabase = getSupabase();

	const { data, error } = await supabase
		.from("ghl_external_auth_refresh_tokens")
		.select("user_id, expires_at, used")
		.eq("token", token)
		.single();

	if (error || !data) return null;
	if (data.used) return null;
	if (new Date(data.expires_at) < new Date()) return null;

	await supabase
		.from("ghl_external_auth_refresh_tokens")
		.update({ used: true })
		.eq("token", token);

	return data.user_id;
}

// ---------------------------------------------------------------------------
// JWT helpers (HMAC-SHA256 via Web Crypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(data: Uint8Array): string {
	let binary = "";
	for (const byte of data) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str: string): string {
	return base64UrlEncode(new TextEncoder().encode(str));
}

async function hmacSign(payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(JWT_SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return base64UrlEncode(new Uint8Array(sig));
}

export async function createJwt(
	userId: string,
	expiresInSeconds: number,
): Promise<string> {
	const header = base64UrlEncodeString(
		JSON.stringify({ alg: "HS256", typ: "JWT" }),
	);
	const now = Math.floor(Date.now() / 1000);
	const payload = base64UrlEncodeString(
		JSON.stringify({ sub: userId, iat: now, exp: now + expiresInSeconds }),
	);
	const signature = await hmacSign(`${header}.${payload}`);
	return `${header}.${payload}.${signature}`;
}

export async function verifyJwt(
	token: string,
): Promise<{ sub: string } | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [header, payload, signature] = parts;
	const expected = await hmacSign(`${header}.${payload}`);
	if (signature !== expected) return null;

	try {
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
		if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
		return { sub: decoded.sub };
	} catch {
		return null;
	}
}

/**
 * Extract and verify a Bearer JWT from request headers.
 * Returns the userId (sub claim) or null.
 */
export async function getUserIdFromBearer(
	authHeader: string | null,
): Promise<string | null> {
	if (!authHeader?.startsWith("Bearer ")) return null;
	const token = authHeader.slice(7);
	const payload = await verifyJwt(token);
	return payload?.sub ?? null;
}
