import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select("id, user_id, name, edit, default_env, created_at, updated_at")
		.eq("user_id", user.user_id)
		.order("updated_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(data ?? []);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { name: string; edit?: Record<string, unknown>; default_env?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const edit = body.edit && typeof body.edit === "object" ? body.edit : {};
	const default_env = body.default_env === "stage" || body.default_env === "v1" ? body.default_env : "v1";

	const supabase = getServiceSupabase();
	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: user.user_id,
			name: body.name.trim(),
			edit,
			default_env,
			updated_at: now,
		})
		.select("id, user_id, name, edit, default_env, created_at, updated_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Failed to create template" }, { status: 500 });
	}

	return Response.json(row);
}
