import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import type { Workflow, WorkflowInsert } from "@/lib/types/workflows";

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

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();

	const [{ data: addedRows }, { data: memberRows }] = await Promise.all([
		supabase.from("workflow_added_by").select("workflow_id").eq("user_id", user.user_id),
		supabase.from("project_members").select("project_id").eq("user_id", user.user_id),
	]);
	const addedIds = (addedRows ?? []).map((r) => r.workflow_id);
	const memberProjectIds = Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);

	// Build an OR filter spanning three sources:
	//   - workflows the caller created
	//   - workflows the caller was explicitly added to (workflow_added_by)
	//   - workflows attached to any project the caller is a member of
	// Each branch is appended only when the relevant id list is non-empty
	// to keep the PostgREST `or=` string clean.
	const orParts: string[] = [`created_by.eq.${user.user_id}`];
	if (addedIds.length > 0) orParts.push(`id.in.(${addedIds.join(",")})`);
	if (memberProjectIds.length > 0) orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	const orFilter = orParts.join(",");

	const { data: workflows, error } = await supabase
		.from("workflows")
		.select("*")
		.eq("archived", false)
		.or(orFilter)
		.order("updated_at", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const withAddedBy = await Promise.all((workflows ?? []).map((w) => workflowWithAddedBy(supabase, w)));
	return Response.json(withAddedBy);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: WorkflowInsert;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const {
		name,
		workflow: workflowJson,
		private: priv = true,
		published = false,
		approved = false,
		version = 1,
		initial_version = null,
		added_by = [],
	} = body;

	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}
	if (!workflowJson || typeof workflowJson !== "object") {
		return Response.json({ error: "workflow is required and must be an object" }, { status: 400 });
	}

	const supabase = getSupabase();

	// Optional `project_id`: if present, the caller must have at least
	// editor access on that project. Validates the FK in app code so we can
	// return a clean 403/404 instead of a Postgres FK violation.
	let projectId: string | null = null;
	if (typeof body.project_id === "string" && body.project_id.trim()) {
		try {
			const membership = await assertProjectAccess(
				supabase,
				body.project_id.trim(),
				user.user_id,
				"editor",
			);
			projectId = membership.projectId;
		} catch (err) {
			if (err instanceof ProjectAccessError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			throw err;
		}
	}

	// Opaque JSON: persist full `workflow` without stripping nested keys (e.g. analyzed.actions[].comment).
	// See docs/BACKEND_IMPLEMENTATION_PROMPT.md and lib/workflow-json-contract.ts.
	const insertRow: Record<string, unknown> = {
		created_by: user.user_id,
		name: name.trim(),
		workflow: workflowJson,
		private: priv,
		published,
		approved,
		version,
		initial_version,
		project_id: projectId,
		updated_at: new Date().toISOString(),
	};
	if (body.id) insertRow.id = body.id;

	const { data: workflow, error: insertError } = await supabase.from("workflows").insert(insertRow).select().single();

	if (insertError || !workflow) {
		return Response.json({ error: insertError?.message ?? "Failed to create workflow" }, { status: 500 });
	}

	const workflowId = workflow.id as string;
	const allAddedBy = [user.user_id, ...added_by.filter((id) => id !== user.user_id)];
	const uniqueAddedBy = [...new Set(allAddedBy)];

	if (uniqueAddedBy.length > 0) {
		await supabase.from("workflow_added_by").insert(uniqueAddedBy.map((user_id) => ({ workflow_id: workflowId, user_id })));
	}

	const result = await workflowWithAddedBy(supabase, workflow);
	return Response.json(result);
}
