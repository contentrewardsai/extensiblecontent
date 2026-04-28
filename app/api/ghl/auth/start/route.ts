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

	// HighLevel rolled out an app-versioning system. As of late 2025 their
	// `/oauth/chooselocation` endpoint rejects installs that don't specify a
	// concrete `appVersionId`, returning the cryptic `error.noAppVersionIdFound`
	// banner along with a "log out and back in" prompt that misleadingly looks
	// like a session issue. The version id is found in the HighLevel
	// Marketplace dashboard → your app → Versions tab → the Live version row;
	// it's a 24-char hex string (Mongo ObjectID) like `665c6bb13d4e5364bdec0e2f`.
	// Falls back to constructing the URL the old way if not configured so we
	// don't break local dev / private-app flows that still accept it.
	const appVersionId = process.env.GHL_APP_VERSION_ID;
	if (!appVersionId) {
		console.warn(
			"[ghl-auth-start] GHL_APP_VERSION_ID is not set; HighLevel may reject the install with `error.noAppVersionIdFound`. Set it from Marketplace → your app → Versions → Live version id.",
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
		// `loginWindowOpenMode=self` makes the OAuth screen reuse the current
		// window for the HighLevel login redirect rather than opening a new
		// window, which was the source of the "log out and log in again"
		// confusion: the popup loaded in an unauthenticated state.
		loginWindowOpenMode: "self",
		...(appVersionId ? { appVersionId } : {}),
	});

	return Response.redirect(
		`https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`,
	);
}
