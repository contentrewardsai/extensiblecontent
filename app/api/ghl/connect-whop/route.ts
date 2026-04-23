import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/connect-whop?locationId=...
 *
 * Initiates Whop OAuth from within the GHL Custom Page so users who
 * didn't go through External Auth at install can link their Whop account.
 */
export async function GET(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId");
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return Response.json({ error: "OAuth not configured" }, { status: 500 });
	}

	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/connect-whop/callback`;

	const state = Buffer.from(JSON.stringify({ locationId })).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state,
	});

	return Response.redirect(`https://api.whop.com/oauth/authorize?${params}`);
}
