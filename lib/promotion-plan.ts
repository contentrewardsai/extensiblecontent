import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pure helpers for the public, link-shareable Promotion Plan feature
 * (`/plan/[planId]`). Kept dependency-free (no `next/server`, no
 * `getServiceSupabase`) so the slug parser is trivially unit-testable.
 *
 * The companion API routes live under `app/api/plan/[planId]/*` and the
 * UI under `app/plan/[planId]/*`. Schema lives in
 * `supabase/migrations/20250422000000_create_promotion_plans.sql`.
 */

// ---------------------------------------------------------------------------
// Constants & validators
// ---------------------------------------------------------------------------

/** DB CHECK constraint mirror — keep in sync with the migration. */
const PLAN_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const ALLOWED_OBJECTIVES = [
	"Sales",
	"Leads",
	"Landing Page Views",
	"Clicks",
	"Views",
] as const;
export type PlanObjective = (typeof ALLOWED_OBJECTIVES)[number];

export const ALLOWED_BUDGET_TYPES = ["monthly", "fixed"] as const;
export type PlanBudgetType = (typeof ALLOWED_BUDGET_TYPES)[number];

export const ALLOWED_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof ALLOWED_REVIEW_STATUSES)[number];

export const ALLOWED_AD_BUDGET_MODES = ["dynamic", "fixed"] as const;
export type AdBudgetMode = (typeof ALLOWED_AD_BUDGET_MODES)[number];

