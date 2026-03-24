import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("generator_templates")
		.select("id, user_id, name, payload, created_at, updated_at")
		.eq("user_id", user.user_id)
		.order("updated_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(data ?? []);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { name: string; payload?: Record<string, unknown> };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

	const supabase = getServiceSupabase();
	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("generator_templates")
		.insert({
			user_id: user.user_id,
			name: body.name.trim(),
			payload,
			updated_at: now,
		})
		.select("id, user_id, name, payload, created_at, updated_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Failed to create template" }, { status: 500 });
	}

	return Response.json(row);
}
