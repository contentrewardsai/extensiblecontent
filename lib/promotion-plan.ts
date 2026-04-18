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

export const ALLOWED_FUNNEL_TYPES = ["leads", "sales"] as const;
export type FunnelType = (typeof ALLOWED_FUNNEL_TYPES)[number];

export function isValidFunnelType(value: unknown): value is FunnelType {
	return (
		typeof value === "string" && (ALLOWED_FUNNEL_TYPES as readonly string[]).includes(value)
	);
}

/**
 * Mirror of the `media_kind` CHECK constraint on `promotion_plan_content`.
 * `'embed'` is reserved for URLs the client converts to an iframe src
 * (YouTube / Vimeo / etc.); `'video'` is for direct video file URLs
 * (.mp4 / .webm / .mov) rendered with a `<video>` tag.
 */
export const ALLOWED_MEDIA_KINDS = ["none", "image", "video", "embed"] as const;
export type MediaKind = (typeof ALLOWED_MEDIA_KINDS)[number];

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

export function isValidMediaKind(value: unknown): value is MediaKind {
	return typeof value === "string" && (ALLOWED_MEDIA_KINDS as readonly string[]).includes(value);
}

/**
 * Heuristic auto-detection of `media_kind` from a raw URL string. Used
 * by the API when a caller supplies `media_url` without an explicit
 * `media_kind`, and exported so the client UI can show a sensible
 * default in the picker as the user types.
 */
export function detectMediaKind(rawUrl: string): MediaKind {
	const url = rawUrl.trim();
	if (!url) return "none";
	const lower = url.toLowerCase();
	if (
		lower.includes("youtube.com/watch") ||
		lower.includes("youtube.com/embed") ||
		lower.includes("youtu.be/") ||
		lower.includes("vimeo.com/") ||
		lower.includes("player.vimeo.com/")
	) {
		return "embed";
	}
	if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(lower)) return "video";
	if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(lower)) return "image";
	// Anything else falls through to image — usually a CDN URL with no
	// extension. The user can flip the picker manually if needed.
	return "image";
}

// ---------------------------------------------------------------------------
// Wire types (snake_case mirrors of the DB rows + the aggregated detail shape)
// ---------------------------------------------------------------------------

export interface PromotionPlanRow {
	id: string;
	admin_user_id: string | null;
	/** Free-form display title; falls back to the slug (`id`) when empty. */
	title: string;
	intro: string;
	objective: PlanObjective | string;
	objective_description: string;
	budget_type: PlanBudgetType;
	daily_budget: number;
	end_date: string | null;
	estimates: Record<string, number>;
	/** Distribution Comparison editor state — see `PromotionPlanComparison`. */
	comparison: PromotionPlanComparison;
	shotstack_template_id: string | null;
	created_at: string;
	updated_at: string;
}

// ---------------------------------------------------------------------------
// Distribution Comparison
// ---------------------------------------------------------------------------

/** Per-channel funnel conversion rates, all stored as percentages (0-100). */
export interface FunnelRates {
	click: number;
	lp: number;
	lead: number;
	sale: number;
}

export interface OrganicComparison {
	/** Daily $ cost of the chosen automation tier (0.33, 1.33, or 3.33). */
	tier: number;
	posts_per_day: number;
	views_per_post: number;
	rates: FunnelRates;
}

export interface ClippersComparison {
	/** Daily $ allocated to paid clippers. */
	budget: number;
	/** $ paid per 1000 views. */
	rate_per_1k: number;
	posts_per_day: number;
	rates: FunnelRates;
}

export interface AdsComparison {
	/** Daily $ allocated to paid ads. */
	budget: number;
	/** Estimated cost per 1000 ad views. */
	cpm: number;
	rates: FunnelRates;
}

export interface PromotionPlanComparison {
	funnel_type: FunnelType;
	product_price: number;
	profit_margin: number;
	organic: OrganicComparison;
	clippers: ClippersComparison;
	ads: AdsComparison;
}

/**
 * Default comparison config for newly-created plans. Mirrors the SQL
 * default in `20250425000000_promotion_plan_comparison.sql` so legacy
 * rows that predate the column hydrate to the same shape on the
 * client.
 */
