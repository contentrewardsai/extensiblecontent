import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { processDueGhlPosts } from "@/lib/ghl-scheduler";
import { getServiceSupabase } from "@/lib/supabase-service";

/**
 * POST /api/ghl/kick-scheduler
 *
 * On-demand trigger for the GHL post scheduler. Since Vercel Hobby caps
 * crons at once per day, UI surfaces call this when the user loads the
 * Social page or schedules a new post so due rows go out immediately.
 *
 * Auth is scoped: the scheduler only processes rows owned by the caller.
 *
 * Accepts either:
 *   - Extension: Authorization: Bearer <token>
 *   - GHL Custom Page: `userId` query/body param (verified to own at least one
 *     GHL connection; prevents random callers from triggering work).
 */
export async function POST(request: NextRequest) {
	const extUser = await getExtensionUser(request).catch(() => null);
	let userId: string | null = extUser?.user_id ?? null;

	if (!userId) {
		const fromQuery = request.nextUrl.searchParams.get("userId");
		let fromBody: string | null = null;
		if (!fromQuery) {
			try {
				const body = (await request.json()) as { userId?: string };
				if (body && typeof body.userId === "string") fromBody = body.userId;
			} catch {
				/* no body */
			}
		}
		const candidate = fromQuery ?? fromBody;
		if (candidate) {
			// Verify this user actually has a GHL link before letting them kick
			// the scheduler.
			const supabase = getServiceSupabase();
			const { data: access } = await supabase
				.from("ghl_connection_users")
				.select("id")
				.eq("user_id", candidate)
				.limit(1)
				.maybeSingle();
			if (access) userId = candidate;
		}
	}

	if (!userId) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const result = await processDueGhlPosts({ userId, batchSize: 10 });
		return Response.json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}
