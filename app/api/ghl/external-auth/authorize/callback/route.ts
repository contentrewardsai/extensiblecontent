import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createAuthCode } from "@/lib/ghl-external-auth";

/**
 * GET /api/ghl/external-auth/authorize/callback
 *
 * Whop redirects here after the user authenticates. We exchange the Whop code
 * for userinfo, ensure the user exists in our DB, generate an external-auth
 * code, and redirect back to GHL's callback.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const whopCode = searchParams.get("code");
	const ghlStateEncoded = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		return new Response(`OAuth error: ${error}`, { status: 400 });
	}
	if (!whopCode || !ghlStateEncoded) {
		return new Response("Missing code or state", { status: 400 });
	}

	let ghlParams: { redirect_uri: string; state: string };
	try {
		ghlParams = JSON.parse(
			Buffer.from(ghlStateEncoded, "base64url").toString(),
		);
	} catch {
		return new Response("Invalid state encoding", { status: 400 });
	}

	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/external-auth/authorize/callback`;

	// Exchange Whop code for access token (public client, no client_secret)
	const tokenRes = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: whopCode,
			redirect_uri: callbackUrl,
			client_id: process.env.NEXT_PUBLIC_WHOP_APP_ID!,
		}),
	});

	if (!tokenRes.ok) {
		const err = await tokenRes.text();
		console.error("[ghl-ext-auth] Whop token exchange failed:", err);
		return new Response("Whop authentication failed", { status: 502 });
	}

	const tokenData = (await tokenRes.json()) as {
		access_token: string;
	};

	// Get Whop user info
	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	});
	if (!userinfoRes.ok) {
		return new Response("Failed to get user info", { status: 502 });
	}

	const userinfo = (await userinfoRes.json()) as {
		sub?: string;
		email?: string;
		name?: string;
		preferred_username?: string;
	};
	if (!userinfo?.sub) {
		return new Response("Invalid user info", { status: 502 });
	}

	// Ensure user exists in our DB
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !supabaseKey) {
		return new Response("Server misconfigured", { status: 500 });
	}
	const supabase = createClient(supabaseUrl, supabaseKey);

	let userId: string;
	const { data: existing } = await supabase
		.from("users")
		.select("id")
		.eq("whop_user_id", userinfo.sub)
		.maybeSingle();

	if (existing) {
		userId = existing.id;
	} else {
		const email = userinfo.email || `${userinfo.sub}@whop.placeholder`;
		const { data: upserted } = await supabase
			.from("users")
			.upsert(
				{
					email,
					whop_user_id: userinfo.sub,
					name: userinfo.name ?? userinfo.preferred_username ?? null,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "email" },
			)
			.select("id")
			.single();
		if (!upserted) {
			return new Response("Failed to create user", { status: 500 });
		}
		userId = upserted.id;
	}

	// Generate an external-auth code and redirect back to GHL
	const code = await createAuthCode(userId, ghlParams.redirect_uri);

	const redirectUrl = new URL(ghlParams.redirect_uri);
	redirectUrl.searchParams.set("code", code);
	redirectUrl.searchParams.set("state", ghlParams.state);

	return Response.redirect(redirectUrl.toString());
}
