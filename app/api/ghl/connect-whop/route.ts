import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { signState, verifyGhlSso } from "@/lib/ghl-sso";

/**
 * GET /api/ghl/connect-whop
 *
 * Initiates Whop OAuth (with PKCE) from within the GHL Custom Page so users
 * can link their Whop account to the GHL company/location they're currently
 * viewing.
 *
 * Accepts GHL context via any of:
 *   - `sso=<encrypted-payload>` — preferred. The payload is AES-encrypted by
 *     GHL with our shared secret, so only a real GHL iframe can produce it.
 *   - `location_id=...` / `company_id=...` — URL params that GHL substitutes
 *     server-side at iframe load ({{location.id}}, {{company.id}}). This is
 *     the trust-equivalent of SSO in practice because:
 *       1. GHL substitutes these values based on the authenticated GHL user's
 *          current location context,
 *       2. the only thing an attacker could do with a crafted URL is link
 *          *their own* Whop account (they still have to complete Whop OAuth)
 *          to a GHL location — which doesn't give them access to that
 *          location's data unless they also have legitimate GHL access.
 *     SSO via postMessage is flaky (timing, iframe embedding) so we accept
 *     URL params as a first-class alternative.
 *
 * Whichever source provides the identifiers, we HMAC-sign them into the
 * OAuth `state` so the callback can trust them on the round-trip back.
 */
export async function GET(request: NextRequest) {
	const ssoPayload = request.nextUrl.searchParams.get("sso");
	const urlCompanyId =
		request.nextUrl.searchParams.get("company_id") ||
		request.nextUrl.searchParams.get("companyId");
	const urlLocationId =
		request.nextUrl.searchParams.get("location_id") ||
		request.nextUrl.searchParams.get("locationId");

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
	}

	if (!companyId && urlCompanyId) companyId = urlCompanyId;
	if (!locationId && urlLocationId) locationId = urlLocationId;

	if (!companyId && !locationId) {
		return errorPopup(
			"Missing GoHighLevel context. The Custom Page URL in GHL must include ?location_id={{location.id}}&company_id={{company.id}} (or provide a valid SSO payload).",
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
