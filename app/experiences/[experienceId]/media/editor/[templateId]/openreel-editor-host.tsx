"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { MediaEditorContext } from "../../media-editor-context";
import type { ShotstackEdit, ORProject } from "@/lib/template-converter";
import { shotstackToOpenReel, openReelToShotstack } from "@/lib/template-converter";
import { ensureAllServicesLoaded, generateTTS } from "@/lib/openreel-service-bridge";
import { exportAndUpload, uploadMediaBlob, type ExportProgress } from "@/lib/openreel-export-bridge";
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
			const ttsUploadPromises: Array<Promise<void>> = [];
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
						originalUrl: orProject.mediaLibrary.items[idx].originalUrl || undefined,
						isPlaceholder: false,
						metadata: {
							...orProject.mediaLibrary.items[idx].metadata,
							duration: result.duration,
						},
					};
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

					// Upload the TTS blob to persistent storage (GHL / Supabase)
					// so the template doesn't need to regenerate audio on next open.
					const capturedIdx = idx;
					const capturedClipId = clipId;
					ttsUploadPromises.push(
						uploadMediaBlob({
							blob: result.blob,
							filename: `tts_${clipId.slice(0, 8)}.wav`,
							contentType: "audio/wav",
							templateId,
							context,
						}).then((url) => {
							// Persist the URL so round-trip save embeds it as asset.src
							origAsset.src = url;
							const item = orProject.mediaLibrary.items[capturedIdx];
							if (item) {
								(orProject.mediaLibrary.items as Array<typeof orProject.mediaLibrary.items[number]>)[capturedIdx] = {
									...item,
									originalUrl: url,
								};
							}
							console.log(`[OpenReelEditorHost] TTS audio for clip ${capturedClipId} uploaded to ${url}`);
						}).catch((err) => {
							console.warn(`[OpenReelEditorHost] TTS upload failed for clip ${capturedClipId} (audio still works in-session):`, err);
						}),
					);
				} catch (err) {
					console.warn(`[OpenReelEditorHost] TTS generation failed for clip ${clipId}:`, err);
				}
			}

			// Fire uploads in the background — don't block editor load.
			// When uploads finish, patch the live Zustand stores so Save picks up the URLs.
			if (ttsUploadPromises.length > 0) {
				Promise.allSettled(ttsUploadPromises).then(async (results) => {
					const uploaded = results.filter((r) => r.status === "fulfilled").length;
					if (uploaded > 0) {
						console.log(`[OpenReelEditorHost] ${uploaded}/${results.length} TTS audio files persisted to storage`);
						try {
							const { useProjectStore } = await import("@/packages/openreel-ui/stores/project-store");
							const currentProject = useProjectStore.getState().project;
							const updatedItems = currentProject.mediaLibrary.items.map((item) => {
								const orItem = orProject.mediaLibrary.items.find((m) => m.id === item.id);
								if (orItem?.originalUrl && !item.originalUrl) {
									return { ...item, originalUrl: orItem.originalUrl };
								}
								return item;
							});
							useProjectStore.setState({
								project: {
									...currentProject,
									mediaLibrary: { ...currentProject.mediaLibrary, items: updatedItems },
								},
							});

							const meta = useShotstackMetadataStore.getState().getMetadata();
							if (meta.rawClipData) {
								useShotstackMetadataStore.getState().setMetadata({ ...meta });
							}
						} catch (err) {
							console.warn("[OpenReelEditorHost] Failed to patch stores after TTS upload:", err);
						}
					}
				});
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

						const svgPos = data.position as { x: number; y: number } | undefined;
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
								position: { x: (svgPos?.x || 0) + 0.5, y: (svgPos?.y || 0) + 0.5 },
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

			// Process Shape assets → OpenReel ShapeClips
			const shapeClips: any[] = [];
			if (orProject._shotstack?.shapeClipData) {
				for (const [clipId, data] of Object.entries(orProject._shotstack.shapeClipData)) {
					const shapeType = (data.shapeType as string) || "rectangle";
					const fillColor = (data.fillColor as string) || "#cccccc";
					const strokeColor = data.strokeColor as string | undefined;
					const strokeWidth = (data.strokeWidth as number) || 0;
					const cornerRadius = (data.cornerRadius as number) || 0;
					const w = (data.width as number) || 100;
					const h = (data.height as number) || 100;

					const shapePos = data.position as { x: number; y: number } | undefined;
					const anchor = (data.positionAnchor as string) || "center";
					const cw = (data.canvasWidth as number) || 1080;
					const ch = (data.canvasHeight as number) || 1080;

					// ShotStack positions the clip's corner at the named anchor,
					// but OpenReel shapes render centered at their transform position.
					let anchorOffsetX = 0;
					let anchorOffsetY = 0;
					if (anchor.includes("left")) anchorOffsetX = (w / 2) / cw;
					if (anchor.includes("right")) anchorOffsetX = -(w / 2) / cw;
					if (anchor.includes("top")) anchorOffsetY = (h / 2) / ch;
					if (anchor.includes("bottom")) anchorOffsetY = -(h / 2) / ch;

					// The base shape is a square of side = min(cw, ch) * 0.15.
					// Non-uniform scale stretches it to the actual w × h.
					// Corner radii are compensated in the renderer so they
					// stay circular despite non-uniform scaling.
					const baseSize = Math.min(cw, ch) * 0.15;

					shapeClips.push({
						id: clipId,
						type: "shape",
						trackId: data.trackId || `track-graphics`,
						startTime: data.startTime,
						duration: data.duration,
						shapeType: shapeType as "rectangle" | "circle" | "ellipse" | "triangle",
						style: {
							fill: { type: "solid", color: fillColor, opacity: 1 },
							stroke: {
								color: strokeColor || "transparent",
								width: strokeWidth,
								opacity: strokeColor ? 1 : 0,
								dashArray: [],
							},
							cornerRadius,
						},
						transform: {
							position: {
								x: (shapePos?.x || 0) + 0.5 + anchorOffsetX,
								y: (shapePos?.y || 0) + 0.5 + anchorOffsetY,
							},
							scale: {
								x: (data.scale as number || 1) * (w / baseSize),
								y: (data.scale as number || 1) * (h / baseSize),
							},
							rotation: 0,
							anchor: { x: 0.5, y: 0.5 },
							opacity: data.opacity,
						},
						keyframes: [],
					});
				}
			}
			if (shapeClips.length > 0) {
				(orProject as any).shapeClips = shapeClips;
			}

			// Process Texts
			const textClips: any[] = [];
			if (orProject._shotstack?.textClipData) {
				for (const [clipId, data] of Object.entries(orProject._shotstack.textClipData)) {
					const textPos = data.position as { x: number; y: number } | undefined;
					const isAbsolute = data.absolutePosition as boolean;
					const cw = orProject.settings.width || 1080;
					const ch = orProject.settings.height || 1080;
					const mw = data.maxWidth as number | undefined;
					const tAlign = (data.textAlign as string) || "center";

					let resolvedX: number;
					let resolvedY: number;
					if (isAbsolute) {
						resolvedX = textPos?.x || 0;
						resolvedY = textPos?.y || 0;
					} else {
						resolvedX = (textPos?.x || 0) + 0.5;
						resolvedY = (textPos?.y || 0) + 0.5;

						// Center-based position: adjust so left/right-aligned
						// text renders from the correct edge of its bounding box.
						if (mw) {
							if (tAlign === "left") resolvedX -= mw / (2 * cw);
							else if (tAlign === "right") resolvedX += mw / (2 * cw);
						}
					}

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
							fontWeight: data.fontWeight || "normal",
							fontStyle: (data.fontStyle as string) || "normal",
							textAlign: tAlign,
							verticalAlign: (data.verticalAlign as string) || "middle",
							lineHeight: (data.lineHeight as number) || 1.2,
							letterSpacing: 0,
							maxWidth: mw,
						},
						transform: {
							position: { x: resolvedX, y: resolvedY },
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

			// Process HTML assets → render to PNG images with alpha
			if (orProject._shotstack?.htmlClipData) {
				for (const [clipId, data] of Object.entries(orProject._shotstack.htmlClipData)) {
					try {
						const htmlStr = (data.html as string) || "";
						const cssStr = (data.css as string) || "";
						const w = (data.width as number) || 800;
						const h = (data.height as number) || 200;
						const bg = (data.background as string) || "transparent";
						const mediaId = data.mediaId as string;

						// Render HTML+CSS to an off-screen canvas via foreignObject SVG
						const svgNs = "http://www.w3.org/2000/svg";
						const foreignHtml = `
							<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background:${bg};overflow:hidden;">
								<style>${cssStr}</style>
								${htmlStr}
							</div>`;
						const svgMarkup = `<svg xmlns="${svgNs}" width="${w}" height="${h}">
							<foreignObject width="100%" height="100%">${foreignHtml}</foreignObject>
						</svg>`;

						const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
						const url = URL.createObjectURL(blob);

						const pngBlob = await new Promise<Blob | null>((resolve) => {
							const img = new Image();
							img.onload = () => {
								const canvas = document.createElement("canvas");
								canvas.width = w;
								canvas.height = h;
								const ctx = canvas.getContext("2d");
								if (ctx) {
									ctx.drawImage(img, 0, 0);
								}
								URL.revokeObjectURL(url);
								canvas.toBlob((b) => resolve(b), "image/png");
							};
							img.onerror = () => {
								URL.revokeObjectURL(url);
								console.warn(`[HTML] Failed to render HTML clip ${clipId} to PNG`);
								resolve(null);
							};
							img.src = url;
						});

						if (pngBlob && mediaId) {
							// Replace the placeholder media item with the rendered PNG
							const idx = orProject.mediaLibrary.items.findIndex((m) => m.id === mediaId);
							if (idx !== -1) {
								(orProject.mediaLibrary.items as Array<typeof orProject.mediaLibrary.items[number]>)[idx] = {
									...orProject.mediaLibrary.items[idx],
									blob: pngBlob,
									isPlaceholder: false,
								};
							}
						}
					} catch (e) {
						console.error(`[HTML] Failed to render HTML clip ${data.mediaId}:`, e);
					}
				}
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
