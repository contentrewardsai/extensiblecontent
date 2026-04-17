import type { NextRequest } from "next/server";
import {
	getPlanWithDetails,
	isValidBudgetType,
	isValidObjective,
	parsePlanId,
} from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

interface RouteContext {
	params: Promise<{ planId: string }>;
}

/**
 * Plan-level CRUD for the open `/plan/<slug>` collaborative document.
 *
 * Permission model: **fully public**. Anyone with the slug can create
 * a plan, edit any field on it, and contribute platforms/content/
 * comments. The plan slug itself has no `DELETE` route, so a plan can
 * never be wiped via the API.
 */

const ALL_PLAN_FIELDS = new Set([
	"title",
	"intro",
	"objective",
	"objective_description",
	"budget_type",
	"daily_budget",
	"end_date",
	"estimates",
	"shotstack_template_id",
]);

/**
 * GET /api/plan/:planId — public read.
 *
 * Returns the full plan detail (platforms, content, comments, attached
 * ShotStack template). The legacy `isAdmin` flag is retained as `true`
 * for any future caller that still inspects it; effectively everyone
 * is now an editor.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const supabase = getServiceSupabase();
	const detail = await getPlanWithDetails(supabase, parsed.id);
	if (!detail) return Response.json({ error: "Not found" }, { status: 404 });

	return Response.json({ ...detail, isAdmin: true, viewer: null });
}

/**
 * PUT /api/plan/:planId — public create.
 *
 * Idempotent: if the plan already exists this is a no-op (200);
 * otherwise we insert a fresh row with sensible defaults. There is no
 * concept of an "owner" any more, so `admin_user_id` stays NULL.
 */
export async function PUT(_request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (existing) {
		return Response.json({ id: parsed.id, created: false }, { status: 200 });
	}

	const { error: insertErr } = await supabase.from("promotion_plans").insert({
		id: parsed.id,
		admin_user_id: null,
		title: "",
		intro:
			"We recommend a comprehensive, cross-platform approach to establish authority, drive engagement, and efficiently convert your audience into loyal customers.",
		objective: "Leads",
		objective_description: "",
		budget_type: "monthly",
		daily_budget: 50,
		estimates: { views: 25000, clicks: 1200, lpViews: 600, leads: 45, sales: 3 },
	});

	if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 });
	return Response.json({ id: parsed.id, created: true }, { status: 201 });
}

/**
 * PATCH /api/plan/:planId — public edit of any plan field.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const unknownKey = Object.keys(body).find((k) => !ALL_PLAN_FIELDS.has(k));
	if (unknownKey) {
		return Response.json({ error: `Unknown field: ${unknownKey}` }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Not found" }, { status: 404 });

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

	if (body.title !== undefined) {
		if (typeof body.title !== "string") {
			return Response.json({ error: "title must be a string" }, { status: 400 });
		}
		updates.title = body.title.slice(0, 200);
	}
	if (typeof body.intro === "string") updates.intro = body.intro.slice(0, 4000);
	if (body.objective !== undefined) {
		if (!isValidObjective(body.objective)) {
			return Response.json({ error: "Invalid objective" }, { status: 400 });
		}
		updates.objective = body.objective;
	}
	if (typeof body.objective_description === "string") {
		updates.objective_description = body.objective_description.slice(0, 4000);
	}
	if (body.budget_type !== undefined) {
		if (!isValidBudgetType(body.budget_type)) {
			return Response.json({ error: "Invalid budget_type" }, { status: 400 });
		}
		updates.budget_type = body.budget_type;
	}
	if (body.daily_budget !== undefined) {
		const n = Number(body.daily_budget);
		if (!Number.isFinite(n) || n < 0) {
			return Response.json({ error: "Invalid daily_budget" }, { status: 400 });
		}
		updates.daily_budget = n;
	}
	if (body.end_date !== undefined) {
		if (body.end_date === null || body.end_date === "") {
			updates.end_date = null;
		} else if (typeof body.end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) {
			updates.end_date = body.end_date;
		} else {
			return Response.json({ error: "Invalid end_date (expected YYYY-MM-DD)" }, { status: 400 });
		}
	}
	if (body.estimates !== undefined) {
		if (!body.estimates || typeof body.estimates !== "object" || Array.isArray(body.estimates)) {
			return Response.json({ error: "estimates must be an object" }, { status: 400 });
		}
		const sanitised: Record<string, number> = {};
		for (const [k, v] of Object.entries(body.estimates as Record<string, unknown>)) {
			const n = Number(v);
			if (Number.isFinite(n) && n >= 0) sanitised[k.slice(0, 32)] = n;
		}
		updates.estimates = sanitised;
	}
	if (body.shotstack_template_id !== undefined) {
		if (body.shotstack_template_id === null) {
			updates.shotstack_template_id = null;
		} else if (typeof body.shotstack_template_id === "string") {
			// Verify the template id exists; ownership is no longer
			// enforced because the plan is fully public.
			const { data: tpl } = await supabase
				.from("shotstack_templates")
				.select("id")
				.eq("id", body.shotstack_template_id)
				.maybeSingle();
			if (!tpl) {
				return Response.json({ error: "Template not found" }, { status: 404 });
			}
			updates.shotstack_template_id = tpl.id;
		} else {
			return Response.json({ error: "Invalid shotstack_template_id" }, { status: 400 });
		}
	}

	const { error } = await supabase
		.from("promotion_plans")
		.update(updates)
		.eq("id", parsed.id);
	if (error) return Response.json({ error: error.message }, { status: 500 });

	const detail = await getPlanWithDetails(supabase, parsed.id);
	return Response.json({ ...detail, isAdmin: true, viewer: null });
}
