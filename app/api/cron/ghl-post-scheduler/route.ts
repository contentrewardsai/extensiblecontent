import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ghlFetch } from "@/lib/ghl";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

const LEASE_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 25;

/**
 * Vercel cron: publishes due GHL scheduled posts.
 *
 * - Picks up to BATCH_SIZE rows whose scheduled_for <= now and status='pending'
 *   (or status='in_progress' but the lease has expired).
 * - Leases each row atomically by bumping status → 'in_progress' with a lease_token
 *   so concurrent invocations can't double-post.
 * - Calls GHL POST /social-media-posting/:locationId/posts via ghlFetch, which
 *   re-verifies access and refreshes tokens on demand.
 * - On success marks status='succeeded' and stores ghl_post_id + response.
 * - On failure bumps attempts; after MAX_ATTEMPTS marks status='failed'.
 *
 * Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;
	if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const supabase = getSupabase();
	const nowIso = new Date().toISOString();
	const leaseExpiredBefore = new Date(Date.now() - LEASE_WINDOW_MS).toISOString();

	const { data: candidates, error: selectErr } = await supabase
		.from("ghl_scheduled_posts")
		.select("id, user_id, location_id, payload, attempts, status, leased_at")
		.or(
			`status.eq.pending,and(status.eq.in_progress,leased_at.lt.${leaseExpiredBefore})`,
		)
		.lte("scheduled_for", nowIso)
		.order("scheduled_for", { ascending: true })
		.limit(BATCH_SIZE);

	if (selectErr) {
		return Response.json({ error: selectErr.message }, { status: 500 });
	}

	const results: Array<{ id: string; ok: boolean; error?: string }> = [];

	for (const row of candidates ?? []) {
		const leaseToken = crypto.randomUUID();

		// Atomic lease: only succeeds if someone else hasn't leased it in between.
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
				results.push({
					id: row.id,
					ok: false,
					error: `GHL ${res.status}`,
				});
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

	return Response.json({ processed: results.length, results });
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
