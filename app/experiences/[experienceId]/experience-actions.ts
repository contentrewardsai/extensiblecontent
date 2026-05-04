"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureUserDefaultProjectId } from "@/lib/default-project";
import { requireExperienceActionUser } from "@/lib/experience-action-auth";
import {
	assertProjectAccess,
	ProjectAccessError,
	type ProjectRole,
} from "@/lib/project-access";
import { recordProjectAudit, type EditSource } from "@/lib/project-audit";
import {
	generateInviteToken,
	isLastOwner,
	resolveUserIdentifier,
} from "@/lib/project-members";
import {
	assertProjectQuota,
	normalizeQuotaInput,
	ProjectQuotaError,
} from "@/lib/project-quota";
import { getServiceSupabase } from "@/lib/supabase-service";
import { queueShotStackRender } from "@/lib/shotstack-queue";
import {
	POST_MEDIA_BUCKET_PRIVATE,
	POST_MEDIA_BUCKET_PUBLIC,
	type PostMediaFolder,
	resolvePostMediaFolder,
} from "@/lib/storage-post-media";
import { createUploadPostAccount } from "@/lib/upload-post-account-create";
import { forwardUploadPostMultipart } from "@/lib/upload-post-forward";
import { getOrRefreshUploadPostConnectUrl } from "@/lib/upload-post-connect";

async function getMemberProjectIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
	const { data: memberRows } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
	return Array.from(
		new Set(
			((memberRows ?? []) as Array<{ project_id: string | null }>)
				.map((r) => r.project_id)
				.filter((id): id is string => typeof id === "string" && id.length > 0),
		),
	);
}

/** Template visible for clone: owner, project-shared, or built-in starter. */
function shotstackTemplateVisibleOrQuery(userId: string, memberProjectIds: string[]) {
	const orParts: string[] = [`user_id.eq.${userId}`, "is_builtin.eq.true"];
	if (memberProjectIds.length > 0) {
		orParts.push(`project_id.in.(${memberProjectIds.join(",")})`);
	}
	return orParts.join(",");
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
	const { data: row } = await supabase
		.from("shotstack_templates")
		.select("id, is_builtin")
		.eq("id", templateId)
		.maybeSingle();
	if (row?.is_builtin) {
		redirect(`/experiences/${experienceId}/shotstack?err=builtin_readonly`);
	}
	await supabase
		.from("shotstack_templates")
		.delete()
		.eq("id", templateId)
		.eq("user_id", internalUserId)
		.eq("is_builtin", false);
	revalidatePath(`/experiences/${experienceId}/shotstack`);
}

export async function cloneShotstackTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const templateId = String(formData.get("templateId") ?? "");
	if (!experienceId || !templateId) {
		if (experienceId) {
			redirect(`/experiences/${experienceId}/shotstack?err=missing_fields`);
		}
		redirect("/");
	}
	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	const memberProjectIds = await getMemberProjectIds(supabase, internalUserId);
	const orFilter = shotstackTemplateVisibleOrQuery(internalUserId, memberProjectIds);
	const { data: source, error: sourceErr } = await supabase
		.from("shotstack_templates")
		.select("id, name, edit, default_env")
		.eq("id", templateId)
		.or(orFilter)
		.maybeSingle();
	if (sourceErr || !source) {
		redirect(`/experiences/${experienceId}/shotstack?err=not_found`);
	}
	const name = `${source.name} (copy)`;
	const now = new Date().toISOString();
	const { data: created, error } = await supabase
		.from("shotstack_templates")
		.insert({
			user_id: internalUserId,
			name,
			edit: (source.edit ?? {}) as Record<string, unknown>,
			default_env: source.default_env === "stage" ? "stage" : "v1",
			is_builtin: false,
			source_path: null,
			updated_at: now,
		})
		.select("id")
		.single();
	if (error || !created?.id) {
		redirect(`/experiences/${experienceId}/shotstack?err=save_failed`);
	}
	revalidatePath(`/experiences/${experienceId}/shotstack`);
	redirect(`/experiences/${experienceId}/shotstack/editor/${created.id}`);
}

