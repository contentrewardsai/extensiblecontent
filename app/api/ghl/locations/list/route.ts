import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

const GHL_API_BASE =
	process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";

/**
 * GET /api/ghl/locations/list?userId=...
 *
 * Lists all HighLevel sub-accounts (locations) available to the given Whop
 * user, using their Company-level OAuth token. Returns both:
 *   - locations already activated in our DB (with real tokens)
 *   - locations available in HighLevel but not yet activated
 *
 * This powers the Whop-side "Connect GoHighLevel" flow, letting users pick
 * which locations to activate without going through HL's chooselocation page.
 */
export async function GET(request: NextRequest) {
	const userId = request.nextUrl.searchParams.get("userId");
	if (!userId) {
		return Response.json({ error: "Missing userId" }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("connection_id")
		.eq("user_id", userId);

	const connIds = (access ?? []).map((a) => a.connection_id);
	if (connIds.length === 0) {
		return Response.json({ connections: [], locations: [] });
	}

	const { data: connections } = await supabase
		.from("ghl_connections")
		.select("id, company_id, user_type, access_token, token_expires_at")
		.in("id", connIds);

	const PLACEHOLDER = new Set(["pending", "pending-link"]);
	const companyConns = (connections ?? []).filter(
		(c) =>
			c.user_type === "Company" &&
			c.access_token &&
			!PLACEHOLDER.has(c.access_token),
	);

	const { data: existingLocs } = await supabase
		.from("ghl_locations")
		.select("location_id, location_name, is_active, access_token")
		.in(
			"connection_id",
			(connections ?? []).map((c) => c.id),
		);

	const activatedSet = new Map<
		string,
		{ name: string | null; active: boolean; hasRealToken: boolean }
	>();
	for (const loc of existingLocs ?? []) {
		activatedSet.set(loc.location_id, {
			name: loc.location_name,
			active: loc.is_active,
			hasRealToken: !PLACEHOLDER.has(loc.access_token ?? ""),
		});
	}

	type GhlLocation = {
		id: string;
		name: string;
		companyId: string;
		activated: boolean;
		hasRealToken: boolean;
	};

	const availableLocations: GhlLocation[] = [];

	for (const conn of companyConns) {
		try {
			const res = await fetch(`${GHL_API_BASE}/locations/search`, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${conn.access_token}`,
					Version: "2021-07-28",
				},
			});

			if (!res.ok) {
				console.error(
					`[ghl-locations-list] search failed for company ${conn.company_id}:`,
					res.status,
					await res.text(),
				);
				continue;
			}

			const data = (await res.json()) as {
				locations?: Array<{ id: string; name: string }>;
			};

			for (const loc of data.locations ?? []) {
				const existing = activatedSet.get(loc.id);
				availableLocations.push({
					id: loc.id,
					name: loc.name,
					companyId: conn.company_id,
					activated: existing?.active ?? false,
					hasRealToken: existing?.hasRealToken ?? false,
				});
			}
		} catch (err) {
			console.error(
				`[ghl-locations-list] error for company ${conn.company_id}:`,
				err,
			);
		}
	}

	return Response.json({
		connections: (connections ?? []).map((c) => ({
			id: c.id,
			companyId: c.company_id,
			userType: c.user_type,
			hasRealToken: !PLACEHOLDER.has(c.access_token ?? ""),
		})),
		locations: availableLocations,
	});
}
