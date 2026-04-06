import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { sidebarWithConnected } from "@/lib/extension-sidebar";
import { type ParsedSidebarListQuery, parseSidebarListQuery } from "@/lib/sidebar-list-query";
import { getExtensionServiceSupabase } from "@/lib/supabase-extension-service";

const LIST_SUCCESS_HEADERS = {
	"Cache-Control": "private, no-store",
	Vary: "Authorization",
} as const;

type ListQueryOk = Extract<ParsedSidebarListQuery, { ok: true }>;

function applySidebarsFilters(
	supabase: ReturnType<typeof getExtensionServiceSupabase>,
	userId: string,
	listQ: ListQueryOk,
	mode: "rows" | "count",
) {
	const base =
		mode === "count"
			? supabase.from("sidebars").select("*", { count: "exact", head: true })
			: supabase.from("sidebars").select("*");
	let q = base.eq("user_id", userId);
	if (listQ.sinceIso) {
		// Strictly after watermark so incremental HEAD counts can be 0 when nothing changed
		// (gte(max_seen) would always include at least the row that produced the watermark).
		q = q.gt("last_seen", listQ.sinceIso);
	}
	q = q.order("last_seen", { ascending: false });
	if (listQ.limit != null) {
		q = q.limit(listQ.limit);
	}
	return q;
}

/**
 * GET: full sidebar rows (with optional `connected` field).
 */
export async function sidebarsListGetResponse(request: NextRequest): Promise<Response> {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const listQ = parseSidebarListQuery(request.nextUrl);
	if (!listQ.ok) {
		return Response.json({ error: listQ.error }, { status: 400 });
	}

	const supabase = getExtensionServiceSupabase();
	const { data: sidebars, error } = await applySidebarsFilters(supabase, user.user_id, listQ, "rows");

	if (error) {
		console.error("[sidebars] List error:", error);
		return Response.json({ error: "Failed to list sidebars" }, { status: 500 });
	}

	const rows = (sidebars ?? []).map(sidebarWithConnected);
	const payloadRows = listQ.omitConnected
		? rows.map(({ connected: _c, ...rest }) => rest)
		: rows;
	return Response.json({ sidebars: payloadRows }, { headers: LIST_SUCCESS_HEADERS });
}

/**
 * HEAD: same filters as GET; count-only DB round-trip; no body.
 * `X-Result-Count` = number of rows that would be returned (respects `since` and `limit`).
 */
export async function sidebarsListHeadResponse(request: NextRequest): Promise<Response> {
	const user = await getExtensionUser(request);
	if (!user) {
		return new Response(null, { status: 401 });
	}

	const listQ = parseSidebarListQuery(request.nextUrl);
	if (!listQ.ok) {
		return new Response(null, { status: 400 });
	}

	const supabase = getExtensionServiceSupabase();
	const { error, count } = await applySidebarsFilters(supabase, user.user_id, listQ, "count");

	if (error) {
		console.error("[sidebars] HEAD list error:", error);
		return new Response(null, { status: 500 });
	}

	const headers = new Headers(LIST_SUCCESS_HEADERS);
	if (count != null) {
		headers.set("X-Result-Count", String(count));
	}
	return new Response(null, { status: 200, headers });
}
