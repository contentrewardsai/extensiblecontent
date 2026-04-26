import type { NextRequest } from "next/server";
import { processDueGhlPosts } from "@/lib/ghl-scheduler";

/**
 * Vercel cron safety-net that publishes any due GHL scheduled posts.
 *
 * On Hobby plans Vercel crons can only run once per day, so this is a
 * backstop for posts that weren't already processed by an on-demand trigger
 * (see /api/ghl/kick-scheduler). On Pro you can raise the schedule.
 *
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const result = await processDueGhlPosts();
		return Response.json(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return Response.json({ error: msg }, { status: 500 });
	}
}
