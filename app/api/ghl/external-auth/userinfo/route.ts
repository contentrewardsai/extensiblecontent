import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getUserIdFromBearer } from "@/lib/ghl-external-auth";

/**
 * GET /api/ghl/external-auth/userinfo
 *
 * GHL calls this after token exchange to get user details.
 * Returns { data: { id, name, email } } matching the field mapping in GHL config.
 */
export async function GET(request: NextRequest) {
	const userId = await getUserIdFromBearer(
		request.headers.get("authorization"),
	);
	if (!userId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !supabaseKey) {
		return Response.json({ error: "Server misconfigured" }, { status: 500 });
	}

	const supabase = createClient(supabaseUrl, supabaseKey);
	const { data: user, error } = await supabase
		.from("users")
		.select("id, name, email")
		.eq("id", userId)
		.single();

	if (error || !user) {
		return Response.json({ error: "User not found" }, { status: 404 });
	}

	return Response.json({
		data: {
			id: user.id,
			name: user.name || "Extensible Content User",
			email: user.email,
		},
	});
}
