import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { sidebarWithConnected } from "@/lib/extension-sidebar";
import { parseSidebarListQuery } from "@/lib/sidebar-list-query";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest) {
	try {
		const user = await getExtensionUser(request);
		if (!user) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		const listQ = parseSidebarListQuery(request.nextUrl);
		if (!listQ.ok) {
			return Response.json({ error: listQ.error }, { status: 400 });
		}

		const supabase = getSupabase();
		let q = supabase.from("sidebars").select("*").eq("user_id", user.user_id);
		if (listQ.sinceIso) {
			q = q.gte("last_seen", listQ.sinceIso);
		}
		q = q.order("last_seen", { ascending: false });
		if (listQ.limit != null) {
			q = q.limit(listQ.limit);
		}
		const { data: sidebars, error } = await q;

		if (error) {
			console.error("[sidebars] List error:", error);
			return Response.json({ error: "Failed to list sidebars" }, { status: 500 });
		}

		const withConnectedFlag = (sidebars ?? []).map(sidebarWithConnected);
		return Response.json({ sidebars: withConnectedFlag });
	} catch (err) {
		console.error("[sidebars] Unexpected error:", err);
		return Response.json({ error: "Failed to list sidebars" }, { status: 500 });
	}
}
