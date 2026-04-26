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

	let stateData: { companyId?: string; locationId?: string; cv?: string };
	try {
		stateData = JSON.parse(Buffer.from(stateParam, "base64url").toString());
	} catch {
		return closePopup({ error: "invalid_state" });
	}

	const { companyId, locationId, cv: codeVerifier } = stateData;
	const callbackUrl = `https://extensiblecontent.com/api/ghl/connect-whop/callback`;

	// Exchange Whop code for access token (PKCE flow)
	const tokenBody: Record<string, string> = {
		grant_type: "authorization_code",
		code,
		redirect_uri: callbackUrl,
		client_id: process.env.NEXT_PUBLIC_WHOP_APP_ID!,
	};
	if (codeVerifier) {
		tokenBody.code_verifier = codeVerifier;
	}

	const tokenRes = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(tokenBody),
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

	if (companyId) {
		// Link this specific GHL company to the Whop user
		await supabase
			.from("ghl_connections")
			.update({ user_id: userId, updated_at: now })
			.eq("company_id", companyId)
			.is("user_id", null);

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
	} else {
		// No specific company — link ALL unlinked GHL connections to this user.
		// This handles the case where SSO didn't provide a companyId.
		const { data: unlinked } = await supabase
			.from("ghl_connections")
			.select("id")
			.is("user_id", null);

		if (unlinked?.length) {
			const ids = unlinked.map((c) => c.id);
			await supabase
				.from("ghl_connections")
				.update({ user_id: userId, updated_at: now })
				.in("id", ids);

			await supabase
				.from("ghl_locations")
				.update({ user_id: userId, updated_at: now })
				.in("connection_id", ids)
				.is("user_id", null);
		}
	}

	if (locationId) {
		await supabase
			.from("ghl_locations")
			.update({ user_id: userId, updated_at: now })
			.eq("location_id", locationId)
			.is("user_id", null);
	}

	console.log(
		`[ghl-connect-whop] Linked companyId=${companyId ?? "all-unlinked"} locationId=${locationId ?? "?"} to userId=${userId}`,
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
