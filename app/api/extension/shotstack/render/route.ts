import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { renderShotStack, creditsFromSeconds } from "@/lib/shotstack";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Queue a ShotStack video render.
 * Body: { edit, duration_seconds, env?: "stage"|"v1", use_own_key?: boolean }
 * - duration_seconds: required for credit check (from edit timeline/output)
 * - use_own_key: use user's BYOK if they have one
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: { edit: Record<string, unknown>; duration_seconds: number; env?: "stage" | "v1"; use_own_key?: boolean };
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { edit, duration_seconds, env = "v1", use_own_key = false } = body;
	if (!edit || typeof edit !== "object") {
		return Response.json({ error: "edit is required" }, { status: 400 });
	}
	if (typeof duration_seconds !== "number" || duration_seconds <= 0) {
		return Response.json({ error: "duration_seconds must be a positive number" }, { status: 400 });
	}

	const supabase = getSupabase();
	const creditsNeeded = creditsFromSeconds(duration_seconds);

	// Resolve API key: BYOK or managed
	let apiKey: string | null = null;
	if (use_own_key) {
		const { data: userRow } = await supabase
			.from("users")
			.select("shotstack_api_key_encrypted")
			.eq("id", user.user_id)
			.single();
		// TODO: decrypt shotstack_api_key_encrypted when encryption is implemented
		apiKey = userRow?.shotstack_api_key_encrypted ?? null;
	}
	if (!apiKey) {
		apiKey = env === "stage" ? process.env.SHOTSTACK_STAGING_API_KEY ?? null : process.env.SHOTSTACK_API_KEY ?? null;
	}
	if (!apiKey) {
		return Response.json({ error: "ShotStack not configured" }, { status: 503 });
	}

	// Credit check (only for managed key + non-BYOK)
	if (!use_own_key) {
		const { data: userRow } = await supabase
			.from("users")
			.select("shotstack_credits")
			.eq("id", user.user_id)
			.single();

		const credits = Number(userRow?.shotstack_credits ?? 0);
		if (credits < creditsNeeded) {
			return Response.json(
				{ error: `Insufficient credits. Need ${creditsNeeded}, have ${credits}` },
				{ status: 402 }
			);
		}
	}

	const result = await renderShotStack({ edit, env, apiKey });
	if (!result) {
		return Response.json({ error: "ShotStack render failed" }, { status: 500 });
	}

	// Deduct credits and record usage (only for managed, non-BYOK)
	if (!use_own_key) {
		const { data: u } = await supabase.from("users").select("shotstack_credits").eq("id", user.user_id).single();
		const current = Number(u?.shotstack_credits ?? 0);
		await supabase
			.from("users")
			.update({ shotstack_credits: Math.max(0, current - creditsNeeded) })
			.eq("id", user.user_id);

		const { error: usageError } = await supabase.from("shotstack_usage").insert({
			user_id: user.user_id,
			shotstack_render_id: result.id,
			duration_seconds,
			credits_used: creditsNeeded,
		});
		if (usageError) {
			console.error("[shotstack] usage record failed:", usageError);
		}
	}

	return Response.json({
		id: result.id,
		status: result.status,
		url: result.url,
	});
}
