import type { NextRequest } from "next/server";
import {
	detectMediaKind,
	isValidAdBudgetMode,
	isValidMediaKind,
	isValidReviewStatus,
	parsePlanId,
} from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS =
	"id, plan_id, platform_id, is_post, is_ad, post_status, ad_status, ad_budget_mode, ad_budget_amount, targeting, title, body, media_kind, media_url, cta_label, cta_url, position, created_at";

interface RouteContext {
	params: Promise<{ planId: string; contentId: string }>;
}

/**
 * PATCH /api/plan/:planId/content/:contentId
 *
 * **Public.** Anyone with the URL can edit any field on a content piece:
 *   - distribution: is_post, is_ad
 *   - reviews: post_status, ad_status
 *   - ad config: ad_budget_mode, ad_budget_amount, targeting
 *   - payload: title, body, media_kind, media_url, cta_label, cta_url
 *
 * `ad_budget_amount` is clamped at the plan's `daily_budget`. If
 * `media_url` is updated without an explicit `media_kind` we
 * auto-detect (YouTube/Vimeo → embed, .mp4/.webm/.mov → video, else
 * image).
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

	// --- Content payload (title / body / media / CTA) ------------------
	if (body.title !== undefined) {
		if (typeof body.title !== "string") {
			return Response.json({ error: "title must be a string" }, { status: 400 });
		}
		updates.title = body.title.slice(0, 280);
	}
	if (body.body !== undefined) {
		if (typeof body.body !== "string") {
			return Response.json({ error: "body must be a string" }, { status: 400 });
		}
		updates.body = body.body.slice(0, 4000);
	}
	if (body.media_url !== undefined) {
		if (typeof body.media_url !== "string") {
			return Response.json({ error: "media_url must be a string" }, { status: 400 });
		}
		const url = body.media_url.slice(0, 2048);
		updates.media_url = url;
		// Auto-derive media_kind when the caller didn't supply one and
		// the URL changed; keeps client code simple (just send the URL).
		if (body.media_kind === undefined) {
			updates.media_kind = url ? detectMediaKind(url) : "none";
		}
	}
	if (body.media_kind !== undefined) {
		if (!isValidMediaKind(body.media_kind)) {
			return Response.json({ error: "Invalid media_kind" }, { status: 400 });
		}
		updates.media_kind = body.media_kind;
	}
	if (body.cta_label !== undefined) {
		if (typeof body.cta_label !== "string") {
			return Response.json({ error: "cta_label must be a string" }, { status: 400 });
		}
		updates.cta_label = body.cta_label.slice(0, 64);
	}
	if (body.cta_url !== undefined) {
		if (typeof body.cta_url !== "string") {
			return Response.json({ error: "cta_url must be a string" }, { status: 400 });
		}
		updates.cta_url = body.cta_url.slice(0, 2048);
	}

	if (body.position !== undefined) {
		const n = Number(body.position);
		if (!Number.isFinite(n)) {
			return Response.json({ error: "position must be a finite number" }, { status: 400 });
		}
		updates.position = n;
	}

	if (Object.keys(updates).length === 0) {
		return Response.json({ error: "No fields to update" }, { status: 400 });
	}

	const { data: row, error } = await supabase
		.from("promotion_plan_content")
		.update(updates)
		.eq("id", contentId)
		.eq("plan_id", parsed.id)
		.select(SELECT_COLUMNS)
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	}
	return Response.json(row);
}

/**
 * DELETE /api/plan/:planId/content/:contentId
 *
 * **Public.** Anyone with the plan URL can remove a content piece.
 * Cascades through to that content's review comments via FK.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, contentId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	if (!UUID_RE.test(contentId)) {
		return Response.json({ error: "Invalid content id" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

	const { error } = await supabase
		.from("promotion_plan_content")
		.delete()
		.eq("id", contentId)
		.eq("plan_id", parsed.id);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
