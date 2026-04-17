import type { NextRequest } from "next/server";
import { parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
	params: Promise<{ planId: string; platformId: string }>;
}

/**
 * Both endpoints below are **public** by design — `/plan/<slug>` is a
 * fully open collaborative document. Anyone with the link can rename
 * profiles, edit follower counts, and remove platforms (cascading to
 * the platform's content + comments). The plan slug itself has no
 * delete path.
 */

export async function PATCH(request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, platformId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	if (!UUID_RE.test(platformId)) {
		return Response.json({ error: "Invalid platform id" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

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

	const { data: row, error } = await supabase
		.from("promotion_plan_platforms")
		.update(updates)
		.eq("id", platformId)
		.eq("plan_id", parsed.id)
		.select("id, plan_id, name, followers, position, created_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Update failed" }, { status: 500 });
	}
	return Response.json(row);
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
	const { planId: rawPlanId, platformId } = await params;
	const parsed = parsePlanId(rawPlanId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
	if (!UUID_RE.test(platformId)) {
		return Response.json({ error: "Invalid platform id" }, { status: 400 });
	}

	const supabase = getServiceSupabase();
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

	const { error } = await supabase
		.from("promotion_plan_platforms")
		.delete()
		.eq("id", platformId)
		.eq("plan_id", parsed.id);
	if (error) return Response.json({ error: error.message }, { status: 500 });
	return new Response(null, { status: 204 });
}