export async function updateShotstackTemplate(formData: FormData) {
	const experienceId = String(formData.get("experienceId") ?? "");
	const templateId = String(formData.get("templateId") ?? "");
	if (!experienceId || !templateId) {
		redirect(`/experiences/${experienceId}/shotstack?err=missing_fields`);
	}
	const nameRaw = String(formData.get("name") ?? "").trim();
	const editRaw = String(formData.get("edit") ?? "").trim();
	const defaultEnv = formData.get("default_env") === "stage" ? "stage" : "v1";

	if (!editRaw) {
		redirect(`/experiences/${experienceId}/shotstack?err=missing_fields`);
	}
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
	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();
	const { data: existing } = await supabase
		.from("shotstack_templates")
		.select("id, is_builtin")
		.eq("id", templateId)
		.eq("user_id", internalUserId)
		.maybeSingle();
	if (!existing) {
		redirect(`/experiences/${experienceId}/shotstack?err=not_found`);
	}
	if (existing.is_builtin) {
		redirect(`/experiences/${experienceId}/shotstack?err=builtin_readonly`);
	}
	const updates: Record<string, unknown> = {
		edit,
		default_env: defaultEnv,
		updated_at: new Date().toISOString(),
	};
	if (nameRaw) {
		updates.name = nameRaw;
	}
	const { error } = await supabase
		.from("shotstack_templates")
		.update(updates)
		.eq("id", templateId)
		.eq("user_id", internalUserId)
		.eq("is_builtin", false);
	if (error) {
		redirect(`/experiences/${experienceId}/shotstack?err=save_failed`);
	}
	revalidatePath(`/experiences/${experienceId}/shotstack`);
	redirect(`/experiences/${experienceId}/shotstack`);
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
			const memberProjectIds = await getMemberProjectIds(supabase, internalUserId);
			const orFilter = shotstackTemplateVisibleOrQuery(internalUserId, memberProjectIds);
			const { data: row, error } = await supabase
				.from("shotstack_templates")
				.select("edit")
				.eq("id", templateId)
				.or(orFilter)
				.maybeSingle();
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

// ---------------------------------------------------------------------------
// Uploads page: Supabase post-media storage (mirrors the extension's
// `uploadToStorage` step). The browser receives a short-lived presigned PUT
// URL and uploads the file directly to Supabase, so we don't go through the
// 4.5 MB Vercel function body limit.
// ---------------------------------------------------------------------------

const STORAGE_UPLOAD_URL_EXPIRY = 60 * 60; // 1 hour

export type GetStorageUploadUrlState =
	| {
			ok: true;
			upload_url: string;
			file_url: string;
			file_path: string;
			file_id: string;
			project_id: string;
			project_id_source: "request" | "default";
			media_type: PostMediaFolder;
			content_type: string;
			size_bytes: number;
			private: boolean;
	  }
	| { ok: false; error: string };

export async function getStorageUploadUrlAction(formData: FormData): Promise<GetStorageUploadUrlState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const filename = String(formData.get("filename") ?? "").trim();
	const contentTypeRaw = String(formData.get("content_type") ?? "").trim();
	const sizeBytesRaw = String(formData.get("size_bytes") ?? "").trim();
	const requestedProjectId = String(formData.get("project_id") ?? "").trim();
	const mediaTypeRaw = String(formData.get("media_type") ?? "").trim();
	const isPrivate = String(formData.get("private") ?? "") === "true";

	if (!experienceId) return { ok: false, error: "experienceId is required" };
	if (!filename) return { ok: false, error: "filename is required" };

	const sizeBytes = Number.parseInt(sizeBytesRaw, 10);
	if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
		return { ok: false, error: "size_bytes must be a non-negative integer" };
	}

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();

		let projectId: string;
		let projectIdSource: "request" | "default";
		let ownerId: string;
		if (requestedProjectId) {
			try {
				const membership = await assertProjectAccess(
					supabase,
					requestedProjectId,
					internalUserId,
					"editor",
				);
				projectId = membership.projectId;
				ownerId = membership.ownerId;
			} catch (e) {
				if (e instanceof ProjectAccessError) {
					return { ok: false, error: e.message };
				}
				throw e;
			}
			projectIdSource = "request";
		} else {
			projectId = await ensureUserDefaultProjectId(supabase, internalUserId);
			ownerId = internalUserId;
			projectIdSource = "default";
		}

		const { data: projectRow } = await supabase
			.from("projects")
			.select("quota_bytes")
			.eq("id", projectId)
			.maybeSingle();
		const quotaBytes = (projectRow?.quota_bytes as number | null) ?? null;

		try {
			await assertProjectQuota(supabase, {
				ownerId,
				projectId,
				quotaBytes,
				addBytes: sizeBytes,
			});
		} catch (e) {
			if (e instanceof ProjectQuotaError) {
				return { ok: false, error: e.message };
			}
			throw e;
		}

		const contentType = contentTypeRaw || "application/octet-stream";
		const mediaFolder = resolvePostMediaFolder(contentType, mediaTypeRaw || null);
		const bucket = isPrivate ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
		const fileId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${filename}`;
		const filePath = `${ownerId}/${projectId}/posts/${mediaFolder}/${fileId}`;

		const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(filePath);
		if (error || !data) {
			return { ok: false, error: error?.message ?? "Failed to create upload URL" };
		}

		let fileUrl = "";
		if (isPrivate) {
			const { data: signed } = await supabase.storage
				.from(bucket)
				.createSignedUrl(filePath, STORAGE_UPLOAD_URL_EXPIRY);
			fileUrl = signed?.signedUrl ?? "";
		} else {
			const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
			fileUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath
				.split("/")
				.map(encodeURIComponent)
				.join("/")}`;
		}

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: "user",
			action: "file.created",
			targetType: "file",
			targetId: filePath,
			after: {
				file_id: fileId,
				size_bytes: sizeBytes,
				content_type: contentType,
				media_type: mediaFolder,
				private: isPrivate,
			},
		});

		return {
			ok: true,
			upload_url: data.signedUrl,
			file_url: fileUrl,
			file_id: fileId,
			file_path: filePath.slice(ownerId.length + 1),
			project_id: projectId,
			project_id_source: projectIdSource,
			media_type: mediaFolder,
			content_type: contentType,
			size_bytes: sizeBytes,
			private: isPrivate,
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Unauthorized or failed" };
	}
}

