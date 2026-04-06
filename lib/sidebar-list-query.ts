/** Optional filters for GET /api/extension/sidebars (polling / large accounts). */

export const SIDEBAR_LIST_MAX_LIMIT = 200;

export type ParsedSidebarListQuery =
	| { ok: true; sinceIso: string | null; limit: number | null }
	| { ok: false; error: string };

export function parseSidebarListQuery(url: URL): ParsedSidebarListQuery {
	const sinceRaw = url.searchParams.get("since");
	let sinceIso: string | null = null;
	if (sinceRaw != null && sinceRaw !== "") {
		const d = new Date(sinceRaw);
		if (Number.isNaN(d.getTime())) {
			return { ok: false, error: "since must be a valid ISO 8601 datetime" };
		}
		sinceIso = d.toISOString();
	}

	const limitRaw = url.searchParams.get("limit");
	if (limitRaw == null || limitRaw === "") {
		return { ok: true, sinceIso, limit: null };
	}
	const n = Number.parseInt(limitRaw, 10);
	if (!Number.isFinite(n) || String(n) !== limitRaw.trim()) {
		return { ok: false, error: "limit must be an integer" };
	}
	if (n < 1 || n > SIDEBAR_LIST_MAX_LIMIT) {
		return { ok: false, error: `limit must be between 1 and ${SIDEBAR_LIST_MAX_LIMIT}` };
	}
	return { ok: true, sinceIso, limit: n };
}
