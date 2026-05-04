"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchNextClip,
	fetchQueueStatus,
	fetchSourcesNeedingStt,
	processSourceVideoStt,
	updateClipStatus,
	resolveSourceVideoUrl,
	trimVideoSegment,
	uploadToStorage,
	type ClipQueueItem,
	type ClipStatus,
	type PipelineCallbacks,
} from "@/lib/clip-pipeline";

interface Props {
	experienceId: string;
	projectId: string;
	presignedUploadUrl: string;
	presignedUploadFields: Record<string, string>;
}

type LogEntry = { ts: number; msg: string };

const STATUS_LABELS: Record<ClipStatus, string> = {
	pending: "Pending",
	stt: "Running STT",
	trimming: "Trimming",
	rendering: "Rendering",
	posting: "Posting",
	done: "Done",
	failed: "Failed",
};

const STATUS_COLORS: Record<ClipStatus, string> = {
	pending: "text-gray-10",
	stt: "text-yellow-11",
	trimming: "text-blue-11",
	rendering: "text-purple-11",
	posting: "text-orange-11",
	done: "text-green-11",
	failed: "text-red-11",
};

export function ClipPipelineRunner({ experienceId, projectId, presignedUploadUrl, presignedUploadFields }: Props) {
	const [running, setRunning] = useState(false);
	const [paused, setPaused] = useState(false);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [currentClip, setCurrentClip] = useState<ClipQueueItem | null>(null);
	const [queueItems, setQueueItems] = useState<ClipQueueItem[]>([]);
	const [clipsDoneToday, setClipsDoneToday] = useState(0);
	const abortRef = useRef<AbortController | null>(null);
	const pausedRef = useRef(false);
	const logContainerRef = useRef<HTMLDivElement>(null);

	const addLog = useCallback((msg: string) => {
		setLogs((prev) => [...prev.slice(-200), { ts: Date.now(), msg }]);
	}, []);

	const makeCb = useCallback((): PipelineCallbacks => ({
		onLog: addLog,
		onStatusChange: (clipId, status) => {
			setQueueItems((prev) =>
				prev.map((c) => (c.id === clipId ? { ...c, status } : c)),
			);
		},
		apiBase: "/api/whop/pipeline",
		experienceId,
		projectId,
	}), [addLog, experienceId, projectId]);

	useEffect(() => {
		const cb = makeCb();
		fetchQueueStatus(cb).then(setQueueItems).catch(() => {});
	}, [makeCb]);

	useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
		}
	}, [logs]);

	const processOneClip = useCallback(async (cb: PipelineCallbacks, signal: AbortSignal): Promise<boolean> => {
		const clip = await fetchNextClip(cb);
		if (!clip) {
			cb.onLog("No pending clips in queue.");
			return false;
		}

		setCurrentClip(clip);
		cb.onLog(`Processing clip ${clip.id.slice(0, 8)}… (${clip.segment_start_sec}s → ${clip.segment_end_sec}s)`);

		try {
			const sourceUrl = resolveSourceVideoUrl(clip.source_video);
			if (!sourceUrl) {
				throw new Error("Source video has no URL");
			}

			// Step 1: Trim
			if (clip.status === "pending" || clip.status === "trimming") {
				if (signal.aborted) return false;
				await updateClipStatus(cb, clip.id, "trimming");

				const trimmedBlob = await trimVideoSegment(sourceUrl, clip.segment_start_sec, clip.segment_end_sec, cb);

				cb.onLog("Uploading trimmed segment to storage…");
				const trimmedUrl = await uploadToStorage(
					trimmedBlob,
					`clip_${clip.id.slice(0, 8)}_trimmed.mp4`,
					presignedUploadUrl,
					presignedUploadFields,
				);

				await updateClipStatus(cb, clip.id, "rendering", {
					stepData: { ...clip.step_data, trimmed_url: trimmedUrl },
				});

				clip.step_data.trimmed_url = trimmedUrl;
				cb.onLog(`Trimmed segment uploaded: ${trimmedUrl.slice(0, 80)}…`);
			}

			// Step 2: Render (template filling + render)
			if (clip.status === "rendering" || clip.step_data.trimmed_url) {
				if (signal.aborted) return false;

				const trimmedUrl = clip.step_data.trimmed_url as string;
				if (!trimmedUrl) throw new Error("No trimmed URL — trim step may have failed");

				if (clip.template_id) {
					cb.onLog("Template assigned — using trimmed clip as output (OpenReel render integration pending)");
					await updateClipStatus(cb, clip.id, "posting", {
						stepData: { ...clip.step_data, output_url: trimmedUrl },
						outputUrl: trimmedUrl,
					});
					clip.step_data.output_url = trimmedUrl;
				} else {
					cb.onLog("No template assigned — using trimmed clip as output");
					await updateClipStatus(cb, clip.id, "posting", {
						stepData: { ...clip.step_data, output_url: trimmedUrl },
						outputUrl: trimmedUrl,
					});
					clip.step_data.output_url = trimmedUrl;
				}
			}

			// Step 3: Post (placeholder — will be wired in Phase 5)
			if (clip.status === "posting" || clip.step_data.output_url) {
				if (signal.aborted) return false;
				cb.onLog("Posting step — marking done (posting wired in Phase 5)");
				await updateClipStatus(cb, clip.id, "done", {
					outputUrl: clip.step_data.output_url as string,
				});
			}

			setClipsDoneToday((prev) => prev + 1);
			cb.onLog(`Clip ${clip.id.slice(0, 8)} complete.`);
			setCurrentClip(null);
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			cb.onLog(`Clip ${clip.id.slice(0, 8)} FAILED: ${msg}`);
			await updateClipStatus(cb, clip.id, "failed", { error: msg }).catch(() => {});
			setCurrentClip(null);
			return true;
		}
	}, [presignedUploadUrl, presignedUploadFields]);

	const processSttSources = useCallback(async (cb: PipelineCallbacks, signal: AbortSignal): Promise<boolean> => {
		const sources = await fetchSourcesNeedingStt(cb);
		if (sources.length === 0) return false;

		for (const source of sources) {
			if (signal.aborted) return false;
			cb.onLog(`STT: Processing source "${source.original_filename}"…`);
			await processSourceVideoStt(source, null, cb);
		}
		return true;
	}, []);

	const startPipeline = useCallback(async () => {
		if (running) return;
		setRunning(true);
		setPaused(false);
		pausedRef.current = false;

		const ac = new AbortController();
		abortRef.current = ac;
		const cb = makeCb();

		cb.onLog("Pipeline started.");

		try {
			while (!ac.signal.aborted) {
				if (pausedRef.current) {
					cb.onLog("Pipeline paused. Waiting…");
					await new Promise<void>((resolve) => {
						const check = () => {
							if (!pausedRef.current || ac.signal.aborted) resolve();
							else setTimeout(check, 500);
						};
						check();
					});
					if (ac.signal.aborted) break;
					cb.onLog("Pipeline resumed.");
				}

				// First, process any source videos needing STT
				const hadSttWork = await processSttSources(cb, ac.signal);
				if (ac.signal.aborted) break;

				// Then process clip queue
				const hadClipWork = await processOneClip(cb, ac.signal);

				if (!hadSttWork && !hadClipWork) {
					cb.onLog("No work available. Waiting 30s before checking again…");
					await new Promise<void>((resolve) => {
						const timeout = setTimeout(resolve, 30000);
						ac.signal.addEventListener("abort", () => {
							clearTimeout(timeout);
							resolve();
						}, { once: true });
					});
				}

				await fetchQueueStatus(cb).then(setQueueItems).catch(() => {});
			}
		} finally {
			cb.onLog("Pipeline stopped.");
			setRunning(false);
			setCurrentClip(null);
		}
	}, [running, makeCb, processOneClip, processSttSources]);

	const stopPipeline = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	const togglePause = useCallback(() => {
		setPaused((prev) => {
			pausedRef.current = !prev;
			return !prev;
		});
	}, []);

	const doneCt = queueItems.filter((c) => c.status === "done").length;
	const failedCt = queueItems.filter((c) => c.status === "failed").length;
	const pendingCt = queueItems.filter((c) => c.status === "pending").length;
	const activeCt = queueItems.filter((c) => !["done", "failed", "pending"].includes(c.status)).length;

	return (
		<div className="flex flex-col gap-4">
			{/* Controls */}
			<div className="flex items-center gap-3">
				{!running ? (
					<button
						type="button"
						onClick={startPipeline}
						className="text-3 px-4 py-2 rounded-md bg-green-9 text-white hover:bg-green-10"
					>
						Start Pipeline
					</button>
				) : (
					<>
						<button
							type="button"
							onClick={togglePause}
							className="text-3 px-4 py-2 rounded-md bg-yellow-9 text-white hover:bg-yellow-10"
						>
							{paused ? "Resume" : "Pause"}
						</button>
						<button
							type="button"
							onClick={stopPipeline}
							className="text-3 px-4 py-2 rounded-md bg-red-9 text-white hover:bg-red-10"
						>
							Stop
						</button>
					</>
				)}
				<span className="text-2 text-gray-10">
					{running ? (paused ? "Paused" : "Running") : "Stopped"}
				</span>
			</div>

			{/* Stats */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<Stat label="Pending" value={pendingCt} />
				<Stat label="Active" value={activeCt} />
				<Stat label="Done" value={doneCt} />
				<Stat label="Failed" value={failedCt} />
			</div>

			{/* Current clip */}
			{currentClip ? (
				<div className="border border-gray-a4 rounded-lg p-3 bg-gray-a2">
					<div className="text-2 text-gray-10">Processing</div>
					<div className="text-3 text-gray-12 font-medium">
						{currentClip.source_video?.original_filename ?? "Unknown source"} — {currentClip.segment_start_sec.toFixed(1)}s → {currentClip.segment_end_sec.toFixed(1)}s
					</div>
					<div className={`text-2 ${STATUS_COLORS[currentClip.status]}`}>
						{STATUS_LABELS[currentClip.status]}
					</div>
				</div>
			) : null}

			{/* Log */}
			<div
				ref={logContainerRef}
				className="border border-gray-a4 rounded-lg bg-gray-a1 p-3 max-h-64 overflow-y-auto font-mono text-2"
			>
				{logs.length === 0 ? (
					<span className="text-gray-10">Pipeline log will appear here…</span>
				) : (
					logs.map((l, i) => (
						<div key={i} className="text-gray-11">
							<span className="text-gray-8">{new Date(l.ts).toLocaleTimeString()}</span>{" "}
							{l.msg}
						</div>
					))
				)}
			</div>

			{/* Queue table */}
			{queueItems.length > 0 ? (
				<section>
					<h4 className="text-3 font-semibold text-gray-12 mb-2">Queue ({queueItems.length})</h4>
					<div className="border border-gray-a4 rounded-lg overflow-hidden">
						<table className="w-full text-2">
							<thead>
								<tr className="bg-gray-a2 text-gray-10">
									<th className="text-left px-3 py-2">ID</th>
									<th className="text-left px-3 py-2">Segment</th>
									<th className="text-left px-3 py-2">Status</th>
									<th className="text-left px-3 py-2">Error</th>
								</tr>
							</thead>
							<tbody>
								{queueItems.slice(0, 20).map((c) => (
									<tr key={c.id} className="border-t border-gray-a4">
										<td className="px-3 py-2 font-mono text-gray-11">{c.id.slice(0, 8)}</td>
										<td className="px-3 py-2 text-gray-11">
											{c.segment_start_sec.toFixed(1)}s → {c.segment_end_sec.toFixed(1)}s
										</td>
										<td className={`px-3 py-2 ${STATUS_COLORS[c.status]}`}>
											{STATUS_LABELS[c.status]}
										</td>
										<td className="px-3 py-2 text-red-11 truncate max-w-48">
											{c.error || "—"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : null}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="border border-gray-a4 rounded-lg p-3 bg-gray-a2">
			<div className="text-2 text-gray-10">{label}</div>
			<div className="text-4 text-gray-12 font-medium">{value}</div>
		</div>
	);
}
