import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import {
	getPlanWithDetails,
	isPlanAdmin,
	isValidBudgetType,
	isValidObjective,
	parsePlanId,
} from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

interface RouteContext {
	params: Promise<{ planId: string }>;
}

/**
 * Plan-level PATCH permission model.
 *
 * **Public** fields (anyone with the URL can edit):
 *   • daily_budget   – core "what should we spend?" knob the user
 *                      explicitly wanted collaborators able to tweak
 *   • budget_type    – Ongoing Monthly vs Fixed End Date toggle
 *   • end_date       – paired with budget_type === 'fixed'
 *
 * **Admin-only** fields (only the user who claimed the slug):
 *   • intro, objective, objective_description, estimates – owner-defined
 *     positioning that should not be rewritten by drive-by visitors.
 *   • shotstack_template_id – attaches the canvas template; verified
 *     against the admin's own template list.
 *
 * `DELETE` on the plan itself is intentionally NOT exposed: anyone with
 * the link can comment / approve / edit budgets, but nobody can wipe out
 * the slug.
 */
const PUBLIC_PLAN_FIELDS = new Set(["daily_budget", "budget_type", "end_date"]);
const ADMIN_PLAN_FIELDS = new Set([
	"intro",
	"objective",
	"objective_description",
	"estimates",
	"shotstack_template_id",
]);

/**
 * GET /api/plan/:planId
 *
 * Public read. Returns the full plan detail (platforms, content, comments,
 * attached ShotStack template) plus an `isAdmin` flag derived from any
 * `Authorization: Bearer <whop-token>` header on the request.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const supabase = getServiceSupabase();
	const detail = await getPlanWithDetails(supabase, parsed.id);
	if (!detail) return Response.json({ error: "Not found" }, { status: 404 });

	// Admin probe is best-effort: if the caller didn't send a token we
	// just return isAdmin: false. We never reject a public read.
	const user = await getExtensionUser(request).catch(() => null);
	const admin = isPlanAdmin(detail.plan, user?.user_id);

	return Response.json({
		...detail,
		isAdmin: admin,
		viewer: user ? { user_id: user.user_id, email: user.email } : null,
	});
}

/**
 * PUT /api/plan/:planId
 *
 * Authenticated. Creates the plan with the caller as admin if it doesn't
 * exist; if it already exists and the caller is *already* the admin this
 * is a no-op (200). Otherwise (someone else owns the slug) we return 409
 * so the caller can pick a different slug.
 */
export async function PUT(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("promotion_plans")
		.select("id, admin_user_id")
		.eq("id", parsed.id)
		.maybeSingle();

	if (existing) {
		if (existing.admin_user_id && existing.admin_user_id !== user.user_id) {
			return Response.json({ error: "Plan id already taken" }, { status: 409 });
		}
		// Either it's already ours, or it had no admin (legacy / claimed). Claim it.
		if (!existing.admin_user_id) {
			await supabase
				.from("promotion_plans")
				.update({ admin_user_id: user.user_id, updated_at: new Date().toISOString() })
				.eq("id", parsed.id);
		}
		return Response.json({ id: parsed.id, claimed: !existing.admin_user_id }, { status: 200 });
	}

	const { error: insertErr } = await supabase.from("promotion_plans").insert({
		id: parsed.id,
		admin_user_id: user.user_id,
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
 * PATCH /api/plan/:planId
 *
 * Mixed permissions (see `PUBLIC_PLAN_FIELDS` / `ADMIN_PLAN_FIELDS`
 * above). If the body contains *any* admin-only field we require Whop
 * auth + admin match; otherwise the request is accepted from anyone.
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

	const requestedKeys = Object.keys(body);
	const unknownKey = requestedKeys.find(
		(k) => !PUBLIC_PLAN_FIELDS.has(k) && !ADMIN_PLAN_FIELDS.has(k),
	);
	if (unknownKey) {
		return Response.json({ error: `Unknown field: ${unknownKey}` }, { status: 400 });
	}
	const needsAdmin = requestedKeys.some((k) => ADMIN_PLAN_FIELDS.has(k));

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("admin_user_id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Not found" }, { status: 404 });

	let isAdmin = false;
	if (needsAdmin) {
		const user = await getExtensionUser(request);
		if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
		if (!isPlanAdmin(plan, user.user_id)) {
			return Response.json({ error: "Forbidden" }, { status: 403 });
		}
		isAdmin = true;
	} else {
		// Best-effort admin probe so the response's isAdmin flag is correct
		// even when the caller is editing public-only fields.
		const user = await getExtensionUser(request).catch(() => null);
		isAdmin = isPlanAdmin(plan, user?.user_id);
	}

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

	// --- Public fields ---------------------------------------------------
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

	// --- Admin-only fields ----------------------------------------------
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
			// Verify the admin owns the template (re-check here even though
			// `needsAdmin` already gated the request, in case the body was
			// constructed by a malicious admin trying to point at someone
			// else's edit JSON).
			const user = await getExtensionUser(request);
			if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
			const { data: tpl } = await supabase
				.from("shotstack_templates")
				.select("id, user_id")
				.eq("id", body.shotstack_template_id)
				.maybeSingle();
			if (!tpl || tpl.user_id !== user.user_id) {
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
	return Response.json({ ...detail, isAdmin });
}
