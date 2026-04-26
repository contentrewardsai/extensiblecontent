import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/scheduled-posts?userId=...&locationId=...[&status=...]
 *
 * Returns the given Whop user's scheduled posts for the given GHL location.
 * Access is verified via the ghl_connection_users join table (the caller
 * must actually have access to the connection that owns this location).
 */
export async function GET(request: NextRequest) {
	const userId = request.nextUrl.searchParams.get("userId");
	const locationId = request.nextUrl.searchParams.get("locationId");
	const status = request.nextUrl.searchParams.get("status");

	if (!userId) {
		return Response.json({ error: "userId is required" }, { status: 400 });
	}
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	const supabase = getServiceSupabase();

	const { data: loc } = await supabase
		.from("ghl_locations")
		.select("connection_id")
		.eq("location_id", locationId)
		.maybeSingle();

	if (!loc) return Response.json({ posts: [] });

	const { data: access } = await supabase
		.from("ghl_connection_users")
		.select("id")
		.eq("connection_id", loc.connection_id)
		.eq("user_id", userId)
		.maybeSingle();

	if (!access) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	let query = supabase
		.from("ghl_scheduled_posts")
		.select(
			"id, payload, scheduled_for, status, attempts, last_error, ghl_post_id, source, created_at",
		)
		.eq("user_id", userId)
		.eq("location_id", locationId)
		.order("scheduled_for", { ascending: false })
		.limit(50);

	if (status) query = query.eq("status", status);

	const { data, error } = await query;
	if (error) return Response.json({ error: error.message }, { status: 500 });

	return Response.json({ posts: data ?? [] });
}

/**
 * DELETE /api/ghl/scheduled-posts?id=...&userId=...
 *
 * Cancels a pending scheduled post. Only the owner can cancel.
 */
export async function DELETE(request: NextRequest) {
	const id = request.nextUrl.searchParams.get("id");
	const userId = request.nextUrl.searchParams.get("userId");

	if (!id) return Response.json({ error: "id is required" }, { status: 400 });
	if (!userId)
		return Response.json({ error: "userId is required" }, { status: 400 });

	const supabase = getServiceSupabase();
	const { data, error } = await supabase
		.from("ghl_scheduled_posts")
		.update({ status: "cancelled", updated_at: new Date().toISOString() })
		.eq("id", id)
		.eq("user_id", userId)
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
