/** Optional filters for GET /api/extension/sidebars (polling / large accounts). */

export const SIDEBAR_LIST_MAX_LIMIT = 200;

export type ParsedSidebarListQuery =
	| { ok: true; sinceIso: string | null; limit: number | null; omitConnected: boolean }
	| { ok: false; error: string };

function truthyQueryParam(url: URL, name: string): boolean {
	const v = url.searchParams.get(name);
	if (v == null || v === "") return false;
	const t = v.trim().toLowerCase();
	return t === "1" || t === "true" || t === "yes";
}

export function parseSidebarListQuery(url: URL): ParsedSidebarListQuery {
	const sinceRaw = url.searchParams.get("since");
	let sinceIso: string | null = null;
	if (sinceRaw != null && sinceRaw.trim() !== "") {
		const d = new Date(sinceRaw.trim());
		if (Number.isNaN(d.getTime())) {
			return { ok: false, error: "since must be a valid ISO 8601 datetime" };
		}
		sinceIso = d.toISOString();
	}

	const limitRaw = url.searchParams.get("limit");
	if (limitRaw == null || limitRaw.trim() === "") {
		return { ok: true, sinceIso, limit: null, omitConnected: truthyQueryParam(url, "omit_connected") };
	}
	const trimmedLimit = limitRaw.trim();
	const n = Number.parseInt(trimmedLimit, 10);
	if (!Number.isFinite(n) || String(n) !== trimmedLimit) {
		return { ok: false, error: "limit must be an integer" };
	}
	if (n < 1 || n > SIDEBAR_LIST_MAX_LIMIT) {
		return { ok: false, error: `limit must be between 1 and ${SIDEBAR_LIST_MAX_LIMIT}` };
	}
	return { ok: true, sinceIso, limit: n, omitConnected: truthyQueryParam(url, "omit_connected") };
}
