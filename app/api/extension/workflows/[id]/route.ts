import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Workflow, WorkflowUpdate } from "@/lib/types/workflows";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

async function workflowWithAddedBy(supabase: SupabaseClient, wf: Record<string, unknown>): Promise<Workflow> {
	const { data: addedBy } = await supabase
		.from("workflow_added_by")
		.select("user_id")
		.eq("workflow_id", wf.id as string);
	return {
		...wf,
		added_by: (addedBy ?? []).map((r) => ({ user_id: r.user_id })),
	} as Workflow;
}

async function userCanAccess(supabase: SupabaseClient, workflow: { created_by: string }, workflowId: string, userId: string): Promise<boolean> {
	if (workflow.created_by === userId) return true;
	const { data } = await supabase
		.from("workflow_added_by")
		.select("user_id")
		.eq("workflow_id", workflowId)
		.eq("user_id", userId)
		.single();
	return !!data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: workflow, error } = await supabase.from("workflows").select("*").eq("id", id).eq("archived", false).single();

	if (error || !workflow) {
		return Response.json({ error: error?.message ?? "Workflow not found" }, { status: 404 });
	}

	const canAccess = await userCanAccess(supabase, workflow as { created_by: string }, id, user.user_id);
	if (!canAccess) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	const result = await workflowWithAddedBy(supabase, workflow);
	return Response.json(result);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: existing } = await supabase.from("workflows").select("created_by").eq("id", id).single();
	if (!existing) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	const canAccess = await userCanAccess(supabase, existing, id, user.user_id);
	if (!canAccess) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	let body: WorkflowUpdate;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, workflow: workflowJson, private: priv, published, version, initial_version, added_by } = body;

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (name !== undefined) {
		if (typeof name !== "string" || !name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		updates.name = name.trim();
	}
	if (workflowJson !== undefined) {
		if (typeof workflowJson !== "object" || workflowJson === null) {
			return Response.json({ error: "workflow must be an object" }, { status: 400 });
		}
		updates.workflow = workflowJson;
	}
	if (priv !== undefined) updates.private = priv;
	if (published !== undefined) updates.published = published;
	if (version !== undefined) updates.version = version;
	if (initial_version !== undefined) updates.initial_version = initial_version;

	if (Object.keys(updates).length > 1) {
		await supabase.from("workflows").update(updates).eq("id", id);
	}

	if (added_by !== undefined) {
		await supabase.from("workflow_added_by").delete().eq("workflow_id", id);
		if (added_by.length > 0) {
			await supabase.from("workflow_added_by").insert(added_by.map((user_id) => ({ workflow_id: id, user_id })));
		}
	}

	const { data: workflow } = await supabase.from("workflows").select("*").eq("id", id).single();
	if (!workflow) {
		return Response.json({ error: "Failed to fetch updated workflow" }, { status: 500 });
	}

	const result = await workflowWithAddedBy(supabase, workflow);
	return Response.json(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: existing } = await supabase.from("workflows").select("created_by").eq("id", id).single();
	if (!existing) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	const canAccess = await userCanAccess(supabase, existing, id, user.user_id);
	if (!canAccess) {
		return Response.json({ error: "Workflow not found" }, { status: 404 });
	}

	await supabase.from("workflows").update({ archived: true, updated_at: new Date().toISOString() }).eq("id", id);
	return new Response(null, { status: 204 });
}
