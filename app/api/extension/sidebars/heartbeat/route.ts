import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { sidebarWithConnected } from "@/lib/extension-sidebar";
import {
	batchHeartbeatSidebars,
	fetchSidebarsByIds,
	normalizeBackendIdsForHeartbeat,
	sidebarsWithConnectedInOrder,
} from "@/lib/sidebar-heartbeat";
import { parseExclusiveSidebarLookup } from "@/lib/sidebar-lookup-parse";
import type { Sidebar, SidebarHeartbeatBody } from "@/lib/types/sidebars";
import { getExtensionServiceSupabase } from "@/lib/supabase-extension-service";

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

		const { sidebar_id, window_id, backend_ids } = body;

		const supabase = getExtensionServiceSupabase();

		if (backend_ids !== undefined && backend_ids !== null) {
			const sidNoise = typeof sidebar_id === "string" && sidebar_id.trim().length > 0;
			const widNoise = typeof window_id === "string" && window_id.trim().length > 0;
			if (sidNoise || widNoise) {
				return Response.json(
					{ error: "backend_ids cannot be combined with sidebar_id or window_id" },
					{ status: 400 },
				);
			}
			const normalized = normalizeBackendIdsForHeartbeat(backend_ids);
			if ("error" in normalized) {
				return Response.json({ error: normalized.error }, { status: 400 });
			}
			const batch = await batchHeartbeatSidebars(supabase, user.user_id, normalized);
			if ("error" in batch) {
				return Response.json({ error: batch.error }, { status: batch.status });
			}
			const rows = await fetchSidebarsByIds(supabase, user.user_id, batch.ids);
			const sidebars = sidebarsWithConnectedInOrder(batch.ids, rows);
			const requested = normalized.length;
			const skipped = requested - batch.updated;
			return Response.json({ updated: batch.updated, requested, skipped, sidebars });
		}

		const parsed = parseExclusiveSidebarLookup(body);
		if (!parsed.ok) {
			return Response.json({ error: parsed.error }, { status: parsed.status });
		}

		const now = new Date().toISOString();

		let query = supabase.from("sidebars").select("id").eq("user_id", user.user_id);
		if ("sidebar_id" in parsed) {
			query = query.eq("id", parsed.sidebar_id);
		} else {
			query = query.eq("window_id", parsed.window_id);
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
