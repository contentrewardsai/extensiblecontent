import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/connected-users?companyId=...&userId=...
 * GET /api/ghl/connected-users?locationId=...&userId=...
 *
 * Returns all Whop users connected to a given GHL company or location.
 * The caller must pass their own userId so we can verify they also have
 * access before revealing the list.
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
	if (!requesterId) {
		return Response.json({ error: "userId is required" }, { status: 400 });
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

	// Verify the requester has access to this connection.
	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("connection_id", connectionId)
		.eq("user_id", requesterId)
		.maybeSingle();

	if (!access) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	// Fetch all users linked to this connection.
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
