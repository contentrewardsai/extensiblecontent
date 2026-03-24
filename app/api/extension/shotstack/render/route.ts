import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getExtensionUser } from "@/lib/extension-auth";
import { queueShotStackRender } from "@/lib/shotstack-queue";

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

	const supabase = getSupabase();
	const result = await queueShotStackRender(supabase, {
		userId: user.user_id,
		edit: body.edit,
		duration_seconds: body.duration_seconds,
		env: body.env,
		use_own_key: body.use_own_key,
	});

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	return Response.json({
		id: result.id,
		status: result.status,
		url: result.url,
	});
}
