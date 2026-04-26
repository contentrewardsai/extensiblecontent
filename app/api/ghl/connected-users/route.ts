import type { NextRequest } from "next/server";
import { WHOP_USER_COOKIE, readWhopUserCookie } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/connected-users?companyId=...  (or ?locationId=...)
 *
 * Returns every Whop user linked to a given GHL company or location.
 *
 * This endpoint is intentionally **unauthenticated** — a GHL subaccount is a
 * shared team workspace, and anyone on the team who can see the Custom Page
 * should be able to see their teammates' linked Whop accounts. Requiring a
 * per-user cookie/SSO would break common flows:
 *   • Team member opens the Custom Page in a fresh browser (no cookie yet)
 *   • User clicks "Switch account" (cookie cleared) and needs to pick
 *     another linked teammate to switch to
 *   • SSO postMessage handshake fails (common — GHL's iframe is flaky)
 *
 * The only data exposed is the list of Whop user names/emails that have
 * linked to this GHL subaccount — equivalent to the team roster GHL itself
 * already shows for that subaccount.
 *
 * The `userId` query param (or the `ec_whop_user` cookie) is used ONLY to
 * mark which of the returned users is the current viewer (the `isSelf`
 * flag), not for authorization.
 */
export async function GET(request: NextRequest) {
	const companyId = request.nextUrl.searchParams.get("companyId");
	const locationId = request.nextUrl.searchParams.get("locationId");
	const viewerId =
		request.nextUrl.searchParams.get("userId") ||
		readWhopUserCookie(request.cookies.get(WHOP_USER_COOKIE)?.value);

	if (!companyId && !locationId) {
		return Response.json(
			{ error: "companyId or locationId is required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	// Collect ALL connection_ids that match the given GHL context. Usually
	// there's just one, but historical data (from before the callback was
	// hardened) may have split teammates across multiple rows — this query
	// unions them so the picker shows every linked teammate for the location.
	const connectionIds = new Set<string>();

	if (companyId) {
		const { data: byCompany } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", companyId);
		for (const c of byCompany ?? []) connectionIds.add(c.id);
	}

	if (locationId) {
		const { data: byLocation } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId);
		for (const l of byLocation ?? []) {
			if (l.connection_id) connectionIds.add(l.connection_id);
		}

		// Also catch the synthetic-id connections we may have created for
		// location-only OAuth flows.
		const { data: byLocSynthetic } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", `loc:${locationId}`);
		for (const c of byLocSynthetic ?? []) connectionIds.add(c.id);
	}

	if (connectionIds.size === 0) {
		return Response.json({ users: [] });
	}

	const { data: rows } = await supabase
		.from("ghl_connection_users")
		.select("user_id, created_at")
		.in("connection_id", Array.from(connectionIds))
		.order("created_at", { ascending: true });

	const userIds = (rows ?? []).map((r) => r.user_id);
	if (userIds.length === 0) {
		return Response.json({ users: [] });
	}

	const { data: users } = await supabase
		.from("users")
		.select("id, name, email")
		.in("id", userIds);

	const byId = new Map((users ?? []).map((u) => [u.id, u]));

	const result = (rows ?? []).map((r) => {
		const u = byId.get(r.user_id);
		return {
			userId: r.user_id,
			name: u?.name ?? null,
			email: u?.email ?? null,
			linkedAt: r.created_at,
			isSelf: r.user_id === viewerId,
		};
	});

	return Response.json({ users: result });
}
