/**
 * openreel-export-bridge.ts — Uploads rendered video/audio to HighLevel
 * (direct client upload) or Supabase Storage (presigned fallback).
 *
 * When a GHL location context is available the client uploads the blob
 * straight to HighLevel's medias API using a short-lived OAuth token
 * provided by our resolve-upload-target endpoint. This avoids the Vercel
 * body-size limit and ensures HighLevel hosts the file natively.
 *
 * When GHL is unavailable the previous two-step presigned flow is used:
 *   1. PUT blob to Supabase via signed URL
 *   2. POST confirm-upload to register the render row
 */

import type { MediaEditorContext } from "@/app/experiences/[experienceId]/media/media-editor-context";

export interface ExportProgress {
	phase: string;
	progress: number;
	complete: boolean;
	error: string | null;
	fileUrl?: string;
	storageType?: string;
}

type ProgressCallback = (state: ExportProgress) => void;

// ── GHL direct upload ────────────────────────────────────────────────────────

interface ResolveGhlResult {
	target: "ghl";
	upload_url: string;
	token: string;
	location_id: string;
	company_id: string | null;
	api_version: string;
}

interface ResolveSupabaseResult {
	target: "supabase";
	upload_url: string;
	file_url: string;
	file_path: string;
	render_id: string;
	[key: string]: unknown;
}

type ResolveResult = ResolveGhlResult | ResolveSupabaseResult;

async function uploadDirectToGhl(
	blob: Blob,
	filename: string,
	resolved: ResolveGhlResult,
	templateId: string,
	context: MediaEditorContext,
	onProgress: ProgressCallback,
): Promise<{ fileUrl: string; storageType: string; fallbackMessage?: string }> {
	const mb = (blob.size / 1e6).toFixed(1);
	onProgress({ phase: `Uploading ${filename} to HighLevel (${mb} MB)...`, progress: 92, complete: false, error: null });

	const form = new FormData();
	form.append("hosted", "false");
	form.append("file", blob, filename);
	form.append("name", filename);

	const res = await fetch(resolved.upload_url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			Version: resolved.api_version,
			Authorization: `Bearer ${resolved.token}`,
		},
		body: form,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`GHL media upload failed (${res.status}): ${text || res.statusText}`);
	}

	const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	const mediaId =
		(typeof json.fileId === "string" && json.fileId) ||
		(typeof json._id === "string" && json._id) ||
		(typeof json.id === "string" && json.id) ||
		"";
	const ghlUrl =
		(typeof json.url === "string" && json.url) ||
		(typeof json.fileUrl === "string" && json.fileUrl) ||
		"";

	if (!ghlUrl) {
		throw new Error("GHL upload succeeded but response did not include a URL");
	}

	onProgress({ phase: "Registering render...", progress: 98, complete: false, error: null });

	const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";
	const confirmRes = await fetch(`${context.confirmUploadUrl}${qs}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			file_url: ghlUrl,
			file_path: "",
			render_id: crypto.randomUUID(),
			template_id: templateId,
			content_type: blob.type || "video/mp4",
			size_bytes: blob.size,
			source: "openreel",
			ghl_direct: true,
			ghl_url: ghlUrl,
			ghl_media_id: mediaId,
			ghl_location_id: resolved.location_id,
			ghl_company_id: resolved.company_id,
			...context.browserRenderFields,
		}),
	});

	if (!confirmRes.ok) {
		const confirmJson = (await confirmRes.json().catch(() => ({}))) as { error?: string };
		console.warn("[export-bridge] confirm after GHL upload failed:", confirmJson.error);
	}

	return { fileUrl: ghlUrl, storageType: "ghl" };
}

// ── Supabase presigned upload (fallback) ─────────────────────────────────────

async function uploadViaPresigned(
	blob: Blob,
	filename: string,
	contentType: string,
	templateId: string,
	context: MediaEditorContext,
	onProgress: ProgressCallback,
	preResolved?: ResolveSupabaseResult,
): Promise<{ fileUrl: string; storageType: string; fallbackMessage?: string }> {
	if (!context.presignedUploadUrl || !context.confirmUploadUrl) {
		throw new Error("Presigned upload endpoints not configured");
	}

	const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";

	let presignJson: ResolveSupabaseResult;

	if (preResolved) {
		presignJson = preResolved;
	} else {
		onProgress({ phase: "Preparing upload...", progress: 90, complete: false, error: null });

		const presignRes = await fetch(`${context.presignedUploadUrl}${qs}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				filename,
				content_type: contentType,
				size_bytes: blob.size,
				template_id: templateId,
				...context.browserRenderFields,
			}),
		});

		presignJson = (await presignRes.json().catch(() => ({}))) as ResolveSupabaseResult;

		if (!presignRes.ok || !presignJson.upload_url) {
			throw new Error((presignJson as Record<string, unknown>).error as string || `Presign failed (${presignRes.status})`);
		}
	}

	const mb = (blob.size / 1e6).toFixed(1);
	onProgress({ phase: `Uploading ${filename} (${mb} MB)...`, progress: 92, complete: false, error: null });

	const putRes = await fetch(presignJson.upload_url, {
		method: "PUT",
		headers: { "Content-Type": contentType },
		body: blob,
	});

	if (!putRes.ok) {
		throw new Error(`Direct upload failed (${putRes.status})`);
	}

	onProgress({ phase: "Finalizing...", progress: 98, complete: false, error: null });

	const confirmRes = await fetch(`${context.confirmUploadUrl}${qs}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "include",
		body: JSON.stringify({
			file_url: presignJson.file_url,
			file_path: presignJson.file_path,
			render_id: presignJson.render_id,
			template_id: templateId,
			content_type: contentType,
			size_bytes: blob.size,
			source: "openreel",
			...context.browserRenderFields,
		}),
	});

	const confirmJson = (await confirmRes.json().catch(() => ({}))) as {
		file_url?: string;
		storage_type?: string;
		fallback_message?: string;
		error?: string;
	};

	if (!confirmRes.ok) {
		throw new Error(confirmJson.error || `Confirm failed (${confirmRes.status})`);
	}

	return {
		fileUrl: confirmJson.file_url || presignJson.file_url || "",
		storageType: confirmJson.storage_type || "supabase",
		fallbackMessage: confirmJson.fallback_message || undefined,
	};
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function exportAndUpload(opts: {
	exportBlob: Blob;
	format: string;
	templateId: string;
	context: MediaEditorContext;
	onProgress: ProgressCallback;
}): Promise<void> {
	const { exportBlob, format, templateId, context, onProgress } = opts;

	const ext = format === "mov" ? "mov" : format === "webm" ? "webm" : "mp4";
	const contentType = exportBlob.type || `video/${ext}`;
	const filename = `render.${ext}`;

	let result: { fileUrl: string; storageType: string; fallbackMessage?: string };

	if (context.resolveUploadTargetUrl) {
		onProgress({ phase: "Resolving upload destination...", progress: 88, complete: false, error: null });

		const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";

		try {
			const resolveRes = await fetch(`${context.resolveUploadTargetUrl}${qs}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					filename,
					content_type: contentType,
					size_bytes: exportBlob.size,
					template_id: templateId,
					...context.browserRenderFields,
				}),
			});

			const resolved = (await resolveRes.json().catch(() => ({}))) as ResolveResult;

			if (resolveRes.ok && resolved.target === "ghl") {
				try {
					result = await uploadDirectToGhl(
						exportBlob, filename, resolved as ResolveGhlResult,
						templateId, context, onProgress,
					);
				} catch (ghlErr) {
					console.warn("[export-bridge] GHL direct upload failed, falling back to Supabase:", ghlErr);
					result = await uploadViaPresigned(exportBlob, filename, contentType, templateId, context, onProgress);
				}
			} else if (resolveRes.ok && resolved.target === "supabase") {
				result = await uploadViaPresigned(
					exportBlob, filename, contentType, templateId, context, onProgress,
					resolved as ResolveSupabaseResult,
				);
			} else {
				result = await uploadViaPresigned(exportBlob, filename, contentType, templateId, context, onProgress);
			}
		} catch (resolveErr) {
			console.warn("[export-bridge] resolve-upload-target failed, falling back to presigned:", resolveErr);
			result = await uploadViaPresigned(exportBlob, filename, contentType, templateId, context, onProgress);
		}
	} else {
		result = await uploadViaPresigned(exportBlob, filename, contentType, templateId, context, onProgress);
	}

	const dest = result.storageType === "ghl"
		? "Uploaded to HighLevel Media Library."
		: "Uploaded to storage.";

	onProgress({
		phase: `${dest}${result.fallbackMessage ? ` ${result.fallbackMessage}` : ""}`,
		progress: 100,
		complete: true,
		error: null,
		fileUrl: result.fileUrl,
		storageType: result.storageType,
	});
}

