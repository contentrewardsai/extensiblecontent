import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { isPlanAdmin, parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
	params: Promise<{ planId: string; platformId: string }>;
}

async function loadAdminContext(request: NextRequest, planId: string, platformId: string) {
	if (!UUID_RE.test(platformId)) {
		return { ok: false as const, status: 400, error: "Invalid platform id" };
	}
	const user = await getExtensionUser(request);
	if (!user) return { ok: false as const, status: 401, error: "Unauthorized" };

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id, admin_user_id")
		.eq("id", planId)
		.maybeSingle();
	if (!plan) return { ok: false as const, status: 404, error: "Plan not found" };
	if (!isPlanAdmin(plan, user.user_id)) {
		return { ok: false as const, status: 403, error: "Forbidden" };
	}
	return { ok: true as const, supabase, planId, platformId };
}

/**
 * PATCH /api/plan/:planId/platforms/:platformId
 *
 * Admin-only. Updates platform-level fields ({ name?, followers? }).
 * Anyone updating a platform that isn't their own plan is rejected.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, platformId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const ctx = await loadAdminContext(request, parsed.id, platformId);
	if (!ctx.ok) return Response.json({ error: ctx.error }, { status: ctx.status });

	let body: { name?: unknown; followers?: unknown };
	try {
		body = (await request.json()) as { name?: unknown; followers?: unknown };
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || !body.name.trim()) {
			return Response.json({ error: "name must be non-empty" }, { status: 400 });
		}
		updates.name = body.name.trim().slice(0, 64);
	}
	if (body.followers !== undefined) {
		const n = Math.floor(Number(body.followers));
		if (!Number.isFinite(n) || n < 0) {
			return Response.json({ error: "followers must be a non-negative integer" }, { status: 400 });
		}
		updates.followers = n;
	}
	if (Object.keys(updates).length === 0) {
		return Response.json({ error: "No fields to update" }, { status: 400 });
	}

	const { data: row, error } = await ctx.supabase
		.from("promotion_plan_platforms")
		.update(updates)
		.eq("id", ctx.platformId)
		.eq("plan_id", ctx.planId)
		.select("id, plan_id, name, followers, position, created_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	}
	return Response.json(row);
}

/**
 * DELETE /api/plan/:planId/platforms/:platformId
 *
 * Admin-only. Cascades to all child content + comments via FK.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, platformId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	const ctx = await loadAdminContext(request, parsed.id, platformId);
	if (!ctx.ok) return Response.json({ error: ctx.error }, { status: ctx.status });

	const { error } = await ctx.supabase
		.from("promotion_plan_platforms")
		.delete()
		.eq("id", ctx.platformId)
		.eq("plan_id", ctx.planId);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
