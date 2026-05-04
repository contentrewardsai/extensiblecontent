/**
 * openreel-service-bridge.ts — Connects our existing TTS (Kokoro), STT (Whisper),
 * presigned upload, and video preprocessing services to the OpenReel editor.
 *
 * Each function can be called from OpenReel UI components or store actions to
 * perform operations that the vanilla OpenReel editor doesn't natively support.
 */

import type { MediaEditorContext } from "@/app/experiences/[experienceId]/media/media-editor-context";

// ─── TTS (Kokoro) ────────────────────────────────────────────────────────────

declare global {
	interface Window {
		__CFS_ttsGenerate?: (text: string, options?: { voiceId?: string }) => Promise<{ blob: Blob; duration: number }>;
		__CFS_sttGenerate?: (audioBlob: Blob) => Promise<{ words: Array<{ text: string; start: number; end: number }> }>;
		FFmpegLocal?: {
			extractSegment: (inputUrl: string, startSec: number, endSec: number) => Promise<Blob>;
			convertToMp4: (inputBlob: Blob) => Promise<Blob>;
			convertToMp4WithAudio: (videoBlob: Blob, audioBlob: Blob) => Promise<Blob>;
		};
	}
}

export async function generateTTS(
	text: string,
	options?: { voiceId?: string },
): Promise<{ blob: Blob; duration: number }> {
	if (!window.__CFS_ttsGenerate) {
		throw new Error("TTS engine not loaded. Ensure Kokoro scripts are loaded.");
	}
	return window.__CFS_ttsGenerate(text, options);
}

// ─── STT (Whisper) ───────────────────────────────────────────────────────────

export async function generateSTT(
	audioBlob: Blob,
): Promise<{ words: Array<{ text: string; start: number; end: number }> }> {
	if (!window.__CFS_sttGenerate) {
		throw new Error("STT engine not loaded. Ensure Whisper scripts are loaded.");
	}
	return window.__CFS_sttGenerate(audioBlob);
}

// ─── Presigned Upload ────────────────────────────────────────────────────────

export async function presignedUpload(
	context: MediaEditorContext,
	file: Blob,
	filename: string,
	contentType: string,
): Promise<{ publicUrl: string; storagePath: string }> {
	if (!context.presignedUploadUrl) {
		throw new Error("Presigned upload URL not configured");
	}

	const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";
	const signRes = await fetch(`${context.presignedUploadUrl}${qs}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			filename,
			contentType,
			size: file.size,
			...context.browserRenderFields,
		}),
	});

	if (!signRes.ok) {
		throw new Error(`Failed to get presigned URL: ${signRes.status}`);
	}

	const { signedUrl, publicUrl, path: storagePath } = await signRes.json();

	const putRes = await fetch(signedUrl, {
		method: "PUT",
		headers: { "Content-Type": contentType },
		body: file,
	});

	if (!putRes.ok) {
		throw new Error(`Direct upload failed: ${putRes.status}`);
	}

	if (context.confirmUploadUrl) {
		await fetch(`${context.confirmUploadUrl}${qs}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				path: storagePath,
				filename,
				contentType,
				size: file.size,
				...context.browserRenderFields,
			}),
		}).catch((err) => console.warn("[presignedUpload] confirm failed:", err));
	}

	return { publicUrl, storagePath };
}

// ─── Video Preprocessing (FFmpeg trim) ───────────────────────────────────────

export async function trimVideo(
	videoUrl: string,
	startSec: number,
	endSec: number,
): Promise<Blob> {
	if (!window.FFmpegLocal?.extractSegment) {
		throw new Error("FFmpeg not loaded. Ensure ffmpeg-local.js is loaded.");
	}
	return window.FFmpegLocal.extractSegment(videoUrl, startSec, endSec);
}

// ─── Load CFS Scripts ────────────────────────────────────────────────────────

const loadedScripts = new Set<string>();

function loadScript(src: string): Promise<void> {
	if (loadedScripts.has(src)) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const existing = document.querySelector(`script[src="${src}"]`);
		if (existing) {
			loadedScripts.add(src);
			resolve();
			return;
		}
		const script = document.createElement("script");
		script.src = src;
		script.async = true;
		script.onload = () => {
			loadedScripts.add(src);
			resolve();
		};
		script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
		document.head.appendChild(script);
	});
}

export async function ensureTTSLoaded(): Promise<void> {
	await loadScript("/cfs-web/cfs-web-ai.js");
	await loadScript("/generator/tts/default-tts.js");
}

export async function ensureSTTLoaded(): Promise<void> {
	await loadScript("/cfs-web/cfs-web-ai.js");
	await loadScript("/generator/stt/default-stt.js");
}

export async function ensureFFmpegLoaded(): Promise<void> {
	await loadScript("/shared/ffmpeg-local.js");
}

export async function ensureAllServicesLoaded(): Promise<void> {
	await Promise.all([
		ensureTTSLoaded().catch((e) => console.warn("[ServiceBridge] TTS load failed:", e)),
		ensureSTTLoaded().catch((e) => console.warn("[ServiceBridge] STT load failed:", e)),
		ensureFFmpegLoaded().catch((e) => console.warn("[ServiceBridge] FFmpeg load failed:", e)),
	]);
}
