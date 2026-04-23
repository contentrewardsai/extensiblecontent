import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { ghlFetch } from "@/lib/ghl";

/**
 * POST /api/extension/ghl/social/posts
 *
 * Proxies GHL POST /social-media-posting/:locationId/posts
 * Body: { locationId, summary, media, accountIds, scheduleDate, ... }
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { locationId: string; [key: string]: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { locationId, ...postData } = body;
	if (!locationId) {
		return Response.json({ error: "locationId is required" }, { status: 400 });
	}

	try {
		const res = await ghlFetch(
			user.user_id,
			locationId,
			`/social-media-posting/${encodeURIComponent(locationId)}/posts`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(postData),
			},
		);

		const data = await res.json();
		if (!res.ok) {
			return Response.json(
				{ error: "GHL API error", details: data },
				{ status: res.status },
			);
		}
		return Response.json(data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}
