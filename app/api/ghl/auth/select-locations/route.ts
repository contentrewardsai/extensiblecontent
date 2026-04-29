import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getLocationTokenFromAgency } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/ghl/auth/select-locations?connectionId=...
 *
 * Returns a simple HTML page listing known locations (from webhooks) for the
 * agency connection, with checkboxes to activate them. Submits via POST.
 */
export async function GET(request: NextRequest) {
	const connectionId = request.nextUrl.searchParams.get("connectionId");
	if (!connectionId) {
		return new Response("Missing connectionId", { status: 400 });
	}

	const supabase = getSupabase();
	const { data: conn } = await supabase
		.from("ghl_connections")
		.select("id, company_id, user_type")
		.eq("id", connectionId)
		.single();

	if (!conn) {
		return new Response("Connection not found", { status: 404 });
	}

	// Check if we already have locations from webhooks
	const { data: existing } = await supabase
		.from("ghl_locations")
		.select("location_id, location_name, is_active")
		.eq("connection_id", connectionId);

	const locations = existing ?? [];
	const locationListHtml = locations.length
		? locations
				.map(
					(l) =>
						`<label style="display:block;margin:8px 0">
							<input type="checkbox" name="locationIds" value="${l.location_id}" ${l.is_active ? "checked" : ""}>
							${l.location_name || l.location_id}
						</label>`,
				)
				.join("")
		: `<p>No locations found yet. Enter a location ID manually:</p>
		   <input type="text" name="manualLocationId" placeholder="Location ID" style="padding:8px;width:100%;margin:8px 0;border:1px solid #ccc;border-radius:4px">`;

	const html = `<!DOCTYPE html>
<html>
<head><title>Select GHL Sub-Accounts</title>
<style>body{font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px}
button{background:#2563eb;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;margin-top:16px}
button:hover{opacity:0.9}</style></head>
<body>
<h1>Select Sub-Accounts</h1>
<p>Choose which GoHighLevel sub-accounts to connect:</p>
<form method="POST" action="/api/ghl/auth/select-locations">
<input type="hidden" name="connectionId" value="${connectionId}">
${locationListHtml}
<button type="submit">Connect Selected</button>
</form>
</body></html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" },
	});
}

/**
 * POST /api/ghl/auth/select-locations
 *
 * Receives selected locationIds, mints location tokens from the agency token,
 * stores them in ghl_locations.
 */
export async function POST(request: NextRequest) {
	const formData = await request.formData();
	const connectionId = formData.get("connectionId") as string;
	const locationIds = formData.getAll("locationIds") as string[];
	const manualLocationId = formData.get("manualLocationId") as string | null;

	if (manualLocationId?.trim()) {
		locationIds.push(manualLocationId.trim());
	}

	if (!connectionId || locationIds.length === 0) {
		return new Response("No locations selected", { status: 400 });
	}

	const supabase = getSupabase();
	const { data: conn } = await supabase
		.from("ghl_connections")
		.select("id, user_id, company_id, access_token")
		.eq("id", connectionId)
		.single();

	if (!conn) {
		return new Response("Connection not found", { status: 404 });
	}

	const results: Array<{ locationId: string; ok: boolean; error?: string }> = [];

	for (const locationId of locationIds) {
		try {
			const locToken = await getLocationTokenFromAgency(
				conn.access_token,
				conn.company_id,
				locationId,
			);

			const expiresAt = new Date(
				Date.now() + locToken.expires_in * 1000,
			).toISOString();

			await supabase.from("ghl_locations").upsert(
				{
					connection_id: conn.id,
					user_id: conn.user_id,
					location_id: locationId,
					access_token: locToken.access_token,
					refresh_token: locToken.refresh_token,
					token_expires_at: expiresAt,
					is_active: true,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "location_id" },
			);

			results.push({ locationId, ok: true });
		} catch (err) {
			results.push({
				locationId,
				ok: false,
				error: err instanceof Error ? err.message : "Unknown error",
			});
		}
	}

	const succeeded = results.filter((r) => r.ok).length;
	const failed = results.filter((r) => !r.ok);

	const html = `<!DOCTYPE html>
<html><head><title>GHL Connection Complete</title>
<style>body{font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px}
.ok{color:#16a34a}.err{color:#dc2626}</style></head>
<body>
<h1>Connection Complete</h1>
<p class="ok">${succeeded} sub-account(s) connected successfully.</p>
${failed.length ? `<p class="err">${failed.length} failed:</p><ul>${failed.map((f) => `<li>${f.locationId}: ${f.error}</li>`).join("")}</ul>` : ""}
<p>You can close this window and return to the app.</p>
</body></html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" },
	});
}
