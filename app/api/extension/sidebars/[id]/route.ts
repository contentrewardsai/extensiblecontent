import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { broadcastListUpdatedToSidebars } from "@/lib/realtime-broadcast";
import type { Sidebar, SidebarUpdateBody } from "@/lib/types/sidebars";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: existing } = await supabase
		.from("sidebars")
		.select("id")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (!existing) {
		return Response.json({ error: "Sidebar not found" }, { status: 404 });
	}

	let body: SidebarUpdateBody;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.sidebar_name !== undefined) {
		if (typeof body.sidebar_name !== "string" || !body.sidebar_name.trim()) {
			return Response.json({ error: "sidebar_name must be a non-empty string" }, { status: 400 });
		}
		updates.sidebar_name = body.sidebar_name.trim();
	}
	if (body.active_project_id !== undefined) {
		updates.active_project_id = body.active_project_id ?? null;
	}

	const { data: sidebar, error } = await supabase
		.from("sidebars")
		.update(updates)
		.eq("id", id)
		.select()
		.single();

	if (error || !sidebar) {
		return Response.json({ error: error?.message ?? "Failed to update sidebar" }, { status: 500 });
	}

	// Broadcast list_updated to all of user's sidebars
	const { data: allSidebars } = await supabase
		.from("sidebars")
		.select("id")
		.eq("user_id", user.user_id);
	const ids = (allSidebars ?? []).map((r) => r.id);
	await broadcastListUpdatedToSidebars(ids);

	return Response.json(sidebar as Sidebar);
}
