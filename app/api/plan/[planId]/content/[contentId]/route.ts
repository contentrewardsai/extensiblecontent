import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import {
	isPlanAdmin,
	isValidAdBudgetMode,
	isValidReviewStatus,
	parsePlanId,
} from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
	params: Promise<{ planId: string; contentId: string }>;
}

/**
 * PATCH /api/plan/:planId/content/:contentId
 *
 * **Public.** Anyone with the URL may approve/reject content, flip the
 * post/ad toggles, and tweak budget or targeting. The destructive
 * counterpart (`DELETE`) stays admin-only.
 *
 * Mutates any subset of:
 *   { is_post, is_ad, post_status, ad_status, ad_budget_mode,
 *     ad_budget_amount, targeting }
 *
 * `ad_budget_amount` is clamped at the plan's `daily_budget` to mirror
 * the same UI guard in `plan-client.tsx`.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, contentId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	if (!UUID_RE.test(contentId)) {
		return Response.json({ error: "Invalid content id" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id, daily_budget")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const dailyBudget = Number(plan.daily_budget) || 0;
	const updates: Record<string, unknown> = {};
	if (body.is_post !== undefined) updates.is_post = Boolean(body.is_post);
	if (body.is_ad !== undefined) updates.is_ad = Boolean(body.is_ad);
	if (body.post_status !== undefined) {
		if (!isValidReviewStatus(body.post_status)) {
			return Response.json({ error: "Invalid post_status" }, { status: 400 });
		}
		updates.post_status = body.post_status;
	}
	if (body.ad_status !== undefined) {
		if (!isValidReviewStatus(body.ad_status)) {
			return Response.json({ error: "Invalid ad_status" }, { status: 400 });
		}
		updates.ad_status = body.ad_status;
	}
	if (body.ad_budget_mode !== undefined) {
		if (!isValidAdBudgetMode(body.ad_budget_mode)) {
			return Response.json({ error: "Invalid ad_budget_mode" }, { status: 400 });
		}
		updates.ad_budget_mode = body.ad_budget_mode;
	}
	if (body.ad_budget_amount !== undefined) {
		const n = Number(body.ad_budget_amount);
		if (!Number.isFinite(n) || n < 0) {
			return Response.json({ error: "Invalid ad_budget_amount" }, { status: 400 });
		}
		updates.ad_budget_amount = dailyBudget > 0 ? Math.min(n, dailyBudget) : n;
	}
	if (body.targeting !== undefined) {
		if (!body.targeting || typeof body.targeting !== "object" || Array.isArray(body.targeting)) {
			return Response.json({ error: "targeting must be an object" }, { status: 400 });
		}
		const t = body.targeting as Record<string, unknown>;
		const sanitised: Record<string, string> = {};
		for (const key of ["age", "gender", "location", "interests"] as const) {
			const v = t[key];
			if (typeof v === "string") sanitised[key] = v.slice(0, 200);
		}
		updates.targeting = sanitised;
	}

	if (Object.keys(updates).length === 0) {
		return Response.json({ error: "No fields to update" }, { status: 400 });
	}

	const { data: row, error } = await supabase
		.from("promotion_plan_content")
		.update(updates)
		.eq("id", contentId)
		.eq("plan_id", parsed.id)
		.select(
			"id, plan_id, platform_id, is_post, is_ad, post_status, ad_status, ad_budget_mode, ad_budget_amount, targeting, position, created_at",
		)
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	}
	return Response.json(row);
}

/**
 * DELETE /api/plan/:planId/content/:contentId
 *
 * Admin-only — destructive removal that wipes other contributors'
 * comments on this thread along with the row itself.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, contentId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	if (!UUID_RE.test(contentId)) {
		return Response.json({ error: "Invalid content id" }, { status: 400 });
	}

	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id, admin_user_id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });
	if (!isPlanAdmin(plan, user.user_id)) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	const { error } = await supabase
		.from("promotion_plan_content")
		.delete()
		.eq("id", contentId)
		.eq("plan_id", parsed.id);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
