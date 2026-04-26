import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { signState, verifyGhlSso } from "@/lib/ghl-sso";

/**
 * GET /api/ghl/connect-whop?sso=<encrypted-payload>
 *
 * Initiates Whop OAuth (with PKCE) from within the GHL Custom Page so users
 * can link their Whop account to the GHL company/location they're currently
 * viewing.
 *
 * SECURITY: The GHL company/location identifiers MUST come from a valid
 * encrypted SSO payload provided by the GHL iframe, not from the URL. That
 * payload is encrypted by GHL with our shared secret, so only a real GHL
 * iframe for the intended location can produce it. We decrypt it here and
 * HMAC-sign the resulting identifiers into the OAuth `state` so the callback
 * can trust them after the Whop OAuth round-trip.
 *
 * Legacy / test mode: if NO sso param is provided AND we're running outside
 * of production, we fall back to accepting companyId/locationId from the URL
 * (marked as untrusted in state). This only affects local dev.
 */
export async function GET(request: NextRequest) {
	const ssoPayload = request.nextUrl.searchParams.get("sso");

	const whopAppId = process.env.NEXT_PUBLIC_WHOP_APP_ID;
	if (!whopAppId) {
		return errorPopup("OAuth not configured on the server.");
	}
	if (!process.env.GHL_SHARED_SECRET) {
		return errorPopup(
			"GHL_SHARED_SECRET is not configured on the server. Set it in Vercel env vars and redeploy.",
		);
	}

	let companyId: string | null = null;
	let locationId: string | null = null;

	if (ssoPayload) {
		const sso = verifyGhlSso(ssoPayload);
		if (!sso) {
			return errorPopup(
				"Invalid or expired GoHighLevel session. Close this window, reload the Custom Page in GHL, and try again.",
			);
		}
		companyId = sso.companyId ?? null;
		locationId =
			sso.activeLocation ??
			(sso as { locationId?: string }).locationId ??
			null;
	} else if (process.env.NODE_ENV !== "production") {
		companyId = request.nextUrl.searchParams.get("companyId");
		locationId = request.nextUrl.searchParams.get("locationId");
	} else {
		return errorPopup(
			"Missing GoHighLevel session. Close this window, reload the Custom Page, and try again.",
		);
	}

	if (!companyId && !locationId) {
		return errorPopup(
			"Your GoHighLevel session didn't include a company or location. Reload the Custom Page in GHL and try again.",
		);
	}

	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const nonce = randomBytes(16).toString("base64url");

	const callbackUrl = `https://extensiblecontent.com/api/ghl/connect-whop/callback`;

	const state = signState({
		...(companyId ? { companyId } : {}),
		...(locationId ? { locationId } : {}),
		cv: codeVerifier,
		ts: Date.now(),
	});

	const params = new URLSearchParams({
		response_type: "code",
		client_id: whopAppId,
		redirect_uri: callbackUrl,
		scope: "openid profile email",
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});

	return Response.redirect(`https://api.whop.com/oauth/authorize?${params}`);
}

/**
 * Returns an HTML page that posts the error back to the parent window so the
 * GHL Custom Page can surface it, instead of showing raw JSON in the popup.
 */
function errorPopup(message: string): Response {
	const html = `<!DOCTYPE html>
<html><head><title>Linking failed</title></head>
<body style="font-family:system-ui;padding:20px">
<p>${message}</p>
<script>
if (window.opener) {
  window.opener.postMessage(${JSON.stringify({ type: "whop-link-result", error: message })}, "*");
  setTimeout(() => window.close(), 3000);
}
</script>
</body></html>`;
	return new Response(html, {
		status: 400,
		headers: { "Content-Type": "text/html" },
	});
}
