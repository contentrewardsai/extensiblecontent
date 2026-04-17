import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Workflow } from "@/lib/types/workflows";
import { isUserEntitled } from "@/lib/user-entitlement";
import { hostnameFromOrigin, normalizeHostname, workflowMatchesHostname } from "@/lib/workflow-hostname-match";

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

/**
 * GET: Published/discoverable workflows catalog for auto-enrich and domain browsing.
 * Query: ?hostname=&origin=&scope=published|mine|all&limit=&offset=
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const requestedScope = request.nextUrl.searchParams.get("scope") || "published";
	const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 200);
	const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);

	const supabase = getSupabase();

	// Free users (not paid, not invited to a paying user's project) only ever
	// see workflows they own / were added to / belong to one of their member
	// projects. Force the global "published" branch off for them by collapsing
	// the scope down to "mine" — `scope=all` requests get the same treatment
	// so the published rows never leak in.
	const entitled = (await isUserEntitled(supabase, user.user_id)).entitled;
	const scope = entitled ? requestedScope : "mine";

	// Domain filter: extension passes ?hostname=labs.google or ?origin=https://labs.google.
	// Normalize (lowercase, strip leading "www.") and match host or any subdomain against
	// workflow.urlPattern.{origin,hostname} or the first run/action URL inside the JSONB blob.
	const targetHostname =
		normalizeHostname(request.nextUrl.searchParams.get("hostname")) ??
		hostnameFromOrigin(request.nextUrl.searchParams.get("origin"));

	let workflows: Record<string, unknown>[] = [];
	let totalFetched = 0;

	if (scope === "published" || scope === "all") {
		const { data: published } = await supabase
			.from("workflows")
			.select("*")
			.eq("published", true)
			.eq("private", false)
			.eq("archived", false)
			.order("updated_at", { ascending: false })
			.range(offset, offset + limit - 1);

		workflows = published ?? [];
		totalFetched = workflows.length;
	}

	if (scope === "mine" || scope === "all") {
		// "Mine" = workflows the caller created OR was explicitly added to
		// OR belong to a project the caller is a member of. The latter is
		// what lets a free user invited to a paying user's project see the
		// project's workflows in the extension without unlocking the global
		// catalog.
		const [{ data: addedRows }, { data: memberRows }] = await Promise.all([
			supabase
				.from("workflow_added_by")
				.select("workflow_id")
				.eq("user_id", user.user_id),
			supabase
				.from("project_members")
				.select("project_id")
				.eq("user_id", user.user_id),
		]);
		const addedIds = (addedRows ?? []).map((r) => r.workflow_id);
		const memberProjectIds = Array.from(
			new Set(
				((memberRows ?? []) as Array<{ project_id: string | null }>)
					.map((r) => r.project_id)
					.filter((id): id is string => typeof id === "string" && id.length > 0),
			),
		);

		const orParts: string[] = [`created_by.eq.${user.user_id}`];
		if (addedIds.length > 0) orParts.push(`id.in.(${addedIds.join(",")})`);
		if (memberProjectIds.length > 0) orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
		const orFilter = orParts.join(",");

		const { data: mine } = await supabase
			.from("workflows")
			.select("*")
			.eq("archived", false)
			.or(orFilter)
			.order("updated_at", { ascending: false })
			.range(offset, offset + limit - 1);

		if (scope === "mine") {
			workflows = mine ?? [];
			totalFetched = workflows.length;
		} else {
			// scope=all: merge, dedup by id
			const existing = new Set(workflows.map((w) => w.id as string));
			for (const w of mine ?? []) {
				if (!existing.has(w.id as string)) {
					workflows.push(w);
				}
			}
			totalFetched = workflows.length;
		}
	}

	// In-memory hostname filter. Acceptable while limit <= 200; if growth pressures this,
	// switch to a SQL pre-filter on workflow->'urlPattern'->>'origin' before this point.
	const filtered = targetHostname
		? workflows.filter((w) => workflowMatchesHostname(w.workflow, targetHostname))
		: workflows;

	const withAddedBy = await Promise.all(filtered.map((w) => workflowWithAddedBy(supabase, w)));

	const hasMore = totalFetched >= limit;
	return Response.json({
		workflows: withAddedBy,
		has_more: hasMore,
		next_offset: hasMore ? offset + limit : null,
	});
}
