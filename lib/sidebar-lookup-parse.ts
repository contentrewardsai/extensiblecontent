/**
 * Shared validation for endpoints that accept exactly one of sidebar_id or window_id.
 */

export type ParsedSidebarLookup =
	| { ok: true; sidebar_id: string }
	| { ok: true; window_id: string }
	| { ok: false; status: 400; error: string };

const SIDEBAR_NAME_MAX = 256;
const WINDOW_ID_MAX = 512;

export function parseExclusiveSidebarLookup(body: {
	sidebar_id?: unknown;
	window_id?: unknown;
}): ParsedSidebarLookup {
	const sid = body.sidebar_id;
	const wid = body.window_id;

	const sidStr = typeof sid === "string" ? sid.trim() : "";
	const widStr = typeof wid === "string" ? wid.trim() : "";
	const hasSid = sidStr.length > 0;
	const hasWid = widStr.length > 0;

	if (sid !== undefined && sid !== null && typeof sid !== "string") {
		return { ok: false, status: 400, error: "sidebar_id must be a string" };
	}
	if (wid !== undefined && wid !== null && typeof wid !== "string") {
		return { ok: false, status: 400, error: "window_id must be a string" };
	}

	if (!hasSid && !hasWid) {
		return { ok: false, status: 400, error: "sidebar_id or window_id is required" };
	}
	if (hasSid && hasWid) {
		return {
			ok: false,
			status: 400,
			error: "Provide only one of sidebar_id or window_id, not both",
		};
	}
	if (hasSid) return { ok: true, sidebar_id: sidStr };
	return { ok: true, window_id: widStr };
}

/** Register / upsert: trim and cap lengths (DB allows longer; API guards abuse). */
export function normalizeRegisterWindowId(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
	if (typeof raw !== "string" || !raw.trim()) {
		return { ok: false, error: "window_id is required" };
	}
	const t = raw.trim();
	if (t.length > WINDOW_ID_MAX) {
		return { ok: false, error: `window_id must be at most ${WINDOW_ID_MAX} characters` };
	}
	return { ok: true, value: t };
}

export function normalizeRegisterSidebarName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
	if (typeof raw !== "string" || !raw.trim()) {
		return { ok: false, error: "sidebar_name is required" };
	}
	const t = raw.trim();
	if (t.length > SIDEBAR_NAME_MAX) {
		return { ok: false, error: `sidebar_name must be at most ${SIDEBAR_NAME_MAX} characters` };
	}
	return { ok: true, value: t };
}
