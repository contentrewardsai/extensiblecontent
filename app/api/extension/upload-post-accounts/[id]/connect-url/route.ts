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

/**
 * POST: Generate JWT URL for user to connect social media accounts.
 * Returns access_url valid for 48h.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	const { id } = await params;
	const supabase = getSupabase();
	const { data: account, error } = await supabase
		.from("upload_post_accounts")
		.select("upload_post_username, uses_own_key")
		.eq("id", id)
		.eq("user_id", user.user_id)
		.single();

	if (error || !account) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	// For managed accounts, use our key. For BYOK, we'd need user's key (not implemented yet).
	const apiKey = getUploadPostKey();
	if (!apiKey || account.uses_own_key) {
		return Response.json(
			{ error: "Connect URL not available for this account type" },
			{ status: 503 }
		);
	}

	let body: { redirect_url?: string; logo_image?: string } = {};
	try {
		body = await request.json();
	} catch {
		// empty body is ok
	}

	const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://extensiblecontent.com";
	const redirectUrl = body.redirect_url ?? `${appOrigin}/extension/settings?upload=connected`;

	return generateUploadPostJwt(account.upload_post_username, apiKey, {
		redirect_url: redirectUrl,
		logo_image: body.logo_image,
		connect_title: "Connect Social Media Accounts",
		connect_description: "Connect your social media accounts to post from Extensible Content.",
		show_calendar: false,
	})
		.then((res) => {
			if (!res.success || !res.access_url) {
				return Response.json({ error: "Failed to generate connect URL" }, { status: 500 });
			}
			return Response.json({ access_url: res.access_url, duration: res.duration ?? "48h" });
		})
		.catch((err) => {
			const msg = err instanceof Error ? err.message : "Failed to generate connect URL";
			return Response.json({ error: msg }, { status: 500 });
		});
}