export type StoragePathRefreshState = { ok: true } | { ok: false; error: string };

/**
 * Called by the client after a successful PUT to revalidate the Uploads page so
 * the new file appears without a hard reload.
 */
export async function revalidateUploadsAction(experienceId: string): Promise<StoragePathRefreshState> {
	if (!experienceId) return { ok: false, error: "experienceId required" };
	try {
		await requireExperienceActionUser(experienceId);
		revalidatePath(`/experiences/${experienceId}/uploads`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Failed" };
	}
}

// ---------------------------------------------------------------------------
// Upload-Post accounts: dashboard "Add account" form.
// Reuses the same `createUploadPostAccount` helper as the extension API so
// the limit/quota check, profile creation, JWT mint, and DB rollback all
// stay in lockstep.
// ---------------------------------------------------------------------------

export type CreateUploadPostAccountActionState =
	| { ok: true; account_id: string; name: string }
	| { ok: false; error: string };

export async function createUploadPostAccountAction(
	_prev: CreateUploadPostAccountActionState | null,
	formData: FormData,
): Promise<CreateUploadPostAccountActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const name = String(formData.get("name") ?? "");
	const apiKey = String(formData.get("api_key") ?? "");

	if (!experienceId) return { ok: false, error: "experienceId is required" };

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		const result = await createUploadPostAccount(supabase, internalUserId, {
			name,
			apiKey: apiKey.trim() ? apiKey : null,
		});
		if (!result.ok) {
			return { ok: false, error: result.error };
		}
		revalidatePath(`/experiences/${experienceId}/upload-post`);
		return { ok: true, account_id: result.account.id, name: result.account.name };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Failed" };
	}
}

