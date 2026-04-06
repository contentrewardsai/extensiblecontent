import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { broadcastListUpdatedToUser } from "@/lib/realtime-broadcast";
import type { Sidebar, SidebarUpdateBody } from "@/lib/types/sidebars";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: sidebar, error } = await supabase
		.from("sidebars")
		.select("*")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !sidebar) {
		return Response.json({ error: "Sidebar not found" }, { status: 404 });
	}

	return Response.json(sidebar as Sidebar);
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

	let body: SidebarUpdateBody = {};
	try {
		const raw = await request.json();
		if (raw && typeof raw === "object") body = raw as SidebarUpdateBody;
	} catch {
		// Empty or invalid body — still refresh last_seen (heartbeat via PATCH with no body)
	}

	const now = new Date().toISOString();
	const updates: Record<string, unknown> = {
		updated_at: now,
		last_seen: now,
	};

	if (body.sidebar_name !== undefined) {
		if (typeof body.sidebar_name !== "string") {
			return Response.json({ error: "sidebar_name must be a string" }, { status: 400 });
		}
		// Empty string = skip update (keep existing name)
		if (body.sidebar_name.trim()) {
			updates.sidebar_name = body.sidebar_name.trim();
		}
	}
	if (body.active_project_id !== undefined) {
		updates.active_project_id = body.active_project_id ?? null;
	}

	/** Heartbeat-only PATCH (ExtensibleContentExtension fallback when MCP is off) must touch last_seen. */
	const shouldBroadcastList =
		(body.sidebar_name !== undefined &&
			typeof body.sidebar_name === "string" &&
			body.sidebar_name.trim() !== "") ||
		body.active_project_id !== undefined;

	const { data: sidebar, error } = await supabase
		.from("sidebars")
		.update(updates)
		.eq("id", id)
		.select()
		.single();

	if (error || !sidebar) {
		return Response.json({ error: error?.message ?? "Failed to update sidebar" }, { status: 500 });
	}

	if (shouldBroadcastList) {
		await broadcastListUpdatedToUser(user.user_id);
	}

	return Response.json(sidebar as Sidebar);
}
