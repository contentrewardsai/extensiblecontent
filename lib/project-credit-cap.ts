import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-project (and per-project-member) ShotStack credit cap enforcement.
 *
 * Credits are still funded from the project owner's wallet (`users` cap +
 * `shotstack_credit_ledger` rows where `user_id = owner`). This module adds
 * an *additional* monthly cap layered on top so the owner can say:
 *   - "this project may only spend N credits/month"; and/or
 *   - "Alice may spend at most M credits/month inside this project".
 *
 * Resolution order, evaluated against `requestedCredits`:
 *   1. If a per-member override exists for `actorUserId`, the actor's spend
 *      this month + requestedCredits must fit inside that override.
 *   2. Otherwise, if the project has a monthly cap, the *project's* spend
 *      this month (across all members) + requestedCredits must fit.
 *   3. Otherwise no project-level limit applies (only the owner wallet
 *      check downstream gates the render).
 *
 * Throws `ProjectCreditCapError` (402) on overrun. Callers are expected to
 * surface the message + code in the API response.
 */

export type ProjectCreditCapErrorCode = "project_cap_full" | "member_cap_full";

export class ProjectCreditCapError extends Error {
	readonly status: number;
	readonly code: ProjectCreditCapErrorCode;
	readonly cap: number;
	readonly used: number;
	readonly requested: number;
	constructor(
		code: ProjectCreditCapErrorCode,
		message: string,
		cap: number,
		used: number,
		requested: number,
	) {
		super(message);
		this.name = "ProjectCreditCapError";
		this.status = 402;
		this.code = code;
		this.cap = cap;
		this.used = used;
		this.requested = requested;
	}
}

export interface AssertProjectShotstackCapOptions {
	projectId: string;
	actorUserId: string;
	requestedCredits: number;
}

export interface ProjectCreditCapResult {
	cap: number | null;
	used: number;
	requested: number;
	source: "member_override" | "project_cap" | "none";
}

interface ProjectCapRow {
	shotstack_monthly_credit_cap: number | null;
}
interface OverrideRow {
	monthly_credit_cap: number;
}

async function getProjectMonthlySpent(
	supabase: SupabaseClient,
	projectId: string,
	actorUserId: string | null,
): Promise<number> {
	const { data, error } = await supabase.rpc("project_shotstack_spent_this_month", {
		p_project_id: projectId,
		p_actor_user_id: actorUserId,
	});
	if (error) {
		throw new Error(`project_shotstack_spent_this_month: ${error.message}`);
	}
	const n = Number(data ?? 0);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Throws on cap overrun. Returns the resolved cap context on success so
 * callers can log / surface usage telemetry alongside the render.
 */
export async function assertProjectShotstackCap(
	supabase: SupabaseClient,
	{ projectId, actorUserId, requestedCredits }: AssertProjectShotstackCapOptions,
): Promise<ProjectCreditCapResult> {
	const requested = Number.isFinite(requestedCredits) && requestedCredits > 0 ? requestedCredits : 0;
	if (requested === 0) {
		return { cap: null, used: 0, requested: 0, source: "none" };
	}

	const [{ data: projectRow, error: projectErr }, { data: overrideRow, error: overrideErr }] =
		await Promise.all([
			supabase
				.from("projects")
				.select("shotstack_monthly_credit_cap")
				.eq("id", projectId)
				.maybeSingle(),
			supabase
				.from("project_member_credit_overrides")
				.select("monthly_credit_cap")
				.eq("project_id", projectId)
				.eq("user_id", actorUserId)
				.maybeSingle(),
		]);
	if (projectErr) throw new Error(`assertProjectShotstackCap: ${projectErr.message}`);
	if (overrideErr) throw new Error(`assertProjectShotstackCap (override): ${overrideErr.message}`);

	const projectCap = (projectRow as ProjectCapRow | null)?.shotstack_monthly_credit_cap ?? null;
	const memberOverride = (overrideRow as OverrideRow | null)?.monthly_credit_cap ?? null;

	if (memberOverride != null) {
		// Per-member override: scope the spent-this-month query to just
		// this actor so other members' spend doesn't pull from the override.
		const used = await getProjectMonthlySpent(supabase, projectId, actorUserId);
		if (used + requested > memberOverride) {
			throw new ProjectCreditCapError(
				"member_cap_full",
				`Member monthly cap reached (${used} used + ${requested} requested > ${memberOverride}).`,
				memberOverride,
				used,
				requested,
			);
		}
		return { cap: memberOverride, used, requested, source: "member_override" };
	}

	if (projectCap != null) {
		const used = await getProjectMonthlySpent(supabase, projectId, null);
		if (used + requested > projectCap) {
			throw new ProjectCreditCapError(
				"project_cap_full",
				`Project monthly credit cap reached (${used} used + ${requested} requested > ${projectCap}).`,
				projectCap,
				used,
				requested,
			);
		}
		return { cap: projectCap, used, requested, source: "project_cap" };
	}

	return { cap: null, used: 0, requested, source: "none" };
}