export async function deletePostMediaAction(formData: FormData): Promise<void> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const filePath = String(formData.get("file_path") ?? "").trim();
	const isPrivate = String(formData.get("private") ?? "") === "true";

	if (!experienceId || !filePath) return;

	const { internalUserId } = await requireExperienceActionUser(experienceId);
	const supabase = getServiceSupabase();

	// First path segment of the relative file path is the project id; the
	// caller is allowed to delete iff they're an editor on that project. We
	// then build the full storage path under the project owner's prefix.
	const projectId = filePath.split("/")[0] ?? "";
	if (!projectId) return;

	let ownerId: string;
	try {
		const membership = await assertProjectAccess(supabase, projectId, internalUserId, "editor");
		ownerId = membership.ownerId;
	} catch {
		return;
	}

	const bucket = isPrivate ? POST_MEDIA_BUCKET_PRIVATE : POST_MEDIA_BUCKET_PUBLIC;
	const fullPath = `${ownerId}/${filePath}`;
	await supabase.storage.from(bucket).remove([fullPath]);

	await recordProjectAudit(supabase, {
		projectId,
		actorUserId: internalUserId,
		source: "user",
		action: "file.deleted",
		targetType: "file",
		targetId: fullPath,
		before: { file_path: filePath, private: isPrivate },
	});

	revalidatePath(`/experiences/${experienceId}/uploads`);
}

// ---------------------------------------------------------------------------
// Project sharing: members, invites, settings, audit. Mirrors the extension
// API routes under /api/extension/projects/[id]/* but called directly from
// dashboard pages without an extra HTTP hop.
// ---------------------------------------------------------------------------

const PROJECT_AUDIT_SOURCE: EditSource = "user";

function projectActionError(e: unknown): string {
	if (e instanceof ProjectAccessError || e instanceof ProjectQuotaError) return e.message;
	return e instanceof Error ? e.message : "Failed";
}

export type CreateProjectActionState =
	| { ok: true; project_id: string; name: string }
	| { ok: false; error: string };

export async function createProjectAction(
	_prev: CreateProjectActionState | null,
	formData: FormData,
): Promise<CreateProjectActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const name = String(formData.get("name") ?? "").trim();
	const description = String(formData.get("description") ?? "").trim();
	const quotaRaw = String(formData.get("quota_bytes") ?? "").trim();

	if (!experienceId) return { ok: false, error: "experienceId is required" };
	if (!name) return { ok: false, error: "Project name is required" };

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		const quotaBytes = quotaRaw ? normalizeQuotaInput(quotaRaw) : null;

		const { data: project, error } = await supabase
			.from("projects")
			.insert({
				user_id: internalUserId,
				owner_id: internalUserId,
				name,
				description: description || null,
				quota_bytes: quotaBytes,
				updated_at: new Date().toISOString(),
			})
			.select("id")
			.single();
		if (error || !project) {
			return { ok: false, error: error?.message ?? "Failed to create project" };
		}

		await recordProjectAudit(supabase, {
			projectId: project.id as string,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: "project.created",
			targetType: "project",
			targetId: project.id as string,
			after: { name, description: description || null, quota_bytes: quotaBytes },
		});

		revalidatePath(`/experiences/${experienceId}/uploads`);
		return { ok: true, project_id: project.id as string, name };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export type UpdateProjectActionState =
	| { ok: true }
	| { ok: false; error: string };

/**
 * Parses a `<input type="number">` field that's allowed to be blank
 * ("clear the cap") or a non-negative integer. Returns `undefined` when
 * the field wasn't submitted at all.
 */
function parseOptionalNonNegativeIntField(
	formData: FormData,
	field: string,
): number | null | undefined {
	const raw = formData.get(field);
	if (raw == null) return undefined;
	const trimmed = String(raw).trim();
	if (trimmed === "") return null;
	const n = Number(trimmed);
	if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
		throw new Error(`${field} must be a non-negative integer or blank`);
	}
	return n;
}

