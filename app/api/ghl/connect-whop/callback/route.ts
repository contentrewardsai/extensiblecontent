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

	// Find which connection(s) this user is linking to.
	const connectionIds: string[] = [];

	if (companyId) {
		const { data: conn } = await supabase
			.from("ghl_connections")
			.select("id, user_id")
			.eq("company_id", companyId)
			.maybeSingle();

		if (conn) {
			connectionIds.push(conn.id);
			// Set "installer" user_id for historical tracking if still null.
			if (!conn.user_id) {
				await supabase
					.from("ghl_connections")
					.update({ user_id: userId, updated_at: now })
					.eq("id", conn.id);
			}
		}
	} else if (locationId) {
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId)
			.maybeSingle();
		if (loc?.connection_id) connectionIds.push(loc.connection_id);
	} else {
		// No context at all — link to ALL connections that currently have no users.
		// This covers SSO-failed first-time linking.
		const { data: orphan } = await supabase
			.from("ghl_connections")
			.select("id")
			.is("user_id", null);
		if (orphan?.length) {
			connectionIds.push(...orphan.map((c) => c.id));
			await supabase
				.from("ghl_connections")
				.update({ user_id: userId, updated_at: now })
				.in(
					"id",
					orphan.map((c) => c.id),
				);
		}
	}

	// Grant access via the many-to-many join table.
	if (connectionIds.length > 0) {
		const rows = connectionIds.map((connection_id) => ({
			connection_id,
			user_id: userId,
		}));
		await supabase
			.from("ghl_connection_users")
			.upsert(rows, { onConflict: "connection_id,user_id" });
	}

	console.log(
		`[ghl-connect-whop] Linked userId=${userId} to connections=[${connectionIds.join(",")}] (companyId=${companyId ?? "?"} locationId=${locationId ?? "?"})`,
	);

	return closePopup({ success: true, userId });
}

/**
 * Returns an HTML page that notifies the parent window and closes the popup.
 */
function closePopup(result: {
	success?: boolean;
	error?: string;
	userId?: string;
}) {
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
