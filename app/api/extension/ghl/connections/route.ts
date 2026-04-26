import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/extension/ghl/connections
 *
 * Lists the user's GHL connections and their locations.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();

	// Get connection IDs this user has access to (many-to-many join table).
	const { data: access, error: accessErr } = await supabase
		.from("ghl_connection_users")
		.select("connection_id")
		.eq("user_id", user.user_id);

	if (accessErr) {
		return Response.json({ error: accessErr.message }, { status: 500 });
	}

	const connIds = (access ?? []).map((a) => a.connection_id);

	let connections: Array<{
		id: string;
		company_id: string;
		user_type: string;
		scopes: string | null;
		created_at: string;
		updated_at: string;
	}> = [];

	if (connIds.length > 0) {
		const { data: conns, error: connErr } = await supabase
			.from("ghl_connections")
			.select("id, company_id, user_type, scopes, created_at, updated_at")
			.in("id", connIds)
			.order("created_at", { ascending: false });

		if (connErr) {
			return Response.json({ error: connErr.message }, { status: 500 });
		}
		connections = conns ?? [];
	}

	let locations: Array<{
		id: string;
		connection_id: string;
		location_id: string;
		location_name: string | null;
		is_active: boolean;
		created_at: string;
	}> = [];

	if (connIds.length > 0) {
		const { data: locs } = await supabase
			.from("ghl_locations")
			.select(
				"id, connection_id, location_id, location_name, is_active, created_at",
			)
			.in("connection_id", connIds)
			.neq("access_token", "pending")
			.neq("access_token", "pending-link")
			.order("created_at", { ascending: false });

		locations = locs ?? [];
	}

	return Response.json({
		connections,
		locations,
	});
}

/**
 * DELETE /api/extension/ghl/connections?id=...
 *
 * Revokes THIS user's access to the GHL connection. If no other users remain
 * linked to it, the underlying connection (and its locations, via FK cascade)
 * is also deleted.
 */
export async function DELETE(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const connectionId = request.nextUrl.searchParams.get("id");
	if (!connectionId) {
		return Response.json({ error: "id is required" }, { status: 400 });
	}

	const supabase = getSupabase();

	// Verify the user has access to this connection.
	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("connection_id", connectionId)
		.eq("user_id", user.user_id)
		.maybeSingle();

	if (!access) {
		return Response.json({ error: "Connection not found" }, { status: 404 });
	}

	// Remove just this user's access.
	await supabase.from("ghl_connection_users").delete().eq("id", access.id);

	// If no other users remain, delete the connection itself.
	const { count } = await supabase
		.from("ghl_connection_users")
		.select("*", { count: "exact", head: true })
		.eq("connection_id", connectionId);

	if ((count ?? 0) === 0) {
		await supabase.from("ghl_connections").delete().eq("id", connectionId);
	}

	return Response.json({ ok: true });
}
