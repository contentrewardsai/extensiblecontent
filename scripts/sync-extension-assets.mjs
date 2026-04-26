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
	const versionFile = join(PUBLIC, "generator", ".extension-assets-version");
	await writeFile(versionFile, `${REPO}@${REF}\nFiles: ${count}\n${new Date().toISOString()}\n`);
	// eslint-disable-next-line no-console
	console.log(`[sync-extension-assets] Wrote ${count} files to public/ (ref ${REF})`);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
