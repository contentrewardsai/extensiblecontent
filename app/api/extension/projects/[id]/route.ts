import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Project, ProjectUpdate } from "@/lib/types/projects";

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();
	const { data: project, error } = await supabase.from("projects").select("*").eq("id", id).eq("user_id", user.user_id).single();

	if (error || !project) {
		return Response.json({ error: error?.message ?? "Project not found" }, { status: 404 });
	}

	const result = await projectWithJoins(supabase, project);
	return Response.json(result);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: existing } = await supabase.from("projects").select("id").eq("id", id).eq("user_id", user.user_id).single();
	if (!existing) {
		return Response.json({ error: "Project not found" }, { status: 404 });
	}

	let body: ProjectUpdate;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, industry_ids, platform_ids, monetization_ids } = body;

	if (name !== undefined) {
		if (typeof name !== "string" || !name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		await supabase.from("projects").update({ name: name.trim(), updated_at: new Date().toISOString() }).eq("id", id);
	}

	if (industry_ids !== undefined) {
		await supabase.from("project_industries").delete().eq("project_id", id);
		if (industry_ids.length > 0) {
			await supabase.from("project_industries").insert(industry_ids.map((industry_id) => ({ project_id: id, industry_id })));
		}
	}
	if (platform_ids !== undefined) {
		await supabase.from("project_platforms").delete().eq("project_id", id);
		if (platform_ids.length > 0) {
			await supabase.from("project_platforms").insert(platform_ids.map((platform_id) => ({ project_id: id, platform_id })));
		}
	}
	if (monetization_ids !== undefined) {
		await supabase.from("project_monetization").delete().eq("project_id", id);
		if (monetization_ids.length > 0) {
			await supabase.from("project_monetization").insert(monetization_ids.map((monetization_id) => ({ project_id: id, monetization_id })));
		}
	}

	const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
	if (!project) {
		return Response.json({ error: "Failed to fetch updated project" }, { status: 500 });
	}

	const result = await projectWithJoins(supabase, project);
	return Response.json(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: existing } = await supabase.from("projects").select("id").eq("id", id).eq("user_id", user.user_id).single();
	if (!existing) {
		return Response.json({ error: "Project not found" }, { status: 404 });
	}

	await supabase.from("projects").delete().eq("id", id);
	return new Response(null, { status: 204 });
}
