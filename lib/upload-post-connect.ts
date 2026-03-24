import type { SupabaseClient } from "@supabase/supabase-js";
import { generateUploadPostJwt } from "@/lib/upload-post";
import { getUploadPostServerKey } from "@/lib/upload-post-forward";

const JWT_CACHE_MIN_HOURS = 24;

export type ConnectUrlResult =
	| { ok: true; access_url: string; duration: string; cached?: boolean }
	| { ok: false; status: number; error: string };

export async function getOrRefreshUploadPostConnectUrl(
	supabase: SupabaseClient,
	internalUserId: string,
	accountId: string,
	options?: { redirect_url?: string; logo_image?: string },
): Promise<ConnectUrlResult> {
	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key, upload_post_api_key_encrypted, jwt_access_url, jwt_expires_at")
		.eq("id", accountId)
		.eq("user_id", internalUserId)
		.single();

	if (error || !account) {
		return { ok: false, status: 404, error: "Not found" };
	}

	let apiKey: string | null = null;
	if (account.uses_own_key) {
		apiKey = account.upload_post_api_key_encrypted?.trim() ?? null;
	} else {
		apiKey = getUploadPostServerKey();
	}
	if (!apiKey) {
		return {
			ok: false,
			status: 503,
			error: account.uses_own_key ? "API key not set for this account" : "Upload-Post not configured",
		};
	}

	const now = Date.now();
	const expiresAt = account.jwt_expires_at ? new Date(account.jwt_expires_at).getTime() : 0;
	const minExpiry = now + JWT_CACHE_MIN_HOURS * 60 * 60 * 1000;
	if (account.jwt_access_url && expiresAt > minExpiry) {
		return {
			ok: true,
			access_url: account.jwt_access_url,
			duration: "48h",
			cached: true,
		};
	}

	const appOrigin =
		process.env.NEXT_PUBLIC_APP_ORIGIN ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://extensiblecontent.com");
	const redirectUrl = options?.redirect_url ?? `${appOrigin}/extension/settings?upload=connected`;

	const res = await generateUploadPostJwt(account.upload_post_username, apiKey, {
		redirect_url: redirectUrl,
		logo_image: options?.logo_image,
		connect_title: "Connect Social Media Accounts",
		connect_description: "Connect your social media accounts to post from Extensible Content.",
		show_calendar: false,
	});

	if (!res.success || !res.access_url) {
		return { ok: false, status: 500, error: "Failed to generate connect URL" };
	}

	const jwtExpiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();
	await supabase
		.from("upload_post_accounts")
		.update({
			jwt_access_url: res.access_url,
			jwt_expires_at: jwtExpiresAt,
			updated_at: new Date().toISOString(),
		})
		.eq("id", accountId)
		.eq("user_id", internalUserId);

	return { ok: true, access_url: res.access_url, duration: res.duration ?? "48h" };
}
