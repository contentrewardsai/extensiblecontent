import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/connect-whop?companyId=...&locationId=...
 *
 * Initiates Whop OAuth (with PKCE) from within the GHL Custom Page so
 * users can link their Whop account to their GHL company.
 */
export async function GET(request: NextRequest) {
	const companyId = request.nextUrl.searchParams.get("companyId");
	const locationId = request.nextUrl.searchParams.get("locationId");

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return Response.json({ error: "OAuth not configured" }, { status: 500 });
	}

	// PKCE: generate code_verifier and code_challenge
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");

	const callbackUrl = `https://extensiblecontent.com/api/ghl/connect-whop/callback`;

	const state = Buffer.from(
		JSON.stringify({
			...(companyId ? { companyId } : {}),
			...(locationId ? { locationId } : {}),
			cv: codeVerifier,
		}),
	).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});

	return Response.redirect(`https://api.whop.com/oauth/authorize?${params}`);
}
