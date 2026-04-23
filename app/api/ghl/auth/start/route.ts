import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

/**
 * GET /api/ghl/auth/start
 *
 * Initiates the GHL OAuth flow. The user is redirected to GHL's location chooser.
 * Requires Whop Bearer auth so we know which internal user is connecting.
 * Accepts ?userId= as fallback when called from a browser page that already has the userId.
 */
export async function GET(request: NextRequest) {
	let userId: string | null = null;

	// Try Whop bearer token first (extension flow)
	const extUser = await getExtensionUser(request);
	if (extUser) {
		userId = extUser.user_id;
	}

	// Fallback: userId query param (from Whop experience page)
	if (!userId) {
		userId = request.nextUrl.searchParams.get("userId");
	}

	if (!userId) {
		return Response.json(
			{ error: "Unauthorized. Provide Bearer token or userId param." },
			{ status: 401 },
		);
	}

	const clientId = process.env.GHL_CLIENT_ID;
	const redirectUri = process.env.GHL_REDIRECT_URI;
	if (!clientId || !redirectUri) {
		return Response.json(
			{ error: "GHL OAuth not configured" },
			{ status: 500 },
		);
	}

	const state = Buffer.from(JSON.stringify({ userId })).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope:
			"medias.readonly medias.write socialplanner/post.readonly socialplanner/post.write socialplanner/account.readonly oauth.readonly oauth.write",
		state,
	});

	return Response.redirect(
		`https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`,
	);
}
