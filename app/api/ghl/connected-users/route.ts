import type { NextRequest } from "next/server";
import { verifyGhlSso } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/connected-users?companyId=...&userId=...
 * GET /api/ghl/connected-users?locationId=...&userId=...
 *
 * Returns all Whop users connected to a given GHL company or location.
 * The caller must authenticate one of two ways:
 *   1. `userId` query parameter of a Whop user who has a row in
 *      `ghl_connection_users` for this connection.
 *   2. `X-Ghl-Sso-Payload` header containing a valid encrypted GHL SSO
 *      payload for the caller (this proves they're viewing the iframe as an
 *      authenticated GHL user of the requested location — which is sufficient
 *      to list the Whop accounts they can switch to). This lets fresh
 *      browsers (no Whop session yet) still see available accounts.
 */
export async function GET(request: NextRequest) {
	const companyId = request.nextUrl.searchParams.get("companyId");
	const locationId = request.nextUrl.searchParams.get("locationId");
	const requesterId = request.nextUrl.searchParams.get("userId");

	if (!companyId && !locationId) {
		return Response.json(
			{ error: "companyId or locationId is required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	let connectionId: string | null = null;

	if (companyId) {
		const { data: conn } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", companyId)
			.maybeSingle();
		connectionId = conn?.id ?? null;
	} else if (locationId) {
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId)
			.maybeSingle();
		connectionId = loc?.connection_id ?? null;
	}

	if (!connectionId) {
		return Response.json({ users: [] });
	}

	// Authentication: require either userId with a valid access row, or a
	// valid signed SSO payload that references the requested company/location.
	let authorized = false;

	if (requesterId) {
		const { data: access } = await supabase
			.from("ghl_connection_users")
			.select("id")
			.eq("connection_id", connectionId)
			.eq("user_id", requesterId)
			.maybeSingle();
		if (access) authorized = true;
	}

	if (!authorized) {
		const ssoHeader = request.headers.get("x-ghl-sso-payload");
		const sso = verifyGhlSso(ssoHeader);
		if (sso) {
			if (companyId && sso.companyId === companyId) authorized = true;
			else if (
				locationId &&
				(sso.activeLocation === locationId ||
					(sso as { locationId?: string }).locationId === locationId)
			) {
				authorized = true;
			}
		}
	}

	if (!authorized) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	const { data: rows } = await supabase
		.from("ghl_connection_users")
		.select("user_id, created_at")
		.eq("connection_id", connectionId)
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
			isSelf: r.user_id === requesterId,
		};
	});

	return Response.json({ users: result });
}
