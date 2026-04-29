import type { NextRequest } from "next/server";
import { createAuthCode } from "@/lib/ghl-external-auth";
import {
	WHOP_USER_COOKIE,
	readWhopUserCookie,
} from "@/lib/ghl-sso";

/**
 * GET /api/ghl/external-auth/authorize  (public path: /api/ext-auth/authorize)
 *
 * Entry point for GoHighLevel's "External Authentication" / Custom Auth flow.
 * GHL redirects the user here when they click "Connect to Extensible Content"
 * on the External Connection tab.
 *
 * GHL's request looks like:
 *   GET /api/ext-auth/authorize
 *     ?redirect_uri=https://services.leadconnectorhq.com/oauth/clients/.../callback
 *     &state=<ghl-state>
 *     &response_type=code
 *
 * This endpoint connects GHL to Extensible Content (NOT to Whop). We check
 * the `ec_whop_user` cookie that was set when the user signed in on the
 * Custom Page. If the cookie is present and valid, we mint an auth code and
 * redirect back to GHL immediately. If not, we show a page telling the user
 * to sign in via the Custom Page first.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const ghlRedirectUri = searchParams.get("redirect_uri");
	const ghlState = searchParams.get("state");

	if (!ghlRedirectUri || !ghlState) {
		return errorResponse("Missing redirect_uri or state from HighLevel.");
	}

	const raw = request.cookies.get(WHOP_USER_COOKIE)?.value;
	const userId = readWhopUserCookie(raw);

	if (!userId) {
		return notSignedInPage(request.nextUrl.toString());
	}

	const code = await createAuthCode(userId, ghlRedirectUri);

	const redirect = new URL(ghlRedirectUri);
	redirect.searchParams.set("code", code);
	redirect.searchParams.set("state", ghlState);

	return Response.redirect(redirect.toString());
}

function notSignedInPage(retryUrl: string): Response {
	const html = `<!DOCTYPE html>
<html>
<head>
<title>Connect to Extensible Content</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
h1 { font-size: 20px; margin-bottom: 8px; }
.card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin: 24px 0; }
.steps { margin: 16px 0; padding-left: 20px; }
.steps li { margin: 8px 0; line-height: 1.6; }
.muted { color: #6b7280; font-size: 14px; }
.btn { display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; margin-top: 12px; }
.btn:hover { background: #1d4ed8; }
</style>
</head>
<body>
<h1>Sign in required</h1>
<div class="card">
<p>To connect this HighLevel account to Extensible Content, you need to sign in first.</p>
<ol class="steps">
<li>Open the <strong>Extensible Content</strong> settings page from your HighLevel sidebar.</li>
<li>Click <strong>Link Whop Account</strong> and sign in.</li>
<li>Come back here and click the button below.</li>
</ol>
<a class="btn" href="${escapeHtml(retryUrl)}">Try again</a>
</div>
<p class="muted">This window was opened by HighLevel's External Connection flow. Once you've signed in on the settings page, retrying will connect automatically.</p>
</body>
</html>`;

	return new Response(html, {
		status: 200,
		headers: { "Content-Type": "text/html" },
	});
}

function errorResponse(message: string): Response {
	const html = `<!DOCTYPE html>
<html><head><title>Connection failed</title></head>
<body style="font-family:system-ui;padding:24px;max-width:480px;margin:0 auto">
<h1 style="font-size:18px">Couldn't connect</h1>
<p>${escapeHtml(message)}</p>
</body></html>`;
	return new Response(html, {
		status: 400,
		headers: { "Content-Type": "text/html" },
	});
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
