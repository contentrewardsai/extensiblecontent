"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureCfsGeneratorLoaded } from "./ensure-cfs-generator";
import type { ShotstackEditorContext } from "./shotstack-editor-context";

type Variant = "row" | "toolbar";

type CfsAiProgress = {
	type?: string;
	stage?: "tts" | "stt";
	file?: string;
	loaded?: number;
	total?: number;
	status?: string;
	error?: string;
	message?: string;
};

function detectChromium() {
	if (typeof navigator === "undefined") return false;
	const u = navigator.userAgent;
	// iOS Chrome (CriOS) can run MediaRecorder; still exclude non‑Chromium.
	return /Chrome|Chromium|Edg\/|CriOS/.test(u) && !/FxiOS|Firefox\//.test(u);
}

function buildUrl(base: string, path: string, query: string): string {
	const url = `${base}${path}`;
	if (!query) return url;
	return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

async function preflightFfmpegWasm(): Promise<void> {
	const paths = ["/lib/ffmpeg/ffmpeg-core.js", "/lib/ffmpeg/ffmpeg-core.wasm"];
	for (const p of paths) {
		try {
			const res = await fetch(p, { method: "HEAD", credentials: "include" });
			if (!res.ok) {
				throw new Error(`${p} returned HTTP ${res.status} — FFmpeg assets aren't deployed. Ask ops to rerun the build.`);
			}
		} catch (err) {
			if (err instanceof Error && err.message.includes("aren't deployed")) throw err;
			throw new Error(`Could not reach ${p}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

/**
 * Stream the 40 MB ffmpeg-core.wasm with visible progress and warm the HTTP
 * cache so FFmpeg's own `load()` call (which reads it again via fetch from
 * inside its worker) lands in cache and resolves immediately.
 *
 * Without this, the user sees "Loading FFmpeg WASM..." forever while the
 * worker silently downloads — the only feedback is no feedback. With it,
 * they see the actual byte count climb so they can tell it's not hung.
 */
async function warmFfmpegWasmCache(onProgress: (msg: string) => void): Promise<void> {
	const url = "/lib/ffmpeg/ffmpeg-core.wasm";
	let res: Response;
	try {
		res = await fetch(url, { credentials: "include" });
	} catch (err) {
		throw new Error(`Could not start ffmpeg-core.wasm download: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!res.ok) throw new Error(`ffmpeg-core.wasm returned HTTP ${res.status}`);
	const totalHeader = res.headers.get("content-length");
	const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
	const reader = res.body?.getReader();
	if (!reader) {
		// No streaming support — fall through and let the browser fetch normally.
		await res.arrayBuffer();
		return;
	}
	let loaded = 0;
	let lastReport = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		loaded += value?.byteLength ?? 0;
		const now = Date.now();
		// Throttle UI updates to ~5/sec so React doesn't thrash.
		if (now - lastReport > 200) {
			lastReport = now;
			const mb = (loaded / 1e6).toFixed(1);
			if (total > 0) {
				const pct = Math.min(100, Math.round((100 * loaded) / total));
				onProgress(`Downloading FFmpeg WASM — ${mb} / ${(total / 1e6).toFixed(1)} MB (${pct}%)`);
			} else {
				onProgress(`Downloading FFmpeg WASM — ${mb} MB`);
			}
		}
	}
	onProgress("Compiling FFmpeg WASM…");
}

function runWithTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(message)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}

export function BrowserRenderButton({
	templateId,
	templateName: _templateName,
	variant = "row",
	getTemplateJson,
	disabled = false,
	context,
}: {
	templateId: string;
	templateName: string;
	variant?: Variant;
	/** If provided (e.g. from visual editor), used instead of fetching the template. */
	getTemplateJson?: () => Record<string, unknown> | null;
	disabled?: boolean;
	context: ShotstackEditorContext;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	// Gate with useEffect so SSR and first client render agree (hydration-safe).
	const [canRun, setCanRun] = useState<boolean | null>(null);
	// `crossOriginIsolated` requires COOP/COEP on the page AND the embedding
	// parent iframe setting `allow="cross-origin-isolated"`. GHL (and some Whop
	// surfaces) don't grant that, so we expose a "open in new tab" fallback —
	// the editor URL is standalone-friendly and in a top-level browsing context
	// the COOP/COEP headers we ship actually take effect.
	const [isolated, setIsolated] = useState<boolean | null>(null);
	useEffect(() => {
		setCanRun(detectChromium());
		setIsolated(typeof crossOriginIsolated !== "undefined" ? !!crossOriginIsolated : false);
	}, []);

	// When opened via "Open in new tab to render" the URL carries `?render=1`.
	// We *don't* auto-run on mount: the timeline player's AudioContext can only
	// start in the running state when created inside a user-gesture stack, and
	// `window.open()` doesn't transfer activation reliably across tabs. Instead
	// we surface a single big primary CTA so the next click is a real gesture
	// in *this* tab. Tracked via state so we can switch the button copy.
	const [pendingFromOpen, setPendingFromOpen] = useState(false);
	useEffect(() => {
		if (canRun !== true || isolated !== true) return;
		try {
			const url = new URL(window.location.href);
			if (url.searchParams.get("render") !== "1") return;
			setPendingFromOpen(true);
			url.searchParams.delete("render");
			window.history.replaceState(null, "", url.toString());
		} catch {
			/* ignore */
		}
	}, [canRun, isolated]);
	const isToolbar = variant === "toolbar";
	const baseBtn =
		"text-3 px-3 py-1.5 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12 disabled:opacity-50 disabled:cursor-not-allowed";

	function openStandalone() {
		try {
			const url = new URL(window.location.href);
			url.searchParams.set("render", "1");
			// If we're embedded (GHL / Whop iframe), _top is often blocked by
			// the parent's frame-ancestors; always use a fresh window instead.
			window.open(url.toString(), "_blank", "noopener,noreferrer");
		} catch {
			/* ignore */
		}
	}

	const onRender = async () => {
		if (canRun !== true) return;
		// MUST run synchronously inside this user-gesture handler before any
		// `await`. Creating + resuming an AudioContext here marks the page as
		// "audio activated", so the AudioContext that pixi-timeline-player
		// spins up later (after our async TTS / FFmpeg downloads) is allowed
		// to start in the running state rather than throwing the
		// "AudioContext was not allowed to start" warning and outputting
		// silence. We also stash the primer on a global so we can keep it
		// open if the player wants to inherit a context.
		try {
			const w = window as unknown as {
				AudioContext?: typeof AudioContext;
				webkitAudioContext?: typeof AudioContext;
				__CFS_audioContext?: AudioContext;
			};
			const Ctor = w.AudioContext || w.webkitAudioContext;
			if (Ctor && !w.__CFS_audioContext) {
				const primer = new Ctor();
				w.__CFS_audioContext = primer;
				if (primer.state === "suspended") {
					primer.resume().catch(() => {});
				}
			} else if (w.__CFS_audioContext && w.__CFS_audioContext.state === "suspended") {
				w.__CFS_audioContext.resume().catch(() => {});
			}
		} catch {
			/* ignore — worst case the player handles its own context */
		}
		setBusy(true);
		setPendingFromOpen(false);
		setMsg(null);
		try {
			setMsg("Loading editor scripts…");
			await ensureCfsGeneratorLoaded();
			type CfsEngine = {
				applyMergeToTemplate: (t: unknown, m: unknown[]) => unknown;
				renderTimelineToVideoBlob: (t: unknown) => Promise<Blob | null>;
			};
			const engine = (window as unknown as { __CFS_templateEngine?: CfsEngine }).__CFS_templateEngine;
			if (!engine?.applyMergeToTemplate || !engine?.renderTimelineToVideoBlob) {
				throw new Error("Render pipeline not available");
			}
			let edit: Record<string, unknown> | null = null;
			if (getTemplateJson) {
				edit = getTemplateJson() as Record<string, unknown> | null;
			}
			if (!edit) {
				const tRes = await fetch(
					buildUrl(context.templatesApiBase, `/${templateId}`, context.templatesApiQuery),
					{ credentials: "include" },
				);
				if (!tRes.ok) {
					throw new Error("Could not load template");
				}
				const t = (await tRes.json()) as { edit?: Record<string, unknown> };
				edit = (t?.edit as Record<string, unknown>) ?? null;
			}
			if (!edit) throw new Error("No template JSON");
			// Preflight: verify the ffmpeg-core wasm is actually reachable from
			// this origin before we kick off `convertToMp4`, which would
			// otherwise hang indefinitely on a 404 / COEP mismatch.
			await preflightFfmpegWasm();
			if (!crossOriginIsolated) {
				throw new Error(
					'This page is embedded, so the render pipeline (FFmpeg WASM + Kokoro / Whisper) can\'t use SharedArrayBuffer. Click "Open in new tab to render" below.',
				);
			}
			const wAi = window as unknown as {
				__CFS_subscribeAiProgress?: (fn: (d: CfsAiProgress) => void) => () => void;
			};
			// `fatal` means the worker died — but the shim transparently retries
			// on the main thread, so it's a soft warning not a render-killer.
			let workerFatal: string | null = null;
			const unsub =
				typeof wAi.__CFS_subscribeAiProgress === "function"
					? wAi.__CFS_subscribeAiProgress((d) => {
							if (d.type === "fatal") {
								workerFatal = d.error || "AI worker failed";
								setMsg("AI worker unavailable — running TTS / STT on the main thread (slower).");
								return;
							}
							if (d.type === "info" && d.message) {
								setMsg(d.message);
								return;
							}
							if (d.type !== "progress") return;
							const label = d.stage === "stt" ? "Whisper STT" : "Kokoro TTS";
							if (typeof d.loaded === "number" && typeof d.total === "number" && d.total > 0) {
								const pct = Math.min(100, Math.round((100 * d.loaded) / d.total));
								setMsg(
									`Downloading ${label} model — ${(d.loaded / 1e6).toFixed(1)} / ${(d.total / 1e6).toFixed(1)} MB (${pct}%)` +
										(d.file ? ` · ${d.file}` : ""),
								);
							} else if (d.status) {
								setMsg(`Preparing ${label} — ${d.status}`);
							} else {
								setMsg(`Preparing ${label}…`);
							}
						})
					: undefined;
			let webm: Blob | null = null;
			try {
				setMsg("Rendering video (TTS + timeline)…");
				const e = JSON.parse(JSON.stringify(edit)) as { merge?: unknown[] };
				const merge = Array.isArray(e.merge) ? e.merge : [];
				const merged = engine.applyMergeToTemplate(e, merge) as Record<string, unknown>;
				webm = await runWithTimeout(
					engine.renderTimelineToVideoBlob(merged),
					600_000,
					"Video render (Kokoro / Whisper + timeline) timed out after 10 minutes",
				);
				if (!webm) throw new Error("No video from renderer");
			} finally {
				try {
					unsub?.();
				} catch {
					/* ignore */
				}
			}
			if (!webm) {
				throw new Error("No video from renderer");
			}

			const ff = (window as unknown as {
				FFmpegLocal?: { convertToMp4: (b: Blob, c?: (s: string) => void) => Promise<unknown> };
			}).FFmpegLocal;
			let mp4result: { ok?: boolean; blob?: Blob; error?: string } | null = null;
			if (ff?.convertToMp4) {
				try {
					// Warm the HTTP cache for the 40 MB ffmpeg-core.wasm with
					// visible byte-progress, so the user can tell the load is
					// alive (and FFmpeg's internal fetch will then hit cache).
					await runWithTimeout(
						warmFfmpegWasmCache((s) => setMsg(s)),
						600_000,
						"FFmpeg WASM download timed out after 10 minutes — uploading WebM instead.",
					);
					// First-time FFmpeg WASM load on a fresh tab can take a while
					// (the core wasm is ~40MB and is fetched + compiled inside an
					// internal worker). Give it 10 minutes; if it still doesn't
					// finish, just upload the webm so the user gets *something*.
					mp4result = (await runWithTimeout(
						ff.convertToMp4(webm, (s) => setMsg(s)),
						600_000,
						"FFmpeg conversion timed out after 10 minutes — uploading WebM instead.",
					)) as { ok?: boolean; blob?: Blob; error?: string };
				} catch (err) {
					mp4result = { ok: false, error: err instanceof Error ? err.message : String(err) };
				}
			}
			const isMp4 = !!(mp4result?.ok && mp4result.blob);
			const blob: Blob = isMp4 && mp4result?.blob ? mp4result.blob : webm;
			const ext = isMp4 ? "mp4" : "webm";
			const contentType = blob.type || (isMp4 ? "video/mp4" : "video/webm");
			if (!isMp4) {
				const why = mp4result?.error
					? ` (${mp4result.error})`
					: ff?.convertToMp4
						? ""
						: " (FFmpeg not available)";
				setMsg(`Uploading WebM — could not transcode to MP4${why}`);
			}
			const fd = new FormData();
			for (const [k, v] of Object.entries(context.browserRenderFields)) {
				fd.append(k, v);
			}
			fd.append("template_id", templateId);
			fd.append("file", blob, `render.${ext}`);
			fd.append("content_type", contentType);
			const up = await fetch(context.browserRenderUrl, { method: "POST", body: fd, credentials: "include" });
			const j = (await up.json().catch(() => ({}))) as {
				error?: string;
				file_url?: string;
				ok?: boolean;
				storage_type?: "supabase" | "ghl";
				fallback_message?: string | null;
			};
			if (!up.ok) {
				throw new Error(j.error || `Upload failed (${up.status})`);
			}
			// Surface the destination so the user knows whether their render landed
			// in the HighLevel Media Library or in our Supabase buckets — and show
			// the fallback reason when we couldn't honour their preference.
			const dest =
				j.storage_type === "ghl" ? "Uploaded to HighLevel Media Library." : "Uploaded to Content Rewards AI storage.";
			const workerNote = workerFatal
				? ` (TTS / STT ran on the main thread — worker unavailable: ${workerFatal})`
				: "";
			const fmtNote = isMp4 ? "" : " Saved as WebM instead of MP4.";
			setMsg(`${dest}${j.fallback_message ? ` ${j.fallback_message}` : ""}${fmtNote}${workerNote}`);
			router.refresh();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : "Render failed");
		} finally {
			setBusy(false);
		}
	};

	if (canRun === null) {
		return (
			<div className={isToolbar ? "inline-flex flex-col gap-0.5" : "inline-flex flex-col items-end gap-0.5"}>
				<button type="button" className={baseBtn} disabled>
					{isToolbar ? "Render in browser (free)" : "Browser render (free)"}
				</button>
			</div>
		);
	}

	if (canRun === false) {
		return (
			<span
				className="text-2 text-gray-10 max-w-xs"
				title="Browser (free) render uses MediaRecorder and FFmpeg in Chromium-based browsers. Use Queue render for other browsers."
			>
				Browser render: Chromium only
			</span>
		);
	}

	if (isolated === false) {
		// Embedded in an iframe that doesn't grant `allow="cross-origin-isolated"`
		// (GHL, some Whop surfaces). We can't render in this frame at all — direct
		// users to a standalone tab where our COOP/COEP headers actually take effect.
		return (
			<div className={isToolbar ? "inline-flex flex-col gap-0.5" : "inline-flex flex-col items-end gap-0.5"}>
				<button type="button" className={baseBtn} onClick={openStandalone}>
					{isToolbar ? "Open in new tab to render" : "Open in new tab to render (free)"}
				</button>
				<span
					className={
						isToolbar
							? "text-2 text-gray-10"
							: "text-2 text-gray-10 text-right max-w-xs"
					}
					title="SharedArrayBuffer (required by FFmpeg + Kokoro) only works in a top-level browsing context."
				>
					Embedded frame can't run the free render — open standalone.
				</span>
			</div>
		);
	}

	const buttonLabel = busy
		? "Rendering…"
		: pendingFromOpen
			? "Click to start render"
			: isToolbar
				? "Render in browser (free)"
				: "Browser render (free)";
	const buttonClass = pendingFromOpen && !busy ? `${baseBtn} bg-accent-9 text-white border-accent-9` : baseBtn;
	return (
		<div className={isToolbar ? "inline-flex flex-col gap-0.5" : "inline-flex flex-col items-end gap-0.5"}>
			<button type="button" className={buttonClass} disabled={disabled || busy} onClick={onRender}>
				{buttonLabel}
			</button>
			{pendingFromOpen && !busy && !msg ? (
				<span className={isToolbar ? "text-2 text-gray-10" : "text-2 text-gray-10 text-right max-w-xs"}>
					This tab is ready — click to render (a click is required to enable audio playback).
				</span>
			) : null}
			{msg && !isToolbar ? <span className="text-2 text-gray-10 text-right max-w-xs">{msg}</span> : null}
			{msg && isToolbar ? <span className="text-2 text-gray-10">{msg}</span> : null}
		</div>
	);
}
