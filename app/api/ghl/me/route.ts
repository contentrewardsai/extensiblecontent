import type { NextRequest } from "next/server";
import {
	WHOP_USER_COOKIE,
	clearWhopUserCookieHeader,
	readWhopUserCookie,
} from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/me
 *
 * Returns the currently-active Whop user (if any) based on the signed
 * `ec_whop_user` HTTP-only cookie set by the Whop OAuth callback.
 *
 * This replaces the old client-side `sessionStorage` approach — the backend
 * is the source of truth for "who is logged in in this browser", so the
 * identity survives reloads, tab switches, and iframe re-embeds.
 */
export async function GET(request: NextRequest) {
	const raw = request.cookies.get(WHOP_USER_COOKIE)?.value;
	const userId = readWhopUserCookie(raw);
	if (!userId) {
		return Response.json({ user: null });
	}

	const supabase = getServiceSupabase();
	const { data: user } = await supabase
		.from("users")
		.select("id, name, email")
		.eq("id", userId)
		.maybeSingle();

	if (!user) {
		// Cookie points at a deleted user; clear it.
		return new Response(JSON.stringify({ user: null }), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Set-Cookie": clearWhopUserCookieHeader(),
			},
		});
	}

	return Response.json({
		user: {
			userId: user.id,
			name: user.name,
			email: user.email,
		},
	});
}

/**
 * DELETE /api/ghl/me
 *
 * Clears the active-user cookie. Used when the user clicks "Switch account"
 * on the GHL Custom Page.
 */
export async function DELETE() {
	return new Response(JSON.stringify({ cleared: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": clearWhopUserCookieHeader(),
		},
	});
}
