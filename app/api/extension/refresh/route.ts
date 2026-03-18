import type { NextRequest } from "next/server";

interface WhopTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	token_type: string;
}

export async function POST(request: NextRequest) {
	const clientId = process.env.NEXT_PUBLIC_WHOP_APP_ID;

	if (!clientId) {
		return Response.json({ error: "OAuth not configured: missing NEXT_PUBLIC_WHOP_APP_ID" }, { status: 500 });
	}

	let body: { refresh_token: string };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const { refresh_token } = body;
	if (!refresh_token) {
		return Response.json({ error: "Missing refresh_token" }, { status: 400 });
	}

	// PKCE/public client - no client_secret for refresh
	const res = await fetch("https://api.whop.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			refresh_token,
			client_id: clientId,
		}),
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const code = (err as { error?: string }).error;
		if (res.status === 401 || code === "invalid_grant") {
			return Response.json({ error: "Session expired - please log in again" }, { status: 401 });
		}
		return Response.json(
			{ error: (err as { error_description?: string }).error_description || "Token refresh failed" },
			{ status: 400 },
		);
	}

	const tokens = (await res.json()) as WhopTokenResponse;
	return Response.json({
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		expires_in: tokens.expires_in,
		obtained_at: Date.now(),
	});
}
