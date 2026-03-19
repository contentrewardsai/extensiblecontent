import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
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

/** JWT valid for 48h; return cached if >24h remaining */
const JWT_CACHE_MIN_HOURS = 24;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key, upload_post_api_key_encrypted, jwt_access_url, jwt_expires_at")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !account) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	// Resolve API key: BYOK or managed
	let apiKey: string | null = null;
	if (account.uses_own_key) {
		apiKey = account.upload_post_api_key_encrypted?.trim() ?? null;
	} else {
		apiKey = getUploadPostKey();
	}
	if (!apiKey) {
		return Response.json(
			{ error: account.uses_own_key ? "API key not set for this account" : "Upload-Post not configured" },
			{ status: 503 }
		);
	}

	// Return cached JWT if still valid (>24h remaining)
	const now = Date.now();
	const expiresAt = account.jwt_expires_at ? new Date(account.jwt_expires_at).getTime() : 0;
	const minExpiry = now + JWT_CACHE_MIN_HOURS * 60 * 60 * 1000;
	if (account.jwt_access_url && expiresAt > minExpiry) {
		return Response.json({
			access_url: account.jwt_access_url,
			duration: "48h",
			cached: true,
		});
	}

	let body: { redirect_url?: string; logo_image?: string } = {};
	try {
		body = await request.json();
	} catch {
		// empty body is ok
	}

	const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://extensiblecontent.com");
	const redirectUrl = body.redirect_url ?? `${appOrigin}/extension/settings?upload=connected`;

	const res = await generateUploadPostJwt(account.upload_post_username, apiKey, {
		redirect_url: redirectUrl,
		logo_image: body.logo_image,
		connect_title: "Connect Social Media Accounts",
		connect_description: "Connect your social media accounts to post from Extensible Content.",
		show_calendar: false,
	});

	if (!res.success || !res.access_url) {
		return Response.json({ error: "Failed to generate connect URL" }, { status: 500 });
	}

	// Cache JWT (expires in 48h)
	const jwtExpiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();
	await supabase
		.from("upload_post_accounts")
		.update({
			jwt_access_url: res.access_url,
			jwt_expires_at: jwtExpiresAt,
			updated_at: new Date().toISOString(),
		})
		.eq("id", id)
		.eq("user_id", user.user_id);

	return Response.json({ access_url: res.access_url, duration: res.duration ?? "48h" });
}
