import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only audit logging for project mutations.
 *
 * The `source` enum mirrors what the Chrome extension stamps on local workflow
 * edits:
 *   - `'user'`    – sidepanel UI / dashboard human action (default for
 *                   extension-authenticated routes).
 *   - `'backend'` – server-initiated work (webhooks, cron, server actions
 *                   without a clear human actor).
 *   - `'mcp'`     – MCP server / AI agent tooling.
 *
 * Routes that accept extension calls should let the extension override the
 * default by sending an `X-Edit-Source` request header.
 */

export type EditSource = "user" | "backend" | "mcp";

const VALID_SOURCES: ReadonlySet<EditSource> = new Set(["user", "backend", "mcp"]);

export const EDIT_SOURCE_HEADER = "x-edit-source";

interface HeadersLike {
	get(name: string): string | null;
}

interface RequestLike {
	headers: HeadersLike;
}

/**
 * Pull the source from an incoming request header, falling back to `fallback`.
 * Header names are case-insensitive (Next's `Headers` already lowercases).
 */
export function resolveEditSource(
	request: RequestLike | null | undefined,
	fallback: EditSource = "backend",
): EditSource {
	const raw = request?.headers?.get(EDIT_SOURCE_HEADER);
	return parseEditSource(raw, fallback);
}

/**
 * Coerce an arbitrary string to a valid `EditSource`. Defaults to `fallback`
 * when the input is missing or unknown.
 */
export function parseEditSource(
	raw: string | null | undefined,
	fallback: EditSource = "backend",
): EditSource {
	const trimmed = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (VALID_SOURCES.has(trimmed as EditSource)) return trimmed as EditSource;
	return fallback;
}

export interface ProjectAuditEntryInput {
	projectId: string;
	actorUserId: string | null;
	source: EditSource;
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	before?: unknown;
	after?: unknown;
}

/**
 * Insert a single audit row. Failures are logged but never thrown so audit
 * logging never breaks the calling route.
 */
export async function recordProjectAudit(
	supabase: SupabaseClient,
	entry: ProjectAuditEntryInput,
): Promise<void> {
	if (!entry.projectId || !entry.action) return;

	const row = {
		project_id: entry.projectId,
		actor_user_id: entry.actorUserId,
		source: entry.source,
		action: entry.action,
		target_type: entry.targetType ?? null,
		target_id: entry.targetId ?? null,
		before: entry.before === undefined ? null : entry.before,
		after: entry.after === undefined ? null : entry.after,
	};

	const { error } = await supabase.from("project_audit_log").insert(row);
	if (error) {
		console.error("[project-audit] insert failed:", error.message, {
			project_id: entry.projectId,
			action: entry.action,
		});
	}
}

export interface ProjectAuditEntry {
	id: string;
	project_id: string;
	actor_user_id: string | null;
	source: EditSource;
	action: string;
	target_type: string | null;
	target_id: string | null;
	before: unknown;
	after: unknown;
	created_at: string;
}

/**
 * List audit entries for a project, newest first. `actorMeta` is optional and
 * lets pages render a name/email next to each row without an N+1 lookup.
 */
export async function listProjectAuditEntries(
	supabase: SupabaseClient,
	projectId: string,
	{ limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ProjectAuditEntry[]> {
	const { data, error } = await supabase
		.from("project_audit_log")
		.select("id, project_id, actor_user_id, source, action, target_type, target_id, before, after, created_at")
		.eq("project_id", projectId)
		.order("created_at", { ascending: false })
		.range(offset, offset + limit - 1);

	if (error) {
		console.error("[project-audit] list failed:", error.message);
		return [];
	}

	return (data ?? []).map((row) => ({
		id: row.id as string,
		project_id: row.project_id as string,
		actor_user_id: (row.actor_user_id as string | null) ?? null,
		source: row.source as EditSource,
		action: row.action as string,
		target_type: (row.target_type as string | null) ?? null,
		target_id: (row.target_id as string | null) ?? null,
		before: row.before,
		after: row.after,
		created_at: row.created_at as string,
	}));
}
