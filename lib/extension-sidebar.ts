import type { Sidebar } from "@/lib/types/sidebars";

/**
 * Same window as ExtensibleContentExtension Activity tab (`RECENT_MS` in sidepanel.js):
 * treat a sidebar as connected when last_seen is within this interval.
 */
export const SIDEBAR_CONNECTED_THRESHOLD_MS = 60 * 60 * 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For inserts/upserts: invalid or empty values become null (no 400). */
export function coerceActiveProjectId(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value !== "string") return null;
	const t = value.trim();
	if (!t) return null;
	return UUID_REGEX.test(t) ? t : null;
}

export type ActiveProjectIdPatch =
	| { kind: "omit" }
	| { kind: "set"; id: string | null };

/**
 * For PATCH: undefined = omit field; null / "" = clear; string must be UUID.
 */
export function parseActiveProjectIdForUpdate(
	value: unknown,
): ActiveProjectIdPatch | { kind: "error"; message: string } {
	if (value === undefined) return { kind: "omit" };
	if (value === null) return { kind: "set", id: null };
	if (typeof value !== "string") {
		return { kind: "error", message: "active_project_id must be a string or null" };
	}
	const t = value.trim();
	if (!t) return { kind: "set", id: null };
	if (!UUID_REGEX.test(t)) {
		return { kind: "error", message: "active_project_id must be a valid UUID" };
	}
	return { kind: "set", id: t };
}

/** Use anywhere we have `last_seen` but not a full Sidebar row (e.g. dashboard queries). */
export function connectedFromLastSeen(lastSeen: string | null | undefined): boolean {
	if (lastSeen == null || lastSeen === "") return false;
	const t = new Date(lastSeen).getTime();
	if (Number.isNaN(t)) return false;
	return Date.now() - t < SIDEBAR_CONNECTED_THRESHOLD_MS;
}

export function sidebarWithConnected(row: Sidebar): Sidebar {
	return { ...row, connected: connectedFromLastSeen(row.last_seen) };
}
