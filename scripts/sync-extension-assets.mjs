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
