/**
 * openreel-export-bridge.ts — Wraps OpenReel's ExportEngine output to upload
 * the rendered video/audio via our presigned upload pipeline to Supabase
 * Storage, then optionally post to HighLevel or UploadPost.
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

/**
 * Upload a blob via presigned URL, then confirm. Returns the public URL.
 */
async function uploadViaPresigned(
	blob: Blob,
	filename: string,
	contentType: string,
	templateId: string,
	context: MediaEditorContext,
	onProgress: ProgressCallback,
): Promise<{ fileUrl: string; storageType: string; fallbackMessage?: string }> {
	if (!context.presignedUploadUrl || !context.confirmUploadUrl) {
		throw new Error("Presigned upload endpoints not configured");
	}

	const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";

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

	const presignJson = (await presignRes.json().catch(() => ({}))) as {
		upload_url?: string;
		file_url?: string;
		file_path?: string;
		render_id?: string;
		error?: string;
	};

	if (!presignRes.ok || !presignJson.upload_url) {
		throw new Error(presignJson.error || `Presign failed (${presignRes.status})`);
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

/**
 * Run the OpenReel ExportEngine and upload the result via presigned URL.
 * Designed to be called from the editor toolbar's export handler.
 */
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

	const result = await uploadViaPresigned(
		exportBlob,
		filename,
		contentType,
		templateId,
		context,
		onProgress,
	);

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
