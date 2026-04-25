import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { refreshAccessToken } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * Vercel cron: proactively refresh GHL tokens before they expire.
 * GHL access tokens last 24h; we refresh anything expiring within 6h.
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const sixHoursFromNow = new Date(
		Date.now() + 6 * 60 * 60 * 1000,
	).toISOString();

	// Refresh agency-level connection tokens (skip placeholders)
	const { data: connections } = await supabase
		.from("ghl_connections")
		.select("id, refresh_token, user_type, token_expires_at")
		.lt("token_expires_at", sixHoursFromNow)
		.neq("access_token", "pending-link");

	let connRefreshed = 0;
	const connErrors: string[] = [];

	for (const conn of connections ?? []) {
		try {
			const refreshed = await refreshAccessToken(
				conn.refresh_token,
				conn.user_type as "Company" | "Location",
			);
			const newExpires = new Date(
				Date.now() + refreshed.expires_in * 1000,
			).toISOString();

			await supabase
				.from("ghl_connections")
				.update({
					access_token: refreshed.access_token,
					refresh_token: refreshed.refresh_token,
					token_expires_at: newExpires,
					updated_at: new Date().toISOString(),
				})
				.eq("id", conn.id);

			connRefreshed++;
		} catch (err) {
			connErrors.push(
				`conn:${conn.id}: ${err instanceof Error ? err.message : "Unknown"}`,
			);
		}
	}

	// Refresh location-level tokens
	const { data: locations } = await supabase
		.from("ghl_locations")
		.select("id, refresh_token, token_expires_at")
		.eq("is_active", true)
		.neq("access_token", "pending")
		.neq("access_token", "pending-link")
		.lt("token_expires_at", sixHoursFromNow);

	let locRefreshed = 0;
	const locErrors: string[] = [];

	for (const loc of locations ?? []) {
		try {
			const refreshed = await refreshAccessToken(loc.refresh_token, "Location");
			const newExpires = new Date(
				Date.now() + refreshed.expires_in * 1000,
			).toISOString();

			await supabase
				.from("ghl_locations")
				.update({
					access_token: refreshed.access_token,
					refresh_token: refreshed.refresh_token,
					token_expires_at: newExpires,
					updated_at: new Date().toISOString(),
				})
				.eq("id", loc.id);

			locRefreshed++;
		} catch (err) {
			locErrors.push(
				`loc:${loc.id}: ${err instanceof Error ? err.message : "Unknown"}`,
			);
		}
	}

	return Response.json({
		connections: { refreshed: connRefreshed, errors: connErrors },
		locations: { refreshed: locRefreshed, errors: locErrors },
	});
}