export async function updateProjectSettingsAction(
	_prev: UpdateProjectActionState | null,
	formData: FormData,
): Promise<UpdateProjectActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const name = formData.get("name") != null ? String(formData.get("name")).trim() : undefined;
	const description = formData.get("description") != null ? String(formData.get("description")).trim() : undefined;
	const quotaProvided = formData.get("quota_bytes") != null;
	const quotaRaw = quotaProvided ? String(formData.get("quota_bytes")) : "";
	let creditCap: number | null | undefined;
	try {
		creditCap = parseOptionalNonNegativeIntField(formData, "shotstack_monthly_credit_cap");
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Invalid credit cap" };
	}
	const creditCapProvided = creditCap !== undefined;

	if (!experienceId || !projectId) {
		return { ok: false, error: "experienceId and projectId are required" };
	}

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		const ownerOnly = quotaProvided || creditCapProvided;
		const required: ProjectRole = ownerOnly ? "owner" : "editor";
		await assertProjectAccess(supabase, projectId, internalUserId, required);

		const { data: existing } = await supabase
			.from("projects")
			.select("name, description, quota_bytes, shotstack_monthly_credit_cap")
			.eq("id", projectId)
			.maybeSingle();
		if (!existing) return { ok: false, error: "Project not found" };

		const updates: Record<string, unknown> = {};
		const after: Record<string, unknown> = {};
		if (name !== undefined) {
			if (!name) return { ok: false, error: "Name cannot be empty" };
			updates.name = name;
			after.name = name;
		}
		if (description !== undefined) {
			updates.description = description || null;
			after.description = description || null;
		}
		if (quotaProvided) {
			updates.quota_bytes = quotaRaw.trim() === "" ? null : normalizeQuotaInput(quotaRaw);
			after.quota_bytes = updates.quota_bytes;
		}
		if (creditCapProvided) {
			updates.shotstack_monthly_credit_cap = creditCap;
			after.shotstack_monthly_credit_cap = creditCap;
		}

		if (Object.keys(updates).length === 0) return { ok: true };

		updates.updated_at = new Date().toISOString();
		const { error } = await supabase.from("projects").update(updates).eq("id", projectId);
		if (error) return { ok: false, error: error.message };

		// Pick the most specific audit action so the activity feed is
		// readable. Quota changes get their own row; otherwise credit-cap
		// updates win, falling back to the generic project.updated.
		const auditAction = quotaProvided
			? "project.quota_changed"
			: creditCapProvided
				? "project.credit_cap_changed"
				: "project.updated";

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: auditAction,
			targetType: "project",
			targetId: projectId,
			before: existing,
			after,
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		revalidatePath(`/experiences/${experienceId}/uploads`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export type UpdateMemberCreditOverrideState =
	| { ok: true; user_id: string; cap: number | null }
	| { ok: false; error: string };

/**
 * Owner-only: set or clear the per-member ShotStack monthly credit cap.
 * Blank `monthly_credit_cap` deletes the override (member falls back to the
 * project-level cap, or unbounded if no project cap is set).
 */
export async function updateProjectMemberCreditOverrideAction(
	_prev: UpdateMemberCreditOverrideState | null,
	formData: FormData,
): Promise<UpdateMemberCreditOverrideState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const userId = String(formData.get("userId") ?? "");
	let cap: number | null | undefined;
	try {
		cap = parseOptionalNonNegativeIntField(formData, "monthly_credit_cap");
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "Invalid cap" };
	}

	if (!experienceId || !projectId || !userId) {
		return { ok: false, error: "Missing project, member, or experience id" };
	}
	if (cap === undefined) {
		return { ok: false, error: "monthly_credit_cap is required" };
	}

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "owner");

		// Sanity: the member we're capping must actually be on the project.
		// Avoids creating dangling override rows for users who left.
		const { data: membership } = await supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", userId)
			.maybeSingle();
		if (!membership) {
			return { ok: false, error: "User is not a member of this project" };
		}

		if (cap == null) {
			const { error } = await supabase
				.from("project_member_credit_overrides")
				.delete()
				.eq("project_id", projectId)
				.eq("user_id", userId);
			if (error) return { ok: false, error: error.message };
		} else {
			const now = new Date().toISOString();
			const { error } = await supabase
				.from("project_member_credit_overrides")
				.upsert(
					{
						project_id: projectId,
						user_id: userId,
						monthly_credit_cap: cap,
						updated_at: now,
					},
					{ onConflict: "project_id,user_id" },
				);
			if (error) return { ok: false, error: error.message };
		}

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: cap == null ? "project.member_credit_override_cleared" : "project.member_credit_override_set",
			targetType: "project_member",
			targetId: userId,
			after: { user_id: userId, monthly_credit_cap: cap },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true, user_id: userId, cap };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export type AddProjectMemberActionState =
	| { ok: true; user_id: string; role: ProjectRole }
	| { ok: false; error: string };

