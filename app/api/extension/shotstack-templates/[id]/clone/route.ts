import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { getServiceSupabase } from "@/lib/supabase-service";

const SELECT_COLUMNS =
	"id, user_id, project_id, name, edit, default_env, is_builtin, source_path, created_at, updated_at";

/**
 * POST /api/extension/shotstack-templates/[id]/clone
 *
 * Duplicates a template the caller can see (their own row, a row in a project
 * they're a member of, or a built-in starter) into a new row owned by the
 * caller. The resulting row is always `is_builtin = false`.
 *
 * Optional body:
 *   - `name`: override the cloned template's name (default: "<source name> (copy)").
 *   - `project_id`: attach the clone to a project the caller has editor access to.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;

	let body: { name?: string; project_id?: string | null } = {};
	try {
		const text = await request.text();
		body = text ? JSON.parse(text) : {};
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	// Caller must be able to see the source: owner, project member, or built-in.
	const { data: memberRows } = await supabase
		.from("project_members")
		.select("project_id")
		.eq("user_id", user.user_id);
	const memberProjectIds = Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((pid): pid is string => typeof pid === "string" && pid.length > 0),
		),
	);

	const orParts: string[] = [`user_id.eq.${user.user_id}`, "is_builtin.eq.true"];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}

	const { data: source, error: sourceErr } = await supabase
		.from("shotstack_templates")
		.select("id, name, edit, default_env")
		.eq("id", id)
		.or(orParts.join(","))
		.maybeSingle();

	if (sourceErr || !source) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

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

	const overrideName = typeof body.name === "string" ? body.name.trim() : "";
	const defaultCopyName = `${source.name} (copy)`;
	const name = overrideName || defaultCopyName;

	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: user.user_id,
			project_id: projectId,
			name,
			edit: source.edit ?? {},
			default_env: source.default_env ?? "v1",
			is_builtin: false,
			source_path: null,
			updated_at: now,
		})
		.select(SELECT_COLUMNS)
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Failed to clone template" }, { status: 500 });
	}

	return Response.json(row);
}
