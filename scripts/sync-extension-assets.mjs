#!/usr/bin/env node
/**
 * Vendors generator / lib / shared files from ExtensibleContentExtension (pinned ref)
 * into public/lib, public/generator, public/shared. Idempotent; writes public/generator/.extension-assets-version
 *
 * Optional:
 *   EXTENSIBLE_CONTENT_EXTENSION_PATH=/path/to/ExtensibleContentExtension  (copy from disk, faster)
 *   EXTENSION_TEMPLATES_REF=commit|branch|tag  (default: same pin as seed script)
 */
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");

const DEFAULT_REF = "03292705b91d7ae9984f274a28f11cc503775ac8";
const REPO = "contentrewardsai/ExtensibleContentExtension";
const REF = process.env.EXTENSION_TEMPLATES_REF || DEFAULT_REF;
const LOCAL = process.env.EXTENSIBLE_CONTENT_EXTENSION_PATH
	? process.env.EXTENSIBLE_CONTENT_EXTENSION_PATH.replace(/\/$/, "")
	: null;

const RAW = (path) => `https://raw.githubusercontent.com/${REPO}/${REF}/${path}`;

/** Explicit list: paths relative to extension repo root. */
const ASSET_PATHS = [
	"lib/html2canvas.min.js",
	"lib/fabric.min.js",
	"lib/fabric-textbaseline-patch.js",
	"lib/pixi.min.js",
	"lib/pixi-unsafe-eval.min.js",
	"lib/socket.io.min.js",
	"lib/Sortable.min.js",
	"lib/ffmpeg/814.ffmpeg.js",
	"lib/ffmpeg/README.md",
	"lib/ffmpeg/ffmpeg-core.js",
	"lib/ffmpeg/ffmpeg-core.wasm",
	"lib/ffmpeg/ffmpeg.js",
	"shared/ffmpeg-local.js",
	"shared/shotstack-merge-placeholder-fill.js",
	"shared/step-comment.js",
	"shared/book-builder.js",
	"shared/walkthrough-export.js",
	"shared/upload-post.js",
	"shared/manifest-loader.js",
	"generator/inputs/manifest.json",
	"generator/outputs/manifest.json",
	"generator/inputs/registry.js",
	"generator/outputs/registry.js",
	"generator/inputs/text.js",
	"generator/inputs/textarea.js",
	"generator/inputs/number.js",
	"generator/inputs/color.js",
	"generator/inputs/select.js",
	"generator/inputs/checkbox.js",
	"generator/inputs/list.js",
	"generator/inputs/file.js",
	"generator/inputs/hidden.js",
	"generator/inputs/voice.js",
	"generator/inputs/video.js",
	"generator/inputs/audio.js",
	"generator/outputs/image.js",
	"generator/outputs/video.js",
	"generator/outputs/audio.js",
	"generator/outputs/book.js",
	"generator/outputs/registry.js",
	"generator/core/estimate-words.js",
	"generator/core/srt.js",
	"generator/core/wrap-text.js",
	"generator/core/font-loader.js",
	"generator/core/position-from-clip.js",
	"generator/core/scene.js",
	"generator/core/pixi-timeline-player.js",
	"generator/tts/default-tts.js",
	"generator/tts/tts-audio-cache.js",
	"generator/stt/default-stt.js",
	"generator/template-engine.js",
	"generator/templates/presets/loader.js",
	"generator/step-generator-ui-loader.js",
	"generator/editor/extensions/api.js",
	"generator/editor/extensions/loader.js",
	"generator/editor/fabric-to-timeline.js",
	"generator/editor/timeline-options.js",
	"generator/editor/chunk-utils.js",
	"generator/editor/timeline-panel.js",
	"generator/editor/json-patch.js",
	"generator/editor/unified-editor.js",
	"generator/editor/editor.css",
	"generator/generator.css",
];

/**
 * Pinned ESM / WASM for in-browser Kokoro TTS + Whisper (Transformers.js), not in the
 * extension repo. See public/cfs-web/ for the worker + main-thread shim.
 *
 * IMPORTANT: kokoro-js bundles its own copy of @huggingface/transformers and that
 * embeds a specific onnxruntime-web JS runtime. The vendored ORT *.wasm / *.mjs
 * files MUST match that runtime version exactly — if the JS calls into wasm
 * helpers (e.g. `Module.getValue`) that the wasm side doesn't export, ORT fails
 * during session init with cryptic errors like
 * `TypeError: A.getValue is not a function`. Sources of truth:
 *   - kokoro-js@1.2.1 → @huggingface/transformers@^3.5.1
 *   - @huggingface/transformers@3.5.1 → onnxruntime-web@1.22.0-dev.20250409-89f8206ba4
 * Bump these in lockstep.
 */
const ORT_VERSION = "1.22.0-dev.20250409-89f8206ba4";
const NPM_VENDOR = [
	{
		out: "public/lib/kokoro/kokoro.web.js",
		url: "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js",
	},
	{
		out: "public/lib/transformers/transformers.min.js",
		url: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js",
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.jsep.wasm",
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm`,
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.wasm",
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`,
	},
	// ONNX Runtime Web 1.20+ split the JSEP (JavaScript Execution Provider)
	// glue out into ESM `.mjs` loaders that get *dynamically imported* alongside
	// the .wasm files. Without these the worker (and main-thread fallback)
	// dies with: "no available backend found. ERR: [wasm] TypeError: Failed to
	// fetch dynamically imported module: /lib/transformers/ort-wasm-simd-threaded.jsep.mjs".
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.jsep.mjs",
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.jsep.mjs`,
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.mjs",
		url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.mjs`,
	},
];

async function ensureDir(f) {
	await mkdir(f, { recursive: true });
}

async function writeBuffer(dest, body) {
	await ensureDir(dirname(dest));
	await writeFile(dest, body);
}

async function fetchOrRead(relPath) {
	if (LOCAL) {
		const p = join(LOCAL, relPath);
		if (existsSync(p)) {
			return readFile(p);
		}
	}
	const res = await fetch(RAW(relPath), { headers: { Accept: "*/*" } });
	if (!res.ok) {
		throw new Error(`Failed ${relPath}: ${res.status} ${res.statusText}`);
	}
	return Buffer.from(await res.arrayBuffer());
}

/**
 * @param {string} relPath
 * @param {string} outRelPath
 */
function patchFfmpegLocal(relPath, outRelPath) {
	// In extension, coreURL() uses chrome.runtime.getURL. For the web app, use same-origin.
	return relPath === "shared/ffmpeg-local.js" && outRelPath === "public/shared/ffmpeg-local.js";
}

/**
 * Apply web-app patches to the vendored ffmpeg-local.js after the URL fixups.
 * The upstream extension never had to deal with a 40 MB wasm hanging silently
 * in a tab, so we add:
 *
 * 1. `ensureLoaded` exposed publicly so the caller can split "loading" from
 *    "converting" timeouts (a hung load looks identical to a slow long video).
 * 2. Diagnostic `console.log` lines inside `ensureLoaded` so the next time it
 *    hangs we can see which sub-step (worker spawn, importScripts, wasm fetch,
 *    wasm compile) is actually stuck, instead of seeing only the frontend
 *    "Loading FFmpeg WASM..." status with no detail.
 *
 * Markers are exact substrings of the vendored upstream so a kokoro-/ffmpeg-
 * version drift will surface as a "marker not found" warning and skip cleanly
 * rather than silently corrupting the file.
 */
