import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: List user's social profiles.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("social_profiles")
		.select("*")
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(data ?? []);
}

/**
 * POST: Create a social profile.
 * Body: { name: string, platform?: string, profile_url?: string }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { name: string; platform?: string; profile_url?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, platform, profile_url } = body;
	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("social_profiles")
		.insert({
			user_id: user.user_id,
			name: name.trim(),
			platform: platform?.trim() ?? null,
			profile_url: profile_url?.trim() ?? null,
			updated_at: new Date().toISOString(),
		})
		.select()
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(data);
}
