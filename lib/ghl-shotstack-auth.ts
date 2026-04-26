import type { NextRequest } from "next/server";
import { readWhopUserCookie, WHOP_USER_COOKIE } from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * Resolve the active Whop user for a request coming from the GHL Custom Page.
 *
 * Auth model:
 *   - The `ec_whop_user` HTTP-only cookie is the source of truth for "who is
 *     logged in in this browser" (set by OAuth callback / set-active-user,
 *     HMAC-signed so it cannot be forged client-side).
 *   - If the caller passes a `locationId` or `companyId`, we additionally
 *     verify the Whop user is linked to that GHL subaccount via
 *     `ghl_connection_users` — the same check `/api/ghl/page-context` does
 *     when it serves a linked user.
 *
 * Returns `{ ok: true, internalUserId }` on success, or `{ ok: false, response }`
 * with a ready-to-return Response on failure (401 / 403).
 */
export async function getInternalUserForGhl(
	request: NextRequest,
	ctx: { locationId?: string | null; companyId?: string | null } = {},
): Promise<
	| { ok: true; internalUserId: string }
	| { ok: false; response: Response }
> {
	const raw = request.cookies.get(WHOP_USER_COOKIE)?.value;
	const internalUserId = readWhopUserCookie(raw);
	if (!internalUserId) {
		return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	}

	const { locationId, companyId } = ctx;
	if (!locationId && !companyId) {
		// Cookie-only trust: no GHL context to cross-check against.
		return { ok: true, internalUserId };
	}

	const supabase = getServiceSupabase();
	const connectionIds = new Set<string>();
	if (companyId) {
		const { data } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", companyId);
		for (const c of data ?? []) connectionIds.add(c.id);
	}
	if (locationId) {
		const { data } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId);
		for (const l of data ?? []) if (l.connection_id) connectionIds.add(l.connection_id);
		const { data: bySynthetic } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", `loc:${locationId}`);
		for (const c of bySynthetic ?? []) connectionIds.add(c.id);
	}

	if (connectionIds.size === 0) {
		// GHL context was supplied but we have no connection rows for it — treat
		// as unauthorized rather than silently falling back to cookie-only trust.
		return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
	}

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.in("connection_id", Array.from(connectionIds))
		.eq("user_id", internalUserId)
		.limit(1);
	if (!access || access.length === 0) {
		return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
	}

	return { ok: true, internalUserId };
}

/**
 * Convenience wrapper that reads `locationId` / `companyId` from the request
 * query string. Use in API routes where the client sends `?locationId=...&companyId=...`.
 */
export async function getInternalUserForGhlFromQuery(request: NextRequest) {
	const locationId = request.nextUrl.searchParams.get("locationId");
	const companyId = request.nextUrl.searchParams.get("companyId");
	return getInternalUserForGhl(request, { locationId, companyId });
}
