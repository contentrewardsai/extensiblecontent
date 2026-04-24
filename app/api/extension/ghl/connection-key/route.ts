import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

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
 * POST /api/extension/ghl/connection-key
 *
 * Generates a new connection key for the authenticated user.
 * The key is shown once; only the hash is stored.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();

	// Deactivate any existing keys
	await supabase
		.from("ghl_connection_keys")
		.update({ is_active: false })
		.eq("user_id", user.user_id)
		.eq("is_active", true);

	// Generate new key: ec_ prefix + 32 random bytes as hex
	const raw = randomBytes(32).toString("hex");
	const key = `ec_${raw}`;
	const prefix = key.slice(0, 7);

	const { error } = await supabase.from("ghl_connection_keys").insert({
		user_id: user.user_id,
		key_hash: hashKey(key),
		key_prefix: prefix,
		is_active: true,
	});

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json({ key, prefix });
}

/**
 * GET /api/extension/ghl/connection-key
 *
 * Returns the prefix of the user's active connection key (if any).
 * The full key is never returned after creation.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data } = await supabase
		.from("ghl_connection_keys")
		.select("key_prefix, created_at, used_at")
		.eq("user_id", user.user_id)
		.eq("is_active", true)
		.maybeSingle();

	return Response.json({ activeKey: data ?? null });
}
