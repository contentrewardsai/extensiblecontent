import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
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

	const { name, birthday = null, accounts = [], emails = [], phones = [], addresses = [], notes = [] } = body;

	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const { data: following, error: insertError } = await supabase
		.from("following")
		.insert({
			user_id: user.user_id,
			name: name.trim(),
			birthday: birthday || null,
			updated_at: new Date().toISOString(),
		})
		.select()
		.single();

	if (insertError || !following) {
		return Response.json({ error: insertError?.message ?? "Failed to create following" }, { status: 500 });
	}

	const followingId = following.id as string;

	if (accounts.length > 0) {
		await supabase.from("following_accounts").insert(
			accounts.map((a) => ({
				following_id: followingId,
				handle: a.handle ?? null,
				url: a.url ?? null,
				platform_id: a.platform_id,
			}))
		);
	}
	if (emails.length > 0) {
		await supabase.from("following_emails").insert(
			emails.map((e) => ({
				following_id: followingId,
				email: e.email,
				added_by: user.user_id,
			}))
		);
	}
	if (phones.length > 0) {
		await supabase.from("following_phones").insert(
			phones.map((p) => ({
				following_id: followingId,
				phone_number: p.phone_number,
				added_by: user.user_id,
			}))
		);
	}
	if (addresses.length > 0) {
		await supabase.from("following_addresses").insert(
			addresses.map((a) => ({
				following_id: followingId,
				address: a.address ?? null,
				address_2: a.address_2 ?? null,
				city: a.city ?? null,
				state: a.state ?? null,
				zip: a.zip ?? null,
				country: a.country ?? null,
				added_by: user.user_id,
			}))
		);
	}
	if (notes.length > 0) {
		await supabase.from("following_notes").insert(
			notes.map((n) => ({
				following_id: followingId,
				note: n.note,
				added_by: user.user_id,
				access: n.access ?? null,
				scheduled: n.scheduled ?? null,
			}))
		);
	}

	const result = await followingWithJoins(supabase, following);
	return Response.json(result);
}
