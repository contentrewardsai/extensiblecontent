"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureCfsGeneratorLoaded } from "./ensure-cfs-generator";
import type { ShotstackEditorContext } from "./shotstack-editor-context";

type Variant = "row" | "toolbar";

function detectChromium() {
	if (typeof navigator === "undefined") return false;
	const u = navigator.userAgent;
	// iOS Chrome (CriOS) can run MediaRecorder; still exclude non‑Chromium.
	return /Chrome|Chromium|Edg\/|CriOS/.test(u) && !/FxiOS|Firefox\//.test(u);
}

function buildUrl(base: string, path: string, query: string): string {
	const url = `${base}${path}`;
	if (!query) return url;
	return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

export function BrowserRenderButton({
	templateId,
	templateName: _templateName,
	variant = "row",
	getTemplateJson,
	disabled = false,
	context,
}: {
	templateId: string;
	templateName: string;
	variant?: Variant;
	/** If provided (e.g. from visual editor), used instead of fetching the template. */
	getTemplateJson?: () => Record<string, unknown> | null;
	disabled?: boolean;
	context: ShotstackEditorContext;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	// Gate with useEffect so SSR and first client render agree (hydration-safe).
	const [canRun, setCanRun] = useState<boolean | null>(null);
	useEffect(() => {
		setCanRun(detectChromium());
	}, []);
	const isToolbar = variant === "toolbar";
	const baseBtn =
		"text-3 px-3 py-1.5 rounded-md border border-gray-a4 bg-gray-a1 text-gray-12 disabled:opacity-50 disabled:cursor-not-allowed";

	const onRender = async () => {
		if (canRun !== true) return;
		setBusy(true);
		setMsg(null);
		try {
			await ensureCfsGeneratorLoaded();
			type CfsEngine = {
				applyMergeToTemplate: (t: unknown, m: unknown[]) => unknown;
				renderTimelineToVideoBlob: (t: unknown) => Promise<Blob | null>;
			};
			const engine = (window as unknown as { __CFS_templateEngine?: CfsEngine }).__CFS_templateEngine;
			if (!engine?.applyMergeToTemplate || !engine?.renderTimelineToVideoBlob) {
				throw new Error("Render pipeline not available");
			}
			let edit: Record<string, unknown> | null = null;
			if (getTemplateJson) {
				edit = getTemplateJson() as Record<string, unknown> | null;
			}
			if (!edit) {
				const tRes = await fetch(
					buildUrl(context.templatesApiBase, `/${templateId}`, context.templatesApiQuery),
					{ credentials: "include" },
				);
				if (!tRes.ok) {
					throw new Error("Could not load template");
				}
				const t = (await tRes.json()) as { edit?: Record<string, unknown> };
				edit = (t?.edit as Record<string, unknown>) ?? null;
			}
			if (!edit) throw new Error("No template JSON");
			const e = JSON.parse(JSON.stringify(edit)) as { merge?: unknown[] };
			const merge = Array.isArray(e.merge) ? e.merge : [];
			const merged = engine.applyMergeToTemplate(e, merge) as Record<string, unknown>;
			const webm = await engine.renderTimelineToVideoBlob(merged);
			if (!webm) throw new Error("No video from renderer");

			const ff = (window as unknown as {
				FFmpegLocal?: { convertToMp4: (b: Blob, c?: (s: string) => void) => Promise<unknown> };
			}).FFmpegLocal;
			if (!ff?.convertToMp4) {
				throw new Error("FFmpeg not loaded");
			}
			const mp4result = (await ff.convertToMp4(webm, (s) => setMsg(s))) as { ok?: boolean; blob?: Blob };
			const blob = mp4result?.ok && mp4result.blob ? mp4result.blob : webm;
			const isMp4 = !!(mp4result?.ok && mp4result.blob);
			const ext = isMp4 ? "mp4" : "webm";
			const contentType = blob.type || (isMp4 ? "video/mp4" : "video/webm");
			const fd = new FormData();
			for (const [k, v] of Object.entries(context.browserRenderFields)) {
				fd.append(k, v);
			}
			fd.append("template_id", templateId);
			fd.append("file", blob, `render.${ext}`);
			fd.append("content_type", contentType);
			const up = await fetch(context.browserRenderUrl, { method: "POST", body: fd, credentials: "include" });
			const j = (await up.json().catch(() => ({}))) as { error?: string; file_url?: string; ok?: boolean };
			if (!up.ok) {
				throw new Error(j.error || `Upload failed (${up.status})`);
			}
			setMsg("Uploaded.");
			router.refresh();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : "Render failed");
		} finally {
			setBusy(false);
		}
	};

	if (canRun === null) {
		return (
			<div className={isToolbar ? "inline-flex flex-col gap-0.5" : "inline-flex flex-col items-end gap-0.5"}>
				<button type="button" className={baseBtn} disabled>
					{isToolbar ? "Render in browser (free)" : "Browser render (free)"}
				</button>
			</div>
		);
	}

	if (canRun === false) {
		return (
			<span
				className="text-2 text-gray-10 max-w-xs"
				title="Browser (free) render uses MediaRecorder and FFmpeg in Chromium-based browsers. Use Queue render for other browsers."
			>
				Browser render: Chromium only
			</span>
		);
	}

	return (
		<div className={isToolbar ? "inline-flex flex-col gap-0.5" : "inline-flex flex-col items-end gap-0.5"}>
			<button type="button" className={baseBtn} disabled={disabled || busy} onClick={onRender}>
				{busy ? "Rendering…" : isToolbar ? "Render in browser (free)" : "Browser render (free)"}
			</button>
			{msg && !isToolbar ? <span className="text-2 text-gray-10 text-right max-w-xs">{msg}</span> : null}
			{msg && isToolbar ? <span className="text-2 text-gray-10">{msg}</span> : null}
		</div>
	);
}
