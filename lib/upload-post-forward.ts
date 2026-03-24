import type { SupabaseClient } from "@supabase/supabase-js";

const UPLOAD_POST_BASE = "https://api.upload-post.com";

export function getUploadPostServerKey(): string | null {
	return process.env.UPLOAD_POST_API_KEY ?? null;
}

export type ForwardUploadPostResult =
	| { ok: true; status: number; json: unknown }
	| { ok: false; status: number; error: string };

/**
 * Forwards multipart to Upload-Post after verifying account ownership (managed key only).
 * Mutates `formData`: removes account_id and endpoint, sets `user`.
 */
export async function forwardUploadPostMultipart(
	supabase: SupabaseClient,
	internalUserId: string,
	formData: FormData,
): Promise<ForwardUploadPostResult> {
	const apiKey = getUploadPostServerKey();
	if (!apiKey) {
		return { ok: false, status: 503, error: "Upload-Post not configured" };
	}

	const accountId = formData.get("account_id")?.toString();
	const endpoint = formData.get("endpoint")?.toString() ?? "photos";

	if (!accountId) {
		return { ok: false, status: 400, error: "account_id is required" };
	}

	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key")
		.eq("id", accountId)
		.eq("user_id", internalUserId)
		.single();

	if (error || !account) {
		return { ok: false, status: 404, error: "Account not found" };
	}

	if (account.uses_own_key) {
		return { ok: false, status: 400, error: "BYOK accounts must use direct Upload-Post API with your key" };
	}

	formData.delete("account_id");
	formData.delete("endpoint");
	formData.set("user", account.upload_post_username);

	const path = endpoint === "video" ? "/api/upload" : "/api/upload_photos";
	const res = await fetch(`${UPLOAD_POST_BASE}${path}`, {
		method: "POST",
		headers: { Authorization: `Apikey ${apiKey}` },
		body: formData,
	});

	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		return { ok: false, status: 502, error: "Upload-Post returned invalid response" };
	}

	return { ok: true, status: res.status, json };
}
