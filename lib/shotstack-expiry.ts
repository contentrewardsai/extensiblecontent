import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * FIFO reconciliation for ShotStack credit grants whose 3-month rollover
 * window has ended.
 *
 * Why this exists
 * ---------------
 * The ledger stores grants with an `expires_at` (set on insert by
 * `lib/shotstack-ledger.ts → grantSubscriptionCredits`) but, until this
 * module landed, nothing actually wrote a `kind = 'expiry'` row when that
 * window passed. The spendable formula sidestepped the issue by filtering
 * out expired grants, but that left two problems the user asked us to fix:
 *
 *   1. The billing-history page never showed the user that any of their
 *      credits had rolled off the books — they just silently stopped
 *      counting toward the spendable balance.
 *   2. The old formula could go negative: a debit followed by the funding
 *      grant's expiry would leave the debit on the books with no offsetting
 *      grant. (E.g. grant +30 in Jan, debit -20 in Feb, grant expires Apr →
 *      spendable = -20 under the old rule.)
 *
 * The reconciler fixes both by simulating a FIFO inventory of grant buckets:
 *
 *   - When a grant arrives, push a bucket {credits, expiresAt, grantId}.
 *   - When a debit/adjustment arrives, deduct from the soonest-expiring
 *     bucket first (FIFO by `expires_at`). Any leftover negative simply
 *     leaks past zero — that's a pre-existing condition, not our concern.
 *   - When the bucket's `expires_at` passes, insert a `kind = 'expiry'` row
 *     with `credits = -bucket.remaining` and `source_grant_id = grantId`,
 *     dated at the bucket's expiry timestamp. The migration in
 *     `20250420000000_storage_caps_and_credit_expiry.sql` removes the
 *     `expires_at` filter from `shotstack_spendable_credits`, so these
 *     expiry rows are exactly what makes the post-expiry balance correct.
 *
 * Idempotency: every grant that already has a corresponding expiry row
 * (recognised by `source_grant_id` matching the grant's id) is skipped on
 * subsequent runs. Safe to invoke from both lazy reads and a daily cron.
 */

interface LedgerRow {
	id: string;
	kind: "grant" | "debit" | "expiry" | "adjustment";
	credits: number | string;
	expires_at: string | null;
	created_at: string;
	source_grant_id: string | null;
	whop_membership_id: string | null;
	whop_product_id: string | null;
	period_start: string | null;
}

interface Bucket {
	grantId: string;
	remaining: number;
	expiresAt: Date | null;
	whopMembershipId: string | null;
	whopProductId: string | null;
	periodStart: string | null;
}

type SimulationEvent =
	| { type: "grant"; at: Date; row: LedgerRow }
	| { type: "spend"; at: Date; credits: number }
	| { type: "recorded_expiry"; at: Date; grantId: string };

export interface ReconcileResult {
	insertedExpiries: number;
}

/**
 * Walk the user's ledger in chronological order, FIFO-consume debits against
 * grant buckets, and insert one `expiry` row per grant whose window has
 * closed but doesn't yet have an offset.
 *
 * Returns the number of expiry rows that were newly inserted (0 means the
 * ledger was already up-to-date).
 */
export async function reconcileExpiredGrants(
	supabase: SupabaseClient,
	userId: string,
	now: Date = new Date(),
): Promise<ReconcileResult> {
	const { data, error } = await supabase
		.from("shotstack_credit_ledger")
		.select(
			"id, kind, credits, expires_at, created_at, source_grant_id, whop_membership_id, whop_product_id, period_start",
		)
		.eq("user_id", userId)
		.order("created_at", { ascending: true });

	if (error) {
		console.error("[shotstack-expiry] load ledger failed:", error);
		return { insertedExpiries: 0 };
	}

	const rows = (data ?? []) as LedgerRow[];
	if (rows.length === 0) return { insertedExpiries: 0 };

	const recordedExpiries = new Set<string>();
	for (const r of rows) {
		if (r.kind === "expiry" && r.source_grant_id) {
			recordedExpiries.add(r.source_grant_id);
		}
	}

	const events: SimulationEvent[] = rows.map((r) => {
		const at = new Date(r.created_at);
		if (r.kind === "grant") return { type: "grant", at, row: r };
		if (r.kind === "expiry")
			return { type: "recorded_expiry", at, grantId: r.source_grant_id ?? "" };
		return { type: "spend", at, credits: Number(r.credits) };
	});
	events.sort((a, b) => a.at.getTime() - b.at.getTime());

	const buckets: Bucket[] = [];
	const newExpiries: Array<{
		grantId: string;
		credits: number;
		when: Date;
		whopMembershipId: string | null;
		whopProductId: string | null;
		periodStart: string | null;
	}> = [];

	const sortBucketsByExpiry = () => {
		// Soonest expiry first. Buckets with `null` expires_at (never expire)
		// sink to the back so they're consumed last — matches the spec
		// language ("3-month rollover" applies to graned credits only;
		// adjustments without a window survive forever).
		buckets.sort((a, b) => {
			if (a.expiresAt === null && b.expiresAt === null) return 0;
			if (a.expiresAt === null) return 1;
			if (b.expiresAt === null) return -1;
			return a.expiresAt.getTime() - b.expiresAt.getTime();
		});
	};

	const expireBucketsThrough = (cutoff: Date) => {
		sortBucketsByExpiry();
		while (buckets.length > 0) {
			const head = buckets[0];
			if (head.expiresAt === null) break;
			if (head.expiresAt.getTime() > cutoff.getTime()) break;
			if (head.remaining > 0 && !recordedExpiries.has(head.grantId)) {
				newExpiries.push({
					grantId: head.grantId,
					credits: -head.remaining,
					when: head.expiresAt,
					whopMembershipId: head.whopMembershipId,
					whopProductId: head.whopProductId,
					periodStart: head.periodStart,
				});
				recordedExpiries.add(head.grantId);
			}
			buckets.shift();
		}
	};

	for (const ev of events) {
		expireBucketsThrough(ev.at);
		if (ev.type === "grant") {
			buckets.push({
				grantId: ev.row.id,
				remaining: Number(ev.row.credits),
				expiresAt: ev.row.expires_at ? new Date(ev.row.expires_at) : null,
				whopMembershipId: ev.row.whop_membership_id,
				whopProductId: ev.row.whop_product_id,
				periodStart: ev.row.period_start,
			});
		} else if (ev.type === "recorded_expiry") {
			// The matching bucket should have already been removed by
			// `expireBucketsThrough`, but the user might have manually
			// inserted an expiry row out-of-order; remove the bucket
			// defensively to keep the simulation honest.
			const idx = buckets.findIndex((b) => b.grantId === ev.grantId);
			if (idx >= 0) buckets.splice(idx, 1);
		} else {
			// Spend rows are negative; FIFO-deduct from oldest bucket.
			let remaining = ev.credits;
			sortBucketsByExpiry();
			for (const b of buckets) {
				if (remaining >= 0) break;
				if (b.remaining <= 0) continue;
				const consume = Math.min(b.remaining, -remaining);
				b.remaining -= consume;
				remaining += consume;
			}
		}
	}

	expireBucketsThrough(now);

	if (newExpiries.length === 0) return { insertedExpiries: 0 };

	const insertRows = newExpiries.map((ne) => ({
		user_id: userId,
		kind: "expiry" as const,
		credits: ne.credits,
		description: "Subscription credits expired (3-month rollover ended)",
		source_grant_id: ne.grantId,
		whop_membership_id: ne.whopMembershipId,
		whop_product_id: ne.whopProductId,
		period_start: ne.periodStart,
		// Use the original expiry timestamp so the row sorts naturally next
		// to the funding grant in the billing history. `created_at` is set
		// on insert by Supabase but the column has no `default now()`
		// override path, so we pass it explicitly.
		created_at: ne.when.toISOString(),
		metadata: {},
	}));

	const { error: insertErr } = await supabase
		.from("shotstack_credit_ledger")
		.insert(insertRows);
	if (insertErr) {
		console.error("[shotstack-expiry] insert expiry rows failed:", insertErr);
		return { insertedExpiries: 0 };
	}
	return { insertedExpiries: newExpiries.length };
}
