import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { createFollowingForUser } from "@/lib/following-mutations";
import { followingWithJoins } from "@/lib/queries/following";
import type { FollowingInsert } from "@/lib/types/following";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const { data: list, error } = await supabase
		.from("following")
		.select("*")
		.eq("user_id", user.user_id)
		.eq("deleted", false)
		.order("updated_at", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	const withJoins = await Promise.all((list ?? []).map((f) => followingWithJoins(supabase, f)));
	return Response.json(withJoins);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: FollowingInsert;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getSupabase();
	const created = await createFollowingForUser(supabase, user.user_id, body);
	if (!created.ok) {
		return Response.json({ error: created.error }, { status: created.status });
	}

	const { data: following, error: fetchErr } = await supabase.from("following").select("*").eq("id", created.id).single();
	if (fetchErr || !following) {
		return Response.json({ error: fetchErr?.message ?? "Failed to load following" }, { status: 500 });
	}

	const result = await followingWithJoins(supabase, following);
	return Response.json(result);
}
