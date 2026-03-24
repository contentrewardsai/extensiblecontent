import type { SupabaseClient } from "@supabase/supabase-js";
import { renderShotStack, creditsFromSeconds } from "@/lib/shotstack";

export type QueueShotStackInput = {
	userId: string;
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
};

export type QueueShotStackResult = QueueShotStackSuccess | QueueShotStackFailure;

export async function queueShotStackRender(supabase: SupabaseClient, input: QueueShotStackInput): Promise<QueueShotStackResult> {
	const { userId, edit, duration_seconds, env = "v1", use_own_key = false } = input;

	if (!edit || typeof edit !== "object") {
		return { ok: false, status: 400, error: "edit is required" };
	}
	if (typeof duration_seconds !== "number" || duration_seconds <= 0) {
		return { ok: false, status: 400, error: "duration_seconds must be a positive number" };
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
		const { data: userRow } = await supabase.from("users").select("shotstack_credits").eq("id", userId).single();
		const credits = Number(userRow?.shotstack_credits ?? 0);
		if (credits < creditsNeeded) {
			return {
				ok: false,
				status: 402,
				error: `Insufficient credits. Need ${creditsNeeded}, have ${credits}`,
			};
		}
	}

	let result: Awaited<ReturnType<typeof renderShotStack>>;
	try {
		result = await renderShotStack({ edit, env, apiKey });
	} catch (e) {
		const msg = e instanceof Error ? e.message : "ShotStack render failed";
		return { ok: false, status: 500, error: msg };
	}

	if (!result) {
		return { ok: false, status: 500, error: "ShotStack render failed" };
	}

	const creditsUsed = env === "stage" ? 0 : creditsNeeded;
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
		const { data: u } = await supabase.from("users").select("shotstack_credits").eq("id", userId).single();
		const current = Number(u?.shotstack_credits ?? 0);
		await supabase
			.from("users")
			.update({ shotstack_credits: Math.max(0, current - creditsNeeded) })
			.eq("id", userId);

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
