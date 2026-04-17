import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { normalizeQuotaInput, ProjectQuotaError } from "@/lib/project-quota";
import type { Project, ProjectUpdate } from "@/lib/types/projects";

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

function accessErrorResponse(e: unknown) {
	if (e instanceof ProjectAccessError) {
		return Response.json({ error: e.message }, { status: e.status });
	}
	const message = e instanceof Error ? e.message : "Failed";
	return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	let membership: Awaited<ReturnType<typeof assertProjectAccess>>;
	try {
		membership = await assertProjectAccess(supabase, id, user.user_id, "viewer");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const { data: project, error } = await supabase
		.from("projects")
		.select("id, user_id, owner_id, name, description, quota_bytes, created_at, updated_at")
		.eq("id", id)
		.single();

	if (error || !project) {
		return Response.json({ error: error?.message ?? "Project not found" }, { status: 404 });
	}

	const result = await projectWithJoins(supabase, project as ProjectRow, membership.role);
	return Response.json(result);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	let body: ProjectUpdate;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, description, quota_bytes, industry_ids, platform_ids, monetization_ids } = body;

	// Quota changes are owner-only; other field tweaks need editor.
	const requiresOwner = quota_bytes !== undefined;
	let membership: Awaited<ReturnType<typeof assertProjectAccess>>;
	try {
		membership = await assertProjectAccess(supabase, id, user.user_id, requiresOwner ? "owner" : "editor");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const { data: existing } = await supabase
		.from("projects")
		.select("id, name, description, quota_bytes")
		.eq("id", id)
		.maybeSingle();
	if (!existing) {
		return Response.json({ error: "Project not found" }, { status: 404 });
	}

	const before = {
		name: existing.name,
		description: existing.description,
		quota_bytes: existing.quota_bytes,
	};
	const after: Record<string, unknown> = {};

	const updates: Record<string, unknown> = {};
	if (name !== undefined) {
		if (typeof name !== "string" || !name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		updates.name = name.trim();
		after.name = updates.name;
	}
	if (description !== undefined) {
		updates.description = typeof description === "string" ? description.trim() || null : null;
		after.description = updates.description;
	}
	if (quota_bytes !== undefined) {
		try {
			updates.quota_bytes = normalizeQuotaInput(quota_bytes);
		} catch (e) {
			const status = e instanceof ProjectQuotaError ? e.status : 400;
			return Response.json({ error: e instanceof Error ? e.message : "invalid quota_bytes" }, { status });
		}
		after.quota_bytes = updates.quota_bytes;
	}

	if (Object.keys(updates).length > 0) {
		updates.updated_at = new Date().toISOString();
		await supabase.from("projects").update(updates).eq("id", id);
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

	if (Object.keys(after).length > 0) {
		await recordProjectAudit(supabase, {
			projectId: id,
			actorUserId: user.user_id,
			source: resolveEditSource(request, "user"),
			action: quota_bytes !== undefined ? "project.quota_changed" : "project.updated",
			targetType: "project",
			targetId: id,
			before,
			after,
		});
	}

	const { data: project } = await supabase
		.from("projects")
		.select("id, user_id, owner_id, name, description, quota_bytes, created_at, updated_at")
		.eq("id", id)
		.single();
	if (!project) {
		return Response.json({ error: "Failed to fetch updated project" }, { status: 500 });
	}

	const result = await projectWithJoins(supabase, project as ProjectRow, membership.role);
	return Response.json(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	try {
		await assertProjectAccess(supabase, id, user.user_id, "owner");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const { data: existing } = await supabase
		.from("projects")
		.select("id, name")
		.eq("id", id)
		.maybeSingle();
	if (!existing) {
		return Response.json({ error: "Project not found" }, { status: 404 });
	}

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "project.deleted",
		targetType: "project",
		targetId: id,
		before: { name: existing.name },
	});

	await supabase.from("projects").delete().eq("id", id);
	return new Response(null, { status: 204 });
}
