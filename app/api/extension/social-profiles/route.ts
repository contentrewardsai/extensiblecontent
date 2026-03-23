import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { countUploadPostAccountsForUser } from "@/lib/upload-post-account-limits";
import { createUploadPostProfile, generateUploadPostJwt } from "@/lib/upload-post";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

function getUploadPostKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

/**
 * GET: List user's social profiles (Upload-Post accounts).
 * Returns upload_post_accounts in a shape compatible with the extension (name, username, access_url, etc.).
 */
export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const supabase = getSupabase();
	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select("id, name, upload_post_username, created_at, jwt_access_url")
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (error) return Response.json({ error: error.message }, { status: 500 });

	// Shape for extension: name, username, access_url, created_at
	const profiles = (accounts ?? []).map((a) => ({
		id: a.id,
		name: a.name,
		username: a.upload_post_username,
		access_url: a.jwt_access_url ?? undefined,
		accessUrl: a.jwt_access_url ?? undefined,
		created_at: a.created_at,
	}));

	return Response.json({ profiles });
}

/**
 * POST: Create a social profile (Upload-Post account).
 * Creates in Upload-Post first, then upload_post_accounts.
 * Body: { name: string, platform?: string, profile_url?: string, api_key?: string }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { name: string; platform?: string; profile_url?: string; api_key?: string };
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

	const numAccounts = await countUploadPostAccountsForUser(supabase, user.user_id);
	if (numAccounts >= max) {
		return Response.json(
			{ error: `Maximum ${max} Upload-Post account(s) allowed. Upgrade to add more.` },
			{ status: 403 }
		);
	}

	const accountId = crypto.randomUUID();
	const uploadPostUsername = `extensible_${user.user_id}_${accountId}`;

	// Create profile in Upload-Post first
	try {
		const createRes = await createUploadPostProfile(uploadPostUsername, apiKey);
		if (!createRes.success || !createRes.profile) {
			return Response.json({ error: "Upload-Post did not confirm profile creation" }, { status: 500 });
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Failed to create Upload-Post profile";
		return Response.json({ error: msg }, { status: 500 });
	}

	// Generate JWT immediately
	const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://extensiblecontent.com");
	const redirectUrl = `${appOrigin}/extension/settings?upload=connected`;
	let jwtAccessUrl: string | null = null;
	let jwtExpiresAt: string | null = null;
	try {
		const jwtRes = await generateUploadPostJwt(uploadPostUsername, apiKey, {
			redirect_url: redirectUrl,
			connect_title: "Connect Social Media Accounts",
			connect_description: "Connect your social media accounts to post from Extensible Content.",
			show_calendar: false,
		});
		if (jwtRes.success && jwtRes.access_url) {
			jwtAccessUrl = jwtRes.access_url;
			jwtExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
		}
	} catch {
		// Non-fatal
	}

	const insertRow: Record<string, unknown> = {
		id: accountId,
		user_id: user.user_id,
		name: name.trim(),
		upload_post_username: uploadPostUsername,
		uses_own_key: isByok,
		updated_at: new Date().toISOString(),
	};
	if (isByok) insertRow.upload_post_api_key_encrypted = userApiKey!.trim();
	if (jwtAccessUrl) insertRow.jwt_access_url = jwtAccessUrl;
	if (jwtExpiresAt) insertRow.jwt_expires_at = jwtExpiresAt;

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.insert(insertRow)
		.select("id, name, upload_post_username, created_at, jwt_access_url")
		.single();

	if (error) {
		try {
			const { deleteUploadPostProfile } = await import("@/lib/upload-post");
			await deleteUploadPostProfile(uploadPostUsername, apiKey);
		} catch {
			// ignore
		}
		return Response.json({ error: error.message }, { status: 500 });
	}

	// Return shape compatible with extension
	return Response.json({
		id: account.id,
		name: account.name,
		username: account.upload_post_username,
		access_url: account.jwt_access_url ?? undefined,
		accessUrl: account.jwt_access_url ?? undefined,
		created_at: account.created_at,
	});
}
