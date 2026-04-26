import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { getValidTokenForLocation } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * GET /api/extension/ghl/social/schedule?locationId=...&status=pending
 * List the current user's scheduled posts.
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const locationId = request.nextUrl.searchParams.get("locationId");
	const status = request.nextUrl.searchParams.get("status");

	const supabase = getSupabase();
	let query = supabase
		.from("ghl_scheduled_posts")
		.select(
			"id, location_id, payload, scheduled_for, status, attempts, last_error, ghl_post_id, source, created_at",
		)
		.eq("user_id", user.user_id)
		.order("scheduled_for", { ascending: true })
		.limit(200);

	if (locationId) query = query.eq("location_id", locationId);
	if (status) query = query.eq("status", status);

	const { data, error } = await query;
	if (error) return Response.json({ error: error.message }, { status: 500 });

	return Response.json({ posts: data ?? [] });
}

/**
 * POST /api/extension/ghl/social/schedule
 * Body: { locationId, scheduledFor (ISO8601), payload }
 *   payload is the JSON body passed to GHL's
 *   POST /social-media-posting/:locationId/posts (accountIds, summary, media, etc.)
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		locationId?: string;
		scheduledFor?: string;
		payload?: Record<string, unknown>;
		source?: string;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { locationId, scheduledFor, payload, source } = body;
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}
	if (!scheduledFor) {
		return Response.json({ error: "scheduledFor is required" }, { status: 400 });
	}
	if (!payload || typeof payload !== "object") {
		return Response.json({ error: "payload is required" }, { status: 400 });
	}

	const when = new Date(scheduledFor);
	if (Number.isNaN(when.getTime())) {
		return Response.json({ error: "scheduledFor is not a valid date" }, { status: 400 });
	}

	// Verifies the user actually has access to this location (via the
	// ghl_connection_users join table). Throws if not.
	let ghlLocationDbId: string;
	try {
		const resolved = await getValidTokenForLocation(user.user_id, locationId);
		ghlLocationDbId = resolved.ghlLocationDbId;
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Access denied";
		return Response.json({ error: msg }, { status: 403 });
	}

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("ghl_scheduled_posts")
		.insert({
			user_id: user.user_id,
			ghl_location_id: ghlLocationDbId,
			location_id: locationId,
			payload,
			scheduled_for: when.toISOString(),
			source: source ?? "extension",
		})
		.select("id, scheduled_for, status")
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });

	return Response.json({ post: data });
}

/**
 * DELETE /api/extension/ghl/social/schedule?id=...
 * Cancels a pending scheduled post. Only the owner can cancel.
 */
export async function DELETE(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const id = request.nextUrl.searchParams.get("id");
	if (!id) return Response.json({ error: "id is required" }, { status: 400 });

	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("ghl_scheduled_posts")
		.update({ status: "cancelled", updated_at: new Date().toISOString() })
		.eq("id", id)
		.eq("user_id", user.user_id)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	if (!data) {
		return Response.json(
			{ error: "Scheduled post not found or no longer pending" },
			{ status: 404 },
		);
	}

	return Response.json({ ok: true });
}
