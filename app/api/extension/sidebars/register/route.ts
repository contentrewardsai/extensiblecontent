import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { coerceActiveProjectId, sidebarWithConnected } from "@/lib/extension-sidebar";
import { normalizeRegisterSidebarName, normalizeRegisterWindowId } from "@/lib/sidebar-lookup-parse";
import { isProjectOwnedByUser } from "@/lib/sidebar-project";
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

function isUniqueViolation(err: unknown): boolean {
	const e = err as { code?: string; message?: string };
	if (e?.code === "23505") return true;
	const m = String(e?.message ?? "").toLowerCase();
	return m.includes("unique") || m.includes("duplicate key");
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
		const win = normalizeRegisterWindowId(window_id);
		if (!win.ok) return Response.json({ error: win.error }, { status: 400 });
		const name = normalizeRegisterSidebarName(sidebar_name);
		if (!name.ok) return Response.json({ error: name.error }, { status: 400 });

		const safeProjectId = coerceActiveProjectId(active_project_id);

		const supabase = getSupabase();
		if (safeProjectId) {
			const owned = await isProjectOwnedByUser(supabase, user.user_id, safeProjectId);
			if (!owned) {
				return Response.json({ error: "Project not found" }, { status: 404 });
			}
		}
		const ipAddress = getIpAddress(request);
		const now = new Date().toISOString();

		// Check existing row for upsert (ignore PGRST116 "no rows" - that's expected for insert)
		const { data: existing, error: selectError } = await supabase
			.from("sidebars")
			.select("id, sidebar_name, active_project_id")
			.eq("user_id", user.user_id)
			.eq("window_id", win.value)
			.maybeSingle();

		if (selectError) {
			return errorResponse(selectError);
		}

		let sidebar: Sidebar;
		/** `null` = successful insert path (always broadcast); else prior row for heartbeat-only broadcast skip */
		let priorForBroadcast: { sidebar_name: string; active_project_id: string | null } | null;

		if (existing) {
			priorForBroadcast = {
				sidebar_name: existing.sidebar_name,
				active_project_id: existing.active_project_id,
			};
			const { data: updated, error: updateError } = await supabase
				.from("sidebars")
				.update({
					sidebar_name: name.value,
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
			const { data: inserted, error: insertError } = await supabase
				.from("sidebars")
				.insert({
					user_id: user.user_id,
					window_id: win.value,
					sidebar_name: name.value,
					active_project_id: safeProjectId,
					last_seen: now,
					ip_address: ipAddress,
					updated_at: now,
				})
				.select()
				.single();

			if (insertError || !inserted) {
				if (!isUniqueViolation(insertError)) {
					return errorResponse(insertError);
				}
				// Concurrent register: another request inserted the same (user_id, window_id)
				const { data: raced, error: raceSelectError } = await supabase
					.from("sidebars")
					.select("id, sidebar_name, active_project_id")
					.eq("user_id", user.user_id)
					.eq("window_id", win.value)
					.maybeSingle();
				if (raceSelectError || !raced) {
					return errorResponse(insertError);
				}
				priorForBroadcast = {
					sidebar_name: raced.sidebar_name,
					active_project_id: raced.active_project_id,
				};
				const { data: updated, error: updateError } = await supabase
					.from("sidebars")
					.update({
						sidebar_name: name.value,
						active_project_id: safeProjectId,
						last_seen: now,
						ip_address: ipAddress,
						updated_at: now,
					})
					.eq("id", raced.id)
					.select()
					.single();
				if (updateError || !updated) {
					return errorResponse(updateError);
				}
				sidebar = updated as Sidebar;
			} else {
				priorForBroadcast = null;
				sidebar = inserted as Sidebar;
			}
		}

		// Notify other clients when the row set or visible fields change — not on pure last_seen/ip refresh.
		const shouldBroadcast =
			priorForBroadcast === null ||
			priorForBroadcast.sidebar_name !== name.value ||
			(priorForBroadcast.active_project_id ?? null) !== (safeProjectId ?? null);
		if (shouldBroadcast) {
			try {
				await broadcastListUpdatedToUser(user.user_id);
			} catch (broadcastErr) {
				console.error("[sidebars/register] Broadcast failed (registration still succeeded):", broadcastErr);
			}
		}

		const response = sidebarWithConnected(sidebar);
		return Response.json({ sidebar: response });
	} catch (err) {
		return errorResponse(err);
	}
}
