import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { deleteUploadPostProfile } from "@/lib/upload-post";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function getUploadPostKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data, error } = await supabase
		.from("upload_post_accounts")
		.select("id, name, upload_post_username, created_at, jwt_access_url")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !data) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({
		id: data.id,
		name: data.name,
		username: data.upload_post_username,
		access_url: data.jwt_access_url ?? undefined,
		accessUrl: data.jwt_access_url ?? undefined,
		created_at: data.created_at,
	});
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	let body: { name?: string; platform?: string; profile_url?: string } = {};
	try {
		const raw = await request.json();
		if (raw && typeof raw === "object") body = raw;
	} catch {
		// empty body ok
	}

	const supabase = getSupabase();
	const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
	if (body.name !== undefined) {
		if (typeof body.name !== "string" || !body.name.trim()) {
			return Response.json({ error: "name must be a non-empty string" }, { status: 400 });
		}
		updates.name = body.name.trim();
	}

	if (Object.keys(updates).length <= 1) {
		const { data: current } = await supabase
			.from("upload_post_accounts")
			.select("id, name, upload_post_username, created_at, jwt_access_url")
			.eq("id", id)
			.eq("user_id", user.user_id)
			.single();
		if (current) {
			return Response.json({
				id: current.id,
				name: current.name,
				username: current.upload_post_username,
				access_url: current.jwt_access_url ?? undefined,
				accessUrl: current.jwt_access_url ?? undefined,
				created_at: current.created_at,
			});
		}
	}

	const { data, error } = await supabase
		.from("upload_post_accounts")
		.update(updates)
		.eq("id", id)
		.eq("user_id", user.user_id)
		.select("id, name, upload_post_username, created_at, jwt_access_url")
		.single();

	if (error) return Response.json({ error: error.message }, { status: 500 });
	if (!data) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({
		id: data.id,
		name: data.name,
		username: data.upload_post_username,
		access_url: data.jwt_access_url ?? undefined,
		accessUrl: data.jwt_access_url ?? undefined,
		created_at: data.created_at,
	});
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: account } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key, upload_post_api_key_encrypted")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (account) {
		const apiKey = account.uses_own_key
			? (account.upload_post_api_key_encrypted?.trim() ?? null)
			: getUploadPostKey();
		if (apiKey) {
			try {
				await deleteUploadPostProfile(account.upload_post_username, apiKey);
			} catch (err) {
				console.error("[social-profiles] delete from Upload-Post failed:", err);
			}
		}
	}

	const { error } = await supabase.from("upload_post_accounts").delete().eq("id", id).eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	return Response.json({ success: true });
}
