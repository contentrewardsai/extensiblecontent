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
		__CFS_ttsGenerate?: (text: string, options?: { voice?: string }) => Promise<{ blob: Blob; duration: number }>;
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
	options?: { voiceId?: string; speed?: number },
): Promise<{ blob: Blob; duration: number }> {
	if (!window.__CFS_ttsGenerate) {
		throw new Error("TTS engine not loaded. Ensure Kokoro scripts are loaded.");
	}
	const runtimeOpts = options?.voiceId ? { voice: options.voiceId } : undefined;
	const raw = await window.__CFS_ttsGenerate(text, runtimeOpts);

	let blob: Blob;
	let duration: number;
	if (raw instanceof Blob) {
		blob = raw;
		duration = await extractAudioDuration(raw);
	} else {
		blob = raw.blob;
		duration = raw.duration;
	}

	const speed = options?.speed ?? 1.0;
	if (speed !== 1.0) {
		blob = await resampleAudioBlob(blob, speed);
		duration = duration / speed;
	}

	return { blob, duration };
}

/** Re-encode an audio blob at a different playback rate to change its speed. */
async function resampleAudioBlob(blob: Blob, speed: number): Promise<Blob> {
	const ctx = new AudioContext();
	const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
	const newLength = Math.ceil(decoded.length / speed);
	const offline = new OfflineAudioContext(decoded.numberOfChannels, newLength, decoded.sampleRate);
	const src = offline.createBufferSource();
	src.buffer = decoded;
	src.playbackRate.value = speed;
	src.connect(offline.destination);
	src.start(0);
	const rendered = await offline.startRendering();
	ctx.close().catch(() => {});

	// Encode to WAV
	const numCh = rendered.numberOfChannels;
	const sr = rendered.sampleRate;
	const bps = 16;
	const blockAlign = numCh * (bps / 8);
	const dataSize = rendered.length * blockAlign;
	const buf = new ArrayBuffer(44 + dataSize);
	const v = new DataView(buf);
	const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
	w(0, "RIFF"); v.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
	w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
	v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
	v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
	v.setUint16(34, bps, true); w(36, "data"); v.setUint32(40, dataSize, true);
	const ch0 = rendered.getChannelData(0);
	let off = 44;
	for (let i = 0; i < rendered.length; i++) {
		const s = Math.max(-1, Math.min(1, ch0[i]));
		v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
		off += 2;
	}
	return new Blob([buf], { type: "audio/wav" });
}

/** Decode a Blob to extract its audio duration via AudioContext. */
async function extractAudioDuration(blob: Blob): Promise<number> {
	try {
		const buffer = await blob.arrayBuffer();
		const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		const decoded = await ctx.decodeAudioData(buffer);
		const dur = decoded.duration;
		ctx.close().catch(() => {});
		return dur;
	} catch {
		// Fallback: estimate from file size (~22050 Hz mono 16-bit WAV)
		return Math.max(0.5, blob.size / (22050 * 2));
	}
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
