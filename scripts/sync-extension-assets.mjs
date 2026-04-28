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
 */
const NPM_VENDOR = [
	{
		out: "public/lib/kokoro/kokoro.web.js",
		url: "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js",
	},
	{
		out: "public/lib/transformers/transformers.min.js",
		url: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js",
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.jsep.wasm",
		url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20241016-2b8fc5529b/dist/ort-wasm-simd-threaded.jsep.wasm",
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.wasm",
		url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20241016-2b8fc5529b/dist/ort-wasm-simd-threaded.wasm",
	},
	// ONNX Runtime Web 1.20+ split the JSEP (JavaScript Execution Provider)
	// glue out into ESM `.mjs` loaders that get *dynamically imported* alongside
	// the .wasm files. Without these the worker (and main-thread fallback)
	// dies with: "no available backend found. ERR: [wasm] TypeError: Failed to
	// fetch dynamically imported module: /lib/transformers/ort-wasm-simd-threaded.jsep.mjs".
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.jsep.mjs",
		url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20241016-2b8fc5529b/dist/ort-wasm-simd-threaded.jsep.mjs",
	},
	{
		out: "public/lib/transformers/ort-wasm-simd-threaded.mjs",
		url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20241016-2b8fc5529b/dist/ort-wasm-simd-threaded.mjs",
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
		let text = body.toString("utf8");
		if (patchFfmpegLocal(rel, outRel)) {
			if (!text.includes("location.origin + '/lib/ffmpeg/ffmpeg-core.js'")) {
				text = text.replace(
					`  function coreURL() {
    return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.js');
  }`,
					`  function coreURL() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.js');
    }
    if (typeof location !== 'undefined' && location.origin) {
      return location.origin + '/lib/ffmpeg/ffmpeg-core.js';
    }
    return '/lib/ffmpeg/ffmpeg-core.js';
  }`,
				);
				text = text.replace(
					`  function wasmURL() {
    return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.wasm');
  }`,
					`  function wasmURL() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.wasm');
    }
    if (typeof location !== 'undefined' && location.origin) {
      return location.origin + '/lib/ffmpeg/ffmpeg-core.wasm';
    }
    return '/lib/ffmpeg/ffmpeg-core.wasm';
  }`,
				);
			}
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