function patchFfmpegLocalDiagnostics(text) {
	let out = text;

	// ── 1. Insert workerChunkURL() + fetchWorkerBlobUrl() before ensureLoaded ──
	// We anchor on the ensureLoaded marker because patchFfmpegLocalDiagnostics
	// runs BEFORE the URL-expansion patch, so the wasmURL() function still has
	// the simple `chrome.runtime.getURL(...)` form at this point.
	const ensureMarker = "function ensureLoaded(report) {";
	if (out.includes(ensureMarker)) {
		const blobHelpers = [
			"function workerChunkURL() {",
			"    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {",
			"      return chrome.runtime.getURL('lib/ffmpeg/814.ffmpeg.js');",
			"    }",
			"    if (typeof location !== 'undefined' && location.origin) {",
			"      return location.origin + '/lib/ffmpeg/814.ffmpeg.js';",
			"    }",
			"    return '/lib/ffmpeg/814.ffmpeg.js';",
			"  }",
			"",
			"  /**",
			"   * Pre-fetch the FFmpeg worker chunk and return a Blob URL.",
			"   *",
			"   * Under Cross-Origin-Embedder-Policy: credentialless (required for",
			"   * SharedArrayBuffer / crossOriginIsolated), Chrome blocks direct Worker",
			"   * script loading with a silent, sparse error event (all fields undefined).",
			"   * Loading the script ourselves and creating a blob: URL side-steps COEP",
			"   * entirely because blob: URLs are same-origin by definition.",
			"   *",
			"   * All URLs used inside the worker (coreURL, wasmURL for importScripts /",
			"   * fetch) are absolute, so changing the Worker's base URL to blob: has no",
			"   * effect on them.",
			"   */",
			"  var _workerBlobUrlCache = null;",
			"  function fetchWorkerBlobUrl() {",
			"    if (_workerBlobUrlCache) return Promise.resolve(_workerBlobUrlCache);",
			"    var url = workerChunkURL();",
			"    try { console.log('[FFmpegLocal] fetching worker chunk for Blob URL', url); } catch (_) {}",
			"    return fetch(url, { credentials: 'same-origin' })",
			"      .then(function (resp) {",
			"        if (!resp.ok) throw new Error('Failed to fetch FFmpeg worker chunk (' + resp.status + ')');",
			"        return resp.text();",
			"      })",
			"      .then(function (text) {",
			"        var blob = new Blob([text], { type: 'application/javascript' });",
			"        _workerBlobUrlCache = URL.createObjectURL(blob);",
			"        try { console.log('[FFmpegLocal] worker Blob URL created'); } catch (_) {}",
			"        return _workerBlobUrlCache;",
			"      });",
			"  }",
			"",
			"  function ensureLoaded(report) {",
			"    try { console.log('[FFmpegLocal] ensureLoaded called', { hasInstance: !!ffmpegInstance, loaded: ffmpegInstance && ffmpegInstance.loaded }); } catch (_) {}",
		].join("\n  ");
		out = out.replace(ensureMarker, blobHelpers);
	} else {
		console.warn("[sync-extension-assets] ffmpeg-local.js ensureLoaded marker not found — skipping diagnostics patch");
	}

	// Replace the IIFE `loading = (function () {` with `loading = fetchWorkerBlobUrl().then(function (blobUrl) {`
	const iifeMarker = "loading = (function () {";
	if (out.includes(iifeMarker)) {
		out = out.replace(iifeMarker, "loading = fetchWorkerBlobUrl().then(function (blobUrl) {");
	} else {
		console.warn("[sync-extension-assets] ffmpeg-local.js IIFE marker not found — skipping Blob URL rewrite");
	}

	// Replace the closing `})();` of the IIFE with `});` for the .then()
	// This is the `})();` that closes the loading IIFE, right before `loading.catch`
	const iifeEnd = "    })();\n\n    loading.catch";
	if (out.includes(iifeEnd)) {
		out = out.replace(iifeEnd, "    });\n\n    loading.catch");
	}

	// Change `return Promise.reject(new Error(...));` to `throw new Error(...);` inside .then()
	const rejectMarker = "return Promise.reject(new Error('FFmpegWASM.FFmpeg not found \\u2013 is lib/ffmpeg/ffmpeg.js loaded?'));";
	if (out.includes(rejectMarker)) {
		out = out.replace(rejectMarker, "throw new Error('FFmpegWASM.FFmpeg not found \\u2013 is lib/ffmpeg/ffmpeg.js loaded?');");
	} else {
		// Try with literal dash
		const rejectMarker2 = "return Promise.reject(new Error('FFmpegWASM.FFmpeg not found";
		if (out.includes(rejectMarker2)) {
			out = out.replace(
				/return Promise\.reject\(new Error\('FFmpegWASM\.FFmpeg not found[^)]*\)\)/,
				function (m) { return m.replace("return Promise.reject(", "throw ").replace(/\)\s*$/, ""); },
			);
		}
	}

	const loadMarker =
		"return ffmpegInstance.load({\n        coreURL: coreURL(),\n        wasmURL: wasmURL(),\n      }).then(function () {";
	if (out.includes(loadMarker)) {
		// Monkey-patch Worker to use Blob URL and race against worker error + timeout
		out = out.replace(
			loadMarker,
			[
				"try { console.log('[FFmpegLocal] calling FFmpeg.load()', { coreURL: coreURL(), wasmURL: wasmURL(), workerBlobUrl: blobUrl }); } catch (_) {}",
				"      ffmpegInstance.on('log', function (ev) { try { console.log('[FFmpeg core]', ev && ev.type, ev && ev.message); } catch (_) {} });",
				"",
				"      // Monkey-patch Worker to use Blob URL — bypasses COEP restrictions",
				"      var __origWorker = global.Worker;",
				"      var __workerErrorReject = null;",
				"      var __wrappedWorker = function (url, opts) {",
				"        try { console.log('[FFmpegLocal] new Worker (intercepted)', { originalUrl: String(url), blobUrl: blobUrl, opts: opts }); } catch (_) {}",
				"        var w = new __origWorker(blobUrl, opts);",
				"        try {",
				"          w.addEventListener('error', function (e) {",
				"            var detail = { message: e && e.message, filename: e && e.filename, lineno: e && e.lineno, colno: e && e.colno, error: e && e.error };",
				"            try { console.error('[FFmpeg worker] error event', detail); } catch (_) {}",
				"            if (typeof __workerErrorReject === 'function') {",
				"              __workerErrorReject(new Error('FFmpeg worker error: ' + (detail.message || detail.filename || 'unknown')));",
				"              __workerErrorReject = null;",
				"            }",
				"          });",
				"          w.addEventListener('messageerror', function (e) {",
				"            try { console.error('[FFmpeg worker] messageerror event', e); } catch (_) {}",
				"          });",
				"        } catch (_) {}",
				"        return w;",
				"      };",
				"      __wrappedWorker.prototype = __origWorker.prototype;",
				"      try { global.Worker = __wrappedWorker; } catch (_) {}",
				"      var __restoreWorker = function () { try { global.Worker = __origWorker; } catch (_) {} };",
				"",
				"      var workerErrorPromise = new Promise(function (_resolve, reject) {",
				"        __workerErrorReject = reject;",
				"      });",
				"      var safetyTimeout = new Promise(function (_resolve, reject) {",
				"        setTimeout(function () {",
				"          reject(new Error('FFmpeg load() did not resolve within 60s — worker likely hung.'));",
				"        }, 60000);",
				"      });",
				"",
				"      return Promise.race([",
				"        ffmpegInstance.load({",
				"          coreURL: coreURL(),",
				"          wasmURL: wasmURL(),",
				"        }),",
				"        workerErrorPromise,",
				"        safetyTimeout,",
				"      ]).then(function () {",
				"        __restoreWorker();",
				"        __workerErrorReject = null;",
				"        try { console.log('[FFmpegLocal] FFmpeg.load() resolved'); } catch (_) {}",
			].join("\n"),
		);
		// Also restore the wrapper if load() rejects.
		const restoreMarker = "    loading.catch(function () {\n      ffmpegInstance = null;\n      loading = null;\n    });";
		if (out.includes(restoreMarker)) {
			out = out.replace(
				restoreMarker,
				"    loading.catch(function (err) {\n      try { console.error('[FFmpegLocal] FFmpeg.load() rejected', err); } catch (_) {}\n      try { if (ffmpegInstance && typeof ffmpegInstance.terminate === 'function') ffmpegInstance.terminate(); } catch (_) {}\n      ffmpegInstance = null;\n      loading = null;\n    });",
			);
		}
	} else {
		console.warn("[sync-extension-assets] ffmpeg-local.js load marker not found — skipping load diagnostics");
	}
	const exportsMarker = "global.FFmpegLocal = {\n    convertToMp4: convertToMp4,";
	if (out.includes(exportsMarker)) {
		out = out.replace(
			exportsMarker,
			"global.FFmpegLocal = {\n    ensureLoaded: ensureLoaded,\n    convertToMp4: convertToMp4,",
		);
	} else {
		console.warn("[sync-extension-assets] ffmpeg-local.js exports marker not found — skipping ensureLoaded export");
	}
	// Optimise FFmpeg encoding: force 30fps CFR output, use ultrafast preset,
	// and add +faststart for progressive MP4 download.
	const ffmpegArgsMarker =
		"'-c:v', 'libx264',\n" +
		"                '-preset', 'medium',";
	const ffmpegArgsFix =
		"'-r', '30',\n" +
		"                '-vsync', 'cfr',\n" +
		"                '-c:v', 'libx264',\n" +
		"                '-preset', 'ultrafast',";
	if (out.includes(ffmpegArgsMarker)) {
		out = out.replace(ffmpegArgsMarker, ffmpegArgsFix);
	} else if (!out.includes("'-vsync', 'cfr',")) {
		console.warn("[sync-extension-assets] ffmpeg-local.js encoding args marker not found — skipping");
	}

	// Add -movflags +faststart before outputName
	const movflagsMarker = "'-b:a', '128k',\n                outputName,";
	const movflagsFix = "'-b:a', '128k',\n                '-movflags', '+faststart',\n                outputName,";
	if (out.includes(movflagsMarker)) {
		out = out.replace(movflagsMarker, movflagsFix);
	} else if (!out.includes("'+faststart'")) {
		console.warn("[sync-extension-assets] ffmpeg-local.js movflags marker not found — skipping");
	}

	return out;
}

/**
 * Patch template-engine.js for the web app:
 *
 * 1. Fix async race in renderTimelineToAudioBlob — player.load() returns a Promise
 *    but was not awaited, so renderMixedAudioBuffer ran before the player had loaded
 *    the template, causing "No audio from renderer".
 *
 * 2. Fix destructuring bug — preGenerateTtsForTemplate returns { map, revoke } but the
 *    audio path named the param `ttsMap` and passed the whole wrapper object to the
 *    player instead of `.map`. The player couldn't find any TTS URLs → null audio.
 */
function patchTemplateEngine(text) {
	let out = text;
	const audioRaceMarker =
		"const player = createPlayer({ merge: (options.merge || {}), preGeneratedTts: ttsMap || undefined });\n" +
		"      player.load(mergedTemplate);\n" +
		"      const durationSec = player.getDuration ? player.getDuration() : 10;\n" +
		"      if (player.renderMixedAudioBuffer) {\n" +
		"        return player.renderMixedAudioBuffer(durationSec, 0);\n" +
		"      }\n" +
		"      return null;";
	const audioRaceFix =
		"const player = createPlayer({ merge: (options.merge || {}), preGeneratedTts: ttsResult.map || {} });\n" +
		"      return player.load(mergedTemplate).then(function () {\n" +
		"        const durationSec = player.getDuration ? player.getDuration() : 10;\n" +
		"        if (player.renderMixedAudioBuffer) {\n" +
		"          return player.renderMixedAudioBuffer(durationSec, 0);\n" +
		"        }\n" +
		"        return null;\n" +
		"      });";
	if (out.includes(audioRaceMarker)) {
		out = out.replace(audioRaceMarker, audioRaceFix);
	} else {
		console.warn("[sync-extension-assets] template-engine.js audioRace marker not found — skipping");
	}

	// Fix destructuring: rename `ttsMap` → `ttsResult` and extract `.revoke` / `.map`
	const destructureMarker =
		"return preGenerateTtsForTemplate(mergedTemplate).then(function (ttsMap) {\n" +
		"      ttsRevoke = ttsMap ? Object.values(ttsMap).filter(function (u) { return typeof u === 'string' && u.startsWith('blob:'); }) : [];";
	const destructureFix =
		"return preGenerateTtsForTemplate(mergedTemplate).then(function (ttsResult) {\n" +
		"      ttsRevoke = ttsResult.revoke || [];";
	if (out.includes(destructureMarker)) {
		out = out.replace(destructureMarker, destructureFix);
	} else {
		console.warn("[sync-extension-assets] template-engine.js destructure marker not found — skipping");
	}

	// Cap capture-stream FPS at 30 to reduce WebM file size and prevent
	// FFmpeg from processing thousands of duplicate frames from VFR WebM.
	const fpsCap60 = "Math.min(60,";
	const fpsCap30 = "Math.min(30,";
	if (out.includes(fpsCap60)) {
		out = out.replace(fpsCap60, fpsCap30);
	} else if (!out.includes(fpsCap30)) {
		console.warn("[sync-extension-assets] template-engine.js fps cap marker not found — skipping");
	}

	// Start native video playback before the render loop so videos play smoothly.
	// The upstream code seeks every frame which causes jerkiness.
	const audioPlaybackStartMarker =
		"if (audioPlayback && audioPlayback.start) {\n" +
		"          audioPlayback.start().catch(function (err) { console.warn('[CFS] Audio playback start failed', err); });\n" +
		"        }\n" +
		"        const startTime = Date.now();";
	const audioPlaybackStartFix =
		"if (audioPlayback && audioPlayback.start) {\n" +
		"          audioPlayback.start().catch(function (err) { console.warn('[CFS] Audio playback start failed', err); });\n" +
		"        }\n" +
		"        if (player.startVideoPlayback) player.startVideoPlayback(rangeStart);\n" +
		"        const startTime = Date.now();";
	if (out.includes(audioPlaybackStartMarker)) {
		out = out.replace(audioPlaybackStartMarker, audioPlaybackStartFix);
	} else if (!out.includes("startVideoPlayback")) {
		console.warn("[sync-extension-assets] template-engine.js startVideoPlayback marker not found — skipping");
	}

	return out;
}

/**
 * Patch fabric-to-timeline.js — video clip width/height export:
 *
 * Use the visual Fabric canvas dimensions (width × scaleX) for the exported
 * clip's asset.width/height instead of the original source video dimensions
 * (cfsVideoWidth/cfsVideoHeight).  The Pixi player uses clip.width/height as
 * the target container for fit/crop, so they must reflect what the user sees.
 */
function patchFabricToTimeline(text) {
	let out = text;
	const vidDimMarker =
		"var vw = obj.cfsVideoWidth != null ? Number(obj.cfsVideoWidth) : (obj.width != null && obj.width > 0 ? obj.width : null);\n" +
		"        var vh = obj.cfsVideoHeight != null ? Number(obj.cfsVideoHeight) : (obj.height != null && obj.height > 0 ? obj.height : null);\n" +
		"        if (vw != null && vh != null && vw > 0 && vh > 0) {\n" +
		"          videoClip.asset.width = vw;\n" +
		"          videoClip.asset.height = vh;\n" +
		"        }";
	const vidDimFix =
		"/* Use the VISUAL size of the Fabric group (width × scaleX) for the clip\n" +
		"           container, not the original source video dimensions. */\n" +
		"        var visualW = (obj.width != null ? obj.width : 0) * (obj.scaleX != null ? obj.scaleX : 1);\n" +
		"        var visualH = (obj.height != null ? obj.height : 0) * (obj.scaleY != null ? obj.scaleY : 1);\n" +
		"        if (visualW > 0 && visualH > 0) {\n" +
		"          videoClip.asset.width = Math.round(visualW);\n" +
		"          videoClip.asset.height = Math.round(visualH);\n" +
		"        } else {\n" +
		"          var vw = obj.cfsVideoWidth != null ? Number(obj.cfsVideoWidth) : (obj.width != null && obj.width > 0 ? obj.width : null);\n" +
		"          var vh = obj.cfsVideoHeight != null ? Number(obj.cfsVideoHeight) : (obj.height != null && obj.height > 0 ? obj.height : null);\n" +
		"          if (vw != null && vh != null && vw > 0 && vh > 0) {\n" +
		"            videoClip.asset.width = vw;\n" +
		"            videoClip.asset.height = vh;\n" +
		"          }\n" +
		"        }";
	if (out.includes(vidDimMarker)) {
		out = out.replace(vidDimMarker, vidDimFix);
	} else if (!out.includes("visualW") || !out.includes("visualH")) {
		console.warn("[sync-extension-assets] fabric-to-timeline.js video dimension marker not found — skipping");
	}

	// ── Video Preprocessor: Use cfsProcessedUrl for browser renders ──
	// Add a hasProcessedClip flag near the top of the video clip building code.
	const videoSrcAssign = "var videoSrc = obj.cfsVideoSrc;";
	if (out.includes(videoSrcAssign) && !out.includes("hasProcessedClip")) {
		out = out.replace(videoSrcAssign,
			"var videoSrc = obj.cfsVideoSrc;\n" +
			"        var hasProcessedClip = typeof obj.cfsProcessedUrl === 'string' && obj.cfsProcessedUrl.length > 0;"
		);
	}

	// In the new clip path, use processed URL when available (trim/speed already baked in)
	const newClipSrcMarker =
		"videoClip.asset.src = videoIsPlaceholder ? ('{{ ' + videoAlias + ' }}')\n" +
		"            : (useOrigVideoUrl ? origVideoSrc : (videoSrc || ''));";
	if (out.includes(newClipSrcMarker) && !out.includes("hasProcessedClip && !videoIsPlaceholder")) {
		out = out.replace(newClipSrcMarker,
			"if (hasProcessedClip && !videoIsPlaceholder) {\n" +
			"            videoClip.asset.src = obj.cfsProcessedUrl;\n" +
			"            delete videoClip.asset.trim;\n" +
			"            delete videoClip.asset.speed;\n" +
			"          } else {\n" +
			"            videoClip.asset.src = videoIsPlaceholder ? ('{{ ' + videoAlias + ' }}')\n" +
			"              : (useOrigVideoUrl ? origVideoSrc : (videoSrc || ''));\n" +
			"          }"
		);
	}

	return out;
}

/**
 * Patch unified-editor.js for the web app:
 *
 * 1. New elements start at t=0 spanning the full existing duration instead of
 *    being appended at the end of the timeline (which inflates video length).
 *
 * 2. In-memory clipboard fallback for GHL iframes where the Clipboard API is
 *    blocked by the browser's Permissions Policy.
 */
function patchUnifiedEditor(text) {
	let out = text;

	// ── Fix: addText start at 0 instead of end ──
	const addTextMarker = "opts.cfsStart = getTimelineEnd();\n        opts.cfsLength = 5;";
	const addTextFix    = "opts.cfsStart = 0;\n        opts.cfsLength = getTimelineEnd() || 5;";
	if (out.includes(addTextMarker)) {
		out = out.replace(addTextMarker, addTextFix);
	}

	// ── Fix: addImage start at 0 ──
	const addImgMarker = "imgOpts.cfsStart = getTimelineEnd();\n              imgOpts.cfsLength = 5;";
	const addImgFix    = "imgOpts.cfsStart = 0;\n              imgOpts.cfsLength = getTimelineEnd() || 5;";
	if (out.includes(addImgMarker)) {
		out = out.replace(addImgMarker, addImgFix);
	}

	// ── Fix: addShape start at 0 ──
	const addShapeMarker = "timeProps.cfsStart = getTimelineEnd(); timeProps.cfsLength = 5;";
	const addShapeFix    = "timeProps.cfsStart = 0; timeProps.cfsLength = getTimelineEnd() || 5;";
	if (out.includes(addShapeMarker)) {
		out = out.replace(addShapeMarker, addShapeFix);
	}

	// ── Fix: importSvg start at 0 ──
	const svgMarker = "svgOpts.cfsStart = getTimelineEnd();\n            svgOpts.cfsLength = 5;";
	const svgFix    = "svgOpts.cfsStart = 0;\n            svgOpts.cfsLength = getTimelineEnd() || 5;";
	if (out.includes(svgMarker)) {
		out = out.replace(svgMarker, svgFix);
	}

	// ── Fix: addAudioClip start at 0 ──
	const audioStartMarker = "var start = Math.max(getTimelineEnd(), lastTotalDuration || 0);\n        var audioTrackIdx";
	const audioStartFix    = "var start = 0;\n        var audioTrackIdx";
	if (out.includes(audioStartMarker)) {
		out = out.replace(audioStartMarker, audioStartFix);
	}
	const audioLenMarker = "start: start,\n          length: 10\n        });\n        saveStateDebounced();\n        refreshTimeline();\n        refreshPropertyPanel();\n      }\n    }";
	const audioLenFix    = "start: start,\n          length: getTimelineEnd() || 10\n        });\n        saveStateDebounced();\n        refreshTimeline();\n        refreshPropertyPanel();\n      }\n    }";
	if (out.includes(audioLenMarker)) {
		out = out.replace(audioLenMarker, audioLenFix);
	}

	// ── Fix: addVideo length ──
	const vidLenMarker = "group.set('cfsLength', 5);\n        group.set('cfsTrackIndex', 0);";
	const vidLenFix    = "group.set('cfsLength', getTimelineEnd() || 5);\n        group.set('cfsTrackIndex', 0);";
	if (out.includes(vidLenMarker)) {
		out = out.replace(vidLenMarker, vidLenFix);
	}

	// ── Fix: Add non-TTS audio playback (audio clips + soundtrack) to preview ──
	// The extension's playTimelinePreview only schedules TTS chunks.
	// We inject a scheduleNonTtsAudio IIFE after the TTS scheduling block.
	const ttsScheduleEndMarker = "          });\n        }\n\n        function tick() {";
	const nonTtsAudioBlock =
		"          });\n" +
		"        }\n" +
		"\n" +
		"        /* ── Schedule audio clip + soundtrack playback ── */\n" +
		"        (function scheduleNonTtsAudio() {\n" +
		"          if (!template || !template.timeline) return;\n" +
		"          var entries = [];\n" +
		"          (template.timeline.tracks || []).forEach(function (track) {\n" +
		"            (track.clips || []).forEach(function (clip) {\n" +
		"              var asset = clip.asset || {};\n" +
		"              var type = (asset.type || '').toLowerCase();\n" +
		"              if (type !== 'audio') return;\n" +
		"              var src = asset.src || asset.url || '';\n" +
		"              if (!src || src.indexOf('{{') !== -1) return;\n" +
		"              var clipStart = typeof clip.start === 'number' ? clip.start : 0;\n" +
		"              var clipLength = clip.length === 'end' || clip.length === 'auto'\n" +
		"                ? Math.max(0, total - clipStart)\n" +
		"                : (typeof clip.length === 'number' ? clip.length : 5);\n" +
		"              var vol = typeof asset.volume === 'number' ? asset.volume : 1;\n" +
		"              if (vol > 1 && vol <= 100) vol = vol / 100;\n" +
		"              entries.push({ src: src, start: clipStart, length: clipLength, volume: Math.max(0, Math.min(4, vol)) });\n" +
		"            });\n" +
		"          });\n" +
		"          var soundtrack = template.timeline.soundtrack;\n" +
		"          if (soundtrack && soundtrack.src) {\n" +
		"            var stSrc = soundtrack.src;\n" +
		"            if (stSrc && stSrc.indexOf('{{') === -1) {\n" +
		"              var stDur = typeof soundtrack.duration === 'number' ? soundtrack.duration : total;\n" +
		"              var stVol = typeof soundtrack.volume === 'number' ? soundtrack.volume : 1;\n" +
		"              if (stVol > 1 && stVol <= 100) stVol = stVol / 100;\n" +
		"              entries.push({ src: stSrc, start: 0, length: stDur, volume: Math.max(0, Math.min(4, stVol)) });\n" +
		"            }\n" +
		"          }\n" +
		"          if (!entries.length) return;\n" +
		"          entries.forEach(function (entry) {\n" +
		"            var entryEnd = entry.start + entry.length;\n" +
		"            if (timelinePlayStartTime >= entryEnd) return;\n" +
		"            function playEntry() {\n" +
		"              if (!isTimelinePlaying) return;\n" +
		"              var srcUrl = entry.src;\n" +
		"              (srcUrl.startsWith('blob:') || srcUrl.startsWith('data:')\n" +
		"                ? Promise.resolve(srcUrl)\n" +
		"                : fetch(srcUrl, { mode: 'cors' }).then(function (r) {\n" +
		"                    if (!r.ok) throw new Error('HTTP ' + r.status);\n" +
		"                    return r.blob();\n" +
		"                  }).then(function (blob) { return URL.createObjectURL(blob); })\n" +
		"                  .catch(function () {\n" +
		"                    var proxyBase = (typeof location !== 'undefined' && location.origin) || '';\n" +
		"                    if (proxyBase) {\n" +
		"                      return fetch(proxyBase + '/api/media-proxy?url=' + encodeURIComponent(srcUrl))\n" +
		"                        .then(function (pr) { if (!pr.ok) throw new Error('Proxy ' + pr.status); return pr.blob(); })\n" +
		"                        .then(function (b) { return URL.createObjectURL(b); })\n" +
		"                        .catch(function () { return srcUrl; });\n" +
		"                    }\n" +
		"                    return srcUrl;\n" +
		"                  })\n" +
		"              ).then(function (url) {\n" +
		"                if (!isTimelinePlaying) return;\n" +
		"                var audio = new Audio(url);\n" +
		"                if (url !== srcUrl && url.startsWith('blob:')) audio._cfsBlobUrl = url;\n" +
		"                audio.volume = Math.min(1, entry.volume);\n" +
		"                if (timelinePlayStartTime > entry.start) audio.currentTime = timelinePlayStartTime - entry.start;\n" +
		"                _previewAudioEls.push(audio);\n" +
		"                audio.play().catch(function () {});\n" +
		"              });\n" +
		"            }\n" +
		"            if (timelinePlayStartTime < entry.start) {\n" +
		"              var delay = (entry.start - timelinePlayStartTime) * 1000;\n" +
		"              setTimeout(function () { if (isTimelinePlaying) playEntry(); }, delay);\n" +
		"            } else {\n" +
		"              playEntry();\n" +
		"            }\n" +
		"          });\n" +
		"        })();\n" +
		"\n" +
		"        function tick() {";
	if (out.includes(ttsScheduleEndMarker)) {
		out = out.replace(ttsScheduleEndMarker, nonTtsAudioBlock);
	} else {
		console.warn("[sync-extension-assets] unified-editor.js TTS schedule end marker not found — skipping non-TTS audio patch");
	}

	// ── Inject getNextTrackIndex() helper ──
	// Placed right before assignSeparateTracksForVideo() so it's in scope for all add functions.
	const helperInsertMarker = "    function assignSeparateTracksForVideo() {";
	const helperBlock =
		"    /** Compute the next available track index so each new element gets its own track. */\n" +
		"    function getNextTrackIndex() {\n" +
		"      var maxTrack = -1;\n" +
		"      if (canvas && canvas.getObjects) {\n" +
		"        canvas.getObjects().forEach(function (obj) {\n" +
		"          var ti = obj.cfsTrackIndex != null ? obj.cfsTrackIndex : -1;\n" +
		"          if (ti > maxTrack) maxTrack = ti;\n" +
		"        });\n" +
		"      }\n" +
		"      if (template && template.timeline && Array.isArray(template.timeline.tracks)) {\n" +
		"        maxTrack = Math.max(maxTrack, template.timeline.tracks.length - 1);\n" +
		"      }\n" +
		"      return maxTrack + 1;\n" +
		"    }\n\n" +
		"    function assignSeparateTracksForVideo() {";
	if (out.includes(helperInsertMarker)) {
		out = out.replace(helperInsertMarker, helperBlock);
	} else {
		console.warn("[sync-extension-assets] unified-editor.js assignSeparateTracksForVideo marker not found — skipping getNextTrackIndex injection");
	}

	// ── Replace cfsTrackIndex = 0 with getNextTrackIndex() in all add functions ──
	// addText
	const textTrackMarker = "opts.cfsTrackIndex = 0;";
	const textTrackFix    = "opts.cfsTrackIndex = getNextTrackIndex();";
	if (out.includes(textTrackMarker)) {
		out = out.replace(textTrackMarker, textTrackFix);
	}
	// addImage
	const imgTrackMarker = "imgOpts.cfsTrackIndex = 0;";
	const imgTrackFix    = "imgOpts.cfsTrackIndex = getNextTrackIndex();";
	if (out.includes(imgTrackMarker)) {
		out = out.replace(imgTrackMarker, imgTrackFix);
	}
	// addShape
	const shapeTrackMarker = "timeProps.cfsTrackIndex = 0;";
	const shapeTrackFix    = "timeProps.cfsTrackIndex = getNextTrackIndex();";
	if (out.includes(shapeTrackMarker)) {
		out = out.replace(shapeTrackMarker, shapeTrackFix);
	}
	// addVideo — note: the vidLen patch above already changed length, so marker now includes getTimelineEnd()
	const vidTrackMarker = "group.set('cfsTrackIndex', 0);";
	const vidTrackFix    = "group.set('cfsTrackIndex', getNextTrackIndex());";
	if (out.includes(vidTrackMarker)) {
		out = out.replace(vidTrackMarker, vidTrackFix);
	}
	// importSvg
	const svgTrackMarker = "svgOpts.cfsTrackIndex = 0;";
	const svgTrackFix    = "svgOpts.cfsTrackIndex = getNextTrackIndex();";
	if (out.includes(svgTrackMarker)) {
		out = out.replace(svgTrackMarker, svgTrackFix);
	}
	// addClip text fallback
	const addClipTrackMarker = "cfsTrackIndex: 0,\n        cfsWrapText: true,";
	const addClipTrackFix    = "cfsTrackIndex: getNextTrackIndex(),\n        cfsWrapText: true,";
	if (out.includes(addClipTrackMarker)) {
		out = out.replace(addClipTrackMarker, addClipTrackFix);
	}

	// ── Fix insertAudioClip: always create a new track (one element per track) ──
	const audioTrackFindMarker =
		"var audioTrackIdx = -1;\n" +
		"        for (var ti = 0; ti < template.timeline.tracks.length; ti++) {\n" +
		"          var clips = (template.timeline.tracks[ti] && template.timeline.tracks[ti].clips) || [];\n" +
		"          if (clips.length && clips.every(function (c) { return (c.asset || {}).type === 'audio'; })) { audioTrackIdx = ti; break; }\n" +
		"        }\n" +
		"        if (audioTrackIdx < 0) {\n" +
		"          template.timeline.tracks.push({ clips: [] });\n" +
		"          audioTrackIdx = template.timeline.tracks.length - 1;\n" +
		"        }";
	const audioTrackAlwaysNew =
		"/* Always create a new track for each audio clip — one element per track */\n" +
		"        template.timeline.tracks.push({ clips: [] });\n" +
		"        var audioTrackIdx = template.timeline.tracks.length - 1;";
	if (out.includes(audioTrackFindMarker)) {
		out = out.replace(audioTrackFindMarker, audioTrackAlwaysNew);
	} else {
		console.warn("[sync-extension-assets] unified-editor.js insertAudioClip track-find marker not found — skipping");
	}

	// ── Add showIframePrompt() helper for URL/file input in iframes ──
	// window.prompt is blocked in some cross-origin iframes; this inline modal
	// serves as a fallback.
	const iframePromptInsertMarker = "    function getNextTrackIndex() {";
	if (!out.includes("showIframePrompt") && out.includes(iframePromptInsertMarker)) {
		const iframePromptFn =
			"    function showIframePrompt(message, fileAccept, cb) {\n" +
			"      var overlay = document.createElement('div');\n" +
			"      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;';\n" +
			"      var box = document.createElement('div');\n" +
			"      box.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px 28px;min-width:360px;max-width:480px;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);';\n" +
			"      var title = document.createElement('div');\n" +
			"      title.textContent = message || 'Enter URL or choose a file';\n" +
			"      title.style.cssText = 'font-size:15px;margin-bottom:14px;font-weight:500;';\n" +
			"      var urlInput = document.createElement('input');\n" +
			"      urlInput.type = 'text'; urlInput.placeholder = 'https://...';\n" +
			"      urlInput.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:14px;margin-bottom:12px;outline:none;';\n" +
			"      var btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';\n" +
			"      var fileBtn = document.createElement('button'); fileBtn.textContent = 'Choose File';\n" +
			"      fileBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #475569;background:#334155;color:#e2e8f0;cursor:pointer;font-size:13px;';\n" +
			"      var okBtn = document.createElement('button'); okBtn.textContent = 'Use URL';\n" +
			"      okBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-weight:600;';\n" +
			"      var cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel';\n" +
			"      cancelBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #475569;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px;';\n" +
			"      btnRow.appendChild(cancelBtn); btnRow.appendChild(fileBtn); btnRow.appendChild(okBtn);\n" +
			"      box.appendChild(title); box.appendChild(urlInput); box.appendChild(btnRow);\n" +
			"      overlay.appendChild(box); document.body.appendChild(overlay); urlInput.focus();\n" +
			"      function cleanup() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }\n" +
			"      cancelBtn.onclick = function () { cleanup(); };\n" +
			"      overlay.onclick = function (e) { if (e.target === overlay) cleanup(); };\n" +
			"      okBtn.onclick = function () { var val = urlInput.value.trim(); cleanup(); if (val) cb({ url: val }); };\n" +
			"      urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') okBtn.click(); if (e.key === 'Escape') cleanup(); });\n" +
			"      fileBtn.onclick = function () {\n" +
			"        var fi = document.createElement('input'); fi.type = 'file'; fi.accept = fileAccept || '*/*';\n" +
			"        fi.onchange = function () { var file = fi.files && fi.files[0]; cleanup(); if (file) cb({ file: file }); };\n" +
			"        fi.click();\n" +
			"      };\n" +
			"    }\n\n" +
			"    function getNextTrackIndex() {";
		out = out.replace(iframePromptInsertMarker, iframePromptFn);
	}

	// ── Video Preprocessor: Add cfsProcessedUrl to serialization key lists ──
	const cfsVideoSrcKeys = "'cfsVideoSrc', '";
	const cfsVideoSrcKeysFixed = "'cfsVideoSrc', 'cfsProcessedUrl', '";
	if (out.includes(cfsVideoSrcKeys) && !out.includes("'cfsProcessedUrl'")) {
		out = out.split(cfsVideoSrcKeys).join(cfsVideoSrcKeysFixed);
	}

	// ── Video Preprocessor: Add scheduleVideoReprocess helper ──
	const rehydrateVidMarker = "    function rehydrateVideoGroups(fabricCanvas) {";
	if (out.includes(rehydrateVidMarker) && !out.includes("scheduleVideoReprocess")) {
		const reprocessHelper =
			"    var _videoReprocessTimers = {};\n" +
			"    function scheduleVideoReprocess(obj) {\n" +
			"      if (!obj || !obj.cfsVideoSrc) return;\n" +
			"      if (typeof CfsVideoPreprocessor === 'undefined' || !CfsVideoPreprocessor.processAndPersist) return;\n" +
			"      var objName = obj.name || obj.id || '';\n" +
			"      if (_videoReprocessTimers[objName]) clearTimeout(_videoReprocessTimers[objName]);\n" +
			"      _videoReprocessTimers[objName] = setTimeout(function () {\n" +
			"        delete _videoReprocessTimers[objName];\n" +
			"        var src = obj.cfsVideoSrc;\n" +
			"        var uUrl = (typeof window !== 'undefined' && window.__CFS_videoUploadUrl) || '';\n" +
			"        var uFields = (typeof window !== 'undefined' && window.__CFS_videoUploadFields) || {};\n" +
			"        var _pCfg = (typeof window !== 'undefined' && window.__CFS_presignedConfig) || null;\n" +
			"        CfsVideoPreprocessor.processAndPersist(src, { trimStart: obj.cfsTrim || 0, speed: obj.cfsSpeed || 1, width: 0, height: 0, fps: 30 }, uUrl, uFields, function () {}, _pCfg).then(function (r) {\n" +
			"          if (r.url) { var old = obj.cfsProcessedUrl; if (old && old.indexOf('blob:') === 0) { try { URL.revokeObjectURL(old); } catch (_) {} } obj.set('cfsProcessedUrl', r.url); }\n" +
			"          if (typeof saveStateDebounced === 'function') saveStateDebounced();\n" +
			"        }).catch(function () {});\n" +
			"      }, 500);\n" +
			"    }\n\n" +
			"    function rehydrateVideoGroups(fabricCanvas) {";
		out = out.replace(rehydrateVidMarker, reprocessHelper);
	}

	// ── Video Preprocessor: Wire scheduleVideoReprocess into trim change ──
	const trimSyncEnd =
		"obj.set('cfsTrim', trimVal);\n" +
		"          /* Immediately sync the Fabric preview to show the trimmed frame */\n" +
		"          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') {\n" +
		"            syncVideosToTime(currentPlayheadSec);\n" +
		"          }\n" +
		"        });";
	if (out.includes(trimSyncEnd) && !out.includes("scheduleVideoReprocess(obj)")) {
		out = out.replace(trimSyncEnd,
			"obj.set('cfsTrim', trimVal);\n" +
			"          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') { syncVideosToTime(currentPlayheadSec); }\n" +
			"          scheduleVideoReprocess(obj);\n" +
			"        });"
		);
	}
	const speedSyncEnd =
		"obj.set('cfsSpeed', speedVal);\n" +
		"          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') {\n" +
		"            syncVideosToTime(currentPlayheadSec);\n" +
		"          }\n" +
		"        });";
	if (out.includes(speedSyncEnd)) {
		out = out.replace(speedSyncEnd,
			"obj.set('cfsSpeed', speedVal);\n" +
			"          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') { syncVideosToTime(currentPlayheadSec); }\n" +
			"          scheduleVideoReprocess(obj);\n" +
			"        });"
		);
	}

	// ── Video Preprocessor: Inject into placeVideoOnCanvas ──
	const videoMetaMarker =
		"getVideoMetadata(src).then(function (meta) {\n" +
		"          if (!group.canvas || !canvas) return;";
	if (out.includes(videoMetaMarker) && !out.includes("CfsVideoPreprocessor")) {
		out = out.replace(videoMetaMarker,
			"/* ── Video Preprocessor: process on add ── */\n" +
			"        if (typeof CfsVideoPreprocessor !== 'undefined' && CfsVideoPreprocessor.processAndPersist) {\n" +
			"          (function (g, lbl) {\n" +
			"            var uUrl = (typeof window !== 'undefined' && window.__CFS_videoUploadUrl) || '';\n" +
			"            var uFields = (typeof window !== 'undefined' && window.__CFS_videoUploadFields) || {};\n" +
			"            var _pCfg = (typeof window !== 'undefined' && window.__CFS_presignedConfig) || null;\n" +
			"            CfsVideoPreprocessor.processAndPersist(src, { width: 0, height: 0, fps: 30 }, uUrl, uFields, function (msg) {\n" +
			"              try { if (lbl) { lbl.set('text', msg); if (canvas) canvas.renderAll(); } } catch (_) {}\n" +
			"            }, _pCfg).then(function (result) {\n" +
			"              if (!g.canvas) return;\n" +
			"              var previewUrl = result.url || result.blobUrl || src;\n" +
			"              if (result.url) g.set('cfsProcessedUrl', result.url);\n" +
			"              /* Start live video preview from the processed MP4 */\n" +
			"              CfsVideoPreprocessor.createLivePreview(g, previewUrl, canvas).then(function () {\n" +
			"                if (typeof saveStateDebounced === 'function') saveStateDebounced();\n" +
			"              });\n" +
			"            }).catch(function () {\n" +
			"              /* Preprocessing failed — try live preview from raw source */\n" +
			"              CfsVideoPreprocessor.createLivePreview(g, src, canvas).catch(function () {});\n" +
			"              try { if (lbl) lbl.set('text', '▶ Video'); if (canvas) canvas.renderAll(); } catch (_) {}\n" +
			"            });\n" +
			"          })(group, label);\n" +
			"        } else {\n" +
			"          /* No preprocessor — try direct live preview */\n" +
			"          if (typeof CfsVideoPreprocessor !== 'undefined' && CfsVideoPreprocessor.createLivePreview) {\n" +
			"            CfsVideoPreprocessor.createLivePreview(group, src, canvas).catch(function () {});\n" +
			"          }\n" +
			"        }\n" +
			"        getVideoMetadata(src).then(function (meta) {\n" +
			"          if (!group.canvas || !canvas) return;"
		);
	}

	// ── Video Preprocessor: Add cleanup on object:removed ──
	const objRemovedMarker =
		"canvas.on('object:removed', function () { refreshLayersPanel(); if (!isInternalCanvasMutation) pushUndo(); });";
	if (out.includes(objRemovedMarker) && !out.includes("destroyPreview")) {
		out = out.replace(objRemovedMarker,
			"canvas.on('object:removed', function (e) {\n" +
			"            refreshLayersPanel();\n" +
			"            if (!isInternalCanvasMutation) pushUndo();\n" +
			"            /* Clean up live video preview */\n" +
			"            var obj = e && e.target;\n" +
			"            if (obj && obj._cfsLiveVideoEl && typeof CfsVideoPreprocessor !== 'undefined') {\n" +
			"              CfsVideoPreprocessor.destroyPreview(obj);\n" +
			"            }\n" +
			"          });"
		);
	}

	// ── Iframe-safe prompt for addVideo ──
	const videoPromptMarker =
		"var promptUrl = window.prompt('Enter video URL, or click Cancel to choose a file.');\n" +
		"      if (promptUrl != null && promptUrl.trim() !== '') {\n" +
		"        videoUrl = promptUrl.trim();\n" +
		"        placeVideoOnCanvas(videoUrl);\n" +
		"      } else {\n" +
		"        input.click();\n" +
		"      }";
	if (out.includes(videoPromptMarker)) {
		out = out.replace(videoPromptMarker,
			"if (typeof showIframePrompt === 'function') {\n" +
			"        showIframePrompt('Enter video URL, or choose a file.', 'video/*', function (result) {\n" +
			"          if (result.url) { videoUrl = result.url; placeVideoOnCanvas(videoUrl); }\n" +
			"          else if (result.file) { videoUrl = URL.createObjectURL(result.file); placeVideoOnCanvas(videoUrl); }\n" +
			"        });\n" +
			"      } else {\n" +
			"        var promptUrl = window.prompt('Enter video URL, or click Cancel to choose a file.');\n" +
			"        if (promptUrl != null && promptUrl.trim() !== '') {\n" +
			"          videoUrl = promptUrl.trim(); placeVideoOnCanvas(videoUrl);\n" +
			"        } else { input.click(); }\n" +
			"      }"
		);
	}

	// ── Iframe-safe prompt for addAudioClip ──
	const audioPromptMarker =
		"var promptUrl = window.prompt('Enter audio URL, or click Cancel to choose a file.');\n" +
		"      if (promptUrl != null && promptUrl.trim() !== '') {\n" +
		"        audioUrl = promptUrl.trim();\n" +
		"        insertAudioClip(audioUrl);\n" +
		"      } else {\n" +
		"        fileInput.click();\n" +
		"      }";
	if (out.includes(audioPromptMarker)) {
		out = out.replace(audioPromptMarker,
			"if (typeof showIframePrompt === 'function') {\n" +
			"        showIframePrompt('Enter audio URL, or choose a file.', 'audio/*', function (result) {\n" +
			"          if (result.url) { audioUrl = result.url; insertAudioClip(audioUrl); }\n" +
			"          else if (result.file) { audioUrl = URL.createObjectURL(result.file); insertAudioClip(audioUrl); }\n" +
			"        });\n" +
			"      } else {\n" +
			"        var promptUrl = window.prompt('Enter audio URL, or click Cancel to choose a file.');\n" +
			"        if (promptUrl != null && promptUrl.trim() !== '') {\n" +
			"          audioUrl = promptUrl.trim(); insertAudioClip(audioUrl);\n" +
			"        } else { fileInput.click(); }\n" +
			"      }"
		);
	}

	// ── Live preview on Replace Video button ──
	const replaceVideoRenderMarker =
		"canvas.renderAll();\n" +
		"                refreshTimeline();\n" +
		"                refreshPropertyPanel();\n" +
		"              });\n" +
		"            }\n" +
		"          };\n" +
		"          fileInput.click();";
	if (out.includes(replaceVideoRenderMarker) && !out.includes("/* Re-trigger live preview after replacing video */")) {
		out = out.replace(replaceVideoRenderMarker,
			"canvas.renderAll();\n" +
			"                refreshTimeline();\n" +
			"                refreshPropertyPanel();\n" +
			"                /* Re-trigger live preview after replacing video */\n" +
			"                if (typeof CfsVideoPreprocessor !== 'undefined' && CfsVideoPreprocessor.createLivePreview) {\n" +
			"                  CfsVideoPreprocessor.createLivePreview(obj, src, canvas).catch(function () {});\n" +
			"                }\n" +
			"              });\n" +
			"            }\n" +
			"          };\n" +
			"          fileInput.click();"
		);
	}

	return out;
}

/**
 * Patch pixi-timeline-player.js for the web app:
 *
 * 1. CORS media proxy fallback — when fetch(url, {mode:'cors'}) fails for an
 *    external audio/video URL, retry through /api/media-proxy?url= which fetches
 *    server-side and returns same-origin data.
 *
 * 2. Same proxy fallback in decodeAudio for renderMixedAudioBuffer.
 */
function patchPixiTimelinePlayer(text) {
	let out = text;

	// ── 1. Add version header ──
	if (!out.startsWith('/* pixi-timeline-player')) {
		out = '/* pixi-timeline-player v2.1 — media-proxy CORS fallback */\n' + out;
	}

	// ── 2. Patch fetchOne to try media proxy before image fallback ──
	const fetchOneCatchMarker =
		"}).catch(function (err) {\n" +
		"        return imageToBlobUrl(url, true).then(function () {\n" +
		"          if (resolved[url]) return;\n" +
		"          return imageToBlobUrl(url, false);\n" +
		"        }).then(function () {\n" +
		"          if (!resolved[url]) {\n" +
		"            console.warn('[CFS] Could not resolve media to blob URL:', url);";
	const fetchOneCatchFix =
		"}).catch(function (err) {\n" +
		"        /* CORS fetch failed — try server-side media proxy */\n" +
		"        var proxyBase = (typeof location !== 'undefined' && location.origin) || '';\n" +
		"        if (proxyBase) {\n" +
		"          var proxyUrl = proxyBase + '/api/media-proxy?url=' + encodeURIComponent(url);\n" +
		"          return fetch(proxyUrl).then(function (proxyRes) {\n" +
		"            if (!proxyRes.ok) throw new Error('Proxy HTTP ' + proxyRes.status);\n" +
		"            return proxyRes.blob();\n" +
		"          }).then(function (blob) {\n" +
		"            if (!blob) return;\n" +
		"            var blobUrl = URL.createObjectURL(blob);\n" +
		"            resolved[url] = blobUrl;\n" +
		"            revokeList.push(blobUrl);\n" +
		"          }).catch(function () {\n" +
		"            /* Proxy also failed — try image canvas fallback */\n" +
		"            return imageToBlobUrl(url, true).then(function () {\n" +
		"              if (resolved[url]) return;\n" +
		"              return imageToBlobUrl(url, false);\n" +
		"            }).then(function () {\n" +
		"              if (!resolved[url]) {\n" +
		"                console.warn('[CFS] Could not resolve media to blob URL:', url);\n" +
		"                if (typeof global.__CFS_onMediaLoadFailed === 'function') global.__CFS_onMediaLoadFailed(url, err);\n" +
		"                if (typeof global.window !== 'undefined' && global.window.__CFS_onMediaLoadFailed) global.window.__CFS_onMediaLoadFailed(url, err);\n" +
		"              }\n" +
		"            });\n" +
		"          });\n" +
		"        }\n" +
		"        return imageToBlobUrl(url, true).then(function () {\n" +
		"          if (resolved[url]) return;\n" +
		"          return imageToBlobUrl(url, false);\n" +
		"        }).then(function () {\n" +
		"          if (!resolved[url]) {\n" +
		"            console.warn('[CFS] Could not resolve media to blob URL:', url);";
	if (out.includes(fetchOneCatchMarker)) {
		out = out.replace(fetchOneCatchMarker, fetchOneCatchFix);
	} else {
		console.warn("[sync-extension-assets] pixi-timeline-player.js fetchOne catch marker not found — skipping CORS proxy patch");
	}

	// ── 3. Patch decodeAudio to try media proxy when fetch fails ──
	const decodeAudioMarker =
		"function decodeAudio(offlineCtx, src) {\n" +
		"    return fetch(src).then(function (res) {";
	const decodeAudioFix =
		"function decodeAudio(offlineCtx, src) {\n" +
		"    var proxyBase = (typeof location !== 'undefined' && location.origin) || '';\n" +
		"    return fetch(src).catch(function () {\n" +
		"      /* CORS fetch failed — try media proxy */\n" +
		"      if (proxyBase && !src.startsWith('blob:') && !src.startsWith('data:')) {\n" +
		"        return fetch(proxyBase + '/api/media-proxy?url=' + encodeURIComponent(src));\n" +
		"      }\n" +
		"      return Promise.reject(new Error('CORS blocked'));\n" +
		"    }).then(function (res) {";
	if (out.includes(decodeAudioMarker)) {
		out = out.replace(decodeAudioMarker, decodeAudioFix);
	} else {
		console.warn("[sync-extension-assets] pixi-timeline-player.js decodeAudio marker not found — skipping");
	}

	// ── 4. Route ALL video formats through canvas intermediary (not just WebM) ──
	// Chrome's glCopySubTextureCHROMIUM fails for .mov (QuickTime) and other
	// container formats when used directly as WebGL texture sources.  By routing
	// every video through a 2D <canvas>, we avoid the texture-upload error.
	const webmOnlyMarker =
		"var isWebm = (src || '').toLowerCase().indexOf('.webm') !== -1 ||\n" +
		"                     ((asset._originalFormat || '').toLowerCase() === 'webm');\n" +
		"        if (isWebm) {";
	const allVideoFix =
		"var isWebm = (src || '').toLowerCase().indexOf('.webm') !== -1 ||\n" +
		"                     ((asset._originalFormat || '').toLowerCase() === 'webm');\n" +
		"        /* Route ALL video through canvas intermediary to avoid glCopySubTextureCHROMIUM errors */\n" +
		"        if (true) {";
	if (out.includes(webmOnlyMarker)) {
		out = out.replace(webmOnlyMarker, allVideoFix);
	} else {
		console.warn("[sync-extension-assets] pixi-timeline-player.js WebM-only canvas guard not found — skipping video canvas patch");
	}

	// ── 5. Use correct alphaMode for canvas texture (vidAlphaMode, not hardcoded) ──
	const hardcodedAlpha = "var canvasTex = PIXI.Texture.from(alphaCanvas, { alphaMode: 'premultiply-alpha-on-upload' });";
	const dynamicAlpha  = "var canvasTex = PIXI.Texture.from(alphaCanvas, { alphaMode: vidAlphaMode });";
	if (out.includes(hardcodedAlpha)) {
		out = out.replace(hardcodedAlpha, dynamicAlpha);
	} else {
		console.warn("[sync-extension-assets] pixi-timeline-player.js hardcoded alphaMode not found — skipping");
	}

	// ── 6. Add startVideoPlayback() for smooth native video playback ──
	// Instead of seeking every frame (jerky), start videos playing natively
	// and only correct drift when it exceeds 0.15s.
	const getDurationMarker = "PixiShotstackPlayer.prototype.getDuration = function () {\n    return this._duration;\n  };";
	const startVideoPlaybackInjection =
		"PixiShotstackPlayer.prototype.getDuration = function () {\n    return this._duration;\n  };\n\n" +
		"  PixiShotstackPlayer.prototype.startVideoPlayback = function (timelineStart) {\n" +
		"    this._clipDisplays.forEach(function (disp, i) {\n" +
		"      if (!disp._videoEl) return;\n" +
		"      var meta = disp.cfsClipMeta || {};\n" +
		"      var clip = meta.clip || {};\n" +
		"      var videoAsset = clip.asset || {};\n" +
		"      var start = meta.start || 0;\n" +
		"      var trimOffset = videoAsset.trim != null ? Math.max(0, Number(videoAsset.trim)) : (clip.trim != null ? Math.max(0, Number(clip.trim)) : 0);\n" +
		"      var speed = videoAsset.speed != null ? Math.max(0.1, Number(videoAsset.speed)) : 1;\n" +
		"      var rel = Math.max(0, (timelineStart || 0) - start);\n" +
		"      disp._videoEl.currentTime = trimOffset + rel * speed;\n" +
		"      disp._videoEl.playbackRate = speed;\n" +
		"      disp._videoEl.muted = true;\n" +
		"      disp._cfsNativePlayback = true;\n" +
		"      try { disp._videoEl.play().catch(function(){}); } catch(_){}\n" +
		"    }.bind(this));\n" +
		"  };";
	if (out.includes(getDurationMarker) && !out.includes("startVideoPlayback")) {
		out = out.replace(getDurationMarker, startVideoPlaybackInjection);
	} else if (!out.includes("startVideoPlayback")) {
		console.warn("[sync-extension-assets] pixi-timeline-player.js getDuration marker not found — skipping startVideoPlayback patch");
	}

	// ── 7. Patch seek() to skip manual currentTime when video is playing natively ──
	const seekCurrentTimeMarker =
		"disp._videoEl.currentTime = Math.max(0, Math.min(trimOffset + rel * speed, dur));\n" +
		"        if (disp._videoEl.playbackRate !== speed) disp._videoEl.playbackRate = speed;";
	const seekCurrentTimeFix =
		"var targetTime = Math.max(0, Math.min(trimOffset + rel * speed, dur));\n" +
		"        if (disp._videoEl.playbackRate !== speed) disp._videoEl.playbackRate = speed;\n" +
		"        if (disp._cfsNativePlayback) {\n" +
		"          var drift = Math.abs(disp._videoEl.currentTime - targetTime);\n" +
		"          if (drift > 0.15) { disp._videoEl.currentTime = targetTime; }\n" +
		"        } else {\n" +
		"          disp._videoEl.currentTime = targetTime;\n" +
		"        }";
	if (out.includes(seekCurrentTimeMarker)) {
		out = out.replace(seekCurrentTimeMarker, seekCurrentTimeFix);
	} else if (!out.includes("_cfsNativePlayback")) {
		console.warn("[sync-extension-assets] pixi-timeline-player.js seek currentTime marker not found — skipping native playback patch");
	}

	return out;
}

/**
 * Widen kokoro.web.js's `env` proxy so we can mutate ORT settings beyond
 * `wasmPaths`. Ships with ONLY `wasmPaths` exposed:
 *   const Mf={set wasmPaths(e){Wg.backends.onnx.wasm.wasmPaths=e}, get wasmPaths(){…}};
 *
 * We need `numThreads` (so we can force single-threaded ORT and avoid the
 * silent module-Worker pthread-spawn hang under COEP credentialless) and
 * `proxy` (so we can disable the auto-spawned proxy worker for the same
 * reason). We also expose `backends` as a passthrough for advanced consumers.
 *
 * Returns a Buffer with the patch applied (or the original if the marker
 * isn't found, e.g. kokoro version drift).
 */
function patchKokoroEnvProxy(buf) {
	const text = buf.toString("utf8");
	const marker =
		"const Mf={set wasmPaths(e){Wg.backends.onnx.wasm.wasmPaths=e},get wasmPaths(){return Wg.backends.onnx.wasm.wasmPaths}};";
	if (!text.includes(marker)) {
		console.warn(
			"[sync-extension-assets] kokoro env proxy marker not found — skipping numThreads patch (kokoro upstream may have changed)",
		);
		return buf;
	}
	const widened =
		"const Mf={" +
		"set wasmPaths(e){Wg.backends.onnx.wasm.wasmPaths=e}," +
		"get wasmPaths(){return Wg.backends.onnx.wasm.wasmPaths}," +
		"set numThreads(e){Wg.backends.onnx.wasm.numThreads=e}," +
		"get numThreads(){return Wg.backends.onnx.wasm.numThreads}," +
		"set proxy(e){Wg.backends.onnx.wasm.proxy=e}," +
		"get proxy(){return Wg.backends.onnx.wasm.proxy}," +
		"get backends(){return Wg.backends}" +
		"};";
	return Buffer.from(text.replace(marker, widened), "utf8");
}

async function run() {
	let count = 0;
	for (const rel of ASSET_PATHS) {
		const outRel = `public/${rel}`;
		const dest = join(ROOT, outRel);
		let body = await fetchOrRead(rel);
		if (typeof body === "string") {
			body = Buffer.from(body, "utf8");
		}
		// Binary files (.wasm) must NOT be converted to UTF-8 text — that
		// corrupts bytes that aren't valid UTF-8 sequences (shrinks the file
		// and produces a WASM CompileError at runtime).
		if (rel.endsWith(".wasm")) {
			await writeBuffer(dest, body);
			count++;
			continue;
		}
		let text = body.toString("utf8");
		if (patchFfmpegLocal(rel, outRel)) {
			text = patchFfmpegLocalDiagnostics(text);
			if (!text.includes("location.origin + '/lib/ffmpeg/ffmpeg-core.js'")) {
				text = text.replace(
					`  function coreURL() {\n    return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.js');\n  }`,
					`  function coreURL() {\n    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {\n      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.js');\n    }\n    if (typeof location !== 'undefined' && location.origin) {\n      return location.origin + '/lib/ffmpeg/ffmpeg-core.js';\n    }\n    return '/lib/ffmpeg/ffmpeg-core.js';\n  }`,
				);
				text = text.replace(
					`  function wasmURL() {\n    return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.wasm');\n  }`,
					`  function wasmURL() {\n    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {\n      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.wasm');\n    }\n    if (typeof location !== 'undefined' && location.origin) {\n      return location.origin + '/lib/ffmpeg/ffmpeg-core.wasm';\n    }\n    return '/lib/ffmpeg/ffmpeg-core.wasm';\n  }`,
				);
			}
		}
		if (rel === "generator/template-engine.js") {
			text = patchTemplateEngine(text);
		}
		if (rel === "generator/core/pixi-timeline-player.js") {
			text = patchPixiTimelinePlayer(text);
		}
		if (rel === "generator/editor/fabric-to-timeline.js") {
			text = patchFabricToTimeline(text);
		}
		if (rel === "generator/editor/unified-editor.js") {
			text = patchUnifiedEditor(text);
		}
		await writeBuffer(dest, text);
		count++;
	}
	for (const { out, url } of NPM_VENDOR) {
		const dest = join(ROOT, out);
		const res = await fetch(url, { headers: { Accept: "*/*" } });
		if (!res.ok) {
			throw new Error(`Failed ${url}: ${res.status} ${res.statusText}`);
		}
		const buf = Buffer.from(await res.arrayBuffer());
		let body = buf;
		if (out === "public/lib/kokoro/kokoro.web.js") {
			body = patchKokoroEnvProxy(buf);
		}
		await writeBuffer(dest, body);
		count++;
	}
	const versionFile = join(PUBLIC, "generator", ".extension-assets-version");
	await writeFile(versionFile, `${REPO}@${REF}\nFiles: ${count}\n${new Date().toISOString()}\n`);
	// eslint-disable-next-line no-console
	console.log(`[sync-extension-assets] Wrote ${count} files to public/ (ref ${REF})`);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
