"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRenderButton } from "./browser-render-button";
import type { ShotstackEditorContext } from "./shotstack-editor-context";
import { SHOTSTACK_EDITOR_SCRIPT_HREFS, SHOTSTACK_EDITOR_STYLES } from "./shotstack-editor-load-order";

/* eslint-disable @typescript-eslint/no-explicit-any */

type EditEvents = {
	on: (name: string, fn: (data?: unknown) => void) => (() => void) | void;
	off?: (name: string, fn: (data?: unknown) => void) => void;
};

type FabricLikeCanvas = {
	toDataURL?: (options: { format?: string; quality?: number; multiplier?: number }) => string;
};

type UnifiedEditorInstance = {
	getShotstackTemplate?: () => Record<string, unknown>;
	hasPendingChanges?: () => boolean;
	markSaved?: () => void;
	getCanvas?: () => FabricLikeCanvas | null;
	events?: EditEvents;
	destroy?: () => void;
};

declare global {
	interface Window {
		__CFS_unifiedEditor?: {
			create: (
				container: HTMLElement,
				options: { template?: unknown; extension?: unknown; values?: unknown },
			) => UnifiedEditorInstance;
		};
		__CFS_generationStorage?: { getProjectFolderHandle?: () => null };
		__CFS_generatorProjectId?: string;
		__CFS_stepGeneratorUIs?: Record<string, unknown>;
	}
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

function loadStyleOnce(href: string) {
	if (document.querySelector(`link[data-cfs-href="${href}"]`)) return;
	const l = document.createElement("link");
	l.rel = "stylesheet";
	l.href = href;
	l.dataset.cfsHref = href;
	document.head.append(l);
}

function buildUrl(base: string, path: string, query: string): string {
	const url = `${base}${path}`;
	if (!query) return url;
	return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

const AUTOSAVE_INTERVAL_MS = 15_000;
const THUMBNAIL_MULTIPLIER = 0.25; // ~480x270 for a 1920x1080 Fabric canvas

function dataUrlToBlob(dataUrl: string): Blob | null {
	const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
	if (!m) return null;
	const [, mime, b64] = m;
	const bin = atob(b64);
	const len = bin.length;
	const buf = new Uint8Array(len);
	for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
	return new Blob([buf], { type: mime });
}

export function ShotstackEditorHost({
	templateId,
	templateName,
	isBuiltin,
	initialEdit,
	context,
}: {
	templateId: string;
	templateName: string;
	isBuiltin: boolean;
	initialEdit: Record<string, unknown>;
	context: ShotstackEditorContext;
}) {
	const router = useRouter();
	const mountRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<UnifiedEditorInstance | null>(null);
	const savingRef = useRef(false);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [message, setMessage] = useState<string | null>(null);
	const [saveState, setSaveState] = useState<string | null>(null);
	const [isDirty, setIsDirty] = useState(false);

	const applyStubs = useCallback(() => {
		window.__CFS_generationStorage = {
			getProjectFolderHandle: () => null,
		};
		window.__CFS_generatorProjectId = "";
		window.__CFS_stepGeneratorUIs = window.__CFS_stepGeneratorUIs || {};
	}, []);

	const bootEditor = useCallback(() => {
		const el = mountRef.current;
		if (!el || !window.__CFS_unifiedEditor) {
			setStatus("error");
			setMessage("Unified editor not available.");
			return;
		}
		el.innerHTML = "";
		const inst = window.__CFS_unifiedEditor.create(el, { template: initialEdit, extension: {} });
		editorRef.current = inst;
		setStatus("ready");
	}, [initialEdit]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				for (const href of SHOTSTACK_EDITOR_STYLES) loadStyleOnce(href);
				applyStubs();
				for (const src of SHOTSTACK_EDITOR_SCRIPT_HREFS) {
					if (cancelled) return;
					await loadScriptOnce(src);
				}
				if (cancelled) return;
				applyStubs();
				bootEditor();
			} catch (e) {
				if (!cancelled) {
					setStatus("error");
					setMessage(e instanceof Error ? e.message : "Load failed");
				}
			}
		})();
		return () => {
			cancelled = true;
			const inst = editorRef.current;
			editorRef.current = null;
			try {
				inst?.destroy?.();
			} catch {
				// unified-editor.destroy is best-effort; tolerate missing impl
			}
		};
	}, [applyStubs, bootEditor]);

	const persistEdit = useCallback(
		async (edit: Record<string, unknown>): Promise<string | null> => {
			if (isBuiltin) {
				const cloneRes = await fetch(
					buildUrl(context.templatesApiBase, `/${templateId}/clone`, context.templatesApiQuery),
					{ method: "POST", credentials: "include" },
				);
				if (!cloneRes.ok) {
					const j = (await cloneRes.json().catch(() => ({}))) as { error?: string };
					throw new Error(j.error ?? `Clone failed (${cloneRes.status})`);
				}
				const cloned = (await cloneRes.json()) as { id?: string; name?: string };
				if (!cloned.id) throw new Error("Clone returned no id");
				const patchRes = await fetch(
					buildUrl(context.templatesApiBase, `/${cloned.id}`, context.templatesApiQuery),
					{
						method: "PATCH",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ edit, name: cloned.name ?? templateName }),
					},
				);
				if (!patchRes.ok) {
					const j = (await patchRes.json().catch(() => ({}))) as { error?: string };
					throw new Error(j.error ?? `Save failed (${patchRes.status})`);
				}
				return cloned.id;
			}

			const patchRes = await fetch(
				buildUrl(context.templatesApiBase, `/${templateId}`, context.templatesApiQuery),
				{
					method: "PATCH",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ edit, name: templateName }),
				},
			);
			if (!patchRes.ok) {
				const j = (await patchRes.json().catch(() => ({}))) as { error?: string };
				throw new Error(j.error ?? `Save failed (${patchRes.status})`);
			}
			return templateId;
		},
		[context, isBuiltin, templateId, templateName],
	);

	const captureThumbnail = useCallback(
		async (savedId: string): Promise<void> => {
			if (!context.thumbnailUploadUrl) return;
			const inst = editorRef.current;
			const canvas = inst?.getCanvas?.();
			if (!canvas?.toDataURL) return;
			let dataUrl: string;
			try {
				dataUrl = canvas.toDataURL({ format: "png", quality: 0.92, multiplier: THUMBNAIL_MULTIPLIER });
			} catch {
				return; // tainted canvas (cross-origin image), can't capture
			}
			const blob = dataUrlToBlob(dataUrl);
			if (!blob) return;
			const fd = new FormData();
			for (const [k, v] of Object.entries(context.browserRenderFields)) fd.append(k, v);
			fd.append("file", blob, `thumbnail-${savedId}.png`);
			const url = context.thumbnailUploadUrl.replace(":id", savedId);
			try {
				await fetch(url, { method: "PUT", body: fd, credentials: "include" });
			} catch {
				// Best-effort: thumbnail failures never block a save.
			}
		},
		[context],
	);

	const save = useCallback(
		async (opts: { silent?: boolean } = {}): Promise<void> => {
			const inst = editorRef.current;
			if (!inst?.getShotstackTemplate) {
				if (!opts.silent) setSaveState("Editor not ready.");
				return;
			}
			if (savingRef.current) return;
			savingRef.current = true;
			if (!opts.silent) setSaveState("Saving…");
			try {
				const edit = inst.getShotstackTemplate();
				const savedId = await persistEdit(edit);
				inst.markSaved?.();
				setIsDirty(false);
				if (!opts.silent) setSaveState("Saved.");
				if (savedId) void captureThumbnail(savedId);
				if (savedId && savedId !== templateId) {
					const target = `${context.editorUrlPrefix}/${savedId}${
						context.templatesApiQuery ? `?${context.templatesApiQuery}` : ""
					}`;
					router.replace(target);
				}
			} catch (e) {
				setSaveState(e instanceof Error ? e.message : "Save failed");
			} finally {
				savingRef.current = false;
			}
		},
		[captureThumbnail, context, persistEdit, router, templateId],
	);

	useEffect(() => {
		if (status !== "ready") return;
		const inst = editorRef.current;
		if (!inst?.events?.on) return;
		let offEdit: (() => void) | void;
		try {
			offEdit = inst.events.on("edit:changed", () => {
				setIsDirty(true);
			});
		} catch {
			// ignore — events.on is optional
		}
		let interval: number | null = null;
		if (!isBuiltin) {
			interval = window.setInterval(() => {
				const cur = editorRef.current;
				if (!cur?.hasPendingChanges?.()) return;
				if (savingRef.current) return;
				void save({ silent: true });
			}, AUTOSAVE_INTERVAL_MS);
		}
		return () => {
			if (interval !== null) window.clearInterval(interval);
			try {
				if (typeof offEdit === "function") offEdit();
			} catch {
				// tolerate editor event bus implementations without dispose
			}
		};
	}, [isBuiltin, save, status]);

	useEffect(() => {
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			const cur = editorRef.current;
			if (cur?.hasPendingChanges?.()) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, []);

	const saveLabel = isBuiltin ? "Save as copy" : isDirty ? "Save*" : "Save";

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<Link href={context.backUrl} className="text-3 text-gray-12 underline">
					← Back to templates
				</Link>
				<button
					type="button"
					onClick={() => void save()}
					className="text-3 px-4 py-2 rounded-md bg-gray-12 text-gray-1"
					disabled={status !== "ready"}
				>
					{saveLabel}
				</button>
				<BrowserRenderButton
					templateId={templateId}
					templateName={templateName}
					variant="toolbar"
					getTemplateJson={() => editorRef.current?.getShotstackTemplate?.() ?? null}
					disabled={status !== "ready"}
					context={context}
				/>
				{!isBuiltin && isDirty ? <span className="text-2 text-gray-10">Unsaved changes</span> : null}
			</div>
			{saveState ? <p className="text-3 text-gray-11">{saveState}</p> : null}
			{status === "loading" ? <p className="text-3 text-gray-10">Loading editor…</p> : null}
			{status === "error" ? <p className="text-3 text-red-11">{message}</p> : null}
			<div
				ref={mountRef}
				className="min-h-[480px] border border-gray-a4 rounded-lg bg-gray-a1 overflow-auto cfs-unified-editor-host"
			/>
		</div>
	);
}
