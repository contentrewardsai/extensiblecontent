import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import type { Workflow } from "@/lib/types/workflows";

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

	const scope = request.nextUrl.searchParams.get("scope") || "published";
	const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 200);
	const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);

	const supabase = getSupabase();

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
		// Get workflows user created or was added to
		const { data: addedRows } = await supabase
			.from("workflow_added_by")
			.select("workflow_id")
			.eq("user_id", user.user_id);
		const addedIds = (addedRows ?? []).map((r) => r.workflow_id);

		const orFilter =
			addedIds.length > 0
				? `created_by.eq.${user.user_id},id.in.(${addedIds.join(",")})`
				: `created_by.eq.${user.user_id}`;

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

	const withAddedBy = await Promise.all(workflows.map((w) => workflowWithAddedBy(supabase, w)));

	const hasMore = totalFetched >= limit;
	return Response.json({
		workflows: withAddedBy,
		has_more: hasMore,
		next_offset: hasMore ? offset + limit : null,
	});
}
