import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
	params: Promise<{ planId: string }>;
}

/**
 * POST /api/plan/:planId/content
 *
 * Public. Anyone with the URL can append a new content piece to a
 * platform on the plan. Body: { platform_id, is_post?, is_ad? }. Defaults
 * mirror the React form (Organic Post on, Paid Ad off, dynamic budget).
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	let body: { platform_id?: unknown; is_post?: unknown; is_ad?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (typeof body.platform_id !== "string" || !UUID_RE.test(body.platform_id)) {
		return Response.json({ error: "platform_id is required" }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	// Confirm the platform belongs to this plan (avoids cross-plan inserts).
	const { data: platform } = await supabase
		.from("promotion_plan_platforms")
		.select("id")
		.eq("id", body.platform_id)
		.eq("plan_id", parsed.id)
		.maybeSingle();
	if (!platform) return Response.json({ error: "Platform not found" }, { status: 404 });

	const isPost = body.is_post === undefined ? true : Boolean(body.is_post);
	const isAd = body.is_ad === undefined ? false : Boolean(body.is_ad);

	const user = await getExtensionUser(request).catch(() => null);

	const { count } = await supabase
		.from("promotion_plan_content")
		.select("*", { count: "exact", head: true })
		.eq("plan_id", parsed.id)
		.eq("platform_id", body.platform_id);

	const { data: row, error } = await supabase
		.from("promotion_plan_content")
		.insert({
			plan_id: parsed.id,
			platform_id: body.platform_id,
			is_post: isPost,
			is_ad: isAd,
			targeting: {},
			position: count ?? 0,
			created_by_user_id: user?.user_id ?? null,
		})
		.select(
			"id, plan_id, platform_id, is_post, is_ad, post_status, ad_status, ad_budget_mode, ad_budget_amount, targeting, position, created_at",
		)
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
	}
	return Response.json(row, { status: 201 });
}
