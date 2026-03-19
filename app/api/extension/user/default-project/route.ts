import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET: Return user's default project id.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("users")
		.select("default_project_id")
		.eq("id", user.user_id)
		.single();

	if (error || !data) {
		return Response.json({ error: "User not found" }, { status: 404 });
	}

	return Response.json({ default_project_id: data.default_project_id ?? null });
}

/**
 * PATCH: Set user's default project.
 * Body: { default_project_id: string | null }
 */
export async function PATCH(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { default_project_id?: string | null };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { default_project_id } = body;
	if (default_project_id !== undefined && default_project_id !== null) {
		if (typeof default_project_id !== "string" || !default_project_id.trim()) {
			return Response.json({ error: "default_project_id must be a valid UUID or null" }, { status: 400 });
		}
		// Verify project belongs to user
		const supabase = getSupabase();
		const { data: project } = await supabase
			.from("projects")
			.select("id")
			.eq("id", default_project_id.trim())
			.eq("user_id", user.user_id)
			.single();
		if (!project) {
			return Response.json({ error: "Project not found" }, { status: 404 });
		}
	}

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("users")
		.update({
			default_project_id: default_project_id === null || default_project_id === undefined ? null : default_project_id.trim(),
			updated_at: new Date().toISOString(),
		})
		.eq("id", user.user_id)
		.select("default_project_id")
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ default_project_id: data?.default_project_id ?? null });
}
