import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/auth/success
 *
 * Simple success page after GHL OAuth completes for a direct sub-account install.
 */
export async function GET(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId") ?? "";

	const html = `<!DOCTYPE html>
<html><head><title>GHL Connected</title>
<style>body{font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px;text-align:center}
.ok{color:#16a34a;font-size:1.25rem}</style></head>
<body>
<h1 class="ok">GoHighLevel Connected</h1>
<p>Sub-account <code>${locationId}</code> has been connected successfully.</p>
<p>You can close this window and return to the app.</p>
</body></html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" },
	});
}