export async function addProjectMemberAction(
	_prev: AddProjectMemberActionState | null,
	formData: FormData,
): Promise<AddProjectMemberActionState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const identifier = String(formData.get("identifier") ?? "").trim();
	const roleRaw = String(formData.get("role") ?? "viewer");
	const role: ProjectRole = roleRaw === "editor" ? "editor" : "viewer";

	if (!experienceId || !projectId) return { ok: false, error: "Missing project context" };
	if (!identifier) return { ok: false, error: "Enter a username, email, or Whop user id" };

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "owner");

		const resolved = await resolveUserIdentifier(supabase, identifier);
		if (!resolved.ok) return { ok: false, error: resolved.error };
		if (resolved.userId === internalUserId) {
			return { ok: false, error: "You're already the owner of this project." };
		}

		const { data: existing } = await supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", resolved.userId)
			.maybeSingle();
		if (existing?.role === "owner") {
			return { ok: false, error: "User is the project owner." };
		}

		const { error } = await supabase
			.from("project_members")
			.upsert(
				{
					project_id: projectId,
					user_id: resolved.userId,
					role,
					invited_by: internalUserId,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "project_id,user_id" },
			);
		if (error) return { ok: false, error: error.message };

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: existing ? "member.role_changed" : "member.added",
			targetType: "user",
			targetId: resolved.userId,
			before: existing ? { role: existing.role } : null,
			after: { role },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true, user_id: resolved.userId, role };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export async function changeProjectMemberRoleAction(formData: FormData): Promise<void> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const targetUserId = String(formData.get("userId") ?? "");
	const roleRaw = String(formData.get("role") ?? "viewer");
	const role: ProjectRole = roleRaw === "owner" ? "owner" : roleRaw === "editor" ? "editor" : "viewer";

	if (!experienceId || !projectId || !targetUserId) return;

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "owner");

		const { data: existing } = await supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", targetUserId)
			.maybeSingle();
		if (!existing) return;
		if (existing.role === "owner" && role !== "owner" && (await isLastOwner(supabase, projectId, targetUserId))) {
			return;
		}

		await supabase
			.from("project_members")
			.update({ role, updated_at: new Date().toISOString() })
			.eq("project_id", projectId)
			.eq("user_id", targetUserId);

		if (role === "owner") {
			await supabase
				.from("projects")
				.update({ owner_id: targetUserId, updated_at: new Date().toISOString() })
				.eq("id", projectId);
		}

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: "member.role_changed",
			targetType: "user",
			targetId: targetUserId,
			before: { role: existing.role },
			after: { role },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
	} catch {
		// Silent failure for form actions; user can retry.
	}
}