export const COMMENT_KINDS = ["plan", "post", "ad"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** Reserved at the top level of `app/plan/` so we never let a plan claim them. */
const RESERVED_PLAN_IDS = new Set([
	"new",
	"create",
	"admin",
	"api",
	"_next",
	"favicon",
	// Sibling route under /plan — see app/plan/oauth/callback/page.tsx.
	"oauth",
]);

export type PlanIdParseResult =
	| { ok: true; id: string }
	| { ok: false; error: string };

/**
 * Normalises a slug from URL params or request bodies. Returns the
 * canonical (lowercased, trimmed) id or a structured error.
 */
export function parsePlanId(raw: unknown): PlanIdParseResult {
	if (typeof raw !== "string") {
		return { ok: false, error: "plan id is required" };
	}
	const id = raw.trim().toLowerCase();
	if (!id) return { ok: false, error: "plan id is required" };
	if (id.length < 3) return { ok: false, error: "plan id must be at least 3 characters" };
	if (id.length > 64) return { ok: false, error: "plan id must be at most 64 characters" };
	if (!PLAN_ID_RE.test(id)) {
		return {
			ok: false,
			error: "plan id may only contain lowercase letters, digits, and dashes",
		};
	}
	if (RESERVED_PLAN_IDS.has(id)) {
		return { ok: false, error: `"${id}" is a reserved plan id` };
	}
	return { ok: true, id };
}

export function isValidObjective(value: unknown): value is PlanObjective {
	return typeof value === "string" && (ALLOWED_OBJECTIVES as readonly string[]).includes(value);
}

export function isValidBudgetType(value: unknown): value is PlanBudgetType {
	return typeof value === "string" && (ALLOWED_BUDGET_TYPES as readonly string[]).includes(value);
}

export function isValidReviewStatus(value: unknown): value is ReviewStatus {
	return (
		typeof value === "string" && (ALLOWED_REVIEW_STATUSES as readonly string[]).includes(value)
	);
}

export function isValidAdBudgetMode(value: unknown): value is AdBudgetMode {
	return (
		typeof value === "string" && (ALLOWED_AD_BUDGET_MODES as readonly string[]).includes(value)
	);
}

// ---------------------------------------------------------------------------
// Wire types (snake_case mirrors of the DB rows + the aggregated detail shape)
// ---------------------------------------------------------------------------

export interface PromotionPlanRow {
	id: string;
	admin_user_id: string | null;
	intro: string;
	objective: PlanObjective | string;
	objective_description: string;
	budget_type: PlanBudgetType;
	daily_budget: number;
	end_date: string | null;
	estimates: Record<string, number>;
	shotstack_template_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface PromotionPlanPlatformRow {
	id: string;
	plan_id: string;
	name: string;
	followers: number;
	position: number;
	created_at: string;
}

export interface PromotionPlanContentRow {
	id: string;
	plan_id: string;
	platform_id: string;
	is_post: boolean;
	is_ad: boolean;
	post_status: ReviewStatus;
	ad_status: ReviewStatus;
	ad_budget_mode: AdBudgetMode;
	ad_budget_amount: number;
	targeting: { age?: string; gender?: string; location?: string; interests?: string };
	position: number;
	created_at: string;
}

export interface PromotionPlanCommentRow {
	id: string;
	plan_id: string;
	content_id: string | null;
	kind: CommentKind;
	author_name: string;
	author_user_id: string | null;
	body: string;
	created_at: string;
}

export interface PromotionPlanShotstackTemplate {
	id: string;
	name: string;
	edit: Record<string, unknown>;
}

/**
 * The shape returned by `getPlanWithDetails` and consumed by the page.
 * Comments are pre-grouped so the client doesn't have to bucket them.
 */
export interface PromotionPlanDetail {
	plan: PromotionPlanRow;
	platforms: PromotionPlanPlatformRow[];
	content: PromotionPlanContentRow[];
	planComments: PromotionPlanCommentRow[];
	contentComments: Record<string, { post: PromotionPlanCommentRow[]; ad: PromotionPlanCommentRow[] }>;
	template: PromotionPlanShotstackTemplate | null;
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/**
 * Loads a plan with all of its child rows in 4 round-trips. Returns null
 * if the plan does not exist (caller renders a 404 / "create" CTA).
 *
 * Uses the service-role client passed in by the route — no RLS reliance.
 */
export async function getPlanWithDetails(
	supabase: SupabaseClient,
	planId: string,
): Promise<PromotionPlanDetail | null> {
	const { data: plan, error: planErr } = await supabase
		.from("promotion_plans")
		.select(
			"id, admin_user_id, intro, objective, objective_description, budget_type, daily_budget, end_date, estimates, shotstack_template_id, created_at, updated_at",
		)
		.eq("id", planId)
		.maybeSingle();

	if (planErr) throw new Error(planErr.message);
	if (!plan) return null;

	const [{ data: platforms }, { data: content }, { data: comments }] = await Promise.all([
		supabase
			.from("promotion_plan_platforms")
			.select("id, plan_id, name, followers, position, created_at")
			.eq("plan_id", planId)
			.order("position", { ascending: true })
			.order("created_at", { ascending: true }),
		supabase
			.from("promotion_plan_content")
			.select(
				"id, plan_id, platform_id, is_post, is_ad, post_status, ad_status, ad_budget_mode, ad_budget_amount, targeting, position, created_at",
			)
			.eq("plan_id", planId)
			.order("position", { ascending: true })
			.order("created_at", { ascending: true }),
		supabase
			.from("promotion_plan_comments")
			.select("id, plan_id, content_id, kind, author_name, author_user_id, body, created_at")
			.eq("plan_id", planId)
			.order("created_at", { ascending: true }),
	]);

	let template: PromotionPlanShotstackTemplate | null = null;
	if (plan.shotstack_template_id) {
		const { data: tpl } = await supabase
			.from("shotstack_templates")
			.select("id, name, edit")
			.eq("id", plan.shotstack_template_id)
			.maybeSingle();
		if (tpl) {
			template = {
				id: tpl.id as string,
				name: tpl.name as string,
				edit: (tpl.edit ?? {}) as Record<string, unknown>,
			};
		}
	}

	const planComments: PromotionPlanCommentRow[] = [];
	const contentComments: PromotionPlanDetail["contentComments"] = {};
	for (const row of (comments ?? []) as PromotionPlanCommentRow[]) {
		if (row.content_id == null) {
			planComments.push(row);
			continue;
		}
		const bucket = (contentComments[row.content_id] ??= { post: [], ad: [] });
		if (row.kind === "post") bucket.post.push(row);
		else if (row.kind === "ad") bucket.ad.push(row);
	}

	return {
		plan: plan as PromotionPlanRow,
		platforms: (platforms ?? []) as PromotionPlanPlatformRow[],
		content: (content ?? []) as PromotionPlanContentRow[],
		planComments,
		contentComments,
		template,
	};
}

/**
 * Returns true iff the given user is the plan's admin. Plans without an
 * `admin_user_id` (legacy seed rows) are treated as having no admin —
 * everyone is a guest.
 */
export function isPlanAdmin(
	plan: Pick<PromotionPlanRow, "admin_user_id">,
	userId: string | null | undefined,
): boolean {
	return !!plan.admin_user_id && !!userId && plan.admin_user_id === userId;
}
