import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

interface GhlWebhookPayload {
	type: "INSTALL" | "UNINSTALL";
	appId: string;
	locationId?: string;
	companyId?: string;
	userId?: string;
	companyName?: string;
	installType?: string;
	timestamp?: string;
}

/**
 * POST /api/ghl/webhooks
 *
 * Receives INSTALL and UNINSTALL webhook events from GHL.
 * - INSTALL: records the locationId for later token minting
 * - UNINSTALL: deactivates the location
 */
export async function POST(request: NextRequest) {
	let payload: GhlWebhookPayload;
	try {
		payload = (await request.json()) as GhlWebhookPayload;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getSupabase();

	if (payload.type === "INSTALL") {
		const { locationId, companyId } = payload;
		if (!locationId || !companyId) {
			return Response.json({ received: true, action: "skipped" });
		}

		// Find matching connection by companyId, insert a placeholder location
		const { data: connections } = await supabase
			.from("ghl_connections")
			.select("id, user_id")
			.eq("company_id", companyId);

		if (connections?.length) {
			for (const conn of connections) {
				await supabase.from("ghl_locations").upsert(
					{
						connection_id: conn.id,
						user_id: conn.user_id,
						location_id: locationId,
						location_name: payload.companyName ?? null,
						access_token: "pending",
						refresh_token: "pending",
						token_expires_at: new Date().toISOString(),
						is_active: false,
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "connection_id,location_id", ignoreDuplicates: true },
				);
			}
		}

		console.log(
			`[ghl-webhook] INSTALL: location=${locationId} company=${companyId}`,
		);
		return Response.json({ received: true, action: "install_recorded" });
	}

	if (payload.type === "UNINSTALL") {
		const { locationId, companyId } = payload;
		if (!locationId) {
			return Response.json({ received: true, action: "skipped" });
		}

		// Deactivate matching locations
		if (companyId) {
			const { data: connections } = await supabase
				.from("ghl_connections")
				.select("id")
				.eq("company_id", companyId);

			if (connections?.length) {
				const connIds = connections.map((c) => c.id);
				await supabase
					.from("ghl_locations")
					.update({ is_active: false, updated_at: new Date().toISOString() })
					.eq("location_id", locationId)
					.in("connection_id", connIds);
			}
		} else {
			await supabase
				.from("ghl_locations")
				.update({ is_active: false, updated_at: new Date().toISOString() })
				.eq("location_id", locationId);
		}

		console.log(
			`[ghl-webhook] UNINSTALL: location=${locationId} company=${companyId}`,
		);
		return Response.json({ received: true, action: "uninstall_recorded" });
	}

	return Response.json({ received: true, action: "ignored" });
}
