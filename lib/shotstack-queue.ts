import type { SupabaseClient } from "@supabase/supabase-js";
import {
	assertProjectShotstackCap,
	ProjectCreditCapError,
	type ProjectCreditCapErrorCode,
} from "@/lib/project-credit-cap";
import { renderShotStack, creditsFromSeconds } from "@/lib/shotstack";
import { getSpendableCredits, recordRenderDebit } from "@/lib/shotstack-ledger";

export type QueueShotStackInput = {
	/** Wallet holder — debit comes from this user's credits. */
	userId: string;
	/**
	 * Member who triggered the render. Defaults to `userId` (solo-owner
	 * flow). When provided and different from `userId`, the per-member
	 * project cap takes effect.
	 */
	actorUserId?: string | null;
	/**
	 * Project the render is scoped to. Required for per-project cap
	 * enforcement; null bypasses cap checks (BYOK / stage / legacy
	 * solo-owner default-project resolution lives in the route layer).
	 */
	projectId?: string | null;
	edit: Record<string, unknown>;
	duration_seconds: number;
	env?: "stage" | "v1";
	use_own_key?: boolean;
};

export type QueueShotStackSuccess = {
	ok: true;
	id: string;
	status: string;
	url?: string;
};

export type QueueShotStackFailure = {
	ok: false;
	status: number;
	error: string;
	/** Stable error code for client branching (e.g. `project_cap_full`). */
	code?: ProjectCreditCapErrorCode | "insufficient_credits" | "bad_request" | "render_failed";
};

export type QueueShotStackResult = QueueShotStackSuccess | QueueShotStackFailure;

export async function queueShotStackRender(supabase: SupabaseClient, input: QueueShotStackInput): Promise<QueueShotStackResult> {
	const {
		userId,
		actorUserId: actorUserIdRaw = null,
		projectId = null,
		edit,
		duration_seconds,
		env = "v1",
		use_own_key = false,
	} = input;
	const actorUserId = actorUserIdRaw ?? userId;

	if (!edit || typeof edit !== "object") {
		return { ok: false, status: 400, error: "edit is required", code: "bad_request" };
	}
	if (typeof duration_seconds !== "number" || duration_seconds <= 0) {
		return {
			ok: false,
			status: 400,
			error: "duration_seconds must be a positive number",
			code: "bad_request",
		};
	}

	const creditsNeeded = creditsFromSeconds(duration_seconds);

	let apiKey: string | null = null;
	if (use_own_key) {
		const { data: userRow } = await supabase.from("users").select("shotstack_api_key_encrypted").eq("id", userId).single();
		apiKey = userRow?.shotstack_api_key_encrypted ?? null;
	}
	if (!apiKey) {
		apiKey = env === "stage" ? process.env.SHOTSTACK_STAGING_API_KEY ?? null : process.env.SHOTSTACK_API_KEY ?? null;
	}
	if (!apiKey) {
		return { ok: false, status: 503, error: "ShotStack not configured" };
	}

	if (!use_own_key && env !== "stage") {
		// Project / member cap is checked first so we don't burn the
		// owner's wallet credit budget on a render that was going to fail
		// the per-project cap anyway. `null` projectId skips the cap check
		// (legacy solo-owner flow before route-layer resolution exists).
		if (projectId) {
			try {
				await assertProjectShotstackCap(supabase, {
					projectId,
					actorUserId,
					requestedCredits: creditsNeeded,
				});
			} catch (err) {
				if (err instanceof ProjectCreditCapError) {
					return {
						ok: false,
						status: err.status,
						error: err.message,
						code: err.code,
					};
				}
				throw err;
			}
		}

		// Spendable balance = sum of unexpired grants minus debits, computed
		// from `shotstack_credit_ledger`. We deliberately re-check at debit
		// time instead of trusting the cached `users.shotstack_credits` so
		// concurrent renders can't both pass a stale balance check.
		const credits = await getSpendableCredits(supabase, userId);
		if (credits < creditsNeeded) {
			return {
				ok: false,
				status: 402,
				error: `Insufficient credits. Need ${creditsNeeded}, have ${credits}`,
				code: "insufficient_credits",
			};
		}
	}

	let result: Awaited<ReturnType<typeof renderShotStack>>;
	try {
		result = await renderShotStack({ edit, env, apiKey });
	} catch (e) {
		const msg = e instanceof Error ? e.message : "ShotStack render failed";
		return { ok: false, status: 500, error: msg, code: "render_failed" };
	}

	if (!result) {
		return { ok: false, status: 500, error: "ShotStack render failed", code: "render_failed" };
	}

	const creditsUsed = env === "stage" ? 0 : creditsNeeded;
	// `shotstack_renders.user_id` stays the *wallet owner* (who's
	// charged). That preserves the billing page's "show me everything my
	// wallet paid for" view. The actor + project attribution lives on the
	// ledger row instead, written below.
	const { error: renderError } = await supabase.from("shotstack_renders").insert({
		user_id: userId,
		shotstack_render_id: result.id,
		request_json: edit,
		status: result.status,
		credits_used: creditsUsed,
		env,
	});
	if (renderError) {
		console.error("[shotstack] shotstack_renders insert failed:", renderError);
	}

	if (!use_own_key && env !== "stage") {
		// One write per render: a ledger debit on the *owner's* wallet,
		// tagged with the project + actor for cap accounting.
		// `recordRenderDebit` also refreshes the cached
		// `users.shotstack_credits` so existing readers stay accurate. The
		// legacy `shotstack_usage` table is kept for now as a denormalised
		// duration log for reports that don't need ledger semantics.
		try {
			await recordRenderDebit(supabase, {
				userId,
				actorUserId,
				projectId,
				credits: creditsNeeded,
				shotstackRenderId: result.id,
				description: `Render ${result.id} (${duration_seconds.toFixed(2)}s)`,
				metadata: { duration_seconds, env, project_id: projectId, actor_user_id: actorUserId },
			});
		} catch (err) {
			console.error("[shotstack] ledger debit failed:", err);
		}

		const { error: usageError } = await supabase.from("shotstack_usage").insert({
			user_id: userId,
			shotstack_render_id: result.id,
			duration_seconds,
			credits_used: creditsNeeded,
		});
		if (usageError) {
			console.error("[shotstack] usage record failed:", usageError);
		}
	}

	return {
		ok: true,
		id: result.id,
		status: result.status,
		url: result.url,
	};
}
