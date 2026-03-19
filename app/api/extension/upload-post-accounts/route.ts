import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { createUploadPostProfile } from "@/lib/upload-post";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function getUploadPostKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select("id, user_id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at")
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json(accounts ?? []);
}

export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { name: string; api_key?: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { name, api_key: userApiKey } = body;
	if (!name || typeof name !== "string" || !name.trim()) {
		return Response.json({ error: "name is required" }, { status: 400 });
	}

	const isByok = !!userApiKey && typeof userApiKey === "string" && userApiKey.trim().length > 0;
	const apiKey = isByok ? userApiKey!.trim() : getUploadPostKey();

	if (!apiKey) {
		return Response.json(
			{ error: isByok ? "Invalid API key" : "Upload-Post not configured" },
			{ status: 503 }
		);
	}

	const supabase = getSupabase();

	// Check max_upload_post_accounts limit
	const { data: userRow } = await supabase.from("users").select("max_upload_post_accounts").eq("id", user.user_id).single();
	const max = userRow?.max_upload_post_accounts ?? 0;
	if (max <= 0) {
		return Response.json({ error: "Upload-Post accounts are not available for your plan" }, { status: 403 });
	}

	const { count } = await supabase.from("upload_post_accounts").select("*", { count: "exact", head: true }).eq("user_id", user.user_id);
	if (count !== null && count >= max) {
		return Response.json(
			{ error: `Maximum ${max} Upload-Post account(s) allowed. Upgrade to add more.` },
			{ status: 403 }
		);
	}

	// Generate unique username for Upload-Post (stable: extensible_<user_id>_<account_uuid>)
	const accountId = crypto.randomUUID();
	const uploadPostUsername = `extensible_${user.user_id}_${accountId}`;

	// Create profile in Upload-Post first (must succeed before we insert)
	try {
		const createRes = await createUploadPostProfile(uploadPostUsername, apiKey);
		if (!createRes.success || !createRes.profile) {
			return Response.json(
				{ error: "Upload-Post did not confirm profile creation" },
				{ status: 500 }
			);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Failed to create Upload-Post profile";
		// 409 = profile already exists (unlikely with UUID)
		return Response.json({ error: msg }, { status: 500 });
	}

	// Insert into our DB (exclude api_key from response)
	const insertRow: Record<string, unknown> = {
		id: accountId,
		user_id: user.user_id,
		name: name.trim(),
		upload_post_username: uploadPostUsername,
		uses_own_key: isByok,
		updated_at: new Date().toISOString(),
	};
	if (isByok) {
		insertRow.upload_post_api_key_encrypted = userApiKey!.trim();
	}

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.insert(insertRow)
		.select("id, user_id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at")
		.single();

	if (error) {
		// Rollback: delete from Upload-Post if we can't save locally
		try {
			const { deleteUploadPostProfile } = await import("@/lib/upload-post");
			await deleteUploadPostProfile(uploadPostUsername, apiKey);
		} catch {
			// ignore
		}
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json(account);
}
