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

	const { data: connections, error: connErr } = await supabase
		.from("ghl_connections")
		.select("id, company_id, user_type, scopes, created_at, updated_at")
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (connErr) {
		return Response.json({ error: connErr.message }, { status: 500 });
	}

	const connIds = (connections ?? []).map((c) => c.id);

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
		connections: connections ?? [],
		locations,
	});
}

/**
 * DELETE /api/extension/ghl/connections?id=...
 *
 * Deletes a GHL connection and all its locations (cascaded by FK).
 */
export async function DELETE(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const connectionId = request.nextUrl.searchParams.get("id");
	if (!connectionId) {
		return Response.json({ error: "id is required" }, { status: 400 });
	}

	const supabase = getSupabase();

	// Verify ownership before deleting
	const { data: conn } = await supabase
		.from("ghl_connections")
		.select("id")
		.eq("id", connectionId)
		.eq("user_id", user.user_id)
		.single();

	if (!conn) {
		return Response.json({ error: "Connection not found" }, { status: 404 });
	}

	const { error } = await supabase
		.from("ghl_connections")
		.delete()
		.eq("id", connectionId);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json({ ok: true });
}
