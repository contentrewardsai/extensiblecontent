import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { broadcastListUpdatedToUser } from "@/lib/realtime-broadcast";
import type { Sidebar, SidebarRegisterBody } from "@/lib/types/sidebars";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function getIpAddress(request: NextRequest): string | null {
	return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
	try {
		const user = await getExtensionUser(request);
		if (!user) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		let body: SidebarRegisterBody;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON" }, { status: 400 });
		}

		const { window_id, sidebar_name, active_project_id } = body;
		if (!window_id || typeof window_id !== "string" || !window_id.trim()) {
			return Response.json({ error: "window_id is required" }, { status: 400 });
		}
		if (!sidebar_name || typeof sidebar_name !== "string" || !sidebar_name.trim()) {
			return Response.json({ error: "sidebar_name is required" }, { status: 400 });
		}

		const supabase = getSupabase();
		const ipAddress = getIpAddress(request);
		const now = new Date().toISOString();

		// Check existing row for upsert (ignore PGRST116 "no rows" - that's expected for insert)
		const { data: existing, error: selectError } = await supabase
			.from("sidebars")
			.select("id")
			.eq("user_id", user.user_id)
			.eq("window_id", window_id.trim())
			.maybeSingle();

		if (selectError) {
			console.error("[sidebars/register] Select error:", selectError);
			return Response.json({ error: "Registration failed" }, { status: 500 });
		}

		let sidebar: Sidebar;

		if (existing) {
			// Update existing
			const { data: updated, error: updateError } = await supabase
				.from("sidebars")
				.update({
					sidebar_name: sidebar_name.trim(),
					active_project_id: active_project_id ?? null,
					last_seen: now,
					ip_address: ipAddress,
					updated_at: now,
				})
				.eq("id", existing.id)
				.select()
				.single();

			if (updateError || !updated) {
				console.error("[sidebars/register] Update error:", updateError);
				return Response.json({ error: "Registration failed" }, { status: 500 });
			}
			sidebar = updated as Sidebar;
		} else {
			// Insert new (no limit; one channel per user)
			const { data: inserted, error: insertError } = await supabase
				.from("sidebars")
				.insert({
					user_id: user.user_id,
					window_id: window_id.trim(),
					sidebar_name: sidebar_name.trim(),
					active_project_id: active_project_id ?? null,
					last_seen: now,
					ip_address: ipAddress,
					updated_at: now,
				})
				.select()
				.single();

			if (insertError || !inserted) {
				console.error("[sidebars/register] Insert error:", insertError);
				return Response.json({ error: "Registration failed" }, { status: 500 });
			}
			sidebar = inserted as Sidebar;
		}

		// Broadcast list_updated to user channel (all sidebars subscribe to it)
		await broadcastListUpdatedToUser(user.user_id);

		// Include connected: true (just registered = active)
		const response = { ...sidebar, connected: true };
		return Response.json({ sidebar: response });
	} catch (err) {
		console.error("[sidebars/register] Unexpected error:", err);
		return Response.json({ error: "Registration failed" }, { status: 500 });
	}
}
