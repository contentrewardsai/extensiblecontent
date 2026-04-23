import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * GET /api/ghl/connect-whop/callback
 *
 * Whop redirects here after the GHL user authenticates.
 * We exchange the code for user info, ensure the user exists,
 * and link the ghl_locations row to this user.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		return redirectToSettings(request, null, `error=${encodeURIComponent(error)}`);
	}
	if (!code || !stateParam) {
		return redirectToSettings(request, null, "error=missing_params");
	}

	let stateData: { locationId: string };
	try {
		stateData = JSON.parse(Buffer.from(stateParam, "base64url").toString());
	} catch {
		return redirectToSettings(request, null, "error=invalid_state");
	}

	const { locationId } = stateData;
	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/connect-whop/callback`;

	// Exchange Whop code for access token (public client)
	const tokenRes = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: callbackUrl,
			client_id: process.env.NEXT_PUBLIC_WHOP_APP_ID!,
		}),
	});

	if (!tokenRes.ok) {
		console.error("[ghl-connect-whop] Whop token exchange failed:", await tokenRes.text());
		return redirectToSettings(request, locationId, "error=whop_auth_failed");
	}

	const tokenData = (await tokenRes.json()) as { access_token: string };

	// Get Whop user info
	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	});
	if (!userinfoRes.ok) {
		return redirectToSettings(request, locationId, "error=userinfo_failed");
	}

	const userinfo = (await userinfoRes.json()) as {
		sub?: string;
		email?: string;
		name?: string;
		preferred_username?: string;
	};
	if (!userinfo?.sub) {
		return redirectToSettings(request, locationId, "error=invalid_user");
	}

	const supabase = getServiceSupabase();

	// Ensure user exists
	let userId: string;
	const { data: existing } = await supabase
		.from("users")
		.select("id")
		.eq("whop_user_id", userinfo.sub)
		.maybeSingle();

	if (existing) {
		userId = existing.id;
	} else {
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
		if (!upserted) {
			return redirectToSettings(request, locationId, "error=user_create_failed");
		}
		userId = upserted.id;
	}

	// Link the GHL location to this user
	const { error: updateErr } = await supabase
		.from("ghl_locations")
		.update({ user_id: userId, updated_at: new Date().toISOString() })
		.eq("location_id", locationId)
		.eq("is_active", true);

	// Also update the parent connection if it has no user_id
	await supabase
		.from("ghl_connections")
		.update({ user_id: userId, updated_at: new Date().toISOString() })
		.is("user_id", null);

	if (updateErr) {
		console.error("[ghl-connect-whop] Link failed:", updateErr);
		return redirectToSettings(request, locationId, "error=link_failed");
	}

	return redirectToSettings(request, locationId, "connected=true");
}

function redirectToSettings(request: NextRequest, locationId: string | null, query: string) {
	const origin = request.nextUrl.origin;
	const locParam = locationId ? `location_id=${encodeURIComponent(locationId)}&` : "";
	return Response.redirect(`${origin}/ext/settings?${locParam}${query}`);
}
