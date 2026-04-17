import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { type CommentKind, parsePlanId } from "@/lib/promotion-plan";
import { getServiceSupabase } from "@/lib/supabase-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
	params: Promise<{ planId: string }>;
}

/**
 * POST /api/plan/:planId/comments
 *
 * Public. Adds a comment either to the plan as a whole or to a specific
 * content piece (post or ad thread). Body:
 *   {
 *     body: string (1..2000 chars),
 *     content_id?: uuid (required when kind != "plan"),
 *     kind?: "plan" | "post" | "ad" (default "plan"),
 *     author_name?: string (defaults to "Guest" or the signed-in user's email)
 *   }
 *
 * If the caller is signed in via Whop, we record their user id for
 * attribution but the operation itself does not require auth.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
	const parsed = parsePlanId((await params).planId);
	if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

	let body: {
		body?: unknown;
		content_id?: unknown;
		kind?: unknown;
		author_name?: unknown;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const text =
		typeof body.body === "string" ? body.body.trim() : "";
	if (!text) return Response.json({ error: "body is required" }, { status: 400 });
	if (text.length > 2000) {
		return Response.json({ error: "body must be at most 2000 characters" }, { status: 400 });
	}

	let contentId: string | null = null;
	let kind: CommentKind = "plan";
	if (body.kind === "post" || body.kind === "ad") {
		kind = body.kind;
		if (typeof body.content_id !== "string" || !UUID_RE.test(body.content_id)) {
			return Response.json(
				{ error: "content_id is required for post/ad comments" },
				{ status: 400 },
			);
		}
		contentId = body.content_id;
	} else if (body.content_id !== undefined && body.content_id !== null) {
		return Response.json(
			{ error: "content_id requires kind 'post' or 'ad'" },
			{ status: 400 },
		);
	}

	const supabase = getServiceSupabase();

	// Confirm the plan / content row exists & belongs together.
	const { data: plan } = await supabase
		.from("promotion_plans")
		.select("id")
		.eq("id", parsed.id)
		.maybeSingle();
	if (!plan) return Response.json({ error: "Plan not found" }, { status: 404 });

	if (contentId) {
		const { data: content } = await supabase
			.from("promotion_plan_content")
			.select("id")
			.eq("id", contentId)
			.eq("plan_id", parsed.id)
			.maybeSingle();
		if (!content) return Response.json({ error: "Content not found" }, { status: 404 });
	}

	const user = await getExtensionUser(request).catch(() => null);
	const authorName =
		typeof body.author_name === "string" && body.author_name.trim().length > 0
			? body.author_name.trim().slice(0, 80)
			: (user?.email?.split("@")[0]?.slice(0, 80) ?? "Guest");

	const { data: row, error } = await supabase
		.from("promotion_plan_comments")
		.insert({
			plan_id: parsed.id,
			content_id: contentId,
			kind,
			author_name: authorName,
			author_user_id: user?.user_id ?? null,
			body: text,
		})
		.select("id, plan_id, content_id, kind, author_name, author_user_id, body, created_at")
		.single();

	if (error || !row) {
		return Response.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
	}
	return Response.json(row, { status: 201 });
}
