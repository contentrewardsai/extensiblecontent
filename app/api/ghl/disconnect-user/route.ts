import type { NextRequest } from "next/server";
import {
	WHOP_USER_COOKIE,
	clearWhopUserCookieHeader,
	readWhopUserCookie,
} from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * POST /api/ghl/disconnect-user
 * Body: { userId: string, locationId?: string, companyId?: string }
 *
 * Removes a Whop user from the ghl_connection_users join table for the
 * given GHL subaccount. Mirrors the team-visibility model: any teammate
 * who is already linked to this location may remove another teammate's
 * access (or their own). Callers outside the team cannot disconnect
 * anyone.
 *
 * If the caller is disconnecting themselves (the current viewer), we also
 * clear the `ec_whop_user` cookie so the UI falls back to the picker.
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
	const { userId: targetUserId, locationId, companyId } = body;

	if (!companyId && !locationId) {
		return Response.json(
			{ error: "locationId or companyId required" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	// Collect every connection_id matching this GHL context — same union
	// logic as /api/ghl/connected-users so we catch historical splits.
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

	if (connectionIds.size === 0) {
		return Response.json({ error: "Unknown GHL context" }, { status: 404 });
	}
	const connectionIdList = Array.from(connectionIds);

	// Authorization: the caller must themselves be linked to one of these
	// connections. Identity comes from the signed `ec_whop_user` cookie (set
	// by the OAuth callback and set-active-user).
	const viewerId = readWhopUserCookie(
		request.cookies.get(WHOP_USER_COOKIE)?.value,
	);
	if (!viewerId) {
		return Response.json(
			{ error: "Not authenticated" },
			{ status: 401 },
		);
	}

	const { data: viewerAccess } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.in("connection_id", connectionIdList)
		.eq("user_id", viewerId)
		.limit(1);
	if (!viewerAccess || viewerAccess.length === 0) {
		return Response.json(
			{ error: "Not a member of this GHL location" },
			{ status: 403 },
		);
	}

	// Remove the target user from all matching connections.
	const { error: deleteErr } = await supabase
		.from("ghl_connection_users")
		.delete()
		.in("connection_id", connectionIdList)
		.eq("user_id", targetUserId);

	if (deleteErr) {
		console.error("[ghl-disconnect-user] Failed to delete:", deleteErr);
		return Response.json(
			{ error: "Failed to disconnect" },
			{ status: 500 },
		);
	}

	console.log(
		`[ghl-disconnect-user] Removed userId=${targetUserId} from connections=${connectionIdList.join(",")} (viewer=${viewerId})`,
	);

	const isSelf = targetUserId === viewerId;
	const headers: HeadersInit = { "Content-Type": "application/json" };
	if (isSelf) {
		(headers as Record<string, string>)["Set-Cookie"] =
			clearWhopUserCookieHeader();
	}

	return new Response(JSON.stringify({ ok: true, isSelf }), {
		status: 200,
		headers,
	});
}
