import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Service-role client for extension API routes (bypasses RLS). */
export function getExtensionServiceSupabase(): SupabaseClient {
	if (cached) return cached;
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	cached = createClient(url, key);
	return cached;
}
