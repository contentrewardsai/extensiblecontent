import type { NextRequest } from "next/server";
import { createAuthCode } from "@/lib/ghl-external-auth";
import {
	serializeWhopUserCookie,
	signWhopUserCookie,
	verifyState,
} from "@/lib/ghl-sso";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";

type WhopCallbackState = {
	ghlRedirectUri: string;
	ghlState: string;
	cv?: string;
	ts?: number;
};

const MAX_STATE_AGE_MS = 30 * 60 * 1000;

/**
 * GET /api/ghl/external-auth/whop-callback  (public path: /api/ext-auth/whop-callback)
 *
 * Whop redirects here after the user authorises our app inside the
 * GoHighLevel Custom Auth flow. We:
 *   1. Verify the HMAC-signed state we set in /authorize.
 *   2. Exchange the Whop code for an access_token (PKCE).
 *   3. Look up / upsert the matching `users` row.
 *   4. Mint a short-lived auth code that GHL will exchange at /api/ext-auth/token.
 *   5. Set the `ec_whop_user` cookie so subsequent Custom Page iframe loads
 *      identify the user without needing to talk to GHL again.
 *   6. 302 the user back to GHL's `redirect_uri` with `?code=…&state=…`.
 *
 * The whole chain — /authorize → Whop → here → GHL callback — happens in
 * the same browser context, so the cookie set on this response is in scope
 * when the GHL Custom Page iframe loads.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const errorParam = searchParams.get("error");

	if (errorParam) {
		return errorResponse(`Whop returned: ${errorParam}`);
	}
	if (!code || !stateParam) {
		return errorResponse("Missing code or state from Whop");
	}

	const state = verifyState<WhopCallbackState>(stateParam);
	if (!state) {
		return errorResponse("Invalid or unsigned state");
	}
	if (state.ts && Date.now() - state.ts > MAX_STATE_AGE_MS) {
		return errorResponse("Authorisation timed out — please try again");
	}
	if (!state.ghlRedirectUri || !state.ghlState) {
		return errorResponse("State missing GHL redirect details");
	}

	const callbackUrl = `${request.nextUrl.origin}/api/ext-auth/whop-callback`;

	const tokenBody: Record<string, string> = {
		grant_type: "authorization_code",
		code,
		redirect_uri: callbackUrl,
		client_id: process.env.NEXT_PUBLIC_WHOP_APP_ID!,
	};
	if (state.cv) tokenBody.code_verifier = state.cv;

	const tokenRes = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(tokenBody),
	});

	if (!tokenRes.ok) {
		console.error(
			"[ext-auth/whop-callback] Whop token exchange failed:",
			await tokenRes.text(),
		);
		return errorResponse("Whop authorisation failed");
	}

	const tokenData = (await tokenRes.json()) as { access_token: string };

	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	});
	if (!userinfoRes.ok) {
		return errorResponse("Could not fetch Whop user info");
	}

	const userinfo = (await userinfoRes.json()) as {
		sub?: string;
		email?: string;
		name?: string;
		preferred_username?: string;
	};
	if (!userinfo?.sub) {
		return errorResponse("Whop user info missing sub");
	}

	const userId = await ensureInternalUserFromWhop(userinfo.sub, {
		email: userinfo.email,
		name: userinfo.name,
		username: userinfo.preferred_username,
	});

	const ghlCode = await createAuthCode(userId, state.ghlRedirectUri);

	const redirect = new URL(state.ghlRedirectUri);
	redirect.searchParams.set("code", ghlCode);
	redirect.searchParams.set("state", state.ghlState);

	const headers = new Headers({
		Location: redirect.toString(),
	});
	headers.append(
		"Set-Cookie",
		serializeWhopUserCookie(signWhopUserCookie(userId)),
	);

	return new Response(null, { status: 302, headers });
}

function errorResponse(message: string): Response {
	const html = `<!DOCTYPE html>
<html><head><title>Authorisation failed</title></head>
<body style="font-family:system-ui;padding:24px;max-width:480px;margin:0 auto">
<h1 style="font-size:18px">Couldn't sign you in</h1>
<p>${message}</p>
<p style="color:#666;font-size:13px">Close this window and try again from your GoHighLevel Custom Page.</p>
</body></html>`;
	return new Response(html, {
		status: 400,
		headers: { "Content-Type": "text/html" },
	});
}
