import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

interface WhopTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
}

interface WhopUserInfo {
	sub: string;
	email?: string;
	name?: string;
	preferred_username?: string;
}

export async function POST(request: NextRequest) {
	const clientId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!clientId) {
		return Response.json(
			{ error: "OAuth not configured: missing NEXT_PUBLIC_WHOP_APP_ID" },
			{ status: 500 },
		);
	}
	if (!supabaseUrl || !supabaseServiceKey) {
		const missing = [
			!supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
			!supabaseServiceKey && "SUPABASE_SERVICE_ROLE_KEY",
		].filter(Boolean);
		return Response.json(
			{ error: `Supabase not configured: missing ${(missing as string[]).join(", ")}` },
			{ status: 500 },
		);
	}

	let body: { code: string; code_verifier: string; redirect_uri: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const { code, code_verifier, redirect_uri } = body;
	if (!code || !code_verifier || !redirect_uri) {
		return Response.json({ error: "Missing code, code_verifier, or redirect_uri" }, { status: 400 });
	}

	// PKCE only - Whop OAuth token exchange uses code_verifier, no client_secret needed.
	// (Sending client_secret can fail with "lacks oauth:token_exchange permission" if app is public.)
	const tokenRes = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri,
			client_id: clientId,
			code_verifier,
		}),
	});

	if (!tokenRes.ok) {
		const err = await tokenRes.json().catch(() => ({}));
		const desc = (err as { error_description?: string }).error_description || "Token exchange failed";
		// Add fix hint for common Whop OAuth config issue
		const hint = desc.includes("oauth:token_exchange")
			? " In Whop Dashboard: OAuth app → switch to Public client mode, or enable oauth:token_exchange permission."
			: "";
		return Response.json({ error: desc + hint }, { status: 400 });
	}

	const tokens = (await tokenRes.json()) as WhopTokenResponse;
	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${tokens.access_token}` },
	});
	if (!userinfoRes.ok) {
		return Response.json({ error: "Failed to fetch user info" }, { status: 500 });
	}
	const userinfo = (await userinfoRes.json()) as WhopUserInfo;

	const email = userinfo.email || `${userinfo.sub}@whop.placeholder`;
	const supabase = createClient(supabaseUrl, supabaseServiceKey);
	await supabase.from("users").upsert(
		{
			email,
			whop_user_id: userinfo.sub,
			name: userinfo.name ?? userinfo.preferred_username ?? null,
			updated_at: new Date().toISOString(),
		},
		{ onConflict: "email" },
	);

	return Response.json({
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		expires_in: tokens.expires_in,
		user: { id: userinfo.sub, email: userinfo.email },
	});
}
