import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Sidebar } from "@/lib/types/sidebars";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/** Consider connected if last_seen within last 2 minutes */
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

function withConnected(sidebar: Sidebar): Sidebar {
	const lastSeen = new Date(sidebar.last_seen).getTime();
	const connected = Date.now() - lastSeen < STALE_THRESHOLD_MS;
	return { ...sidebar, connected };
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const { data: sidebars, error } = await supabase
		.from("sidebars")
		.select("*")
		.eq("user_id", user.user_id)
		.order("last_seen", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const withConnectedFlag = (sidebars ?? []).map(withConnected);
	return Response.json(withConnectedFlag);
}
