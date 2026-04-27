import { listLinkedGhlLocationsForUser, type StoragePreference } from "@/lib/storage-destination";
import { getServiceSupabase } from "@/lib/supabase-service";

export interface StoragePreferencesResponse {
	preferred_storage: StoragePreference;
	preferred_ghl_location_id: string | null;
	linked_ghl_locations: Array<{ locationId: string; name: string | null; companyId: string | null }>;
	has_ghl_connection: boolean;
}

/**
 * Load the storage preferences + linked GHL locations for an internal user.
 * Shared by both the Whop and GHL storage-preferences API routes.
 */
export async function loadStoragePreferences(internalUserId: string): Promise<StoragePreferencesResponse> {
	const supabase = getServiceSupabase();
	const [userRes, locations] = await Promise.all([
		supabase
			.from("users")
			.select("preferred_storage, preferred_ghl_location_id")
			.eq("id", internalUserId)
			.maybeSingle(),
		listLinkedGhlLocationsForUser(internalUserId),
	]);

	return {
		preferred_storage: (userRes.data?.preferred_storage as StoragePreference | undefined) ?? "auto",
		preferred_ghl_location_id: (userRes.data?.preferred_ghl_location_id as string | null | undefined) ?? null,
		linked_ghl_locations: locations,
		has_ghl_connection: locations.length > 0,
	};
}

export type UpdateStoragePreferencesResult =
	| { ok: true; prefs: StoragePreferencesResponse }
	| { ok: false; status: number; error: string };

/**
 * Apply a partial update to the user's storage preferences. Validates:
 *   - preferred_storage must be one of the enum values.
 *   - preferred_ghl_location_id (if a string) must be a location the user is
 *     actually linked to, otherwise we treat it as a client-side mistake / abuse.
 */
export async function updateStoragePreferences(
	internalUserId: string,
	patch: { preferred_storage?: string; preferred_ghl_location_id?: string | null },
): Promise<UpdateStoragePreferencesResult> {
	const supabase = getServiceSupabase();
	const update: Record<string, unknown> = {};

	if (patch.preferred_storage !== undefined) {
		if (!["auto", "ghl", "supabase"].includes(patch.preferred_storage)) {
			return { ok: false, status: 400, error: "Invalid preferred_storage value" };
		}
		update.preferred_storage = patch.preferred_storage;
	}
	if (patch.preferred_ghl_location_id !== undefined) {
		const raw = patch.preferred_ghl_location_id;
		if (raw === null || raw === "") {
			update.preferred_ghl_location_id = null;
		} else if (typeof raw === "string") {
			const linked = await listLinkedGhlLocationsForUser(internalUserId);
			if (!linked.some((l) => l.locationId === raw)) {
				return { ok: false, status: 403, error: "Location is not linked to this user" };
			}
			update.preferred_ghl_location_id = raw;
		}
	}

	if (Object.keys(update).length > 0) {
		const { error } = await supabase.from("users").update(update).eq("id", internalUserId);
		if (error) return { ok: false, status: 500, error: error.message };
	}

	const prefs = await loadStoragePreferences(internalUserId);
	return { ok: true, prefs };
}
