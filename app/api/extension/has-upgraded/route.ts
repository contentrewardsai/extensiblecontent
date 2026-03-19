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
 * GET: Return whether the authenticated user has upgraded.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("users")
		.select("has_upgraded")
		.eq("id", user.user_id)
		.single();

	if (error || !data) {
		return Response.json({ error: "User not found" }, { status: 404 });
	}

	return Response.json({ has_upgraded: !!data.has_upgraded });
}
