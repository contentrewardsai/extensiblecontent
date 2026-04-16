import type { SupabaseClient } from "@supabase/supabase-js";
import { getUploadPostServerKey } from "@/lib/upload-post-forward";

const UPLOAD_POST_BASE = "https://api.upload-post.com";

export type ProxyResult =
	| { ok: true; status: number; json: unknown }
	| { ok: false; status: number; error: string };

interface AccountInfo {
	upload_post_username: string;
	apiKey: string;
}

/**
 * Resolve an Upload Post account for a user by profile_username.
 * Returns the actual upload_post_username and the API key to use.
 */
export async function resolveUploadPostAccount(
	supabase: SupabaseClient,
	userId: string,
	profileUsername: string,
): Promise<{ ok: true; account: AccountInfo } | { ok: false; status: number; error: string }> {
	if (!profileUsername) {
		return { ok: false, status: 400, error: "profile_username is required" };
	}

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key, upload_post_api_key_encrypted")
		.eq("upload_post_username", profileUsername)
		.eq("user_id", userId)
		.single();

	if (error || !account) {
		return { ok: false, status: 404, error: "Account not found" };
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

	return { ok: true, account: { upload_post_username: account.upload_post_username, apiKey } };
}

/**
 * Forward a JSON request to the Upload Post API.
 */
export async function forwardUploadPostJson(
	method: string,
	apiPath: string,
	apiKey: string,
	options?: {
		body?: Record<string, unknown>;
		queryParams?: URLSearchParams;
	},
): Promise<ProxyResult> {
	const qs = options?.queryParams?.toString();
	const url = `${UPLOAD_POST_BASE}${apiPath}${qs ? "?" + qs : ""}`;

	const headers: Record<string, string> = {
		Authorization: `Apikey ${apiKey}`,
	};
	const fetchOpts: RequestInit = { method, headers };

	if (options?.body && (method === "POST" || method === "PUT" || method === "PATCH")) {
		headers["Content-Type"] = "application/json";
		fetchOpts.body = JSON.stringify(options.body);
	}

	let res: Response;
	try {
		res = await fetch(url, fetchOpts);
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Network error";
		return { ok: false, status: 502, error: msg };
	}

	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		return { ok: false, status: 502, error: "Upload-Post returned invalid response" };
	}

	if (!res.ok) {
		const errObj = json as Record<string, unknown> | null;
		const msg = (errObj?.message ?? errObj?.error ?? `HTTP ${res.status}`) as string;
		return { ok: false, status: res.status, error: msg };
	}

	return { ok: true, status: res.status, json };
}

/**
 * Full proxy flow: resolve account, forward JSON request, return response.
 */
export async function proxyUploadPostRequest(
	supabase: SupabaseClient,
	userId: string,
	profileUsername: string,
	method: string,
	apiPath: string,
	options?: {
		body?: Record<string, unknown>;
		queryParams?: URLSearchParams;
	},
): Promise<ProxyResult> {
	const resolved = await resolveUploadPostAccount(supabase, userId, profileUsername);
	if (!resolved.ok) return resolved;

	return forwardUploadPostJson(method, apiPath, resolved.account.apiKey, options);
}
