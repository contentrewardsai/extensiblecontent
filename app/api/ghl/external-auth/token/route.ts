import type { NextRequest } from "next/server";
import {
	validateClientCredentials,
	consumeAuthCode,
	createJwt,
	createRefreshToken,
} from "@/lib/ghl-external-auth";

/**
 * POST /api/ghl/external-auth/token
 *
 * GHL calls this to exchange an auth code for an access token.
 * Body (form-encoded or JSON): grant_type, code, client_id, client_secret, redirect_uri
 */
export async function POST(request: NextRequest) {
	let params: Record<string, string>;

	const contentType = request.headers.get("content-type") || "";
	if (contentType.includes("application/x-www-form-urlencoded")) {
		const text = await request.text();
		params = Object.fromEntries(new URLSearchParams(text));
	} else {
		params = (await request.json()) as Record<string, string>;
	}

	const {
		grant_type,
		code,
		client_id,
		client_secret,
		redirect_uri,
	} = params;

	if (!client_id || !client_secret || !validateClientCredentials(client_id, client_secret)) {
		return Response.json({ error: "invalid_client" }, { status: 401 });
	}

	if (grant_type !== "authorization_code" || !code || !redirect_uri) {
		return Response.json(
			{ error: "invalid_request", error_description: "Missing required parameters" },
			{ status: 400 },
		);
	}

	const userId = await consumeAuthCode(code, redirect_uri);
	if (!userId) {
		return Response.json(
			{ error: "invalid_grant", error_description: "Invalid or expired code" },
			{ status: 400 },
		);
	}

	const accessToken = await createJwt(userId, 86400); // 24 hours
	const refreshToken = await createRefreshToken(userId);

	return Response.json({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 86400,
		refresh_token: refreshToken,
	});
}
