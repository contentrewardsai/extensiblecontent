import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { createUploadPostAccount } from "@/lib/upload-post-account-create";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

export async function GET(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select(
			"id, user_id, name, upload_post_username, uses_own_key, created_at, updated_at, jwt_access_url, jwt_expires_at",
		)
		.eq("user_id", user.user_id)
		.order("created_at", { ascending: false });

	if (error) {
		return Response.json({ error: error.message }, { status: 500 });
	}

	return Response.json(accounts ?? []);
}

/**
 * POST: Create a new Upload-Post account for the user.
 * Body: { name, api_key? }
 *   - If `api_key` is provided, the account is BYOK and uses that key for all
 *     Upload-Post API calls.
 *   - Otherwise the managed `UPLOAD_POST_API_KEY` is used.
 *
 * Limit enforcement, profile creation, JWT mint, and rollback live in
 * `createUploadPostAccount` so the dashboard server action can share the same
 * code path without drifting.
 */
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

	const supabase = getSupabase();
	const result = await createUploadPostAccount(supabase, user.user_id, {
		name: body.name,
		apiKey: body.api_key ?? null,
	});

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}
	return Response.json(result.account);
}
