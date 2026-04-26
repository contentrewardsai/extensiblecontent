import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getServiceSupabase } from "@/lib/supabase-service";

const SELECT_COLUMNS =
	"id, user_id, project_id, name, edit, default_env, is_builtin, source_path, created_at, updated_at";

const BUILTIN_READONLY_MESSAGE = "Built-in template is read-only; clone it first";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();
	// Built-ins are visible to every caller; user-owned rows only to the owner.
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select(SELECT_COLUMNS)
		.eq("id", id)
		.or(`user_id.eq.${user.user_id},is_builtin.eq.true`)
		.maybeSingle();

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
		.select("id, is_builtin")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.maybeSingle();

	if (!existing) {
		// Either the row doesn't exist, or it's a built-in / someone else's row.
		// Report 409 for built-ins (visible via GET) so the client knows to clone,
		// 404 otherwise.
		const { data: builtin } = await supabase
			.from("shotstack_templates")
			.select("id")
			.eq("id", id)
			.eq("is_builtin", true)
			.maybeSingle();
		if (builtin) return Response.json({ error: BUILTIN_READONLY_MESSAGE }, { status: 409 });
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	if (existing.is_builtin) {
		return Response.json({ error: BUILTIN_READONLY_MESSAGE }, { status: 409 });
	}

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
		.select(SELECT_COLUMNS)
		.single();

	if (error || !data) return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	return Response.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getServiceSupabase();

	// Built-ins surface via GET but must not be deletable by end users.
	const { data: builtin } = await supabase
		.from("shotstack_templates")
		.select("id")
		.eq("id", id)
		.eq("is_builtin", true)
		.maybeSingle();
	if (builtin) return Response.json({ error: BUILTIN_READONLY_MESSAGE }, { status: 409 });

	const { error } = await supabase.from("shotstack_templates").delete().eq("id", id).eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
