import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

interface RouteContext {
	params: Promise<{ planId: string }>;
}

/**
 * POST /api/plan/:planId/platforms
 *
 * Public. Anyone with the URL can add a new platform profile to the plan.
 * Body: { name: string, followers?: number }. The optional Authorization
 * header is honoured purely so we can attribute creator user ids.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	let body: { name?: unknown; followers?: unknown };
	try {
		body = (await request.json()) as { name?: unknown; followers?: unknown };
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const name =
		typeof body.name === "string" && body.name.trim().length > 0
			? body.name.trim().slice(0, 64)
			: null;
	if (!name) return Response.json({ error: "name is required" }, { status: 400 });

	const followers =
		body.followers === undefined || body.followers === null
			? 0
			: Math.max(0, Math.floor(Number(body.followers) || 0));

	const supabase = getServiceSupabase();

	// Ensure plan exists so we don't insert an orphan FK row.
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

	// Attribution: if the caller sent a token, link the row to that user.
	const user = await getExtensionUser(request).catch(() => null);

	// Compute next position so newly added profiles always go to the end.
	const { count } = await supabase
		.from("promotion_plan_platforms")
		.select("*", { count: "exact", head: true })
		.eq("plan_id", parsed.id);

	const { data: row, error } = await supabase
		.from("promotion_plan_platforms")
		.insert({
			plan_id: parsed.id,
			name,
			followers,
			position: count ?? 0,
			created_by_user_id: user?.user_id ?? null,
		})
		.select("id, plan_id, name, followers, position, created_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
	}
	return Response.json(row, { status: 201 });
}
