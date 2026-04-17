import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { getExtensionUser } from "@/lib/extension-auth";
import { getProjectMembership } from "@/lib/project-access";
import { queueShotStackRender } from "@/lib/shotstack-queue";

function getSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase not configured");
	return createClient(url, key);
}

/**
 * POST: Queue a ShotStack video render.
 *
 * Body: `{ edit, duration_seconds, project_id?, env?, use_own_key? }`
 *   - `duration_seconds` — required, drives the credit cost.
 *   - `project_id` — required when the actor is *not* the project owner
 *     (i.e. an invited collaborator). Charged-to wallet = project owner;
 *     per-project / per-member caps are enforced via the project's
 *     `shotstack_monthly_credit_cap` and `project_member_credit_overrides`.
 *     Owners may omit it; we default to their personal default project so
 *     solo-owner flows keep working.
 *   - `use_own_key` — bypasses managed credits; bring-your-own-key.
 */
export async function POST(request: NextRequest) {
	const user = await getExtensionUser(request);
	if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

	let body: {
		edit: Record<string, unknown>;
		duration_seconds: number;
		project_id?: string | null;
		env?: "stage" | "v1";
		use_own_key?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const supabase = getSupabase();

	// Resolve project + owner before queueing so we can attribute the
	// debit and enforce per-project caps. BYOK and stage renders skip
	// project resolution entirely — they don't touch managed credits.
	let projectId: string | null = null;
	let ownerId: string = user.user_id;
	const skipProject = body.use_own_key === true || body.env === "stage";
	if (!skipProject) {
		const requestedProjectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
		if (requestedProjectId) {
			const membership = await getProjectMembership(supabase, requestedProjectId, user.user_id);
			if (!membership) {
				return Response.json(
					{ error: "You are not a member of this project" },
					{ status: 403 },
				);
			}
			projectId = membership.projectId;
			ownerId = membership.ownerId;
		} else {
			// Owner can omit project_id and we'll fall back to their default
			// project; collaborators are required to specify which project
			// the render belongs to so the cap math is unambiguous.
			try {
				projectId = await ensureUserDefaultProjectId(supabase, user.user_id);
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to resolve default project";
				return Response.json({ error: message }, { status: 500 });
			}
			ownerId = user.user_id;
		}
	}

	const result = await queueShotStackRender(supabase, {
		userId: ownerId,
		actorUserId: user.user_id,
		projectId,
		edit: body.edit,
		duration_seconds: body.duration_seconds,
		env: body.env,
		use_own_key: body.use_own_key,
	});

	if (!result.ok) {
		return Response.json({ error: result.error, code: result.code }, { status: result.status });
	}

	return Response.json({
		id: result.id,
		status: result.status,
		url: result.url,
	});
}
