import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
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

	const { data: existing } = await supabase.from("following").select("id").eq("id", id).eq("user_id", user.user_id).single();
	if (!existing) {
		return Response.json({ error: "Following not found" }, { status: 404 });
	}

	let body: FollowingUpdate;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, birthday, accounts, emails, phones, addresses, notes } = body;

	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (name !== undefined) {
		if (typeof name !== "string" || !name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		updates.name = name.trim();
	}
	if (birthday !== undefined) updates.birthday = birthday;

	await supabase.from("following").update(updates).eq("id", id);

	if (accounts !== undefined) {
		await supabase.from("following_accounts").delete().eq("following_id", id);
		if (accounts.length > 0) {
			await supabase.from("following_accounts").insert(
				accounts.map((a) => ({
					following_id: id,
					handle: a.handle ?? null,
					url: a.url ?? null,
					platform_id: a.platform_id,
				}))
			);
		}
	}
	if (emails !== undefined) {
		await supabase.from("following_emails").delete().eq("following_id", id);
		if (emails.length > 0) {
			await supabase.from("following_emails").insert(
				emails.map((e) => ({
					following_id: id,
					email: e.email,
					added_by: user.user_id,
				}))
			);
		}
	}
	if (phones !== undefined) {
		await supabase.from("following_phones").delete().eq("following_id", id);
		if (phones.length > 0) {
			await supabase.from("following_phones").insert(
				phones.map((p) => ({
					following_id: id,
					phone_number: p.phone_number,
					added_by: user.user_id,
				}))
			);
		}
	}
	if (addresses !== undefined) {
		await supabase.from("following_addresses").delete().eq("following_id", id);
		if (addresses.length > 0) {
			await supabase.from("following_addresses").insert(
				addresses.map((a) => ({
					following_id: id,
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
	}
	if (notes !== undefined) {
		await supabase.from("following_notes").delete().eq("following_id", id);
		if (notes.length > 0) {
			await supabase.from("following_notes").insert(
				notes.map((n) => ({
					following_id: id,
					note: n.note,
					added_by: user.user_id,
					access: n.access ?? null,
					scheduled: n.scheduled ?? null,
				}))
			);
		}
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

	const { data: existing } = await supabase.from("following").select("id").eq("id", id).eq("user_id", user.user_id).single();
	if (!existing) {
		return Response.json({ error: "Following not found" }, { status: 404 });
	}

	await supabase.from("following").update({ deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
	return new Response(null, { status: 204 });
}
