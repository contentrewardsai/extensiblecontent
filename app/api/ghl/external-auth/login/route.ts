import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { createAuthCode } from "@/lib/ghl-external-auth";

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
 * POST /api/ghl/external-auth/login
 *
 * Validates a Connection Key and issues an OAuth auth code.
 * The login page calls this after the user pastes their key.
 *
 * Body: { connectionKey, redirectUri, state }
 * Returns: { redirectUrl } on success
 */
export async function POST(request: NextRequest) {
	let body: Record<string, string>;
	try {
		body = (await request.json()) as Record<string, string>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { connectionKey, redirectUri, state } = body;

	if (!connectionKey?.trim()) {
		return Response.json(
			{ error: "Connection key is required" },
			{ status: 400 },
		);
	}

	if (!redirectUri || !state) {
		return Response.json(
			{ error: "Missing OAuth parameters" },
			{ status: 400 },
		);
	}

	const supabase = getSupabase();
	const hash = hashKey(connectionKey.trim());

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

	// Mark key as used (but keep it active for future re-auth)
	await supabase
		.from("ghl_connection_keys")
		.update({ used_at: new Date().toISOString() })
		.eq("id", keyRow.id);

	// Create an auth code for GHL to exchange
	const code = await createAuthCode(keyRow.user_id, redirectUri);

	const redirectUrl = new URL(redirectUri);
	redirectUrl.searchParams.set("code", code);
	redirectUrl.searchParams.set("state", state);

	return Response.json({ redirectUrl: redirectUrl.toString() });
}
