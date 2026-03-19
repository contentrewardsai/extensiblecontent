import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { generateUploadPostJwt } from "@/lib/upload-post";

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
 * Vercel cron: refresh JWT tokens for all upload_post_accounts daily.
 * JWTs expire in 48h; refreshing daily keeps them valid.
 * Secured by CRON_SECRET (Vercel sends Bearer token).
 */
export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const managedKey = getUploadPostKey();

	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select("id, upload_post_username, uses_own_key, upload_post_api_key_encrypted");

	if (error) {
		console.error("[upload-post-jwt-refresh] List error:", error);
		return Response.json({ error: error.message }, { status: 500 });
	}
	if (!accounts?.length) {
		return Response.json({ refreshed: 0, skipped: 0, errors: [] });
	}

	let refreshed = 0;
	let skipped = 0;
	const errors: string[] = [];
	const now = Date.now();
	const expiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();

	for (const acc of accounts) {
		const apiKey = acc.uses_own_key
			? (acc.upload_post_api_key_encrypted?.trim() ?? null)
			: managedKey;
		if (!apiKey) {
			skipped++;
			continue;
		}

		try {
			const res = await generateUploadPostJwt(acc.upload_post_username, apiKey, {
				connect_title: "Connect Social Media Accounts",
				connect_description: "Connect your social media accounts to post from Extensible Content.",
				show_calendar: false,
			});

			if (res.success && res.access_url) {
				await supabase
					.from("upload_post_accounts")
					.update({
						jwt_access_url: res.access_url,
						jwt_expires_at: expiresAt,
						updated_at: new Date().toISOString(),
					})
					.eq("id", acc.id);
				refreshed++;
			} else {
				errors.push(`${acc.upload_post_username}: no access_url`);
			}
		} catch (err) {
			errors.push(`${acc.upload_post_username}: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}

	return Response.json({ refreshed, skipped, errors });
}
