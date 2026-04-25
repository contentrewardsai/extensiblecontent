import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";

/**
 * GET /api/ghl/connect-whop/callback
 *
 * Whop redirects here after the user authenticates. We exchange the
 * code for user info, link the GHL company/location to the Whop user
 * in the database, and close the popup.
 */
export async function GET(request: NextRequest) {
	const { searchParams } = request.nextUrl;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const error = searchParams.get("error");

	if (error) {
		return closePopup({ error });
	}
	if (!code || !stateParam) {
		return closePopup({ error: "missing_params" });
	}

	let stateData: { companyId?: string; locationId?: string };
	try {
		stateData = JSON.parse(Buffer.from(stateParam, "base64url").toString());
	} catch {
		return closePopup({ error: "invalid_state" });
	}

	const { companyId, locationId } = stateData;
	const origin = request.nextUrl.origin;
	const callbackUrl = `${origin}/api/ghl/connect-whop/callback`;

	// Exchange Whop code for access token
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
		console.error(
			"[ghl-connect-whop] Whop token exchange failed:",
			await tokenRes.text(),
		);
		return closePopup({ error: "whop_auth_failed" });
	}

	const tokenData = (await tokenRes.json()) as { access_token: string };

	// Get Whop user info
	const userinfoRes = await fetch("https://api.whop.com/oauth/userinfo", {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	});
	if (!userinfoRes.ok) {
		return closePopup({ error: "userinfo_failed" });
	}

	const userinfo = (await userinfoRes.json()) as {
		sub?: string;
		email?: string;
		name?: string;
		preferred_username?: string;
	};
	if (!userinfo?.sub) {
		return closePopup({ error: "invalid_user" });
	}

	// Ensure user exists in our database
	const userId = await ensureInternalUserFromWhop(userinfo.sub, {
		email: userinfo.email,
		name: userinfo.name,
		username: userinfo.preferred_username,
	});

	const supabase = getServiceSupabase();
	const now = new Date().toISOString();

	// Link the GHL company to this Whop user
	if (companyId) {
		await supabase
			.from("ghl_connections")
			.update({ user_id: userId, updated_at: now })
			.eq("company_id", companyId)
			.is("user_id", null);

		// Also update child locations for this company
		const { data: conn } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", companyId)
			.maybeSingle();

		if (conn) {
			await supabase
				.from("ghl_locations")
				.update({ user_id: userId, updated_at: now })
				.eq("connection_id", conn.id)
				.is("user_id", null);
		}
	}

	// Also link specific location if provided
	if (locationId) {
		await supabase
			.from("ghl_locations")
			.update({ user_id: userId, updated_at: now })
			.eq("location_id", locationId)
			.is("user_id", null);
	}

	console.log(
		`[ghl-connect-whop] Linked companyId=${companyId ?? "?"} locationId=${locationId ?? "?"} to userId=${userId}`,
	);

	return closePopup({ success: true });
}

/**
 * Returns an HTML page that notifies the parent window and closes the popup.
 */
function closePopup(result: { success?: boolean; error?: string }) {
	const html = `<!DOCTYPE html>
<html><head><title>Linking...</title></head>
<body>
<p>${result.success ? "Account linked! This window will close..." : `Error: ${result.error}`}</p>
<script>
if (window.opener) {
  window.opener.postMessage(${JSON.stringify({ type: "whop-link-result", ...result })}, "*");
  setTimeout(() => window.close(), 1000);
} else {
  document.querySelector("p").textContent += " You can close this tab.";
}
</script>
</body></html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html" },
	});
}
