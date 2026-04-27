import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * Resolved upload destination.
 *
 * `supabase` = our existing post-media buckets ("Content Rewards AI account storage").
 * `ghl` = the user's HighLevel Media Library, uploaded via `POST /medias/upload-file`.
 *
 * `fallbackReason` is set when the resolver *wanted* to use GHL (user preference
 * or project override was 'ghl'/'auto') but couldn't, and ended up returning
 * supabase anyway. Callers can use this to surface "Saved to CRAI — GHL not
 * available because X" in the UI.
 */
export type StorageTarget =
	| {
			type: "supabase";
			fallbackReason?: "no_ghl_connection" | "no_location" | "upload_failed";
	  }
	| {
			type: "ghl";
			locationId: string;
			companyId: string | null;
	  };

export type StoragePreference = "auto" | "ghl" | "supabase";

export interface ResolveStorageInput {
	internalUserId: string;
	/** When provided, the project's override takes precedence over user default. */
	projectId?: string | null;
	/**
	 * Active GHL context, typically the locationId/companyId passed in from a
	 * GHL Custom Page surface (carried via form data or query string). Takes
	 * priority over the user's saved `preferred_ghl_location_id` when resolving
	 * a location.
	 */
	activeGhlContext?: { locationId?: string | null; companyId?: string | null } | null;
}

/**
 * Resolve the storage destination to use for a given upload.
 *
 * Priority:
 *   1. Project-level `storage_destination` override — if set to 'ghl' or
 *      'supabase' (not 'auto'), that wins.
 *   2. User-level `preferred_storage`:
 *        - 'supabase' → always supabase.
 *        - 'ghl'      → try to resolve a GHL location; fall back to supabase if none.
 *        - 'auto'     → resolve a GHL location if one exists, else supabase.
 *   3. Location resolution (only relevant when returning 'ghl'):
 *        - activeGhlContext.locationId (verified via getValidTokenForLocation later)
 *        - users.preferred_ghl_location_id
 *        - if the user is linked to exactly one ghl_connection, its first active location
 *        - otherwise supabase with fallbackReason='no_location'.
 */
export async function resolveStorageTarget(input: ResolveStorageInput): Promise<StorageTarget> {
	const supabase = getServiceSupabase();

	let projectOverride: StoragePreference = "auto";
	if (input.projectId) {
		const { data: proj } = await supabase
			.from("projects")
			.select("storage_destination")
			.eq("id", input.projectId)
			.maybeSingle();
		const v = proj?.storage_destination as StoragePreference | undefined;
		if (v === "ghl" || v === "supabase") {
			projectOverride = v;
		}
	}

	if (projectOverride === "supabase") {
		return { type: "supabase" };
	}

	const { data: user } = await supabase
		.from("users")
		.select("preferred_storage, preferred_ghl_location_id")
		.eq("id", input.internalUserId)
		.maybeSingle();

	// projectOverride of 'ghl' forces GHL. Otherwise use the user default.
	const effective: StoragePreference =
		projectOverride === "ghl"
			? "ghl"
			: ((user?.preferred_storage as StoragePreference | undefined) ?? "auto");

	if (effective === "supabase") {
		return { type: "supabase" };
	}

	// effective is 'ghl' or 'auto' — resolve a location.
	const savedLocationId = (user?.preferred_ghl_location_id as string | undefined) ?? null;
	const location = await resolveGhlLocation({
		internalUserId: input.internalUserId,
		activeGhlContext: input.activeGhlContext,
		savedLocationId,
	});

	if (!location) {
		// Distinguish "no connection at all" from "connection exists but no usable
		// location" so the UI can tell the user what to do next.
		const hasAnyConnection = await userHasAnyGhlConnection(input.internalUserId);
		return {
			type: "supabase",
			fallbackReason: hasAnyConnection ? "no_location" : "no_ghl_connection",
		};
	}

	return { type: "ghl", locationId: location.locationId, companyId: location.companyId };
}

