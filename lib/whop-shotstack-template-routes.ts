import { assertProjectAccess, ProjectAccessError } from "@/lib/project-access";
import { getServiceSupabase } from "@/lib/supabase-service";

export const SHOTSTACK_TEMPLATE_SELECT =
	"id, user_id, project_id, name, edit, default_env, is_builtin, source_path, created_at, updated_at";

const BUILTIN_READONLY = "Built-in template is read-only; clone it first";

export function shotstackListOrFilter(userId: string, memberProjectIds: string[]) {
	const orParts: string[] = [`user_id.eq.${userId}`, "is_builtin.eq.true"];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}
	return orParts.join(",");
}

export async function getMemberProjectIdsForUser(userId: string) {
	const supabase = getServiceSupabase();
	const { data: memberRows } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
	return Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);
}

/**
 * Whop / experience cookie routes: list templates for the internal user (same rules as extension).
 */
export async function listTemplatesForWhopUser(internalUserId: string) {
	const supabase = getServiceSupabase();
	const memberProjectIds = await getMemberProjectIdsForUser(internalUserId);
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select(SHOTSTACK_TEMPLATE_SELECT)
		.or(shotstackListOrFilter(internalUserId, memberProjectIds))
		.order("updated_at", { ascending: false });
	if (error) return { ok: false as const, status: 500, error: error.message };
	return { ok: true as const, data: data ?? [] };
}

export async function getTemplateByIdForWhopUser(internalUserId: string, id: string) {
	const supabase = getServiceSupabase();
	// Match extension `GET /api/extension/shotstack-templates/:id` visibility (owner, built-in).
	const { data, error } = await supabase
		.from("shotstack_templates")
		.select(SHOTSTACK_TEMPLATE_SELECT)
		.eq("id", id)
		.or(`user_id.eq.${internalUserId},is_builtin.eq.true`)
		.maybeSingle();
	if (error) return { ok: false as const, status: 500, error: error.message };
	if (!data) return { ok: false as const, status: 404, error: "Not found" };
	return { ok: true as const, data };
}

export async function createTemplateForWhopUser(
	internalUserId: string,
	body: { name: string; edit?: Record<string, unknown>; default_env?: string; project_id?: string | null },
) {
	if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
		return { ok: false as const, status: 400, error: "name is required" };
	}
	const edit = body.edit && typeof body.edit === "object" ? body.edit : {};
	const default_env = body.default_env === "stage" || body.default_env === "v1" ? body.default_env : "v1";
	const supabase = getServiceSupabase();
	let projectId: string | null = null;
	if (typeof body.project_id === "string" && body.project_id.trim()) {
		try {
			const membership = await assertProjectAccess(supabase, body.project_id.trim(), internalUserId, "editor");
			projectId = membership.projectId;
		} catch (err) {
			if (err instanceof ProjectAccessError) {
				return { ok: false as const, status: err.status, error: err.message };
			}
			throw err;
		}
	}
	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: internalUserId,
			project_id: projectId,
			name: body.name.trim(),
			edit,
			default_env,
			is_builtin: false,
			source_path: null,
			updated_at: now,
		})
		.select(SHOTSTACK_TEMPLATE_SELECT)
		.single();
	if (error || !row) {
		return { ok: false as const, status: 500, error: error?.message ?? "Failed to create template" };
	}
	return { ok: true as const, data: row };
}

export async function patchTemplateForWhopUser(
	internalUserId: string,
	id: string,
	body: { name?: string; edit?: Record<string, unknown>; default_env?: string },
) {
	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("shotstack_templates")
		.select("id, is_builtin")
		.eq("id", id)
		.eq("user_id", internalUserId)
		.maybeSingle();

	if (!existing) {
		const { data: builtin } = await supabase
			.from("shotstack_templates")
			.select("id")
			.eq("id", id)
			.eq("is_builtin", true)
			.maybeSingle();
		if (builtin) return { ok: false as const, status: 409, error: BUILTIN_READONLY };
		return { ok: false as const, status: 404, error: "Not found" };
	}

	if (existing.is_builtin) {
		return { ok: false as const, status: 409, error: BUILTIN_READONLY };
	}

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || !body.name.trim()) {
			return { ok: false as const, status: 400, error: "name must be non-empty" };
		}
		updates.name = body.name.trim();
	}
	if (body.edit !== undefined) {
		if (!body.edit || typeof body.edit !== "object") {
			return { ok: false as const, status: 400, error: "edit must be an object" };
		}
		updates.edit = body.edit;
	}
	if (body.default_env !== undefined) {
		if (body.default_env !== "stage" && body.default_env !== "v1") {
			return { ok: false as const, status: 400, error: "default_env must be stage or v1" };
		}
		updates.default_env = body.default_env;
	}

	const { data, error } = await supabase
		.from("shotstack_templates")
		.update(updates)
		.eq("id", id)
		.eq("user_id", internalUserId)
		.select(SHOTSTACK_TEMPLATE_SELECT)
		.single();

	if (error || !data) {
		return { ok: false as const, status: 500, error: error?.message ?? "Update failed" };
	}
	return { ok: true as const, data };
}

export async function deleteTemplateForWhopUser(internalUserId: string, id: string) {
	const supabase = getServiceSupabase();
	const { data: builtin } = await supabase
		.from("shotstack_templates")
		.select("id")
		.eq("id", id)
		.eq("is_builtin", true)
		.maybeSingle();
	if (builtin) {
		return { ok: false as const, status: 409, error: BUILTIN_READONLY };
	}
	const { error } = await supabase.from("shotstack_templates").delete().eq("id", id).eq("user_id", internalUserId);
	if (error) return { ok: false as const, status: 500, error: error.message };
	return { ok: true as const };
}

export async function cloneTemplateForWhopUser(
	internalUserId: string,
	id: string,
	overrides: { name?: string; project_id?: string | null },
) {
	const supabase = getServiceSupabase();
	const memberProjectIds = await getMemberProjectIdsForUser(internalUserId);
	const orFilter = shotstackListOrFilter(internalUserId, memberProjectIds);

	const { data: source, error: sourceErr } = await supabase
		.from("shotstack_templates")
		.select("id, name, edit, default_env")
		.eq("id", id)
		.or(orFilter)
		.maybeSingle();

	if (sourceErr || !source) {
		return { ok: false as const, status: 404, error: "Not found" };
	}

	let projectId: string | null = null;
	if (typeof overrides.project_id === "string" && overrides.project_id.trim()) {
		try {
			const membership = await assertProjectAccess(
				supabase,
				overrides.project_id.trim(),
				internalUserId,
				"editor",
			);
			projectId = membership.projectId;
		} catch (err) {
			if (err instanceof ProjectAccessError) {
				return { ok: false as const, status: err.status, error: err.message };
			}
			throw err;
		}
	}

	const name =
		typeof overrides.name === "string" && overrides.name.trim() ? overrides.name.trim() : `${source.name} (copy)`;
	const now = new Date().toISOString();
	const { data: row, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: internalUserId,
			project_id: projectId,
			name,
			edit: source.edit ?? {},
			default_env: source.default_env === "stage" ? "stage" : "v1",
			is_builtin: false,
			source_path: null,
			updated_at: now,
		})
		.select(SHOTSTACK_TEMPLATE_SELECT)
		.single();

	if (error || !row) {
		return { ok: false as const, status: 500, error: error?.message ?? "Failed to clone template" };
	}
	return { ok: true as const, data: row };
}
