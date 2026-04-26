import { SHOTSTACK_EDITOR_SCRIPT_HREFS, SHOTSTACK_EDITOR_STYLES } from "./shotstack-editor-load-order";

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

function applyStubs() {
	const w = window as Window & { __CFS_generationStorage?: unknown; __CFS_generatorProjectId?: string; __CFS_stepGeneratorUIs?: Record<string, unknown> };
	w.__CFS_generationStorage = { getProjectFolderHandle: () => null };
	w.__CFS_generatorProjectId = "";
	w.__CFS_stepGeneratorUIs = w.__CFS_stepGeneratorUIs || {};
}

/**
 * Loads the same script/CSS chain as the visual editor; safe to call multiple times.
 */
export function ensureCfsGeneratorLoaded(): Promise<void> {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		for (const href of SHOTSTACK_EDITOR_STYLES) {
			loadStyleOnce(href);
		}
		applyStubs();
		for (const src of SHOTSTACK_EDITOR_SCRIPT_HREFS) {
			await loadScriptOnce(src);
		}
		applyStubs();
		const w = window as Window & { __CFS_templateEngine?: { renderTimelineToVideoBlob?: (t: unknown) => Promise<Blob | null> } };
		if (!w.__CFS_templateEngine?.renderTimelineToVideoBlob) {
			throw new Error("Template engine did not load");
		}
	})();
	return loadPromise;
}
