import type { SupabaseClient } from "@supabase/supabase-js";
import {
	createUploadPostProfile,
	deleteUploadPostProfile,
	generateUploadPostJwt,
} from "@/lib/upload-post";

/**
 * Shared "create an Upload-Post account" flow used by both the extension API
 * route (`POST /api/extension/upload-post-accounts`) and the dashboard server
 * action (`createUploadPostAccountAction`). Keeps the limit check, profile
 * creation, JWT mint, and rollback-on-DB-failure in one place so the two entry
 * points can never drift.
 */

export interface UploadPostAccountRow {
	id: string;
	user_id: string;
	name: string;
	upload_post_username: string;
	uses_own_key: boolean;
	created_at: string;
	updated_at: string;
	jwt_access_url: string | null;
	jwt_expires_at: string | null;
}

export type CreateUploadPostAccountResult =
	| { ok: true; account: UploadPostAccountRow }
	| { ok: false; status: number; error: string };

interface CreateUploadPostAccountInput {
	name: string;
	/** Optional BYOK key. When omitted, falls back to `UPLOAD_POST_API_KEY`. */
	apiKey?: string | null;
	/** Origin used to build the post-connect redirect URL. */
	appOrigin?: string | null;
}

function getManagedKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

function defaultAppOrigin(): string {
	return (
		process.env.NEXT_PUBLIC_APP_ORIGIN ??
		(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://extensiblecontent.com")
	);
}

export async function createUploadPostAccount(
	supabase: SupabaseClient,
	userId: string,
	{ name, apiKey: rawApiKey, appOrigin }: CreateUploadPostAccountInput,
): Promise<CreateUploadPostAccountResult> {
	const trimmedName = typeof name === "string" ? name.trim() : "";
	if (!trimmedName) {
		return { ok: false, status: 400, error: "name is required" };
	}

	const isByok = !!rawApiKey && typeof rawApiKey === "string" && rawApiKey.trim().length > 0;
	const apiKey = isByok ? rawApiKey!.trim() : getManagedKey();
	if (!apiKey) {
		return {
			ok: false,
			status: 503,
			error: isByok ? "Invalid API key" : "Upload-Post not configured",
		};
	}

	const { data: userRow, error: userErr } = await supabase
		.from("users")
		.select("max_upload_post_accounts")
		.eq("id", userId)
		.single();
	if (userErr) {
		return { ok: false, status: 500, error: userErr.message };
	}
	const max = (userRow?.max_upload_post_accounts as number | null) ?? 0;
	if (max <= 0) {
		return {
			ok: false,
			status: 403,
			error: "Upload-Post accounts are not available for your plan",
		};
	}

	const { count } = await supabase
		.from("upload_post_accounts")
		.select("*", { count: "exact", head: true })
		.eq("user_id", userId);
	if (count !== null && count >= max) {
		return {
			ok: false,
			status: 403,
			error: `Maximum ${max} Upload-Post account(s) allowed. Upgrade to add more.`,
		};
	}

	const accountId = crypto.randomUUID();
	const uploadPostUsername = `extensible_${userId}_${accountId}`;

	try {
		const createRes = await createUploadPostProfile(uploadPostUsername, apiKey);
		if (!createRes.success || !createRes.profile) {
			return {
				ok: false,
				status: 500,
				error: "Upload-Post did not confirm profile creation",
			};
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Failed to create Upload-Post profile";
		return { ok: false, status: 500, error: msg };
	}

	const origin = (appOrigin ?? defaultAppOrigin()).replace(/\/$/, "");
	const redirectUrl = `${origin}/extension/settings?upload=connected`;
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
		// Non-fatal: caller can request a fresh connect URL later.
	}

	const insertRow: Record<string, unknown> = {
		id: accountId,
		user_id: userId,
		name: trimmedName,
		upload_post_username: uploadPostUsername,
		uses_own_key: isByok,
		updated_at: new Date().toISOString(),
	};
	if (isByok) insertRow.upload_post_api_key_encrypted = apiKey;
	if (jwtAccessUrl) insertRow.jwt_access_url = jwtAccessUrl;
	if (jwtExpiresAt) insertRow.jwt_expires_at = jwtExpiresAt;

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.insert(insertRow)
		.select(
			"id, user_id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at",
		)
		.single();

	if (error || !account) {
		try {
			await deleteUploadPostProfile(uploadPostUsername, apiKey);
		} catch {
			// Best-effort rollback only.
		}
		return { ok: false, status: 500, error: error?.message ?? "Failed to insert account" };
	}

	return { ok: true, account: account as UploadPostAccountRow };
}
