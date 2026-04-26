import type { NextRequest } from "next/server";
import {
	serializeWhopUserCookie,
	signWhopUserCookie,
} from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * POST /api/ghl/set-active-user
 * Body: { userId: string, locationId?: string, companyId?: string }
 *
 * Called by the GHL Custom Page when the viewer picks one of the linked
 * Whop accounts from the picker. Updates the `ec_whop_user` cookie so
 * subsequent requests and reloads know who the active viewer is.
 *
 * Authorization: the `userId` must have a row in `ghl_connection_users`
 * for the given location/company. This keeps the cookie from being set
 * to an arbitrary Whop user — the caller must pick someone already
 * linked to this GHL subaccount.
 */
export async function POST(request: NextRequest) {
	const body = (await request.json().catch(() => null)) as {
		userId?: string;
		locationId?: string;
		companyId?: string;
	} | null;
	if (!body?.userId) {
		return Response.json({ error: "userId required" }, { status: 400 });
	}

	const { userId, locationId, companyId } = body;
	if (!companyId && !locationId) {
		return Response.json(
			{ error: "locationId or companyId required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	// Verify the user is linked to any connection matching this GHL context.
	const connectionIds = new Set<string>();
	if (companyId) {
		const { data } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", companyId);
		for (const c of data ?? []) connectionIds.add(c.id);
	}
	if (locationId) {
		const { data } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId);
		for (const l of data ?? []) {
			if (l.connection_id) connectionIds.add(l.connection_id);
		}
		const { data: bySynthetic } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", `loc:${locationId}`);
		for (const c of bySynthetic ?? []) connectionIds.add(c.id);
	}

	if (connectionIds.size > 0) {
		const { data: access } = await supabase
			.from("ghl_connection_users")
			.select("id")
			.in("connection_id", Array.from(connectionIds))
			.eq("user_id", userId)
			.limit(1);
		if (!access || access.length === 0) {
			return Response.json({ error: "Not linked" }, { status: 403 });
		}
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": serializeWhopUserCookie(signWhopUserCookie(userId)),
		},
	});
}
