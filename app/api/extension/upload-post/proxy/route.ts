import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";

const UPLOAD_POST_BASE = "https://api.upload-post.com";

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
 * POST: Proxy Upload-Post photo/video upload (Method B - cloud posting).
 * Extension sends multipart form like Upload-Post API, plus:
 * - account_id: our upload_post_accounts.id
 * - endpoint: "photos" | "video" (for /api/upload_photos or /api/upload)
 *
 * We verify user owns the account, then forward to Upload-Post with our key
 * and user=upload_post_username.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const apiKey = getUploadPostKey();
	if (!apiKey) return Response.json({ error: "Upload-Post not configured" }, { status: 503 });

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return Response.json({ error: "multipart/form-data required" }, { status: 400 });
	}

	const formData = await request.formData();
	const accountId = formData.get("account_id")?.toString();
	const endpoint = formData.get("endpoint")?.toString() ?? "photos";

	if (!accountId) {
		return Response.json({ error: "account_id is required" }, { status: 400 });
	}

	const supabase = getSupabase();
	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key")
		.eq("id", accountId)
		.eq("user_id", user.user_id)
		.single();

	if (error || !account) {
		return Response.json({ error: "Account not found" }, { status: 404 });
	}

	if (account.uses_own_key) {
		return Response.json({ error: "BYOK accounts must use direct Upload-Post API with your key" }, { status: 400 });
	}

	// Remove our custom fields and set user
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
		json = JSON.parse(text);
	} catch {
		return Response.json({ error: "Upload-Post returned invalid response" }, { status: 502 });
	}

	return Response.json(json, { status: res.status });
}