export function defaultComparison(): PromotionPlanComparison {
	return {
		funnel_type: "leads",
		product_price: 97,
		profit_margin: 50,
		organic: {
			tier: 1.33,
			posts_per_day: 5,
			views_per_post: 500,
			rates: { click: 0.5, lp: 80, lead: 30, sale: 2 },
		},
		clippers: {
			budget: 4.34,
			rate_per_1k: 1.0,
			posts_per_day: 15,
			rates: { click: 0.5, lp: 80, lead: 30, sale: 1 },
		},
		ads: {
			budget: 4.33,
			cpm: 20,
			rates: { click: 2.0, lp: 85, lead: 30, sale: 3 },
		},
	};
}

/**
 * Coerces an unknown JSON value (typically the `comparison` JSONB
 * column or a request body) into a fully-typed `PromotionPlanComparison`,
 * filling in any missing fields with the defaults. Used by both the
 * server (PATCH validation) and the client (defensive hydration of
 * pre-comparison plans loaded from the DB).
 */
export function sanitiseComparison(raw: unknown): PromotionPlanComparison {
	const base = defaultComparison();
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
	const r = raw as Record<string, unknown>;

	const num = (v: unknown, fallback: number): number => {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	};
	const nonNeg = (v: unknown, fallback: number): number => {
		const n = num(v, fallback);
		return n < 0 ? fallback : n;
	};
	const rates = (rawRates: unknown, fb: FunnelRates): FunnelRates => {
		if (!rawRates || typeof rawRates !== "object") return fb;
		const r = rawRates as Record<string, unknown>;
		return {
			click: nonNeg(r.click, fb.click),
			lp: nonNeg(r.lp, fb.lp),
			lead: nonNeg(r.lead, fb.lead),
			sale: nonNeg(r.sale, fb.sale),
		};
	};

	const rawOrganic = (r.organic ?? {}) as Record<string, unknown>;
	const rawClippers = (r.clippers ?? {}) as Record<string, unknown>;
	const rawAds = (r.ads ?? {}) as Record<string, unknown>;

	return {
		funnel_type: isValidFunnelType(r.funnel_type) ? r.funnel_type : base.funnel_type,
		product_price: nonNeg(r.product_price, base.product_price),
		profit_margin: nonNeg(r.profit_margin, base.profit_margin),
		organic: {
			tier: nonNeg(rawOrganic.tier, base.organic.tier),
			posts_per_day: nonNeg(rawOrganic.posts_per_day, base.organic.posts_per_day),
			views_per_post: nonNeg(rawOrganic.views_per_post, base.organic.views_per_post),
			rates: rates(rawOrganic.rates, base.organic.rates),
		},
		clippers: {
			budget: nonNeg(rawClippers.budget, base.clippers.budget),
			rate_per_1k: nonNeg(rawClippers.rate_per_1k, base.clippers.rate_per_1k),
			posts_per_day: nonNeg(rawClippers.posts_per_day, base.clippers.posts_per_day),
			rates: rates(rawClippers.rates, base.clippers.rates),
		},
		ads: {
			budget: nonNeg(rawAds.budget, base.ads.budget),
			cpm: nonNeg(rawAds.cpm, base.ads.cpm),
			rates: rates(rawAds.rates, base.ads.rates),
		},
	};
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
	/** Headline / hook for the piece. */
	title: string;
	/** Long-form copy / description / caption. */
	body: string;
	/** What kind of media `media_url` points at — see `MediaKind`. */
	media_kind: MediaKind;
	/** Image src, video src, or embeddable page URL. Empty string = no media. */
	media_url: string;
	/** Optional CTA shown on the preview card. */
	cta_label: string;
	cta_url: string;
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
			"id, admin_user_id, title, intro, objective, objective_description, budget_type, daily_budget, end_date, estimates, comparison, shotstack_template_id, created_at, updated_at",
		)
		.eq("id", planId)
		.maybeSingle();

	if (planErr) throw new Error(planErr.message);
	if (!plan) return null;

	// Defensive hydration: rows that predate the `comparison` column
	// have a default applied at the DB level, but if the column was
	// somehow nulled out (or contains a partial object from a previous
	// schema iteration) we rebuild it from defaults so the client
	// always receives a fully-typed shape.
	(plan as PromotionPlanRow).comparison = sanitiseComparison(
		(plan as { comparison?: unknown }).comparison,
	);

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
				"id, plan_id, platform_id, is_post, is_ad, post_status, ad_status, ad_budget_mode, ad_budget_amount, targeting, title, body, media_kind, media_url, cta_label, cta_url, position, created_at",
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