// ── Lightweight blob upload (for TTS audio, etc.) ────────────────────────────

/**
 * Upload a media blob (audio, image, etc.) and return its public URL.
 * Uses the same GHL-direct / Supabase-presigned infrastructure as video
 * export but without progress UI or render-row creation.
 */
export async function uploadMediaBlob(opts: {
	blob: Blob;
	filename: string;
	contentType: string;
	templateId: string;
	context: MediaEditorContext;
}): Promise<string> {
	const { blob, filename, contentType, templateId, context } = opts;
	const noop: ProgressCallback = () => {};

	if (context.resolveUploadTargetUrl) {
		const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";
		try {
			const resolveRes = await fetch(`${context.resolveUploadTargetUrl}${qs}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					filename,
					content_type: contentType,
					size_bytes: blob.size,
					template_id: templateId,
					...context.browserRenderFields,
				}),
			});
			const resolved = (await resolveRes.json().catch(() => ({}))) as ResolveResult;

			if (resolveRes.ok && resolved.target === "ghl") {
				try {
					const r = await uploadDirectToGhl(
						blob, filename, resolved as ResolveGhlResult,
						templateId, context, noop,
					);
					return r.fileUrl;
				} catch {
					// fall through to Supabase
				}
			}
			if (resolveRes.ok && resolved.target === "supabase") {
				const r = await uploadViaPresigned(
					blob, filename, contentType, templateId, context, noop,
					resolved as ResolveSupabaseResult,
				);
				return r.fileUrl;
			}
		} catch {
			// fall through
		}
	}

	if (context.presignedUploadUrl) {
		const r = await uploadViaPresigned(blob, filename, contentType, templateId, context, noop);
		return r.fileUrl;
	}

	throw new Error("No upload endpoint configured");
}
