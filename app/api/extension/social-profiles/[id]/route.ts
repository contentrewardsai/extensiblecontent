import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

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
	const { data, error } = await supabase
		.from("social_profiles")
		.select("*")
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
	let body: { name?: string; platform?: string; profile_url?: string } = {};
	try {
		const raw = await request.json();
		if (raw && typeof raw === "object") body = raw;
	} catch {
		// empty body ok
	}

	const supabase = getSupabase();
	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || !body.name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		updates.name = body.name.trim();
	}
	if (body.platform !== undefined) updates.platform = body.platform?.trim() ?? null;
	if (body.profile_url !== undefined) updates.profile_url = body.profile_url?.trim() ?? null;

	if (Object.keys(updates).length <= 1) {
		const { data: current } = await supabase
			.from("social_profiles")
			.select("*")
			.eq("id", id)
			.eq("user_id", user.user_id)
			.single();
		if (current) return Response.json(current);
	}

	const { data, error } = await supabase
		.from("social_profiles")
		.update(updates)
		.eq("id", id)
		.eq("user_id", user.user_id)
		.select()
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	if (!data) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { error } = await supabase.from("social_profiles").delete().eq("id", id).eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ success: true });
}
