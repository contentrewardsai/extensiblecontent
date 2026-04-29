import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { signState } from "@/lib/ghl-sso";

/**
 * GET /api/ghl/external-auth/authorize  (public path: /api/ext-auth/authorize)
 *
 * Entry point for GoHighLevel's "External Authentication" / Custom Auth flow.
 * GHL redirects the user here when they need to identify themselves to our
 * app (e.g. opening a Custom Page for the first time).
 *
 * GHL's request looks like:
 *   GET /api/ext-auth/authorize
 *     ?client_id=<our marketplace client id>
 *     &redirect_uri=https://services.leadconnectorhq.com/oauth/clients/.../callback
 *     &response_type=code
 *     &scope=openid+profile+email
 *     &state=<gh-state>
 *
 * We don't ask the user for a Connection Key anymore. Instead we send them
 * straight through Whop OAuth (PKCE), capture their Whop identity in the
 * callback, and bounce them back to GHL with a freshly-minted code that GHL
 * can exchange at /api/ext-auth/token. The whole round-trip is invisible to
 * the user beyond the Whop login screen itself.
 *
 * The original GHL `redirect_uri` and `state` are HMAC-signed into the Whop
 * OAuth `state` so we can recover them in the callback without trusting the
 * URL bar.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const ghlRedirectUri = searchParams.get("redirect_uri");
	const ghlState = searchParams.get("state");

	if (!ghlRedirectUri || !ghlState) {
		return Response.json(
			{ error: "Missing redirect_uri or state" },
			{ status: 400 },
		);
	}

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return Response.json(
			{ error: "NEXT_PUBLIC_WHOP_APP_ID not configured" },
			{ status: 500 },
		);
	}
	if (!process.env.GHL_SHARED_SECRET) {
		return Response.json(
			{ error: "GHL_SHARED_SECRET not configured" },
			{ status: 500 },
		);
	}

	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const nonce = randomBytes(16).toString("base64url");

	// Public-facing URL (rewritten internally to this same handler's sibling).
	const callbackUrl = `${request.nextUrl.origin}/api/ext-auth/whop-callback`;

	const whopState = signState({
		ghlRedirectUri,
		ghlState,
		cv: codeVerifier,
		ts: Date.now(),
	});

	const params = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state: whopState,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});

	return Response.redirect(`https://api.whop.com/oauth/authorize?${params}`);
}
