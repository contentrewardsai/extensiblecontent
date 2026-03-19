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
 * GET: List user's ShotStack renders.
 * Query: ?env=stage|v1 (optional filter)
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const env = request.nextUrl.searchParams.get("env") as "stage" | "v1" | null;
	const supabase = getSupabase();

	let query = supabase
		.from("shotstack_renders")
		.select("id, shotstack_render_id, status, output_url, credits_used, env, created_at")
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (env) {
		query = query.eq("env", env);
	}

	const { data, error } = await query;

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json(data ?? []);
}
