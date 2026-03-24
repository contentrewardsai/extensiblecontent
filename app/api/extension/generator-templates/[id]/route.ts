import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("generator_templates")
		.select("id, user_id, name, payload, created_at, updated_at")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !data) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	let body: { name?: string; payload?: Record<string, unknown> };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("generator_templates")
		.select("id")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || !body.name.trim()) {
			return Response.json({ error: "name must be non-empty" }, { status: 400 });
		}
		updates.name = body.name.trim();
	}
	if (body.payload !== undefined) {
		if (!body.payload || typeof body.payload !== "object") {
			return Response.json({ error: "payload must be an object" }, { status: 400 });
		}
		updates.payload = body.payload;
	}

	const { data, error } = await supabase
		.from("generator_templates")
		.update(updates)
		.eq("id", id)
		.eq("user_id", user.user_id)
		.select("id, user_id, name, payload, created_at, updated_at")
		.single();

	if (error || !data) return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	return Response.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();
	const { error } = await supabase.from("generator_templates").delete().eq("id", id).eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
