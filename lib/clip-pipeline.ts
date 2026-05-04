/**
 * clip-pipeline.ts — Client-side clip pipeline step definitions.
 *
 * Each step is a pure function: takes input URLs, produces output URLs.
 * No blobs are held across steps. The runner calls these sequentially.
 */

import { detectSegments, type SttWord } from "./clip-segment-detection";

export type ClipStatus = "pending" | "stt" | "trimming" | "rendering" | "posting" | "done" | "failed";

export interface ClipQueueItem {
	id: string;
	project_id: string;
	source_video_id: string;
	segment_start_sec: number;
	segment_end_sec: number;
	template_id: string | null;
	status: ClipStatus;
	step_data: Record<string, unknown>;
	output_url: string | null;
	error: string | null;
	source_video?: {
		id: string;
		original_filename: string;
		storage_path: string | null;
		ghl_media_url: string | null;
		duration_sec: number | null;
		stt_status: string;
		stt_result: unknown;
	};
}

export interface PipelineConfig {
	pipeline_clips_per_day: number;
	pipeline_default_template_ids: string[];
	pipeline_posting_target: string;
	pipeline_auto_run: boolean;
}

export interface PipelineCallbacks {
	onLog: (msg: string) => void;
	onStatusChange: (clipId: string, status: ClipStatus) => void;
	apiBase: string;
	experienceId: string;
	projectId: string;
}

