import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

interface WhopUserInfo {
	sub?: string;
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
 * If valid token but no user record exists, upserts the user (same as extension auth flow).
 * Returns { user_id, email } or null if invalid/missing token.
 */
export async function getExtensionUser(request: NextRequest): Promise<ExtensionUser | null> {
	try {
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
		if (!userinfo?.sub) return null;

		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
		if (!supabaseUrl || !supabaseServiceKey) return null;

		const supabase = createClient(supabaseUrl, supabaseServiceKey);
		let { data: user } = await supabase
			.from("users")
			.select("id")
			.eq("whop_user_id", userinfo.sub)
			.maybeSingle();

		// Auto-create user if valid Whop token but no record (e.g. token from different flow)
		if (!user) {
			const email = userinfo.email || `${userinfo.sub}@whop.placeholder`;
			const { data: upserted } = await supabase
				.from("users")
				.upsert(
					{
						email,
						whop_user_id: userinfo.sub,
						name: userinfo.name ?? userinfo.preferred_username ?? null,
						updated_at: new Date().toISOString(),
					},
					{ onConflict: "email" },
				)
				.select("id")
				.single();
			user = upserted;
		}

		if (!user) return null;

		const email = userinfo.email || `${userinfo.sub}@whop.placeholder`;
		return { user_id: user.id, email };
	} catch (err) {
		console.error("[extension-auth] getExtensionUser error:", err);
		return null;
	}
}