export async function removeProjectMemberAction(formData: FormData): Promise<void> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const targetUserId = String(formData.get("userId") ?? "");
	if (!experienceId || !projectId || !targetUserId) return;

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();

		const required: ProjectRole = targetUserId === internalUserId ? "viewer" : "owner";
		await assertProjectAccess(supabase, projectId, internalUserId, required);

		const { data: existing } = await supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", targetUserId)
			.maybeSingle();
		if (!existing) return;
		if (existing.role === "owner" && (await isLastOwner(supabase, projectId, targetUserId))) {
			return;
		}

		await supabase
			.from("project_members")
			.delete()
			.eq("project_id", projectId)
			.eq("user_id", targetUserId);

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: targetUserId === internalUserId ? "member.left" : "member.removed",
			targetType: "user",
			targetId: targetUserId,
			before: { role: existing.role },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
	} catch {
		// noop
	}
}

export type CreateProjectInviteState =
	| { ok: true; token: string; role: ProjectRole; expires_at: string | null }
	| { ok: false; error: string };

export async function createProjectInviteAction(
	_prev: CreateProjectInviteState | null,
	formData: FormData,
): Promise<CreateProjectInviteState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const roleRaw = String(formData.get("role") ?? "viewer");
	const role: ProjectRole = roleRaw === "editor" ? "editor" : "viewer";
	const expiresInHoursRaw = String(formData.get("expires_in_hours") ?? "").trim();

	if (!experienceId || !projectId) return { ok: false, error: "Missing project context" };

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "owner");

		const expiresInHours = expiresInHoursRaw ? Math.min(Math.max(Number(expiresInHoursRaw), 1), 24 * 30) : null;
		const expiresAt = expiresInHours
			? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString()
			: null;
		const token = generateInviteToken();

		const { data, error } = await supabase
			.from("project_invites")
			.insert({
				project_id: projectId,
				role,
				token,
				created_by: internalUserId,
				expires_at: expiresAt,
			})
			.select("id, token, role, expires_at")
			.single();
		if (error || !data) return { ok: false, error: error?.message ?? "Failed to create invite" };

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: "invite.created",
			targetType: "invite",
			targetId: data.id as string,
			after: { role, expires_at: expiresAt },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true, token: data.token as string, role, expires_at: data.expires_at as string | null };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export async function revokeProjectInviteAction(formData: FormData): Promise<void> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const inviteId = String(formData.get("inviteId") ?? "");
	if (!experienceId || !projectId || !inviteId) return;

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "owner");

		const { data: existing } = await supabase
			.from("project_invites")
			.select("role")
			.eq("id", inviteId)
			.eq("project_id", projectId)
			.maybeSingle();
		if (!existing) return;

		await supabase
			.from("project_invites")
			.update({ revoked_at: new Date().toISOString() })
			.eq("id", inviteId);

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: "invite.revoked",
			targetType: "invite",
			targetId: inviteId,
			before: { role: existing.role },
		});

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
	} catch {
		// noop
	}
}

export type AcceptProjectInviteState =
	| { ok: true; project_id: string; role: ProjectRole }
	| { ok: false; error: string };

export async function acceptProjectInviteAction(
	_prev: AcceptProjectInviteState | null,
	formData: FormData,
): Promise<AcceptProjectInviteState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const token = String(formData.get("token") ?? "").trim();
	if (!experienceId || !token) return { ok: false, error: "Missing experience or token" };

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();

		const { data: invite } = await supabase
			.from("project_invites")
			.select("id, project_id, role, expires_at, used_at, revoked_at")
			.eq("token", token)
			.maybeSingle();
		if (!invite) return { ok: false, error: "Invite not found" };
		if (invite.revoked_at) return { ok: false, error: "Invite has been revoked" };
		if (invite.used_at) return { ok: false, error: "Invite has already been used" };
		if (invite.expires_at && new Date(invite.expires_at as string).getTime() < Date.now()) {
			return { ok: false, error: "Invite has expired" };
		}

		const projectId = invite.project_id as string;
		const targetRole = invite.role as ProjectRole;

		const { data: existing } = await supabase
			.from("project_members")
			.select("role")
			.eq("project_id", projectId)
			.eq("user_id", internalUserId)
			.maybeSingle();

		if (!existing) {
			const { error } = await supabase.from("project_members").insert({
				project_id: projectId,
				user_id: internalUserId,
				role: targetRole,
				updated_at: new Date().toISOString(),
			});
			if (error) return { ok: false, error: error.message };
		}

		await supabase
			.from("project_invites")
			.update({ used_at: new Date().toISOString(), used_by: internalUserId })
			.eq("id", invite.id);

		await recordProjectAudit(supabase, {
			projectId,
			actorUserId: internalUserId,
			source: PROJECT_AUDIT_SOURCE,
			action: existing ? "invite.accepted_existing_member" : "invite.accepted",
			targetType: "user",
			targetId: internalUserId,
			after: { role: existing?.role ?? targetRole },
		});

		revalidatePath(`/experiences/${experienceId}/uploads`);
		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true, project_id: projectId, role: (existing?.role as ProjectRole) ?? targetRole };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline: Source Videos
