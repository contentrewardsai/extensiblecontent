import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { updateFollowingForUser, deleteFollowingForUser } from "@/lib/following-mutations";
import { followingWithJoins } from "@/lib/queries/following";
import type { FollowingUpdate } from "@/lib/types/following";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const { data: following, error } = await supabase
		.from("following")
		.select("*")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.eq("deleted", false)
		.single();

	if (error || !following) {
		return Response.json({ error: error?.message ?? "Following not found" }, { status: 404 });
	}

	const result = await followingWithJoins(supabase, following);
	return Response.json(result);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	let body: FollowingUpdate;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const updated = await updateFollowingForUser(supabase, user.user_id, id, body);
	if (!updated.ok) {
		return Response.json({ error: updated.error }, { status: updated.status });
	}

	const { data: following } = await supabase.from("following").select("*").eq("id", id).single();
	if (!following) {
		return Response.json({ error: "Failed to fetch updated following" }, { status: 500 });
	}

	const result = await followingWithJoins(supabase, following);
	return Response.json(result);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const supabase = getSupabase();

	const removed = await deleteFollowingForUser(supabase, user.user_id, id);
	if (!removed.ok) {
		return Response.json({ error: removed.error }, { status: removed.status });
	}
	return new Response(null, { status: 204 });
}
