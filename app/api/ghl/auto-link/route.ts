import type { NextRequest } from "next/server";
import { linkWhopUserToGhl } from "@/lib/ghl-link";
import { WHOP_USER_COOKIE, readWhopUserCookie } from "@/lib/ghl-sso";

/**
 * POST /api/ghl/auto-link
 *
 * Body: { companyId?: string; locationId?: string }
 *
 * Idempotently records that the currently-signed-in Whop user (from the
 * `ec_whop_user` cookie) has access to the given GoHighLevel company /
 * location. Called from the Custom Page on mount so the many-to-many link
 * forms automatically the first time someone opens the page after going
 * through the Custom Auth (Whop OAuth) flow — no buttons to click.
 *
 * This endpoint is hit only by our own iframe code, never by external
 * services, so its URL doesn't need to be neutral (no `ghl` rewrite).
 */
export async function POST(request: NextRequest) {
	const raw = request.cookies.get(WHOP_USER_COOKIE)?.value;
	const userId = readWhopUserCookie(raw);
	if (!userId) {
		return Response.json({ error: "Not signed in" }, { status: 401 });
	}

	let body: { companyId?: string; locationId?: string };
	try {
		body = (await request.json()) as { companyId?: string; locationId?: string };
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const companyId = body.companyId?.trim() || null;
	const locationId = body.locationId?.trim() || null;

	if (!companyId && !locationId) {
		return Response.json(
			{ error: "companyId or locationId required" },
			{ status: 400 },
		);
	}

	const result = await linkWhopUserToGhl({ userId, companyId, locationId });
	if (!result.connectionId) {
		return Response.json({ error: "link_failed" }, { status: 500 });
	}

	return Response.json({
		linked: true,
		connectionId: result.connectionId,
		created: result.created,
	});
}
