import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { recordProjectAudit, resolveEditSource } from "@/lib/project-audit";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Redeem an invite token. Idempotent — if the user is already a member,
 * we just return their current role rather than overwriting it (so a viewer
 * who happens upon an editor invite doesn't get accidentally downgraded if
 * they re-click the link, and vice versa).
 */
export async function POST(
	request: NextRequest,
	{ params }: { params: Promise<{ token: string }> },
) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { token } = await params;
	if (!token) return Response.json({ error: "token is required" }, { status: 400 });

	const supabase = getSupabase();
	const { data: invite } = await supabase
		.from("project_invites")
		.select("id, project_id, role, expires_at, used_at, revoked_at")
		.eq("token", token)
		.maybeSingle();

	if (!invite) return Response.json({ error: "Invite not found" }, { status: 404 });
	if (invite.revoked_at) return Response.json({ error: "Invite has been revoked" }, { status: 410 });
	if (invite.used_at) return Response.json({ error: "Invite has already been used" }, { status: 410 });
	if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
		return Response.json({ error: "Invite has expired" }, { status: 410 });
	}

	const projectId = invite.project_id as string;
	const targetRole = invite.role as "owner" | "editor" | "viewer";

	const { data: existing } = await supabase
		.from("project_members")
		.select("role")
		.eq("project_id", projectId)
		.eq("user_id", user.user_id)
		.maybeSingle();

	if (!existing) {
		const { error } = await supabase.from("project_members").insert({
			project_id: projectId,
			user_id: user.user_id,
			role: targetRole,
			invited_by: invite.id ? null : null,
			updated_at: new Date().toISOString(),
		});
		if (error) return Response.json({ error: error.message }, { status: 500 });
	}

	await supabase
		.from("project_invites")
		.update({ used_at: new Date().toISOString(), used_by: user.user_id })
		.eq("id", invite.id);

	await recordProjectAudit(supabase, {
		projectId,
		actorUserId: user.user_id,
		source: resolveEditSource(request, "user"),
		action: existing ? "invite.accepted_existing_member" : "invite.accepted",
		targetType: "user",
		targetId: user.user_id,
		after: { role: existing?.role ?? targetRole },
	});

	return Response.json({
		ok: true,
		project_id: projectId,
		role: existing?.role ?? targetRole,
	});
}
