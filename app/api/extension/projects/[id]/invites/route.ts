import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError, type ProjectRole } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { generateInviteToken, listActiveInvites } from "@/lib/project-members";

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
		await assertProjectAccess(supabase, id, user.user_id, "owner");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const invites = await listActiveInvites(supabase, id);
	return Response.json({ invites });
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

	let body: { role?: ProjectRole; expires_in_hours?: number };
	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const role: ProjectRole = isAddableRole(body.role) ? body.role : "viewer";
	const expiresInHours =
		typeof body.expires_in_hours === "number" && body.expires_in_hours > 0
			? Math.min(body.expires_in_hours, 24 * 30)
			: null;
	const expiresAt = expiresInHours
		? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString()
		: null;

	const token = generateInviteToken();
	const { data, error } = await supabase
		.from("project_invites")
		.insert({
			project_id: id,
			role,
			token,
			created_by: user.user_id,
			expires_at: expiresAt,
		})
		.select("id, project_id, role, token, created_by, expires_at, created_at")
		.single();

	if (error || !data) {
		return Response.json({ error: error?.message ?? "Failed to create invite" }, { status: 500 });
	}

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "invite.created",
		targetType: "invite",
		targetId: data.id as string,
		after: { role, expires_at: expiresAt },
	});

	return Response.json({ ok: true, invite: data });
}
