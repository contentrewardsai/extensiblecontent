import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * Resolve / create the single `ghl_connections` row that represents a
 * GoHighLevel workspace, plus the corresponding `ghl_locations` row, plus a
 * many-to-many membership row in `ghl_connection_users` linking the given
 * Whop user to the connection.
 *
 * Lookup order for the connection:
 *   1. If `companyId` is provided, find/create by `company_id`.
 *   2. Otherwise, if `locationId` is provided, reuse the connection that
 *      `ghl_locations.location_id = locationId` already points at.
 *   3. Fall back to a synthetic company id derived from the location
 *      (`loc:<locationId>`) so a brand-new location still gets exactly one
 *      stable row.
 *
 * Idempotent: safe to call multiple times for the same (user, company,
 * location) tuple. Used by both the External Auth (Custom Auth) Whop
 * callback and the Custom Page auto-link endpoint.
 *
 * Returns the resolved connection id, or `null` if linking failed (logged
 * server-side; callers can surface a generic error to the user).
 */
export async function linkWhopUserToGhl(args: {
	userId: string;
	companyId?: string | null;
	locationId?: string | null;
}): Promise<{ connectionId: string | null; created: boolean }> {
	const { userId } = args;
	const companyId = args.companyId?.trim() || null;
	const locationId = args.locationId?.trim() || null;

	if (!companyId && !locationId) {
		return { connectionId: null, created: false };
	}

	const supabase = getServiceSupabase();
	let connectionId: string | null = null;
	let created = false;

	if (!companyId && locationId) {
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId)
			.maybeSingle();
		if (loc?.connection_id) connectionId = loc.connection_id;
	}

	const effectiveCompanyId = companyId ?? `loc:${locationId}`;

	if (!connectionId) {
		const { data: existing } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", effectiveCompanyId)
			.maybeSingle();

		if (existing?.id) {
			connectionId = existing.id;
		} else {
			const { data: inserted, error: insertErr } = await supabase
				.from("ghl_connections")
				.insert({
					company_id: effectiveCompanyId,
					user_type: companyId ? "Company" : "Location",
					access_token: "pending-link",
					refresh_token: "pending-link",
					token_expires_at: new Date(0).toISOString(),
					user_id: userId,
				})
				.select("id")
				.single();
			if (insertErr || !inserted) {
				const { data: retry } = await supabase
					.from("ghl_connections")
					.select("id")
					.eq("company_id", effectiveCompanyId)
					.maybeSingle();
				connectionId = retry?.id ?? null;
			} else {
				connectionId = inserted.id;
				created = true;
			}
		}
	}

	if (!connectionId) {
		console.error("[ghl-link] Failed to resolve connection for", {
			userId,
			companyId,
			locationId,
			effectiveCompanyId,
		});
		return { connectionId: null, created: false };
	}

	if (locationId) {
		await supabase.from("ghl_locations").upsert(
			{
				connection_id: connectionId,
				location_id: locationId,
				access_token: "pending-link",
				refresh_token: "pending-link",
				token_expires_at: new Date(0).toISOString(),
				is_active: true,
			},
			{
				onConflict: "location_id",
				ignoreDuplicates: true,
			},
		);
	}

	await supabase
		.from("ghl_connection_users")
		.upsert(
			{ connection_id: connectionId, user_id: userId },
			{ onConflict: "connection_id,user_id" },
		);

	return { connectionId, created };
}
