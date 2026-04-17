import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";

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

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string; inviteId: string }> },
) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id, inviteId } = await params;
	const supabase = getSupabase();
	try {
		await assertProjectAccess(supabase, id, user.user_id, "owner");
	} catch (e) {
		return accessErrorResponse(e);
	}

	const { data: existing } = await supabase
		.from("project_invites")
		.select("id, role")
		.eq("id", inviteId)
		.eq("project_id", id)
		.maybeSingle();
	if (!existing) {
		return Response.json({ error: "Invite not found" }, { status: 404 });
	}

	const { error } = await supabase
		.from("project_invites")
		.update({ revoked_at: new Date().toISOString() })
		.eq("id", inviteId);

	if (error) return Response.json({ error: error.message }, { status: 500 });

	await recordProjectAudit(supabase, {
		projectId: id,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: "invite.revoked",
		targetType: "invite",
		targetId: inviteId,
		before: { role: existing.role },
	});

	return new Response(null, { status: 204 });
}
