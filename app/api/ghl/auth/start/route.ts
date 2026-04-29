import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

/**
 * GET /api/ghl/auth/start
 *
 * Initiates the GHL OAuth flow. The user is redirected to GHL's location
 * chooser so they can authorize Extensible Content for one or more
 * sub-accounts.
 *
 * This is a fallback path — the primary "Connect GoHighLevel" button on the
 * Whop side first tries our own location picker (backed by an existing
 * Company-level token) and only opens this OAuth flow when no Company
 * connection exists yet. Once the app goes Live in the HL Marketplace, this
 * page will work for all users. While it's still in Draft, only whitelisted
 * locations can complete the flow.
 */
export async function GET(request: NextRequest) {
	let userId: string | null = null;

	const extUser = await getExtensionUser(request);
	if (extUser) {
		userId = extUser.user_id;
	}

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

	const appVersionId = process.env.GHL_APP_VERSION_ID;
	if (!appVersionId) {
		console.warn(
			"[ghl-auth-start] GHL_APP_VERSION_ID is not set; HighLevel may reject the install.",
		);
	}

	const state = Buffer.from(JSON.stringify({ userId })).toString("base64url");

	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope:
			"medias.readonly medias.write socialplanner/post.readonly socialplanner/post.write socialplanner/account.readonly oauth.readonly oauth.write locations.readonly",
		state,
		...(appVersionId ? { appVersionId } : {}),
	});

	return Response.redirect(
		`https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params}`,
	);
}
