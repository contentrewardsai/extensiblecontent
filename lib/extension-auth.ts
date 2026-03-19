import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

interface WhopUserInfo {
	sub: string;
	email?: string;
	name?: string;
	preferred_username?: string;
}

export interface ExtensionUser {
	user_id: string;
	email: string;
}

/**
 * Validates Bearer token via Whop userinfo, looks up user in Supabase by whop_user_id.
 * Returns { user_id, email } or null if invalid/missing token.
 */
export async function getExtensionUser(request: NextRequest): Promise<ExtensionUser | null> {
	const auth = request.headers.get("Authorization");
	let token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
	if (!token) {
		token = request.nextUrl.searchParams.get("token");
	}
	if (!token) return null;

	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!userinfoRes.ok) return null;

	const userinfo = (await userinfoRes.json()) as WhopUserInfo;
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !supabaseServiceKey) return null;

	const supabase = createClient(supabaseUrl, supabaseServiceKey);
	const { data: user } = await supabase
		.from("users")
		.select("id")
		.eq("whop_user_id", userinfo.sub)
		.single();

	if (!user) return null;

	const email = userinfo.email || `${userinfo.sub}@whop.placeholder`;
	return { user_id: user.id, email };
}
