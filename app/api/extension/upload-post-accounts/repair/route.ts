import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { createUploadPostProfile, getUploadPostProfile } from "@/lib/upload-post";

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
 * POST: Repair orphaned accounts - create missing Upload-Post profiles for rows that exist in Supabase.
 * For each account, checks if profile exists in Upload-Post; if not, creates it.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const managedKey = getUploadPostKey();
	const supabase = getSupabase();
	const { data: accounts, error } = await supabase
		.from("upload_post_accounts")
		.select("id, upload_post_username, uses_own_key, upload_post_api_key_encrypted")
		.eq("user_id", user.user_id);

	if (error) return Response.json({ error: error.message }, { status: 500 });
	if (!accounts?.length) {
		return Response.json({ repaired: 0, skipped: 0, errors: [] });
	}

	const results: { repaired: string[]; skipped: string[]; errors: string[] } = {
		repaired: [],
		skipped: [],
		errors: [],
	};

	for (const acc of accounts) {
		const accApiKey = acc.uses_own_key
			? (acc.upload_post_api_key_encrypted?.trim() ?? null)
			: managedKey;
		if (!accApiKey) {
			results.skipped.push(acc.id);
			continue;
		}

		try {
			const existing = await getUploadPostProfile(acc.upload_post_username, accApiKey);
			if (existing) {
				results.skipped.push(acc.id);
				continue;
			}

			const createRes = await createUploadPostProfile(acc.upload_post_username, accApiKey);
			if (createRes.success && createRes.profile) {
				results.repaired.push(acc.id);
			} else {
				results.errors.push(`${acc.id}: Upload-Post did not confirm creation`);
			}
		} catch (err) {
			results.errors.push(`${acc.id}: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}

	return Response.json({
		repaired: results.repaired.length,
		skipped: results.skipped.length,
		errors: results.errors,
		repaired_ids: results.repaired,
	});
}
