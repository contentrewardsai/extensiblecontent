import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError, type ProjectRole } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { listProjectMembers, resolveUserIdentifier } from "@/lib/project-members";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function accessErrorResponse(e: unknown) {
	if (e instanceof ProjectAccessError) {
		return Response.json({ error: e.message }, { status: e.status });
	}
	return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
}

function isAddableRole(role: unknown): role is "editor" | "viewer" {
	return role === "editor" || role === "viewer";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	try {
		await assertProjectAccess(supabase, id, user.user_id, "viewer");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const members = await listProjectMembers(supabase, id);
	return Response.json({ members });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	try {
		await assertProjectAccess(supabase, id, user.user_id, "owner");
	} catch (e) {
		return accessErrorResponse(e);
	}

	let body: { identifier?: string; role?: ProjectRole };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const identifier = (body.identifier ?? "").trim();
	const role: ProjectRole = isAddableRole(body.role) ? body.role : "viewer";
	if (!identifier) {
		return Response.json({ error: "identifier is required" }, { status: 400 });
	}

	const resolved = await resolveUserIdentifier(supabase, identifier);
	if (!resolved.ok) {
		return Response.json({ error: resolved.error }, { status: resolved.status });
	}

	if (resolved.userId === user.user_id) {
		return Response.json({ error: "You're already the owner of this project." }, { status: 400 });
	}

	const { data: existing } = await supabase
		.from("project_members")
		.select("role")
		.eq("project_id", id)
		.eq("user_id", resolved.userId)
		.maybeSingle();

	if (existing?.role === "owner") {
		return Response.json({ error: "User is the project owner." }, { status: 400 });
	}

	const { error } = await supabase
		.from("project_members")
		.upsert(
			{
				project_id: id,
				user_id: resolved.userId,
				role,
				invited_by: user.user_id,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "project_id,user_id" },
		);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: existing ? "member.role_changed" : "member.added",
		targetType: "user",
		targetId: resolved.userId,
		before: existing ? { role: existing.role } : null,
		after: { role },
	});

	return Response.json({ ok: true, user_id: resolved.userId, role });
}
