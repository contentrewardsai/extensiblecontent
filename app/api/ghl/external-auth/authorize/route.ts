import type { NextRequest } from "next/server";

/**
 * GET /api/ghl/external-auth/authorize
 *
 * GHL redirects users here during External Authentication.
 * We redirect to our own login page where the user enters their Connection Key.
 *
 * Query params from GHL: client_id, redirect_uri, state, response_type=code
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const redirectUri = searchParams.get("redirect_uri");
	const state = searchParams.get("state");

	if (!redirectUri || !state) {
		return Response.json(
			{ error: "Missing redirect_uri or state" },
			{ status: 400 },
		);
	}

	const origin = request.nextUrl.origin;

	const loginParams = new URLSearchParams({
		redirect_uri: redirectUri,
		state,
	});

	return Response.redirect(`${origin}/ext/login?${loginParams}`);
}
