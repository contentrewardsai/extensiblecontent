import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { getServiceSupabase } from "@/lib/supabase-service";

const SELECT_COLUMNS = "id, user_id, project_id, name, edit, default_env, created_at, updated_at";

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();

	// Project-shared templates: include rows owned by the caller AND rows
	// attached to any project the caller is a member of (paying owner or
	// invited collaborator alike).
	const { data: memberRows } = await supabase
		.from("project_members")
		.select("project_id")
		.eq("user_id", user.user_id);
	const memberProjectIds = Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);

	const orParts: string[] = [`user_id.eq.${user.user_id}`];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}

	const { data, error } = await supabase
		.from("shotstack_templates")
		.select(SELECT_COLUMNS)
		.or(orParts.join(","))
		.order("updated_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json(data ?? []);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		name: string;
		edit?: Record<string, unknown>;
		default_env?: string;
		project_id?: string | null;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const edit = body.edit && typeof body.edit === "object" ? body.edit : {};
	const default_env = body.default_env === "stage" || body.default_env === "v1" ? body.default_env : "v1";

	const supabase = getServiceSupabase();

	// Optional `project_id`: caller needs editor access to share the
	// template into a project. Same pattern as workflows POST.
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

	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: user.user_id,
			project_id: projectId,
			name: body.name.trim(),
			edit,
			default_env,
			updated_at: now,
		})
		.select(SELECT_COLUMNS)
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Failed to create template" }, { status: 500 });
	}

	return Response.json(row);
}