async function resolveGhlLocation(params: {
	internalUserId: string;
	activeGhlContext?: { locationId?: string | null; companyId?: string | null } | null;
	savedLocationId: string | null;
}): Promise<{ locationId: string; companyId: string | null } | null> {
	const supabase = getServiceSupabase();

	const candidateIds: string[] = [];
	const pushCandidate = (id: string | null | undefined) => {
		if (!id) return;
		if (!candidateIds.includes(id)) candidateIds.push(id);
	};
	pushCandidate(params.activeGhlContext?.locationId ?? null);
	pushCandidate(params.savedLocationId);

	// If neither of the above are set, try auto-picking: if the user has exactly
	// one linked GHL connection with at least one active location, use its first.
	if (candidateIds.length === 0) {
		const { data: links } = await supabase
			.from("ghl_connection_users")
			.select("connection_id")
			.eq("user_id", params.internalUserId);
		const connIds = (links ?? []).map((r) => r.connection_id).filter(Boolean);
		if (connIds.length === 0) return null;
		const { data: locs } = await supabase
			.from("ghl_locations")
			.select("location_id, connection_id")
			.in("connection_id", connIds)
			.eq("is_active", true)
			.limit(2);
		if ((locs?.length ?? 0) !== 1) return null;
		pushCandidate(locs?.[0]?.location_id);
	}

	// Verify each candidate is actually linked to this user and pull companyId.
	for (const locationId of candidateIds) {
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("id, connection_id")
			.eq("location_id", locationId)
			.eq("is_active", true)
			.maybeSingle();
		if (!loc) continue;

		const { data: access } = await supabase
			.from("ghl_connection_users")
			.select("id")
			.eq("connection_id", loc.connection_id)
			.eq("user_id", params.internalUserId)
			.maybeSingle();
		if (!access) continue;

		const { data: conn } = await supabase
			.from("ghl_connections")
			.select("company_id")
			.eq("id", loc.connection_id)
			.maybeSingle();

		return { locationId, companyId: (conn?.company_id as string | null) ?? null };
	}

	return null;
}

async function userHasAnyGhlConnection(internalUserId: string): Promise<boolean> {
	const supabase = getServiceSupabase();
	const { data } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("user_id", internalUserId)
		.limit(1);
	return (data?.length ?? 0) > 0;
}

/**
 * Public helper: return the list of GHL locations linked to this user that
 * could be used as `preferred_ghl_location_id`. Powers the settings dropdown.
 */
export async function listLinkedGhlLocationsForUser(internalUserId: string): Promise<
	Array<{ locationId: string; name: string | null; companyId: string | null }>
> {
	const supabase = getServiceSupabase();
	const { data: links } = await supabase
		.from("ghl_connection_users")
		.select("connection_id")
		.eq("user_id", internalUserId);
	const connIds = (links ?? []).map((r) => r.connection_id).filter(Boolean);
	if (connIds.length === 0) return [];

	const { data: locs } = await supabase
		.from("ghl_locations")
		.select("location_id, name, connection_id")
		.in("connection_id", connIds)
		.eq("is_active", true);

	const { data: conns } = await supabase
		.from("ghl_connections")
		.select("id, company_id")
		.in("id", connIds);
	const companyMap = new Map<string, string | null>();
	for (const c of conns ?? []) companyMap.set(c.id as string, (c.company_id as string | null) ?? null);

	return (locs ?? []).map((l) => ({
		locationId: l.location_id as string,
		name: (l.name as string | null) ?? null,
		companyId: companyMap.get(l.connection_id as string) ?? null,
	}));
}

export type StorageFallbackReason = "no_ghl_connection" | "no_location" | "upload_failed";

/**
 * Format a fallback reason for the UI. Callers can inline this or ignore.
 */
export function describeFallback(reason: StorageFallbackReason): string {
	switch (reason) {
		case "no_ghl_connection":
			return "No HighLevel connection found — saved to Content Rewards AI storage instead.";
		case "no_location":
			return "Couldn't resolve a HighLevel location to upload to — saved to Content Rewards AI storage instead.";
		case "upload_failed":
			return "HighLevel upload failed — saved to Content Rewards AI storage instead.";
		default:
			return "";
	}
}
