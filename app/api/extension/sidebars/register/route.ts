import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { coerceActiveProjectId } from "@/lib/extension-sidebar";
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

function errorResponse(err: unknown, fallback = "Registration failed") {
	const e = err as { message?: string; details?: string; code?: string };
	const message =
		e?.message ||
		(err instanceof Error ? err.message : undefined) ||
		(typeof err === "string" ? err : undefined) ||
		(err ? JSON.stringify(err) : undefined) ||
		fallback;
	const details = e?.details ?? (err instanceof Error ? err.stack?.split("\n")[1]?.trim() : undefined);
	const code = e?.code;
	console.error("[sidebars/register]", err);
	return Response.json(
		{ error: String(message).slice(0, 500), details, code },
		{ status: 500 },
	);
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

		const safeProjectId = coerceActiveProjectId(active_project_id);

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
			return errorResponse(selectError);
		}

		let sidebar: Sidebar;

		if (existing) {
			// Update existing
			const { data: updated, error: updateError } = await supabase
				.from("sidebars")
				.update({
					sidebar_name: sidebar_name.trim(),
					active_project_id: safeProjectId,
					last_seen: now,
					ip_address: ipAddress,
					updated_at: now,
				})
				.eq("id", existing.id)
				.select()
				.single();

			if (updateError || !updated) {
				return errorResponse(updateError);
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
					active_project_id: safeProjectId,
					last_seen: now,
					ip_address: ipAddress,
					updated_at: now,
				})
				.select()
				.single();

			if (insertError || !inserted) {
				return errorResponse(insertError);
			}
			sidebar = inserted as Sidebar;
		}

		// Broadcast list_updated to user channel (non-fatal; don't fail registration)
		try {
			await broadcastListUpdatedToUser(user.user_id);
		} catch (broadcastErr) {
			console.error("[sidebars/register] Broadcast failed (registration still succeeded):", broadcastErr);
		}

		// Include connected: true (just registered = active)
		const response = { ...sidebar, connected: true };
		return Response.json({ sidebar: response });
	} catch (err) {
		return errorResponse(err);
	}
}
