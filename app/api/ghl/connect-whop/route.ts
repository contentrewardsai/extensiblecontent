import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/connect-whop?companyId=...&locationId=...
 *
 * Initiates Whop OAuth from within the GHL Custom Page so users can
 * link their Whop account to their GHL company. Opens in a popup.
 */
export async function GET(request: NextRequest) {
	const companyId = request.nextUrl.searchParams.get("companyId");
	const locationId = request.nextUrl.searchParams.get("locationId");

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return Response.json({ error: "OAuth not configured" }, { status: 500 });
	}

	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/connect-whop/callback`;

	const state = Buffer.from(
		JSON.stringify({
			...(companyId ? { companyId } : {}),
			...(locationId ? { locationId } : {}),
		}),
	).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state,
	});

	return Response.redirect(`https://api.whop.com/oauth/authorize?${params}`);
}
