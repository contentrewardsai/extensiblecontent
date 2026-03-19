import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { broadcastListUpdatedToSidebars } from "@/lib/realtime-broadcast";
import type { Sidebar, SidebarRegisterBody } from "@/lib/types/sidebars";

const MAX_SIDEBARS_PER_USER = 10;

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

	// Check existing row for upsert
	const { data: existing } = await supabase
		.from("sidebars")
		.select("id")
		.eq("user_id", user.user_id)
		.eq("window_id", window_id.trim())
		.single();

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
			return Response.json({ error: updateError?.message ?? "Failed to update sidebar" }, { status: 500 });
		}
		sidebar = updated as Sidebar;
	} else {
		// Count before insert
		const { count, error: countError } = await supabase
			.from("sidebars")
			.select("id", { count: "exact", head: true })
			.eq("user_id", user.user_id);

		if (countError) {
			return Response.json({ error: countError.message }, { status: 500 });
		}
		if ((count ?? 0) >= MAX_SIDEBARS_PER_USER) {
			return Response.json(
				{ error: "Maximum 10 sidebars per account" },
				{ status: 429 }
			);
		}

		// Insert new
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
			return Response.json({ error: insertError?.message ?? "Failed to create sidebar" }, { status: 500 });
		}
		sidebar = inserted as Sidebar;
	}

	// Broadcast list_updated to all of user's sidebars
	const { data: allSidebars } = await supabase
		.from("sidebars")
		.select("id")
		.eq("user_id", user.user_id);
	const ids = (allSidebars ?? []).map((r) => r.id);
	await broadcastListUpdatedToSidebars(ids);

	return Response.json(sidebar);
}