// ──────────────────────────────────────────────────────────────────────────

export type AddSourceVideoState =
	| { ok: true; id: string }
	| { ok: false; error: string }
	| null;

export async function addSourceVideoAction(
	_prev: AddSourceVideoState,
	formData: FormData,
): Promise<AddSourceVideoState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const url = String(formData.get("url") ?? "").trim();
	const filename = String(formData.get("filename") ?? "").trim() || "Untitled";

	if (!experienceId || !projectId || !url) {
		return { ok: false, error: "Missing required fields" };
	}

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "editor");

		const isGhl = url.includes("highlevel") || url.includes("leadconnector");

		const { data, error } = await supabase
			.from("project_source_videos")
			.insert({
				project_id: projectId,
				ghl_media_url: isGhl ? url : null,
				storage_path: isGhl ? null : url,
				original_filename: filename,
			})
			.select("id")
			.single();

		if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true, id: data.id as string };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}

export async function removeSourceVideoAction(formData: FormData): Promise<void> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");
	const videoId = String(formData.get("videoId") ?? "");
	if (!experienceId || !projectId || !videoId) return;

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "editor");

		await supabase
			.from("project_source_videos")
			.delete()
			.eq("id", videoId)
			.eq("project_id", projectId);

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
	} catch {
		// noop
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline: Config
// ──────────────────────────────────────────────────────────────────────────

export type UpdatePipelineConfigState =
	| { ok: true }
	| { ok: false; error: string }
	| null;

export async function updatePipelineConfigAction(
	_prev: UpdatePipelineConfigState,
	formData: FormData,
): Promise<UpdatePipelineConfigState> {
	const experienceId = String(formData.get("experienceId") ?? "");
	const projectId = String(formData.get("projectId") ?? "");

	if (!experienceId || !projectId) {
		return { ok: false, error: "Missing required fields" };
	}

	try {
		const { internalUserId } = await requireExperienceActionUser(experienceId);
		const supabase = getServiceSupabase();
		await assertProjectAccess(supabase, projectId, internalUserId, "editor");

		const clipsPerDay = Math.max(0, Math.min(100, Number(formData.get("clips_per_day")) || 0));
		const postingTarget = String(formData.get("posting_target") ?? "none");
		const autoRun = formData.get("auto_run") === "on";

		const validTargets = ["highlevel", "uploadpost", "none"];
		if (!validTargets.includes(postingTarget)) {
			return { ok: false, error: "Invalid posting target" };
		}

		const templateIdsRaw = String(formData.get("template_ids") ?? "").trim();
		const templateIds = templateIdsRaw
			? templateIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
			: [];

		const { error } = await supabase
			.from("projects")
			.update({
				pipeline_clips_per_day: clipsPerDay,
				pipeline_default_template_ids: templateIds,
				pipeline_posting_target: postingTarget,
				pipeline_auto_run: autoRun,
				updated_at: new Date().toISOString(),
			})
			.eq("id", projectId);

		if (error) return { ok: false, error: error.message };

		revalidatePath(`/experiences/${experienceId}/projects/${projectId}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: projectActionError(e) };
	}
}
