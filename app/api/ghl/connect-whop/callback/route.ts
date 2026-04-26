import type { NextRequest } from "next/server";
import {
	serializeWhopUserCookie,
	signWhopUserCookie,
	verifyState,
} from "@/lib/ghl-sso";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ensureInternalUserFromWhop } from "@/lib/whop-app-user";

type ConnectWhopState = {
	companyId?: string;
	locationId?: string;
	cv?: string;
	ts?: number;
};

// Max age for an in-flight signed state, to limit replay risk.
const MAX_STATE_AGE_MS = 30 * 60 * 1000;

/**
 * GET /api/ghl/connect-whop/callback
 *
 * Whop redirects here after the user authenticates. We exchange the code for
 * user info, then record the Whop user as having access to the GHL
 * company/location that was encoded in the HMAC-signed state.
 *
 * If no ghl_connections row exists yet for the company (e.g. the user has
 * configured the app as a Custom Page without doing a marketplace install),
 * we create a placeholder row with `access_token='pending-link'` so the
 * linking still works. Real tokens will be populated if/when the marketplace
 * install OAuth fires later.
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

	// New-format (HMAC-signed) states contain a dot; legacy base64-only states
	// from before the HMAC migration don't. We accept the legacy format only
	// in non-production to keep any existing test flows working.
	let stateData: ConnectWhopState | null = null;

	if (stateParam.includes(".")) {
		stateData = verifyState<ConnectWhopState>(stateParam);
		if (!stateData) return closePopup({ error: "invalid_state_signature" });
		if (stateData.ts && Date.now() - stateData.ts > MAX_STATE_AGE_MS) {
			return closePopup({ error: "state_expired" });
		}
	} else if (process.env.NODE_ENV !== "production") {
		try {
			stateData = JSON.parse(
				Buffer.from(stateParam, "base64url").toString(),
			) as ConnectWhopState;
		} catch {
			return closePopup({ error: "invalid_state" });
		}
	} else {
		return closePopup({ error: "invalid_state_signature" });
	}

	if (!stateData) return closePopup({ error: "invalid_state" });

	const { companyId, locationId, cv: codeVerifier } = stateData;
	const callbackUrl = `https://extensiblecontent.com/api/ghl/connect-whop/callback`;

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

	const userId = await ensureInternalUserFromWhop(userinfo.sub, {
		email: userinfo.email,
		name: userinfo.name,
		username: userinfo.preferred_username,
	});

	const supabase = getServiceSupabase();
	const now = new Date().toISOString();

	const connectionIds: string[] = [];

	if (companyId) {
		// Upsert a placeholder connection row if none exists. The SSO-verified
		// companyId makes this safe — only a real GHL user of that company
		// could have produced the signed state that got us here.
		const { data: existing } = await supabase
			.from("ghl_connections")
			.select("id, user_id")
			.eq("company_id", companyId)
			.maybeSingle();

		let connectionId: string | null = existing?.id ?? null;

		if (!connectionId) {
			const { data: inserted, error: insertErr } = await supabase
				.from("ghl_connections")
				.insert({
					company_id: companyId,
					user_type: "Company",
					access_token: "pending-link",
					refresh_token: "pending-link",
					token_expires_at: new Date(0).toISOString(),
					user_id: userId,
				})
				.select("id")
				.single();
			if (insertErr || !inserted) {
				// Race: someone else inserted between select and insert.
				const { data: retry } = await supabase
					.from("ghl_connections")
					.select("id")
					.eq("company_id", companyId)
					.maybeSingle();
				connectionId = retry?.id ?? null;
			} else {
				connectionId = inserted.id;
			}
		} else if (!existing?.user_id) {
			await supabase
				.from("ghl_connections")
				.update({ user_id: userId, updated_at: now })
				.eq("id", connectionId);
		}

		if (connectionId) connectionIds.push(connectionId);

		// Also create a pending location row if we have a locationId and no
		// existing row — lets the Social Planner / media UI have something
		// to hang off of before full install.
		if (connectionId && locationId) {
			const { data: loc } = await supabase
				.from("ghl_locations")
				.select("id")
				.eq("connection_id", connectionId)
				.eq("location_id", locationId)
				.maybeSingle();
			if (!loc) {
				await supabase.from("ghl_locations").insert({
					connection_id: connectionId,
					location_id: locationId,
					access_token: "pending-link",
					refresh_token: "pending-link",
					token_expires_at: new Date(0).toISOString(),
					is_active: true,
				});
			}
		}
	} else if (locationId) {
		// Location-level custom page without companyId: derive connection from
		// the existing ghl_locations row if any.
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId)
			.maybeSingle();
		if (loc?.connection_id) connectionIds.push(loc.connection_id);
	} else {
		// No SSO context at all. Link to orphan connections (legacy path).
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

	return closePopup(
		{ success: true, userId },
		{ setCookieUserId: userId },
	);
}

/**
 * Returns an HTML page that notifies the parent window and closes the popup.
 * Optionally sets the signed HTTP-only cookie that tracks the "active" Whop
 * user in this browser, so the iframe doesn't have to rely on
 * sessionStorage/postMessage to know who the user is.
 */
function closePopup(
	result: { success?: boolean; error?: string; userId?: string },
	opts: { setCookieUserId?: string } = {},
) {
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

	const headers: Record<string, string> = { "Content-Type": "text/html" };
	if (opts.setCookieUserId) {
		headers["Set-Cookie"] = serializeWhopUserCookie(
			signWhopUserCookie(opts.setCookieUserId),
		);
	}

	return new Response(html, { headers });
}
