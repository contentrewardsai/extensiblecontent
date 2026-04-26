import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import type { NextRequest } from "next/server";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/**
 * POST /api/ghl/external-auth/validate
 *
 * One-time linking of a GHL company to a Whop user via Connection Key.
 *
 * Body: { connectionKey, companyId? }
 *
 * When companyId is provided, updates the existing ghl_connections row
 * (which already has real OAuth tokens from the GHL app install) to set
 * user_id = the key owner. This permanently links the accounts so the
 * Whop app can access GHL APIs through stored tokens.
 *
 * When companyId is omitted, just validates the key and returns the userId.
 */
export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const connectionKey = String(body.connectionKey || "").trim();
	if (!connectionKey) {
		return Response.json(
			{ error: "Connection key is required" },
			{ status: 400 },
		);
	}

	const supabase = getSupabase();
	const hash = hashKey(connectionKey);

	const { data: keyRow, error: keyErr } = await supabase
		.from("ghl_connection_keys")
		.select("id, user_id, is_active")
		.eq("key_hash", hash)
		.eq("is_active", true)
		.maybeSingle();

	if (keyErr || !keyRow) {
		return Response.json(
			{ error: "Invalid or expired connection key" },
			{ status: 401 },
		);
	}

	// Mark key as used
	await supabase
		.from("ghl_connection_keys")
		.update({ used_at: new Date().toISOString() })
		.eq("id", keyRow.id);

	const companyId = String(body.companyId || "").trim();

	if (companyId) {
		// Many-to-many link: grant this Whop user access to this GHL company.
		// Multiple Whop users can share access to the same GHL company.
		const { data: conn } = await supabase
			.from("ghl_connections")
			.select("id, user_id")
			.eq("company_id", companyId)
			.maybeSingle();

		let connectionId: string | null = null;

		if (conn) {
			connectionId = conn.id;
			// Set "installer" user_id if this connection has none yet (historical only).
			if (!conn.user_id) {
				await supabase
					.from("ghl_connections")
					.update({
						user_id: keyRow.user_id,
						updated_at: new Date().toISOString(),
					})
					.eq("id", conn.id);
			}
		} else {
			// No connection row yet (install hasn't happened or was lost).
			// Create a placeholder that will be updated when the install completes.
			const { data: inserted } = await supabase
				.from("ghl_connections")
				.upsert(
					{
						user_id: keyRow.user_id,
						company_id: companyId,
						user_type: "Company",
						access_token: "pending-link",
						refresh_token: "pending-link",
						token_expires_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "company_id" },
				)
				.select("id")
				.single();
			connectionId = inserted?.id ?? null;
		}

		if (connectionId) {
			await supabase.from("ghl_connection_users").upsert(
				{
					connection_id: connectionId,
					user_id: keyRow.user_id,
				},
				{ onConflict: "connection_id,user_id" },
			);
			console.log(
				`[ghl-link] Granted userId=${keyRow.user_id} access to companyId=${companyId}`,
			);
		}
	}

	return Response.json({
		ok: true,
		userId: keyRow.user_id,
		linked: !!companyId,
		message: companyId
			? "Accounts linked successfully"
			: "Connection key verified",
	});
}
