import type { NextRequest } from "next/server";

/**
 * Proxy for extension API calls. Validates Bearer token and forwards to Whop/Supabase.
 * Extension sends: Authorization: Bearer <access_token>
 * Use ?action=userinfo to fetch current user, or extend for other actions.
 */
export async function GET(request: NextRequest) {
	const auth = request.headers.get("Authorization");
	const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
	if (!token) {
		return Response.json({ error: "Missing Authorization header" }, { status: 401 });
	}

	const action = request.nextUrl.searchParams.get("action") || "userinfo";
	if (action === "userinfo") {
		const res = await fetch("https://api.whop.com/oauth/userinfo", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			return Response.json({ error: "Invalid or expired token" }, { status: 401 });
		}
		const data = await res.json();
		return Response.json(data);
	}

	return Response.json({ error: "Unknown action" }, { status: 400 });
}
