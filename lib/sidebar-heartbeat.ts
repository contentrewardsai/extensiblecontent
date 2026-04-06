import type { SupabaseClient } from "@supabase/supabase-js";
import { sidebarWithConnected } from "@/lib/extension-sidebar";
import type { Sidebar } from "@/lib/types/sidebars";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max backend_ids per batch heartbeat (MCP relay). */
export const SIDEBAR_HEARTBEAT_BATCH_MAX = 64;

export function normalizeBackendIdsForHeartbeat(raw: unknown): string[] | { error: string } {
	if (!Array.isArray(raw)) {
		return { error: "backend_ids must be an array of UUID strings" };
	}
	if (raw.length === 0) {
		return { error: "backend_ids must not be empty" };
	}
	if (raw.length > SIDEBAR_HEARTBEAT_BATCH_MAX) {
		return { error: `backend_ids must have at most ${SIDEBAR_HEARTBEAT_BATCH_MAX} entries` };
	}
	const seen = new Set<string>();
	for (const item of raw) {
		if (typeof item !== "string") {
			return { error: "each backend_ids entry must be a string UUID" };
		}
		const t = item.trim();
		if (!UUID_REGEX.test(t)) {
			return { error: "each backend_ids entry must be a valid UUID" };
		}
		seen.add(t);
	}
	return [...seen];
}

export async function batchHeartbeatSidebars(
	supabase: SupabaseClient,
	userId: string,
	ids: string[],
): Promise<{ updated: number; ids: string[] } | { error: string; status: number }> {
	if (ids.length === 0) {
		return { updated: 0, ids: [] };
	}

	const now = new Date().toISOString();

	const { data: owned, error: selectError } = await supabase
		.from("sidebars")
		.select("id")
		.eq("user_id", userId)
		.in("id", ids);

	if (selectError) {
		console.error("[sidebars/heartbeat] Batch select error:", selectError);
		return { error: "Failed to refresh sidebars", status: 500 };
	}

	const ownedSet = new Set((owned ?? []).map((r) => r.id as string));
	const ownedIds = ids.filter((id) => ownedSet.has(id));
	if (ownedIds.length === 0) {
		return { error: "No matching sidebars found", status: 404 };
	}

	const { error: updateError } = await supabase
		.from("sidebars")
		.update({ last_seen: now, updated_at: now })
		.eq("user_id", userId)
		.in("id", ownedIds);

	if (updateError) {
		console.error("[sidebars/heartbeat] Batch update error:", updateError);
		return { error: "Failed to refresh sidebars", status: 500 };
	}

	return { updated: ownedIds.length, ids: ownedIds };
}

export async function fetchSidebarsByIds(
	supabase: SupabaseClient,
	userId: string,
	ids: string[],
): Promise<Sidebar[]> {
	if (ids.length === 0) return [];
	const { data, error } = await supabase
		.from("sidebars")
		.select("*")
		.eq("user_id", userId)
		.in("id", ids);
	if (error || !data) {
		console.error("[sidebars/heartbeat] Fetch by ids error:", error);
		return [];
	}
	return data as Sidebar[];
}

export function sidebarsWithConnectedInOrder(ids: string[], rows: Sidebar[]): Sidebar[] {
	const byId = new Map(rows.map((r) => [r.id, sidebarWithConnected(r)]));
	return ids.map((id) => byId.get(id)).filter((s): s is Sidebar => s != null);
}
