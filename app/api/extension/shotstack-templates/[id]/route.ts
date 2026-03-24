import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select("id, user_id, name, edit, default_env, created_at, updated_at")
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
	let body: { name?: string; edit?: Record<string, unknown>; default_env?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("shotstack_templates")
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
	if (body.edit !== undefined) {
		if (!body.edit || typeof body.edit !== "object") {
			return Response.json({ error: "edit must be an object" }, { status: 400 });
		}
		updates.edit = body.edit;
	}
	if (body.default_env !== undefined) {
		if (body.default_env !== "stage" && body.default_env !== "v1") {
			return Response.json({ error: "default_env must be stage or v1" }, { status: 400 });
		}
		updates.default_env = body.default_env;
	}

	const { data, error } = await supabase
		.from("shotstack_templates")
		.update(updates)
		.eq("id", id)
		.eq("user_id", user.user_id)
		.select("id, user_id, name, edit, default_env, created_at, updated_at")
		.single();

	if (error || !data) return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	return Response.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();
	const { error } = await supabase.from("shotstack_templates").delete().eq("id", id).eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
