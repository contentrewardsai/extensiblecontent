import type { NextRequest } from "next/server";
import {
	validateClientCredentials,
	consumeRefreshToken,
	createJwt,
	createRefreshToken,
} from "@/lib/ghl-external-auth";

/**
 * POST /api/ghl/external-auth/refresh
 *
 * GHL calls this to refresh an expired access token.
 * Body: grant_type=refresh_token, refresh_token, client_id, client_secret
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

	const { grant_type, refresh_token, client_id, client_secret } = params;

	if (!client_id || !client_secret || !validateClientCredentials(client_id, client_secret)) {
		return Response.json({ error: "invalid_client" }, { status: 401 });
	}

	if (grant_type !== "refresh_token" || !refresh_token) {
		return Response.json(
			{ error: "invalid_request", error_description: "Missing required parameters" },
			{ status: 400 },
		);
	}

	const userId = await consumeRefreshToken(refresh_token);
	if (!userId) {
		return Response.json(
			{ error: "invalid_grant", error_description: "Invalid or expired refresh token" },
			{ status: 400 },
		);
	}

	const accessToken = await createJwt(userId, 86400);
	const newRefreshToken = await createRefreshToken(userId);

	return Response.json({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: 86400,
		refresh_token: newRefreshToken,
	});
}
