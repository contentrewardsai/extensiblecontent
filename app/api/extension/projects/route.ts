import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { listAccessibleProjects } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { normalizeQuotaInput, ProjectQuotaError } from "@/lib/project-quota";
import type { Project, ProjectInsert } from "@/lib/types/projects";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

interface ProjectRow {
	id: string;
	user_id?: string | null;
	owner_id: string;
	name: string;
	description?: string | null;
	quota_bytes?: number | null;
	created_at: string;
	updated_at: string;
}

async function projectWithJoins(
	supabase: SupabaseClient,
	project: ProjectRow,
	role?: "owner" | "editor" | "viewer",
) {
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
		// Keep `user_id` populated for legacy callers that haven't migrated yet.
		user_id: project.owner_id,
		owner_id: project.owner_id,
		description: project.description ?? null,
		quota_bytes: project.quota_bytes ?? null,
		industries,
		platforms,
		monetization,
		...(role ? { role } : {}),
	} as Project;
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const accessible = await listAccessibleProjects(supabase, user.user_id);
	if (accessible.length === 0) return Response.json([]);

	const ids = accessible.map((a) => a.id);
	const { data: rows, error } = await supabase
		.from("projects")
		.select("id, user_id, owner_id, name, description, quota_bytes, created_at, updated_at")
		.in("id", ids);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const roleByProject = new Map(accessible.map((a) => [a.id, a.role]));
	const withJoins = await Promise.all(
		(rows ?? []).map((p) => projectWithJoins(supabase, p as ProjectRow, roleByProject.get(p.id as string))),
	);
	withJoins.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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

	const { name, description, quota_bytes, industry_ids = [], platform_ids = [], monetization_ids = [] } = body;
	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	let normalizedQuota: number | null = null;
	try {
		normalizedQuota = normalizeQuotaInput(quota_bytes ?? null);
	} catch (e) {
		const status = e instanceof ProjectQuotaError ? e.status : 400;
		return Response.json({ error: e instanceof Error ? e.message : "invalid quota_bytes" }, { status });
	}

	const supabase = getSupabase();
	const { data: project, error: projectError } = await supabase
		.from("projects")
		.insert({
			user_id: user.user_id,
			owner_id: user.user_id,
			name: name.trim(),
			description: description?.trim() || null,
			quota_bytes: normalizedQuota,
			updated_at: new Date().toISOString(),
		})
		.select("id, user_id, owner_id, name, description, quota_bytes, created_at, updated_at")
		.single();

	if (projectError || !project) {
		return Response.json({ error: projectError?.message ?? "Failed to create project" }, { status: 500 });
	}

	const projectId = project.id as string;

	if (industry_ids.length > 0) {
		await supabase.from("project_industries").insert(industry_ids.map((industry_id) => ({ project_id: projectId, industry_id })));
	}
	if (platform_ids.length > 0) {
		await supabase.from("project_platforms").insert(platform_ids.map((platform_id) => ({ project_id: projectId, platform_id })));
	}
	if (monetization_ids.length > 0) {
		await supabase.from("project_monetization").insert(monetization_ids.map((monetization_id) => ({ project_id: projectId, monetization_id })));
	}

	await recordProjectAudit(supabase, {
		projectId,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "project.created",
		targetType: "project",
		targetId: projectId,
		after: { name: name.trim(), description: description ?? null, quota_bytes: normalizedQuota },
	});

	const result = await projectWithJoins(supabase, project as ProjectRow, "owner");
	return Response.json(result);
}
