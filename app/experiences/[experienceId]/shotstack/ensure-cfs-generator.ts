import { SHOTSTACK_EDITOR_SCRIPT_GROUPS, SHOTSTACK_EDITOR_STYLES } from "./shotstack-editor-load-order";

let loadPromise: Promise<void> | null = null;

function loadStyleOnce(href: string) {
	if (document.querySelector(`link[data-cfs-href="${href}"]`)) return;
	const l = document.createElement("link");
	l.rel = "stylesheet";
	l.href = href;
	l.dataset.cfsHref = href;
	document.head.append(l);
}

function loadScriptOnce(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`script[data-cfs-src="${src}"]`)) {
			resolve();
			return;
		}
		const s = document.createElement("script");
		s.src = src;
		s.async = false;
		s.dataset.cfsSrc = src;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.body.append(s);
	});
}

/**
 * Generate a silent WAV blob of the requested duration. Used as a stub for the
 * vendored TTS generator so that the Chrome-extension-only Kokoro / tabCapture
 * paths never get hit in a web context.
 */
function buildSilentWavBlob(durationSec: number): Blob {
	const duration = Math.max(0.5, durationSec || 1);
	const sampleRate = 44100;
	const length = Math.ceil(duration * sampleRate);
	const buffer = new ArrayBuffer(44 + length * 2);
	const view = new DataView(buffer);
	const writeStr = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, "data");
	view.setUint32(40, length * 2, true);
	return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Apply web-context stubs / globals BEFORE the vendored generator scripts
 * load. `default-tts.js` bails out early on line 20 if `__CFS_ttsGenerate` is
 * already defined, so seeding it here skips the Kokoro / tabCapture retries
 * that otherwise spam the console for every voice clip.
 */
function applyStubs() {
	const w = window as Window & {
		__CFS_generationStorage?: unknown;
		__CFS_generatorProjectId?: string;
		__CFS_stepGeneratorUIs?: Record<string, unknown>;
		__CFS_ttsGenerate?: unknown;
	};
	w.__CFS_generationStorage = { getProjectFolderHandle: () => null };
	w.__CFS_generatorProjectId = "";
	w.__CFS_stepGeneratorUIs = w.__CFS_stepGeneratorUIs || {};
	if (typeof w.__CFS_ttsGenerate !== "function") {
		w.__CFS_ttsGenerate = async (_text: unknown, opts?: { durationSec?: number }) => {
			const durationSec = typeof opts?.durationSec === "number" ? opts.durationSec : 1;
			/* `template-engine.js` expects a Blob (see tts chunk handler), not a wrapper */
			return buildSilentWavBlob(durationSec);
		};
	}
}

/**
 * Runs after each vendored script loads. Handles fixups that can only happen
 * after the vendored module has overwritten a global.
 */
function afterScriptLoaded(src: string) {
	if (src === "/generator/editor/extensions/loader.js") {
		// The vendored loader tries to load generator/extensions/tts.js and
		// stt.js from a base URL derived from the page location — which yields
		// 404s on our Next.js routes. Those extensions are Chrome-extension
		// only anyway. Replace the loader with a no-op so the unified editor
		// skips them cleanly.
		(window as unknown as { __CFS_editorExtensionsLoader?: unknown }).__CFS_editorExtensionsLoader = {
			loadExtensions: (_api: unknown, _config: unknown, cb?: (err: Error | null) => void) => {
				if (typeof cb === "function") cb(null);
			},
			loadExtensionScript: () => {},
		};
	}
}

/**
 * Loads the same script/CSS chain as the visual editor; safe to call multiple
 * times. The in-browser render button reuses this to boot the template engine
 * without mounting the editor UI.
 */
export function ensureCfsGeneratorLoaded(): Promise<void> {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		for (const href of SHOTSTACK_EDITOR_STYLES) {
			loadStyleOnce(href);
		}
		applyStubs();
		for (const group of SHOTSTACK_EDITOR_SCRIPT_GROUPS) {
			await Promise.all(
				group.map((src) =>
					loadScriptOnce(src).then(() => {
						afterScriptLoaded(src);
					}),
				),
			);
		}
		applyStubs();
		const w = window as Window & {
			__CFS_templateEngine?: { renderTimelineToVideoBlob?: (t: unknown) => Promise<Blob | null> };
		};
		if (!w.__CFS_templateEngine?.renderTimelineToVideoBlob) {
			throw new Error("Template engine did not load");
		}
	})();
	return loadPromise;
}

export { applyStubs as applyCfsGeneratorStubs, afterScriptLoaded as afterCfsScriptLoaded };
