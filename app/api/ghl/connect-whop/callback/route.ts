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

	// Resolve / create the single ghl_connections row that represents this
	// GHL workspace. Shared across all team members — the (company_id) unique
	// index guarantees one row per GHL company.
	//
	// Lookup order:
	//   1. If companyId is known, find/create by company_id.
	//   2. Otherwise, if locationId is known, reuse the connection referenced
	//      by the existing ghl_locations row (this is how teammates converge
	//      when GHL doesn't substitute {{company.id}} in the Custom Page URL).
	//   3. Fall back to a synthetic company_id derived from the location so a
	//      brand-new location still gets exactly one row.
	const effectiveCompanyId = companyId ?? `loc:${locationId ?? "unknown"}`;

	let connectionId: string | null = null;

	// 2. Reuse whatever connection is already wired up to this location.
	if (!companyId && locationId) {
		const { data: loc } = await supabase
			.from("ghl_locations")
			.select("connection_id")
			.eq("location_id", locationId)
			.maybeSingle();
		if (loc?.connection_id) connectionId = loc.connection_id;
	}

	// 1 / 3. Look up or create by (effective) company id.
	if (!connectionId) {
		const { data: existing } = await supabase
			.from("ghl_connections")
			.select("id")
			.eq("company_id", effectiveCompanyId)
			.maybeSingle();

		if (existing?.id) {
			connectionId = existing.id;
		} else {
			const { data: inserted, error: insertErr } = await supabase
				.from("ghl_connections")
				.insert({
					company_id: effectiveCompanyId,
					user_type: companyId ? "Company" : "Location",
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
					.eq("company_id", effectiveCompanyId)
					.maybeSingle();
				connectionId = retry?.id ?? null;
			} else {
				connectionId = inserted.id;
			}
		}
	}

	if (!connectionId) {
		console.error(
			"[ghl-connect-whop] Failed to resolve connection for",
			{ companyId, locationId, effectiveCompanyId },
		);
		return closePopup({ error: "link_failed" });
	}

	// Ensure a ghl_locations row exists too (if we have a locationId). Every
	// teammate's OAuth will converge on this row via (connection_id, location_id).
	if (locationId) {
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

	// Always record team membership in the join table.
	await supabase
		.from("ghl_connection_users")
		.upsert(
			{ connection_id: connectionId, user_id: userId },
			{ onConflict: "connection_id,user_id" },
		);

	console.log(
		`[ghl-connect-whop] Linked userId=${userId} to connection=${connectionId} (companyId=${companyId ?? "?"} locationId=${locationId ?? "?"} effectiveCompanyId=${effectiveCompanyId})`,
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