async function pipelineApiFetch(
	cb: PipelineCallbacks,
	method: "GET" | "POST",
	params?: Record<string, unknown>,
): Promise<unknown> {
	const url = method === "GET"
		? `${cb.apiBase}?${new URLSearchParams(params as Record<string, string>).toString()}`
		: cb.apiBase;

	const res = await fetch(url, {
		method,
		credentials: "same-origin",
		...(method === "POST"
			? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }
			: {}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Pipeline API ${res.status}: ${text}`);
	}
	return res.json();
}

export async function fetchNextClip(cb: PipelineCallbacks): Promise<ClipQueueItem | null> {
	const result = await pipelineApiFetch(cb, "GET", {
		experienceId: cb.experienceId,
		projectId: cb.projectId,
		action: "next",
	}) as { clip: ClipQueueItem | null };
	return result.clip;
}

export async function fetchQueueStatus(cb: PipelineCallbacks): Promise<ClipQueueItem[]> {
	const result = await pipelineApiFetch(cb, "GET", {
		experienceId: cb.experienceId,
		projectId: cb.projectId,
		action: "queue",
	}) as { clips: ClipQueueItem[] };
	return result.clips ?? [];
}

export async function updateClipStatus(
	cb: PipelineCallbacks,
	clipId: string,
	status: ClipStatus,
	extra?: { stepData?: Record<string, unknown>; error?: string; outputUrl?: string },
): Promise<void> {
	cb.onStatusChange(clipId, status);
	await pipelineApiFetch(cb, "POST", {
		experienceId: cb.experienceId,
		projectId: cb.projectId,
		action: "update-clip",
		clipId,
		status,
		...extra,
	});
}

export async function updateSourceVideoStt(
	cb: PipelineCallbacks,
	sourceVideoId: string,
	status: string,
	sttResult?: unknown,
): Promise<void> {
	await pipelineApiFetch(cb, "POST", {
		experienceId: cb.experienceId,
		projectId: cb.projectId,
		action: "update-stt",
		clipId: sourceVideoId,
		status,
		stepData: sttResult as Record<string, unknown> | undefined,
	});
}

/**
 * Resolve the playable URL for a source video (prefers storage_path, falls back to ghl_media_url).
 */
export function resolveSourceVideoUrl(sv: ClipQueueItem["source_video"]): string | null {
	if (!sv) return null;
	return sv.storage_path || sv.ghl_media_url || null;
}

/**
 * Run STT on a source video. Returns word-level transcript.
 * Uses the existing window.__CFS_sttGenerate from the loaded scripts.
 */
export async function runSttOnVideo(
	videoUrl: string,
	cb: PipelineCallbacks,
): Promise<{ text: string; words?: Array<{ word: string; start: number; end: number }> }> {
	cb.onLog("Extracting audio from video for STT…");

	const w = window as unknown as {
		FFmpegLocal?: { extractSegment: (blob: Blob, start: number, dur: number, opts: Record<string, unknown>) => Promise<{ blob: Blob }> };
		__CFS_sttGenerate?: (blob: Blob, opts?: Record<string, unknown>) => Promise<{ text: string; words?: Array<{ word: string; start: number; end: number }> }>;
	};

	if (!w.__CFS_sttGenerate) {
		throw new Error("STT not loaded — ensure cfs-web-ai scripts are loaded");
	}

	const response = await fetch(videoUrl);
	if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
	const videoBlob = await response.blob();

	let audioBlob: Blob;
	if (w.FFmpegLocal?.extractSegment) {
		cb.onLog("Extracting audio track with FFmpeg…");
		const result = await w.FFmpegLocal.extractSegment(videoBlob, 0, 0, { mode: "audio" });
		audioBlob = result.blob;
	} else {
		audioBlob = videoBlob;
	}

	cb.onLog("Running Whisper STT…");
	const sttResult = await w.__CFS_sttGenerate(audioBlob, { word_timestamps: true });
	cb.onLog(`STT complete: "${sttResult.text.slice(0, 100)}…"`);

	return sttResult;
}

/**
 * Trim a video segment using FFmpeg WASM.
 * Returns a Blob of the trimmed segment.
 */
export async function trimVideoSegment(
	videoUrl: string,
	startSec: number,
	endSec: number,
	cb: PipelineCallbacks,
): Promise<Blob> {
	cb.onLog(`Trimming video: ${startSec.toFixed(1)}s → ${endSec.toFixed(1)}s`);

	const w = window as unknown as {
		FFmpegLocal?: { extractSegment: (blob: Blob, start: number, dur: number, opts: Record<string, unknown>) => Promise<{ blob: Blob }> };
	};

	if (!w.FFmpegLocal?.extractSegment) {
		throw new Error("FFmpeg WASM not loaded");
	}

	const response = await fetch(videoUrl);
	if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
	const videoBlob = await response.blob();

	const duration = endSec - startSec;
	const result = await w.FFmpegLocal.extractSegment(videoBlob, startSec, duration, {
		mode: "video",
		includeAudio: true,
		onProgress: (msg: string) => cb.onLog(msg),
	});

	cb.onLog(`Trim complete: ${(result.blob.size / 1024 / 1024).toFixed(1)} MB`);
	return result.blob;
}

/**
 * Fetch source videos that need STT processing.
 */
export async function fetchSourcesNeedingStt(
	cb: PipelineCallbacks,
): Promise<Array<{ id: string; original_filename: string; storage_path: string | null; ghl_media_url: string | null; duration_sec: number | null; stt_status: string }>> {
	const result = await pipelineApiFetch(cb, "GET", {
		experienceId: cb.experienceId,
		projectId: cb.projectId,
		action: "sources-needing-stt",
	}) as { sources: Array<{ id: string; original_filename: string; storage_path: string | null; ghl_media_url: string | null; duration_sec: number | null; stt_status: string }> };
	return result.sources ?? [];
}

/**
 * Process a source video through STT and generate clip queue entries.
 */
export async function processSourceVideoStt(
	source: { id: string; storage_path: string | null; ghl_media_url: string | null; original_filename: string },
	templateId: string | null,
	cb: PipelineCallbacks,
): Promise<number> {
	const videoUrl = source.storage_path || source.ghl_media_url;
	if (!videoUrl) {
		cb.onLog(`Source "${source.original_filename}" has no URL — skipping`);
		return 0;
	}

	await updateSourceVideoStt(cb, source.id, "processing");
	cb.onLog(`Running STT on "${source.original_filename}"…`);

	try {
		const sttResult = await runSttOnVideo(videoUrl, cb);

		await updateSourceVideoStt(cb, source.id, "done", {
			text: sttResult.text,
			words: sttResult.words,
		});

		if (!sttResult.words?.length) {
			cb.onLog("STT produced no word timestamps — cannot detect segments");
			return 0;
		}

		cb.onLog("Detecting clip-worthy segments…");
		const normalizedWords = (sttResult.words as Array<{ word?: string; text?: string; start: number; end: number }>).map(
			(w) => ({ text: w.text || w.word || "", start: w.start, end: w.end }),
		);
		const segments = detectSegments(normalizedWords as SttWord[]);
		cb.onLog(`Found ${segments.length} candidate segments`);

		if (segments.length > 0) {
			await pipelineApiFetch(cb, "POST", {
				experienceId: cb.experienceId,
				projectId: cb.projectId,
				action: "generate-clips",
				clipId: source.id,
				stepData: { segments, template_id: templateId },
			});
			cb.onLog(`Queued ${segments.length} clips from "${source.original_filename}"`);
		}

		return segments.length;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		cb.onLog(`STT failed for "${source.original_filename}": ${msg}`);
		await updateSourceVideoStt(cb, source.id, "failed").catch(() => {});
		return 0;
	}
}

/**
 * Upload a blob to Supabase Storage via presigned URL.
 * Returns the public URL.
 */
export async function uploadToStorage(
	blob: Blob,
	filename: string,
	presignedUploadUrl: string,
	fields: Record<string, string>,
): Promise<string> {
	const presignRes = await fetch(presignedUploadUrl, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...fields,
			filename,
			content_type: blob.type || "video/mp4",
			size_bytes: blob.size,
			template_id: "pipeline",
		}),
	});
	if (!presignRes.ok) {
		throw new Error(`Presigned upload failed: ${presignRes.status}`);
	}
	const presignData = await presignRes.json() as { upload_url: string; file_url: string; upload_token: string };

	const uploadRes = await fetch(presignData.upload_url, {
		method: "PUT",
		headers: { "Content-Type": blob.type || "video/mp4" },
		body: blob,
	});
	if (!uploadRes.ok) {
		throw new Error(`Upload PUT failed: ${uploadRes.status}`);
	}

	return presignData.file_url;
}
