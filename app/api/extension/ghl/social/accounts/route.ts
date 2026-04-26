import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { ghlFetch } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/extension/ghl/social/accounts?locationId=...
 *
 * Proxies GHL GET /social-media-posting/:locationId/accounts
 * and caches the results in ghl_social_accounts.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const locationId = request.nextUrl.searchParams.get("locationId");
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	try {
		const res = await ghlFetch(
			user.user_id,
			locationId,
			`/social-media-posting/${encodeURIComponent(locationId)}/accounts`,
		);

		const data = await res.json();
		if (!res.ok) {
			return Response.json(
				{ error: "GHL API error", details: data },
				{ status: res.status },
			);
		}

		// Cache accounts in DB (best-effort)
		try {
			await cacheAccounts(user.user_id, locationId, data);
		} catch (cacheErr) {
			console.error("[ghl-social-accounts] Cache error:", cacheErr);
		}

		return Response.json(data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}

async function cacheAccounts(
	_userId: string,
	locationId: string,
	data: Record<string, unknown>,
) {
	const supabase = getSupabase();

	// Find the DB ghl_location row (access was already verified by the caller
	// via getValidTokenForLocation, which checks the join table).
	const { data: loc } = await supabase
		.from("ghl_locations")
		.select("id")
		.eq("location_id", locationId)
		.eq("is_active", true)
		.limit(1)
		.single();

	if (!loc) return;

	const accounts = Array.isArray(data) ? data : (data as { accounts?: unknown[] }).accounts;
	if (!Array.isArray(accounts)) return;

	// Clear existing cached accounts for this location
	await supabase
		.from("ghl_social_accounts")
		.delete()
		.eq("ghl_location_id", loc.id);

	const rows = accounts.map((acc: unknown) => {
		const a = acc as Record<string, unknown>;
		return {
		ghl_location_id: loc.id,
		ghl_account_id: String(a.id || a._id || ""),
		platform: String(a.platform || "unknown"),
		display_name: String(a.name || a.displayName || ""),
		account_type: String(a.type || ""),
		meta: a,
		updated_at: new Date().toISOString(),
	};
	});

	if (rows.length) {
		await supabase.from("ghl_social_accounts").insert(rows);
	}
}
