"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { MediaEditorContext } from "../../media-editor-context";
import type { ShotstackEdit, ORProject } from "@/lib/template-converter";
import { shotstackToOpenReel, openReelToShotstack } from "@/lib/template-converter";
import { ensureAllServicesLoaded, generateTTS } from "@/lib/openreel-service-bridge";
import { exportAndUpload, type ExportProgress } from "@/lib/openreel-export-bridge";
import { useShotstackMetadataStore } from "@/packages/openreel-ui/stores/shotstack-metadata-store";

interface Props {
	templateId: string;
	templateName: string;
	isBuiltin: boolean;
	initialEdit: Record<string, unknown>;
	context: MediaEditorContext;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Wrapper that loads the OpenReel editor in a client-side boundary. All
 * browser-only APIs (WebCodecs, WebGPU, WASM, IndexedDB) are dynamically
 * imported so SSR doesn't choke.
 */
export function OpenReelEditorHost({ templateId, templateName, isBuiltin, initialEdit, context }: Props) {
	const [editorReady, setEditorReady] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const projectRef = useRef<ORProject | null>(null);
	const storesLoadedRef = useRef(false);

	const initializeEditor = useCallback(async () => {
		try {
			const orProject = shotstackToOpenReel(initialEdit as ShotstackEdit, {
				projectName: templateName,
				projectId: templateId,
			});

			// Fetch remote media (TTS audio, video, images) into blobs so
			// the OpenReel engines can actually decode and play them.
			const itemsToFetch = orProject.mediaLibrary.items.filter(
				(item) => item.originalUrl && !item.blob,
			);
			if (itemsToFetch.length > 0) {
				const results = await Promise.allSettled(
					itemsToFetch.map(async (item) => {
						const res = await fetch(item.originalUrl!);
						if (!res.ok) throw new Error(`${res.status} fetching ${item.originalUrl}`);
						return { id: item.id, blob: await res.blob() };
					}),
				);
				for (const result of results) {
					if (result.status !== "fulfilled") continue;
					const { id, blob } = result.value;
					const idx = orProject.mediaLibrary.items.findIndex((m) => m.id === id);
					if (idx !== -1) {
						(orProject.mediaLibrary.items as Array<typeof orProject.mediaLibrary.items[number]>)[idx] = {
							...orProject.mediaLibrary.items[idx],
							blob,
							isPlaceholder: false,
						};
					}
				}
			}

			// Generate TTS for clips that have text config but no audio URL.
			// Raw clip data preserves the original ShotStack asset fields.
			const rawClips = orProject._shotstack?.rawClipData ?? {};
			await ensureAllServicesLoaded();
			for (const [clipId, raw] of Object.entries(rawClips)) {
				const origAsset = (raw as Record<string, unknown>).originalAsset as Record<string, unknown> | undefined;
				if (!origAsset || String(origAsset.type).toLowerCase() !== "text-to-speech") continue;
				if (origAsset.src) continue; // already has audio URL (handled above)

				const ttsText = String(origAsset.text || "");
				if (!ttsText) continue;

				// Find the clip's mediaId so we can attach the generated blob
				const clip = orProject.timeline.tracks
					.flatMap((t) => t.clips)
					.find((c) => c.id === clipId);
				if (!clip) continue;

				const idx = orProject.mediaLibrary.items.findIndex((m) => m.id === clip.mediaId);
				if (idx === -1) continue;

				try {
					const voice = String(origAsset.voice || origAsset.localVoice || "");
					const result = await generateTTS(ttsText, voice ? { voiceId: voice } : undefined);
					(orProject.mediaLibrary.items as Array<typeof orProject.mediaLibrary.items[number]>)[idx] = {
						...orProject.mediaLibrary.items[idx],
						blob: result.blob,
						isPlaceholder: false,
						metadata: {
							...orProject.mediaLibrary.items[idx].metadata,
							duration: result.duration,
						},
					};
					// Also update the clip's duration/outPoint to match
					// the actual generated audio length so the timeline
					// doesn't show a 3-minute bar for a 10-second TTS clip.
					const actualDuration = result.duration;
					if (actualDuration > 0) {
						const clipRef = orProject.timeline.tracks
							.flatMap((t) => t.clips)
							.find((c) => c.id === clipId);
						if (clipRef) {
							(clipRef as { duration: number; outPoint: number }).duration = actualDuration;
							(clipRef as { duration: number; outPoint: number }).outPoint = clipRef.inPoint + actualDuration;
						}
					}
				} catch (err) {
					console.warn(`[OpenReelEditorHost] TTS generation failed for clip ${clipId}:`, err);
				}
			}

			projectRef.current = orProject;

			// Stash _shotstack metadata in the dedicated Zustand store
			if (orProject._shotstack) {
				useShotstackMetadataStore.getState().setMetadata(orProject._shotstack);
			}

			// Process SVGs
			const svgClips: any[] = [];
			if (orProject._shotstack?.svgClipData) {
				for (const [clipId, data] of Object.entries(orProject._shotstack.svgClipData)) {
					try {
						let svgContent: string | null = null;
						const svgSrc = data.svgSrc as string | undefined;

						if (!svgSrc) {
							console.warn(`[SVG] Clip ${clipId} has no svgSrc, skipping`);
							continue;
						} else if (svgSrc.trimStart().startsWith("<svg") || svgSrc.trimStart().startsWith("<?xml")) {
							// Inline SVG content — use directly
							svgContent = svgSrc;
						} else if (svgSrc.startsWith("data:")) {
							// Data URI — decode base64/text content
							const commaIdx = svgSrc.indexOf(",");
							if (commaIdx > -1) {
								const payload = svgSrc.slice(commaIdx + 1);
								svgContent = svgSrc.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
							}
						} else if (svgSrc.startsWith("http")) {
							// Remote URL — fetch
							const res = await fetch(svgSrc);
							if (!res.ok) {
								console.warn(`[SVG] Failed to fetch ${svgSrc}: ${res.status}`);
								continue;
							}
							svgContent = await res.text();
						} else {
							console.warn(`[SVG] Unsupported SVG source for clip ${clipId}: ${svgSrc.slice(0, 80)}`);
							continue;
						}

						if (!svgContent) continue;

						// Parse viewBox from SVG content
						let viewBox = { minX: 0, minY: 0, width: 100, height: 100 };
						const vbMatch = svgContent.match(/viewBox=["']([^"']+)["']/i);
						if (vbMatch) {
							const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
							if (parts.length >= 4 && parts.every(Number.isFinite)) {
								viewBox = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
							}
						}

						svgClips.push({
							id: clipId,
							type: "svg",
							trackId: data.trackId || `track-graphics`,
							startTime: data.startTime,
							duration: data.duration,
							svgContent,
							viewBox,
							preserveAspectRatio: "xMidYMid",
							colorStyle: { colorMode: "none" },
							transform: {
								position: data.position,
								scale: { x: data.scale, y: data.scale },
								rotation: 0,
								anchor: { x: 0.5, y: 0.5 },
								opacity: data.opacity,
							},
							keyframes: [],
						});
					} catch (e) {
						console.error(`Failed to load SVG ${data.svgSrc}`, e);
					}
				}
			}
			if (svgClips.length > 0) {
				(orProject as any).svgClips = svgClips;
			}

			// Process Texts
			const textClips: any[] = [];
			if (orProject._shotstack?.textClipData) {
				for (const [clipId, data] of Object.entries(orProject._shotstack.textClipData)) {
					textClips.push({
						id: clipId,
						trackId: data.trackId || `track-text`,
						startTime: data.startTime,
						duration: data.duration,
						text: data.text,
						style: {
							fontFamily: data.fontFamily,
							fontSize: data.fontSize,
							color: data.color,
							fontWeight: "bold",
							textAlign: "center",
						},
						transform: {
							position: data.position,
							scale: { x: data.scale, y: data.scale },
							rotation: 0,
							anchor: { x: 0.5, y: 0.5 },
							opacity: data.opacity,
						},
						keyframes: [],
					});
				}
			}
			if (textClips.length > 0) {
				(orProject as any).textClips = textClips;
			}

			const [{ useProjectStore }] = await Promise.all([
				import("@/packages/openreel-ui/stores/project-store"),
			]);
			const store = useProjectStore.getState();
			store.loadProject(orProject as Parameters<typeof store.loadProject>[0]);
			storesLoadedRef.current = true;
			setEditorReady(true);
		} catch (err) {
			console.error("[OpenReelEditorHost] Failed to initialize:", err);
			setLoadError(err instanceof Error ? err.message : "Unknown init error");
		}
	}, [initialEdit, templateId, templateName]);

	useEffect(() => {
		initializeEditor();
	}, [initializeEditor]);

	const handleSave = useCallback(async () => {
		if (!storesLoadedRef.current) return;
		setSaveState("saving");
		try {
			const { useProjectStore } = await import(
				"@/packages/openreel-ui/stores/project-store"
			);
			const currentProject = useProjectStore.getState().project;

			// Inject current merge field values from the metadata store
			const metadata = useShotstackMetadataStore.getState().getMetadata();
			const projectWithMeta: ORProject = {
				...(currentProject as ORProject),
				_shotstack: {
					...((currentProject as ORProject)._shotstack ?? {}),
					merge: metadata.merge as Array<{ find: string; replace: string }>,
					rawClipData: metadata.rawClipData ?? ((currentProject as ORProject)._shotstack?.rawClipData),
					captionSourceBySubtitleId: (metadata.captionSourceBySubtitleId ?? ((currentProject as ORProject)._shotstack?.captionSourceBySubtitleId)) as ORProject["_shotstack"] extends infer T ? T extends { captionSourceBySubtitleId?: infer C } ? C : never : never,
					background: metadata.background ?? ((currentProject as ORProject)._shotstack?.background),
					fonts: metadata.fonts ?? ((currentProject as ORProject)._shotstack?.fonts),
					soundtrack: metadata.soundtrack ?? ((currentProject as ORProject)._shotstack?.soundtrack),
					outputOverrides: metadata.outputOverrides ?? ((currentProject as ORProject)._shotstack?.outputOverrides),
				},
			};
			const edit = openReelToShotstack(projectWithMeta);

			let targetId = templateId;
			const qs = context.templatesApiQuery ? `?${context.templatesApiQuery}` : "";

			if (isBuiltin) {
				const cloneRes = await fetch(`${context.templatesApiBase}/${templateId}/clone${qs}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: `${templateName} (copy)` }),
				});
				if (!cloneRes.ok) throw new Error(`Clone failed: ${cloneRes.status}`);
				const cloneData = await cloneRes.json();
				targetId = cloneData.id || cloneData.templateId;
				if (targetId && targetId !== templateId) {
					window.location.href = `${context.editorUrlPrefix}/${targetId}`;
					return;
				}
			}

			const saveRes = await fetch(`${context.templatesApiBase}/${targetId}${qs}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ edit }),
			});
			if (!saveRes.ok) throw new Error(`Save failed: ${saveRes.status}`);
			setSaveState("saved");
			setTimeout(() => setSaveState("idle"), 2000);
		} catch (err) {
			console.error("[OpenReelEditorHost] Save failed:", err);
			setSaveState("error");
			setTimeout(() => setSaveState("idle"), 3000);
		}
	}, [templateId, templateName, isBuiltin, context]);

	const handleUploadExport = useCallback(async (blob: Blob, format: string) => {
		try {
			await exportAndUpload({
				exportBlob: blob,
				format,
				templateId,
				context,
				onProgress: setExportProgress,
			});
		} catch (err) {
			setExportProgress({
				phase: err instanceof Error ? err.message : "Upload failed",
				progress: 0,
				complete: false,
				error: err instanceof Error ? err.message : "Upload failed",
			});
		}
	}, [templateId, context]);

	useEffect(() => {
		(window as unknown as Record<string, unknown>).__mediaEditorUploadExport = handleUploadExport;
		return () => { delete (window as unknown as Record<string, unknown>).__mediaEditorUploadExport; };
	}, [handleUploadExport]);

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-[80vh] text-center">
				<div>
					<p className="text-red-11 text-4 font-semibold mb-2">Editor failed to load</p>
					<p className="text-gray-10 text-3">{loadError}</p>
					<button
						type="button"
						onClick={() => { setLoadError(null); initializeEditor(); }}
						className="mt-4 px-4 py-2 rounded-md bg-gray-12 text-gray-1 text-3 hover:opacity-90"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	if (!editorReady) {
		return (
			<div className="flex items-center justify-center h-[80vh]">
				<div className="text-center">
					<div className="w-8 h-8 border-2 border-gray-8 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
					<p className="text-gray-10 text-3">Initializing editor...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="openreel-editor flex flex-col h-[calc(100vh-80px)]">
			<div className="flex items-center justify-between px-3 py-2 border-b border-gray-a4 bg-gray-a1 shrink-0">
				<span className="text-3 text-gray-11 truncate">{templateName}</span>
				<div className="flex items-center gap-2">
					{saveState === "saved" && <span className="text-2 text-green-11">Saved</span>}
					{saveState === "error" && <span className="text-2 text-red-11">Save failed</span>}
					{exportProgress && !exportProgress.complete && !exportProgress.error && (
						<span className="text-2 text-gray-10">{exportProgress.phase}</span>
					)}
					{exportProgress?.complete && (
						<span className="text-2 text-green-11">{exportProgress.phase}</span>
					)}
					{exportProgress?.error && (
						<span className="text-2 text-red-11">{exportProgress.error}</span>
					)}
					<button
						type="button"
						onClick={handleSave}
						disabled={saveState === "saving"}
						className="px-3 py-1.5 rounded-md bg-gray-12 text-gray-1 text-3 hover:opacity-90 disabled:opacity-50"
					>
						{saveState === "saving" ? "Saving..." : isBuiltin ? "Clone & Save" : "Save"}
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-hidden">
				<LazyEditorInterface />
			</div>
		</div>
	);
}

function LazyEditorInterface() {
	const [Editor, setEditor] = useState<React.ComponentType | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		import("@/packages/openreel-ui/editor/EditorInterface")
			.then((mod) => setEditor(() => mod.EditorInterface || mod.default))
			.catch((e) => {
				console.error("[LazyEditorInterface]", e);
				setErr(e instanceof Error ? e.message : "Failed to load editor");
			});
	}, []);

	if (err) return <div className="p-4 text-red-11 text-3">{err}</div>;
	if (!Editor) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="w-6 h-6 border-2 border-gray-8 border-t-transparent rounded-full animate-spin" />
			</div>
		);
	}
	return <Editor />;
}
