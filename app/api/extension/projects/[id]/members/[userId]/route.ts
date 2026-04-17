import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError, type ProjectRole } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";
import { isLastOwner } from "@/lib/project-members";

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

function isValidRole(role: unknown): role is ProjectRole {
	return role === "owner" || role === "editor" || role === "viewer";
}

export async function PATCH(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string; userId: string }> },
) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id, userId: targetUserId } = await params;
	const supabase = getSupabase();
	try {
		await assertProjectAccess(supabase, id, user.user_id, "owner");
	} catch (e) {
		return accessErrorResponse(e);
	}

	let body: { role?: ProjectRole };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!isValidRole(body.role)) {
		return Response.json({ error: "role must be owner|editor|viewer" }, { status: 400 });
	}

	const { data: existing } = await supabase
		.from("project_members")
		.select("role")
		.eq("project_id", id)
		.eq("user_id", targetUserId)
		.maybeSingle();
	if (!existing) {
		return Response.json({ error: "Member not found" }, { status: 404 });
	}

	if (existing.role === "owner" && body.role !== "owner") {
		if (await isLastOwner(supabase, id, targetUserId)) {
			return Response.json({ error: "Cannot demote the only owner" }, { status: 400 });
		}
	}

	const { error } = await supabase
		.from("project_members")
		.update({ role: body.role, updated_at: new Date().toISOString() })
		.eq("project_id", id)
		.eq("user_id", targetUserId);

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	// If promoting to owner, also flip projects.owner_id (trigger keeps the
	// previous owner as editor and updates this row to owner).
	if (body.role === "owner") {
		await supabase.from("projects").update({ owner_id: targetUserId, updated_at: new Date().toISOString() }).eq("id", id);
	}

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "member.role_changed",
		targetType: "user",
		targetId: targetUserId,
		before: { role: existing.role },
		after: { role: body.role },
	});

	return Response.json({ ok: true, user_id: targetUserId, role: body.role });
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string; userId: string }> },
) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id, userId: targetUserId } = await params;
	const supabase = getSupabase();

	// A user can always remove themselves (leave); otherwise must be owner.
	const required = targetUserId === user.user_id ? "viewer" : "owner";
	try {
		await assertProjectAccess(supabase, id, user.user_id, required);
	} catch (e) {
		return accessErrorResponse(e);
	}

	const { data: existing } = await supabase
		.from("project_members")
		.select("role")
		.eq("project_id", id)
		.eq("user_id", targetUserId)
		.maybeSingle();
	if (!existing) {
		return Response.json({ error: "Member not found" }, { status: 404 });
	}

	if (existing.role === "owner" && (await isLastOwner(supabase, id, targetUserId))) {
		return Response.json({ error: "Cannot remove the only owner" }, { status: 400 });
	}

	const { error } = await supabase
		.from("project_members")
		.delete()
		.eq("project_id", id)
		.eq("user_id", targetUserId);

	if (error) return Response.json({ error: error.message }, { status: 500 });

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: targetUserId === user.user_id ? "member.left" : "member.removed",
		targetType: "user",
		targetId: targetUserId,
		before: { role: existing.role },
	});

	return new Response(null, { status: 204 });
}
