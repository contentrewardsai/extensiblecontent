"use server";

import { revalidatePath } from "next/cache";
import { requireExperienceActionUser } from "@/lib/experience-action-auth";
import { getValidTokenForLocation, ghlFetch } from "@/lib/ghl";
import { processDueGhlPosts } from "@/lib/ghl-scheduler";
import { getServiceSupabase } from "@/lib/supabase-service";

type ActionResult =
	| { ok: true; message?: string; ghlPostId?: string | null; scheduledId?: string }
	| { ok: false; error: string };

interface SchedulePayload {
	experienceId: string;
	locationId: string;
	summary: string;
	accountIds: string[];
	media?: Array<{ url: string; type?: string }>;
	scheduledFor?: string | null;
}

function parseAccountIds(raw: FormDataEntryValue | null): string[] {
	if (typeof raw !== "string" || !raw.trim()) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseMediaUrls(raw: FormDataEntryValue | null): Array<{ url: string }> {
	if (typeof raw !== "string") return [];
	return raw
		.split(/\s+/)
		.map((s) => s.trim())
		.filter((s) => /^https?:\/\//i.test(s))
		.map((url) => ({ url }));
}

function buildPayload(input: SchedulePayload) {
	const payload: Record<string, unknown> = {
		accountIds: input.accountIds,
		summary: input.summary,
		type: "post",
		locationId: input.locationId,
	};
	if (input.media && input.media.length > 0) payload.media = input.media;
	return payload;
}

/**
 * Publish now: sends the post to GHL immediately (no queue row).
 */
export async function ghlPostNowAction(
	_prev: ActionResult | null,
	formData: FormData,
): Promise<ActionResult> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const locationId = String(formData.get("locationId") ?? "");
	const summary = String(formData.get("summary") ?? "").trim();
	const accountIds = parseAccountIds(formData.get("accountIds"));
	const media = parseMediaUrls(formData.get("media"));

	if (!experienceId) return { ok: false, error: "Missing experienceId" };
	if (!locationId) return { ok: false, error: "Select a sub-account" };
	if (!summary) return { ok: false, error: "Post text can't be empty" };
	if (accountIds.length === 0)
		return { ok: false, error: "Pick at least one social channel" };

	const { internalUserId } = await requireExperienceActionUser(experienceId);

	try {
		const payload = buildPayload({
			experienceId,
			locationId,
			summary,
			accountIds,
			media,
		});

		const res = await ghlFetch(
			internalUserId,
			locationId,
			`/social-media-posting/${encodeURIComponent(locationId)}/posts`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			},
		);

		const data = await res.json().catch(() => null);
		if (!res.ok) {
			const msg =
				(data && (data.message || data.error)) ||
				`GHL ${res.status}`;
			return { ok: false, error: String(msg) };
		}

		const ghlPostId =
			data && typeof data === "object"
				? ((data.id as string) ??
					((data.post as Record<string, unknown> | undefined)?.id as string | undefined) ??
					null)
				: null;

		revalidatePath(`/experiences/${experienceId}/social`);
		return { ok: true, message: "Posted to GHL.", ghlPostId: ghlPostId ?? null };
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return { ok: false, error: msg };
	}
}

/**
 * Schedule: inserts a row into ghl_scheduled_posts so the cron will publish it later.
 */
export async function ghlSchedulePostAction(
	_prev: ActionResult | null,
	formData: FormData,
): Promise<ActionResult> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const locationId = String(formData.get("locationId") ?? "");
	const summary = String(formData.get("summary") ?? "").trim();
	const accountIds = parseAccountIds(formData.get("accountIds"));
	const media = parseMediaUrls(formData.get("media"));
	const scheduledForRaw = String(formData.get("scheduledFor") ?? "");

	if (!experienceId) return { ok: false, error: "Missing experienceId" };
	if (!locationId) return { ok: false, error: "Select a sub-account" };
	if (!summary) return { ok: false, error: "Post text can't be empty" };
	if (accountIds.length === 0)
		return { ok: false, error: "Pick at least one social channel" };
	if (!scheduledForRaw) return { ok: false, error: "Pick a date and time" };

	const when = new Date(scheduledForRaw);
	if (Number.isNaN(when.getTime())) {
		return { ok: false, error: "Invalid date/time" };
	}
	if (when.getTime() < Date.now() - 60_000) {
		return { ok: false, error: "Scheduled time must be in the future" };
	}

	const { internalUserId } = await requireExperienceActionUser(experienceId);

	let ghlLocationDbId: string;
	try {
		const resolved = await getValidTokenForLocation(internalUserId, locationId);
		ghlLocationDbId = resolved.ghlLocationDbId;
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Access denied";
		return { ok: false, error: msg };
	}

	const supabase = getServiceSupabase();
	const payload = buildPayload({
		experienceId,
		locationId,
		summary,
		accountIds,
		media,
	});

	const { data, error } = await supabase
		.from("ghl_scheduled_posts")
		.insert({
			user_id: internalUserId,
			ghl_location_id: ghlLocationDbId,
			location_id: locationId,
			payload,
			scheduled_for: when.toISOString(),
			source: "whop-app",
		})
		.select("id")
		.single();

	if (error) return { ok: false, error: error.message };

	// If the scheduled time is already due (user picked "now-ish"), process it
	// right away instead of waiting for the daily cron. Fire-and-forget so the
	// user gets immediate UI feedback.
	if (when.getTime() <= Date.now() + 30_000) {
		processDueGhlPosts({ userId: internalUserId, batchSize: 5 }).catch(
			(err) => {
				console.error("[ghl-scheduler] opportunistic kick failed", err);
			},
		);
	}

	revalidatePath(`/experiences/${experienceId}/social`);
	return {
		ok: true,
		message: `Scheduled for ${when.toLocaleString()}.`,
		scheduledId: data.id,
	};
}

/**
 * Cancel a pending scheduled post owned by the current Whop user.
 */
export async function ghlCancelScheduledAction(
	_prev: ActionResult | null,
	formData: FormData,
): Promise<ActionResult> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const scheduledId = String(formData.get("scheduledId") ?? "");

	if (!experienceId) return { ok: false, error: "Missing experienceId" };
	if (!scheduledId) return { ok: false, error: "Missing scheduledId" };

	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();

	const { data, error } = await supabase
		.from("ghl_scheduled_posts")
		.update({ status: "cancelled", updated_at: new Date().toISOString() })
		.eq("id", scheduledId)
		.eq("user_id", internalUserId)
		.eq("status", "pending")
		.select("id")
		.maybeSingle();

	if (error) return { ok: false, error: error.message };
	if (!data)
		return {
			ok: false,
			error: "Scheduled post not found or no longer pending.",
		};

	revalidatePath(`/experiences/${experienceId}/social`);
	return { ok: true, message: "Cancelled." };
}
