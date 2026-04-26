import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ghlFetch } from "@/lib/ghl";

const LEASE_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 25;

export interface SchedulerResult {
	id: string;
	ok: boolean;
	error?: string;
}

export interface ProcessOptions {
	/** Only process rows owned by this user. Used by on-demand triggers from UI. */
	userId?: string;
	/** Max rows to process in this invocation. */
	batchSize?: number;
}

/**
 * Publishes every GHL scheduled post that is due now.
 *
 * Shared between the daily Vercel cron and the on-demand "kick" endpoint the
 * UI calls when someone loads the Social page. Safe to run concurrently — each
 * row is leased atomically by transitioning status pending → in_progress.
 */
export async function processDueGhlPosts(
	opts: ProcessOptions = {},
): Promise<{ processed: number; results: SchedulerResult[] }> {
	const supabase = getServiceSupabase();
	const nowIso = new Date().toISOString();
	const leaseExpiredBefore = new Date(Date.now() - LEASE_WINDOW_MS).toISOString();
	const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

	let query = supabase
		.from("ghl_scheduled_posts")
		.select("id, user_id, location_id, payload, attempts, status, leased_at")
		.or(
			`status.eq.pending,and(status.eq.in_progress,leased_at.lt.${leaseExpiredBefore})`,
		)
		.lte("scheduled_for", nowIso)
		.order("scheduled_for", { ascending: true })
		.limit(batchSize);

	if (opts.userId) query = query.eq("user_id", opts.userId);

	const { data: candidates, error: selectErr } = await query;
	if (selectErr) throw new Error(selectErr.message);

	const results: SchedulerResult[] = [];

	for (const row of candidates ?? []) {
		const leaseToken = crypto.randomUUID();

		const { data: leased } = await supabase
			.from("ghl_scheduled_posts")
			.update({
				status: "in_progress",
				leased_at: new Date().toISOString(),
				lease_token: leaseToken,
				updated_at: new Date().toISOString(),
			})
			.eq("id", row.id)
			.eq("status", row.status)
			.select("id")
			.maybeSingle();

		if (!leased) continue;

		try {
			const res = await ghlFetch(
				row.user_id,
				row.location_id,
				`/social-media-posting/${encodeURIComponent(row.location_id)}/posts`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(row.payload ?? {}),
				},
			);

			const responseJson = await res.json().catch(() => null);

			if (!res.ok) {
				await markFailedOrRetry(supabase, row.id, row.attempts, responseJson);
				results.push({ id: row.id, ok: false, error: `GHL ${res.status}` });
				continue;
			}

			const ghlPostId = extractPostId(responseJson);
			await supabase
				.from("ghl_scheduled_posts")
				.update({
					status: "succeeded",
					attempts: row.attempts + 1,
					ghl_post_id: ghlPostId,
					response: responseJson,
					last_error: null,
					updated_at: new Date().toISOString(),
				})
				.eq("id", row.id);

			results.push({ id: row.id, ok: true });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			await markFailedOrRetry(supabase, row.id, row.attempts, { error: msg });
			results.push({ id: row.id, ok: false, error: msg });
		}
	}

	return { processed: results.length, results };
}

async function markFailedOrRetry(
	supabase: SupabaseClient,
	id: string,
	attempts: number,
	errorPayload: unknown,
) {
	const nextAttempts = attempts + 1;
	const reachedMax = nextAttempts >= MAX_ATTEMPTS;
	await supabase
		.from("ghl_scheduled_posts")
		.update({
			status: reachedMax ? "failed" : "pending",
			attempts: nextAttempts,
			last_error:
				typeof errorPayload === "string"
					? errorPayload
					: JSON.stringify(errorPayload).slice(0, 2000),
			leased_at: null,
			lease_token: null,
			updated_at: new Date().toISOString(),
		})
		.eq("id", id);
}

function extractPostId(response: unknown): string | null {
	if (!response || typeof response !== "object") return null;
	const r = response as Record<string, unknown>;
	const direct = r.id ?? r._id ?? r.postId;
	if (typeof direct === "string") return direct;
	const nested = r.post as Record<string, unknown> | undefined;
	if (nested) {
		const nestedId = nested.id ?? nested._id;
		if (typeof nestedId === "string") return nestedId;
	}
	return null;
}
