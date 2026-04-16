import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { parseExclusiveSidebarLookup } from "@/lib/sidebar-lookup-parse";
import { broadcastListUpdatedToUser } from "@/lib/realtime-broadcast";
import { getExtensionServiceSupabase } from "@/lib/supabase-extension-service";
import type { SidebarDisconnectBody } from "@/lib/types/sidebars";

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: SidebarDisconnectBody;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = parseExclusiveSidebarLookup(body);
	if (!parsed.ok) {
		return Response.json({ error: parsed.error }, { status: parsed.status });
	}

	const supabase = getExtensionServiceSupabase();

	let query = supabase.from("sidebars").select("id").eq("user_id", user.user_id);
	if ("sidebar_id" in parsed) {
		query = query.eq("id", parsed.sidebar_id);
	} else {
		query = query.eq("window_id", parsed.window_id);
	}

	const { data: toDelete } = await query.maybeSingle();

	if (!toDelete) {
		// Already disconnected or not found - still return success
		return Response.json({ success: true });
	}

	await supabase.from("sidebars").delete().eq("id", toDelete.id);

	try {
		await broadcastListUpdatedToUser(user.user_id);
	} catch (broadcastErr) {
		console.error("[sidebars/disconnect] Broadcast failed (disconnect still succeeded):", broadcastErr);
	}

	return Response.json({ success: true });
}
