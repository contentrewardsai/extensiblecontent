import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { reconcileExpiredGrants } from "@/lib/shotstack-expiry";

/**
 * Daily Vercel cron: walk every user that has at least one ShotStack grant
 * whose `expires_at` has passed but no matching `kind = 'expiry'` row, and
 * insert the offsetting expiry rows so the billing-history page shows the
 * roll-off and `shotstack_spendable_credits` stays accurate.
 *
 * Lazy reconciliation already runs from `lib/shotstack-ledger.ts` whenever a
 * user views their balance or billing page; this cron is the safety net that
 * processes inactive users so cohort analytics / admin queries don't lag.
 *
 * Auth: same `CRON_SECRET` Bearer pattern as the existing cron routes.
 */
export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		return Response.json({ error: "Supabase not configured" }, { status: 500 });
	}
	const supabase = createClient(url, key);

	// We only need to look at users that have at least one expired grant
	// without a matching expiry row. Pulling the distinct user_ids in a
	// single query keeps the cron O(users-with-due-expiries) instead of
	// O(all-users).
	const nowIso = new Date().toISOString();
	const { data: dueGrants, error: dueErr } = await supabase
		.from("shotstack_credit_ledger")
		.select("user_id, id")
		.eq("kind", "grant")
		.lte("expires_at", nowIso)
		.limit(10_000);
	if (dueErr) {
		console.error("[cron/shotstack-credit-expiry] list failed:", dueErr);
		return Response.json({ error: dueErr.message }, { status: 500 });
	}

	const userIds = Array.from(new Set((dueGrants ?? []).map((r) => r.user_id as string)));
	if (userIds.length === 0) {
		return Response.json({ users: 0, inserted: 0 });
	}

	let totalInserted = 0;
	const errors: string[] = [];
	for (const userId of userIds) {
		try {
			const { insertedExpiries } = await reconcileExpiredGrants(supabase, userId);
			totalInserted += insertedExpiries;
		} catch (err) {
			errors.push(`${userId}: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	}

	return Response.json({ users: userIds.length, inserted: totalInserted, errors });
}
