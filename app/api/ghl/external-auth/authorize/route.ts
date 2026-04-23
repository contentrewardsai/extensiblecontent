import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/external-auth/authorize
 *
 * GHL redirects users here during External Authentication.
 * We redirect to Whop OAuth, then after login the callback page at
 * /ghl/external-auth/callback completes the flow and redirects back to GHL.
 *
 * Query params from GHL: client_id, redirect_uri, state, response_type=code
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const redirectUri = searchParams.get("redirect_uri");
	const state = searchParams.get("state");

	if (!redirectUri || !state) {
		return Response.json(
			{ error: "Missing redirect_uri or state" },
			{ status: 400 },
		);
	}

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return Response.json(
			{ error: "OAuth not configured" },
			{ status: 500 },
		);
	}

	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/external-auth/authorize/callback`;

	// Encode GHL params so we can recover them after Whop OAuth completes
	const ghlState = Buffer.from(
		JSON.stringify({ redirect_uri: redirectUri, state }),
	).toString("base64url");

	const whopParams = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state: ghlState,
	});

	return Response.redirect(
		`https://api.whop.com/oauth/authorize?${whopParams}`,
	);
}
