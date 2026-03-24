"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireExperienceActionUser } from "@/lib/experience-action-auth";
import { getServiceSupabase } from "@/lib/supabase-service";
import { queueShotStackRender } from "@/lib/shotstack-queue";
import { forwardUploadPostMultipart } from "@/lib/upload-post-forward";
import { getOrRefreshUploadPostConnectUrl } from "@/lib/upload-post-connect";

export async function createGeneratorTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const name = String(formData.get("name") ?? "").trim();
	const payloadRaw = String(formData.get("payload") ?? "").trim();

	if (!experienceId || !name) {
		redirect(`/experiences/${experienceId}/templates?err=missing_name`);
	}

	const { internalUserId } = await requireExperienceActionUser(experienceId);

	let payload: Record<string, unknown> = {};
	if (payloadRaw) {
		try {
			const parsed = JSON.parse(payloadRaw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				redirect(`/experiences/${experienceId}/templates?err=bad_json`);
			}
			payload = parsed as Record<string, unknown>;
		} catch {
			redirect(`/experiences/${experienceId}/templates?err=bad_json`);
		}
	}

	const supabase = getServiceSupabase();
	const now = new Date().toISOString();
	const { error } = await supabase.from("generator_templates").insert({
		user_id: internalUserId,
		name,
		payload,
		updated_at: now,
	});

	if (error) {
		redirect(`/experiences/${experienceId}/templates?err=save_failed`);
	}

	revalidatePath(`/experiences/${experienceId}/templates`);
	redirect(`/experiences/${experienceId}/templates`);
}

export async function deleteGeneratorTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const templateId = String(formData.get("templateId") ?? "");
	if (!experienceId || !templateId) return;

	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	await supabase.from("generator_templates").delete().eq("id", templateId).eq("user_id", internalUserId);
	revalidatePath(`/experiences/${experienceId}/templates`);
}

export async function createShotstackTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const name = String(formData.get("name") ?? "").trim();
	const editRaw = String(formData.get("edit") ?? "").trim();
	const defaultEnv = formData.get("default_env") === "stage" ? "stage" : "v1";

	if (!experienceId || !name || !editRaw) {
		redirect(`/experiences/${experienceId}/shotstack?err=missing_fields`);
	}

	const { internalUserId } = await requireExperienceActionUser(experienceId);

	let edit: Record<string, unknown>;
	try {
		const parsed = JSON.parse(editRaw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			redirect(`/experiences/${experienceId}/shotstack?err=bad_json`);
		}
		edit = parsed as Record<string, unknown>;
	} catch {
		redirect(`/experiences/${experienceId}/shotstack?err=bad_json`);
	}

	const supabase = getServiceSupabase();
	const { error } = await supabase.from("shotstack_templates").insert({
		user_id: internalUserId,
		name,
		edit,
		default_env: defaultEnv,
		updated_at: new Date().toISOString(),
	});

	if (error) {
		redirect(`/experiences/${experienceId}/shotstack?err=save_failed`);
	}

	revalidatePath(`/experiences/${experienceId}/shotstack`);
	redirect(`/experiences/${experienceId}/shotstack`);
}

export async function deleteShotstackTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const templateId = String(formData.get("templateId") ?? "");
	if (!experienceId || !templateId) return;

	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	await supabase.from("shotstack_templates").delete().eq("id", templateId).eq("user_id", internalUserId);
	revalidatePath(`/experiences/${experienceId}/shotstack`);
}

export type ShotstackRenderActionState =
	| { ok: true; id: string; status: string; url?: string }
	| { ok: false; error: string };

export async function queueShotstackRenderAction(
	_prev: ShotstackRenderActionState | null,
	formData: FormData,
): Promise<ShotstackRenderActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const durationRaw = String(formData.get("duration_seconds") ?? "");
	const env = formData.get("env") === "stage" ? "stage" : "v1";
	const useOwnKey = formData.get("use_own_key") === "on";
	const templateId = String(formData.get("template_id") ?? "").trim();
	const editRaw = String(formData.get("edit") ?? "").trim();

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();

		let edit: Record<string, unknown>;
		if (templateId) {
			const { data: row, error } = await supabase
				.from("shotstack_templates")
				.select("edit")
				.eq("id", templateId)
				.eq("user_id", internalUserId)
				.single();
			if (error || !row?.edit || typeof row.edit !== "object") {
				return { ok: false, error: "Template not found" };
			}
			edit = row.edit as Record<string, unknown>;
		} else if (editRaw) {
			try {
				const parsed = JSON.parse(editRaw) as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
					return { ok: false, error: "Invalid edit JSON" };
				}
				edit = parsed as Record<string, unknown>;
			} catch {
				return { ok: false, error: "Invalid edit JSON" };
			}
		} else {
			return { ok: false, error: "Provide a template or paste edit JSON" };
		}

		const duration_seconds = Number.parseFloat(durationRaw);
		if (!Number.isFinite(duration_seconds) || duration_seconds <= 0) {
			return { ok: false, error: "duration_seconds must be a positive number" };
		}

		const result = await queueShotStackRender(supabase, {
			userId: internalUserId,
			edit,
			duration_seconds,
			env,
			use_own_key: useOwnKey,
		});

		if (!result.ok) {
			return { ok: false, error: result.error };
		}

		revalidatePath(`/experiences/${experienceId}/shotstack`);
		return { ok: true, id: result.id, status: result.status, url: result.url };
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Unauthorized or failed";
		return { ok: false, error: msg };
	}
}

export type UploadPostActionState = { ok: true; json: unknown } | { ok: false; error: string };

export async function uploadPostCloudAction(
	_prev: UploadPostActionState | null,
	formData: FormData,
): Promise<UploadPostActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		const forwardData = new FormData();
		for (const [key, value] of formData.entries()) {
			if (key === "experienceId") continue;
			forwardData.append(key, value);
		}
		const result = await forwardUploadPostMultipart(supabase, internalUserId, forwardData);
		if (!result.ok) {
			return { ok: false, error: result.error };
		}
		return { ok: true, json: result.json };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Failed" };
	}
}

export type ConnectUrlActionState = { url?: string; error?: string };

export async function refreshConnectUrlAction(
	_prev: ConnectUrlActionState | null,
	formData: FormData,
): Promise<ConnectUrlActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const accountId = String(formData.get("accountId") ?? "");
	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		const result = await getOrRefreshUploadPostConnectUrl(supabase, internalUserId, accountId);
		if (!result.ok) {
			return { error: result.error };
		}
		return { url: result.access_url };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed" };
	}
}
