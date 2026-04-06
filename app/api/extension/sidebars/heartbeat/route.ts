import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { sidebarWithConnected } from "@/lib/extension-sidebar";
import type { Sidebar, SidebarHeartbeatBody } from "@/lib/types/sidebars";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function POST(request: NextRequest) {
	try {
		const user = await getExtensionUser(request);
		if (!user) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		let body: SidebarHeartbeatBody;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON" }, { status: 400 });
		}

		const { sidebar_id, window_id } = body;
		if (!sidebar_id && !window_id) {
			return Response.json({ error: "sidebar_id or window_id is required" }, { status: 400 });
		}
		if (sidebar_id && typeof sidebar_id !== "string") {
			return Response.json({ error: "sidebar_id must be a string" }, { status: 400 });
		}
		if (window_id && typeof window_id !== "string") {
			return Response.json({ error: "window_id must be a string" }, { status: 400 });
		}

		const supabase = getSupabase();
		const now = new Date().toISOString();

		let query = supabase.from("sidebars").select("id").eq("user_id", user.user_id);
		if (sidebar_id) {
			query = query.eq("id", sidebar_id.trim());
		} else {
			query = query.eq("window_id", window_id!.trim());
		}

		const { data: row, error: findError } = await query.maybeSingle();
		if (findError) {
			console.error("[sidebars/heartbeat] Lookup error:", findError);
			return Response.json({ error: "Failed to refresh sidebar" }, { status: 500 });
		}
		if (!row) {
			return Response.json({ error: "Sidebar not found" }, { status: 404 });
		}

		const { data: sidebar, error: updateError } = await supabase
			.from("sidebars")
			.update({ last_seen: now, updated_at: now })
			.eq("id", row.id)
			.select()
			.single();

		if (updateError || !sidebar) {
			console.error("[sidebars/heartbeat] Update error:", updateError);
			return Response.json({ error: "Failed to refresh sidebar" }, { status: 500 });
		}

		// No list_updated broadcast: heartbeats are frequent; clients poll GET /sidebars or use Realtime on real changes.

		return Response.json({ sidebar: sidebarWithConnected(sidebar as Sidebar) });
	} catch (err) {
		console.error("[sidebars/heartbeat] Unexpected error:", err);
		return Response.json({ error: "Failed to refresh sidebar" }, { status: 500 });
	}
}
