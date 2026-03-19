import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Project, ProjectInsert } from "@/lib/types/projects";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

async function projectWithJoins(supabase: SupabaseClient, project: { id: string; user_id: string; name: string; created_at: string; updated_at: string }) {
	const [industriesRes, platformsRes, monetizationRes] = await Promise.all([
		supabase.from("project_industries").select("industry_id, industries(id, name, created_at)").eq("project_id", project.id),
		supabase.from("project_platforms").select("platform_id, platforms(id, name, slug, created_at)").eq("project_id", project.id),
		supabase.from("project_monetization").select("monetization_id, monetization_options(id, name, slug, created_at)").eq("project_id", project.id),
	]);

	const industries = (industriesRes.data ?? []).flatMap((r: { industries: unknown }) =>
		Array.isArray(r.industries) ? r.industries : r.industries ? [r.industries] : []
	);
	const platforms = (platformsRes.data ?? []).flatMap((r: { platforms: unknown }) =>
		Array.isArray(r.platforms) ? r.platforms : r.platforms ? [r.platforms] : []
	);
	const monetization = (monetizationRes.data ?? []).flatMap((r: { monetization_options: unknown }) =>
		Array.isArray(r.monetization_options) ? r.monetization_options : r.monetization_options ? [r.monetization_options] : []
	);

	return {
		...project,
		industries,
		platforms,
		monetization,
	} as Project;
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const { data: projects, error } = await supabase.from("projects").select("*").eq("user_id", user.user_id).order("updated_at", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const withJoins = await Promise.all((projects ?? []).map((p) => projectWithJoins(supabase, p)));
	return Response.json(withJoins);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: ProjectInsert;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, industry_ids = [], platform_ids = [], monetization_ids = [] } = body;
	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const { data: project, error: projectError } = await supabase
		.from("projects")
		.insert({ user_id: user.user_id, name: name.trim(), updated_at: new Date().toISOString() })
		.select()
		.single();

	if (projectError || !project) {
		return Response.json({ error: projectError?.message ?? "Failed to create project" }, { status: 500 });
	}

	const projectId = project.id;

	if (industry_ids.length > 0) {
		await supabase.from("project_industries").insert(industry_ids.map((industry_id) => ({ project_id: projectId, industry_id })));
	}
	if (platform_ids.length > 0) {
		await supabase.from("project_platforms").insert(platform_ids.map((platform_id) => ({ project_id: projectId, platform_id })));
	}
	if (monetization_ids.length > 0) {
		await supabase.from("project_monetization").insert(monetization_ids.map((monetization_id) => ({ project_id: projectId, monetization_id })));
	}

	const result = await projectWithJoins(supabase, project);
	return Response.json(result);
}
