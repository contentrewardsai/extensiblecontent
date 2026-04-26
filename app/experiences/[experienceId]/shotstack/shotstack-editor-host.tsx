"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRenderButton } from "./browser-render-button";
import { SHOTSTACK_EDITOR_SCRIPT_HREFS, SHOTSTACK_EDITOR_STYLES } from "./shotstack-editor-load-order";

/* eslint-disable @typescript-eslint/no-explicit-any */

type EditEvents = {
	on: (name: string, fn: (data?: unknown) => void) => (() => void) | void;
	off?: (name: string, fn: (data?: unknown) => void) => void;
};

type UnifiedEditorInstance = {
	getShotstackTemplate?: () => Record<string, unknown>;
	hasPendingChanges?: () => boolean;
	markSaved?: () => void;
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

const AUTOSAVE_INTERVAL_MS = 15_000;

export function ShotstackEditorHost({
	experienceId,
	templateId,
	templateName,
	isBuiltin,
	initialEdit,
}: {
	experienceId: string;
	templateId: string;
	templateName: string;
	isBuiltin: boolean;
	initialEdit: Record<string, unknown>;
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

	// Load CSS + scripts + boot editor
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

	// Persist the supplied edit JSON back to the DB. For built-in templates this does an
	// implicit clone first and navigates to the new template's editor URL. Returns the
	// effective templateId that was saved (might differ from the input on implicit clone).
	const persistEdit = useCallback(
		async (edit: Record<string, unknown>): Promise<string | null> => {
			if (isBuiltin) {
				const cloneRes = await fetch(
					`/api/whop/shotstack-templates/${templateId}/clone?experienceId=${encodeURIComponent(experienceId)}`,
					{ method: "POST", credentials: "include" },
				);
				if (!cloneRes.ok) {
					const j = (await cloneRes.json().catch(() => ({}))) as { error?: string };
					throw new Error(j.error ?? `Clone failed (${cloneRes.status})`);
				}
				const cloned = (await cloneRes.json()) as { id?: string; name?: string };
				if (!cloned.id) throw new Error("Clone returned no id");
				const patchRes = await fetch(
					`/api/whop/shotstack-templates/${cloned.id}?experienceId=${encodeURIComponent(experienceId)}`,
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
				`/api/whop/shotstack-templates/${templateId}?experienceId=${encodeURIComponent(experienceId)}`,
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
		[experienceId, isBuiltin, templateId, templateName],
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
				if (savedId && savedId !== templateId) {
					// Implicit clone: navigate to the editable copy.
					router.replace(`/experiences/${experienceId}/shotstack/editor/${savedId}`);
				}
			} catch (e) {
				setSaveState(e instanceof Error ? e.message : "Save failed");
			} finally {
				savingRef.current = false;
			}
		},
		[experienceId, persistEdit, router, templateId],
	);

	// Subscribe to the editor's edit:changed event to drive the dirty indicator.
	// We also start an autosave interval that fires only when there are pending
	// changes and we're not currently saving. Autosave is disabled for built-ins
	// to avoid accidentally spawning multiple clones per edit burst.
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

	// Warn user if they close/refresh with unsaved edits.
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
				<Link href={`/experiences/${experienceId}/shotstack`} className="text-3 text-gray-12 underline">
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
					experienceId={experienceId}
					templateId={templateId}
					templateName={templateName}
					variant="toolbar"
					getTemplateJson={() => editorRef.current?.getShotstackTemplate?.() ?? null}
					disabled={status !== "ready"}
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
