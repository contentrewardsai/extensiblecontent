"use server";

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

export async function generateConnectionKey(userId: string): Promise<{
	key: string;
	prefix: string;
} | null> {
	const supabase = getSupabase();

	// Deactivate any existing keys
	await supabase
		.from("ghl_connection_keys")
		.update({ is_active: false })
		.eq("user_id", userId)
		.eq("is_active", true);

	const raw = randomBytes(32).toString("hex");
	const key = `ec_${raw}`;
	const prefix = key.slice(0, 7);

	const { error } = await supabase.from("ghl_connection_keys").insert({
		user_id: userId,
		key_hash: hashKey(key),
		key_prefix: prefix,
		is_active: true,
	});

	if (error) {
		console.error("[generate-connection-key]", error);
		return null;
	}

	return { key, prefix };
}

export async function getActiveKeyInfo(userId: string): Promise<{
	prefix: string;
	created_at: string;
	used_at: string | null;
} | null> {
	const supabase = getSupabase();
	const { data } = await supabase
		.from("ghl_connection_keys")
		.select("key_prefix, created_at, used_at")
		.eq("user_id", userId)
		.eq("is_active", true)
		.maybeSingle();

	if (!data) return null;
	return {
		prefix: data.key_prefix,
		created_at: data.created_at,
		used_at: data.used_at,
	};
}
