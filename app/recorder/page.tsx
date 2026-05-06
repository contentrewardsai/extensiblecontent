"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

type RecordingMode = "mic" | "system" | "screen" | "webcam";
type Phase = "setup" | "requesting" | "recording" | "sending" | "done" | "error";

interface StreamMeta {
	mode: RecordingMode;
	filename: string;
	mimeType: string;
	bytesSent: number;
}

interface RecorderState {
	recorder: MediaRecorder;
	chunks: Blob[];
	stream: MediaStream;
	mode: RecordingMode;
}

const MODE_META: Record<RecordingMode, { label: string; icon: string; filePrefix: string }> = {
	mic: { label: "Microphone", icon: "🎙️", filePrefix: "mic-recording" },
	system: { label: "System Audio", icon: "🔊", filePrefix: "system-audio" },
	screen: { label: "Screen", icon: "🖥️", filePrefix: "screen-recording" },
	webcam: { label: "Webcam", icon: "📷", filePrefix: "webcam-recording" },
};

function getExtFromMime(mime: string): string {
	if (mime.includes("mp4")) return "mp4";
	if (mime.includes("ogg")) return "ogg";
	return "webm";
}

function getBestAudioMime(): string {
	const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
	for (const t of types) {
		if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
	}
	return "audio/webm";
}

function getBestVideoMime(): string {
	const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
	for (const t of types) {
		if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
	}
	return "video/webm";
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function RecorderPage() {
	const [enabledModes, setEnabledModes] = useState<Set<RecordingMode>>(new Set());
	const [phase, setPhase] = useState<Phase>("setup");
	const [elapsed, setElapsed] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [sentCount, setSentCount] = useState(0);
	const [streamMetas, setStreamMetas] = useState<StreamMeta[]>([]);

	const recordersRef = useRef<RecorderState[]>([]);
	const displayStreamRef = useRef<MediaStream | null>(null);
	const timerRef = useRef<number | null>(null);
	const startTimeRef = useRef(0);


	const screenVideoRef = useRef<HTMLVideoElement>(null);
	const webcamVideoRef = useRef<HTMLVideoElement>(null);
	const micCanvasRef = useRef<HTMLCanvasElement>(null);
	const systemCanvasRef = useRef<HTMLCanvasElement>(null);
	const animFramesRef = useRef<number[]>([]);
	const audioCtxsRef = useRef<AudioContext[]>([]);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);

		const modesParam = params.get("modes");
		if (modesParam) {
			const parsed = modesParam.split(",").filter((m): m is RecordingMode =>
				["mic", "system", "screen", "webcam"].includes(m),
			);
			if (parsed.length > 0) setEnabledModes(new Set(parsed));
		}

		// Notify the opener we're ready
		if (window.opener) {
			try {
				window.opener.postMessage({ type: "recorder-ready" }, "*");
			} catch (e) {
				console.warn("[Recorder] Could not notify opener:", e);
			}
		}
	}, []);

	useEffect(() => {
		const handleBeforeUnload = () => {
			if (window.opener) {
				try { window.opener.postMessage({ type: "recorder-closed" }, "*"); } catch { /* ignore */ }
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, []);

	const toggleMode = useCallback((mode: RecordingMode) => {
		setEnabledModes((prev) => {
			const next = new Set(prev);
			if (next.has(mode)) next.delete(mode);
			else next.add(mode);
			return next;
		});
	}, []);

	const cleanupAll = useCallback(() => {
		for (const rs of recordersRef.current) {
			rs.stream.getTracks().forEach((t) => t.stop());
		}
		recordersRef.current = [];
		displayStreamRef.current?.getTracks().forEach((t) => t.stop());
		displayStreamRef.current = null;
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		for (const id of animFramesRef.current) cancelAnimationFrame(id);
		animFramesRef.current = [];
		for (const ctx of audioCtxsRef.current) ctx.close().catch(() => {});
		audioCtxsRef.current = [];
	}, []);

	useEffect(() => () => cleanupAll(), [cleanupAll]);

	const startWaveform = useCallback((stream: MediaStream, canvas: HTMLCanvasElement | null) => {
		if (!canvas) return;
		const ctx2d = canvas.getContext("2d");
		if (!ctx2d) return;
		const actx = new AudioContext();
		audioCtxsRef.current.push(actx);
		const source = actx.createMediaStreamSource(stream);
		const analyser = actx.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);
		const bufLen = analyser.frequencyBinCount;
		const data = new Uint8Array(bufLen);
		const draw = () => {
			const id = requestAnimationFrame(draw);
			animFramesRef.current.push(id);
			analyser.getByteTimeDomainData(data);
			ctx2d.fillStyle = "rgba(0,0,0,0.15)";
			ctx2d.fillRect(0, 0, canvas.width, canvas.height);
			ctx2d.lineWidth = 2;
			ctx2d.strokeStyle = "#22c55e";
			ctx2d.beginPath();
			const sliceWidth = canvas.width / bufLen;
			let x = 0;
			for (let i = 0; i < bufLen; i++) {
				const v = data[i] / 128.0;
				const y = (v * canvas.height) / 2;
				if (i === 0) ctx2d.moveTo(x, y);
				else ctx2d.lineTo(x, y);
				x += sliceWidth;
			}
			ctx2d.lineTo(canvas.width, canvas.height / 2);
			ctx2d.stroke();
		};
		draw();
	}, []);

	const sendToOpener = useCallback((msg: Record<string, unknown>) => {
		if (window.opener) {
			try { window.opener.postMessage(msg, "*"); } catch (e) { console.warn("[Recorder] postMessage failed:", e); }
		}
	}, []);

	const sendChunkToEditor = useCallback(async (streamIndex: number, blob: Blob) => {
		if (!window.opener) return;
		try {
			const buffer = await blob.arrayBuffer();
			window.opener.postMessage({ type: "stream-chunk", streamIndex, data: buffer }, "*");
			setStreamMetas((prev) => {
				const next = [...prev];
				if (next[streamIndex]) {
					next[streamIndex] = { ...next[streamIndex], bytesSent: next[streamIndex].bytesSent + buffer.byteLength };
				}
				return next;
			});
		} catch (err) {
			console.warn("[Recorder] Failed to send chunk:", err);
		}
	}, []);

	const startRecording = useCallback(async () => {
		if (enabledModes.size === 0) return;
		setError(null);
		setPhase("requesting");
		cleanupAll();

		const modes = Array.from(enabledModes);
		const needsDisplay = modes.includes("screen") || modes.includes("system");
		const needsMic = modes.includes("mic");
		const needsWebcam = modes.includes("webcam");

		try {
			let displayStream: MediaStream | null = null;
			if (needsDisplay) {
				displayStream = await navigator.mediaDevices.getDisplayMedia({
					video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
					audio: true,
				});
				displayStreamRef.current = displayStream;
			}

			const recorders: RecorderState[] = [];

			if (modes.includes("screen") && displayStream) {
				const screenMime = getBestVideoMime();
				const rec = new MediaRecorder(displayStream, { mimeType: screenMime });
				const chunks: Blob[] = [];
				const screenIdx = recorders.length;
				rec.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
						sendChunkToEditor(screenIdx, e.data);
					}
				};
				recorders.push({ recorder: rec, chunks, stream: displayStream, mode: "screen" });
				if (screenVideoRef.current) screenVideoRef.current.srcObject = displayStream;
			}

			if (modes.includes("system") && displayStream) {
				const audioTracks = displayStream.getAudioTracks();
				if (audioTracks.length === 0) {
					throw new Error("No system audio captured. Make sure to check 'Share audio' in the browser dialog.");
				}
				const audioOnly = new MediaStream(audioTracks);
				const sysMime = getBestAudioMime();
				const rec = new MediaRecorder(audioOnly, { mimeType: sysMime });
				const chunks: Blob[] = [];
				const sysIdx = recorders.length;
				rec.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
						sendChunkToEditor(sysIdx, e.data);
					}
				};
				recorders.push({ recorder: rec, chunks, stream: audioOnly, mode: "system" });
				startWaveform(audioOnly, systemCanvasRef.current);
			}

			if (needsMic) {
				const micStream = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
				});
				const micMime = getBestAudioMime();
				const rec = new MediaRecorder(micStream, { mimeType: micMime });
				const chunks: Blob[] = [];
				const micIdx = recorders.length;
				rec.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
						sendChunkToEditor(micIdx, e.data);
					}
				};
				recorders.push({ recorder: rec, chunks, stream: micStream, mode: "mic" });
				startWaveform(micStream, micCanvasRef.current);
			}

			if (needsWebcam) {
				const webcamStream = await navigator.mediaDevices.getUserMedia({
					video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
					audio: { echoCancellation: true, noiseSuppression: true },
				});
				const wcMime = getBestVideoMime();
				const rec = new MediaRecorder(webcamStream, { mimeType: wcMime });
				const chunks: Blob[] = [];
				const wcIdx = recorders.length;
				rec.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
						sendChunkToEditor(wcIdx, e.data);
					}
				};
				recorders.push({ recorder: rec, chunks, stream: webcamStream, mode: "webcam" });
				if (webcamVideoRef.current) webcamVideoRef.current.srcObject = webcamStream;
			}

			if (recorders.length === 0) {
				throw new Error("No recording sources could be initialized.");
			}

			recordersRef.current = recorders;

			if (displayStream) {
				const primaryVideoTrack = displayStream.getVideoTracks()[0];
				if (primaryVideoTrack) {
					primaryVideoTrack.onended = () => stopRecording();
				}
			}

			// Send stream-init to the editor before starting
			const ts = Date.now();
			const initMetas: StreamMeta[] = recorders.map((rs) => {
				const mimeType = rs.mode === "mic" || rs.mode === "system" ? getBestAudioMime() : getBestVideoMime();
				const ext = getExtFromMime(mimeType);
				return { mode: rs.mode, filename: `${MODE_META[rs.mode].filePrefix}-${ts}.${ext}`, mimeType, bytesSent: 0 };
			});
			setStreamMetas(initMetas);
			sendToOpener({ type: "stream-init", streams: initMetas.map((m) => ({ mode: m.mode, filename: m.filename, mimeType: m.mimeType })) });

			for (const rs of recorders) rs.recorder.start(1000);

			startTimeRef.current = Date.now();
			setPhase("recording");
			timerRef.current = window.setInterval(() => {
				setElapsed(Date.now() - startTimeRef.current);
			}, 100);
		} catch (err) {
			console.error("[Recorder] Failed to start:", err);
			setError(err instanceof Error ? err.message : "Failed to start recording");
			setPhase("error");
			cleanupAll();
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [enabledModes, cleanupAll, startWaveform, sendChunkToEditor]);

	const stopRecording = useCallback(async () => {
		if (phase !== "recording") return;
		setPhase("sending");

		const stopPromises = recordersRef.current.map(
			(rs) =>
				new Promise<void>((resolve) => {
					if (rs.recorder.state === "inactive") {
						resolve();
						return;
					}
					rs.recorder.onstop = () => resolve();
					rs.recorder.stop();
				}),
		);

		await Promise.all(stopPromises);

		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}

		// Cleanup streams
		for (const rs of recordersRef.current) {
			rs.stream.getTracks().forEach((t) => t.stop());
		}
		displayStreamRef.current?.getTracks().forEach((t) => t.stop());
		displayStreamRef.current = null;
		recordersRef.current = [];
		for (const id of animFramesRef.current) cancelAnimationFrame(id);
		animFramesRef.current = [];
		for (const ctx of audioCtxsRef.current) ctx.close().catch(() => {});
		audioCtxsRef.current = [];

		// Tell the editor all data has been streamed
		if (window.opener) {
			sendToOpener({ type: "stream-done" });
			setSentCount(streamMetas.length);
			setPhase("done");
		} else {
			setError("No connection to editor. Close this window and try again.");
			setPhase("error");
		}

		setElapsed(0);
	}, [phase, streamMetas]);

	const cancelRecording = useCallback(() => {
		cleanupAll();
		setPhase("setup");
		setElapsed(0);
		setError(null);
	}, [cleanupAll]);

	const activeVideoCount = (enabledModes.has("screen") ? 1 : 0) + (enabledModes.has("webcam") ? 1 : 0);
	const activeAudioCount = (enabledModes.has("mic") ? 1 : 0) + (enabledModes.has("system") ? 1 : 0);

	return (
		<div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#111]">
				<div className="flex items-center gap-2">
					<div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" style={{ animationPlayState: phase === "recording" ? "running" : "paused", opacity: phase === "recording" ? 1 : 0.3 }} />
					<h1 className="text-sm font-semibold">Media Recorder</h1>
				</div>
				{phase === "recording" && (
					<div className="flex items-center gap-2 px-3 py-1 bg-red-500/20 rounded-full border border-red-500/40">
						<div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
						<span className="text-xs font-mono text-red-300">{formatDuration(elapsed)}</span>
					</div>
				)}
			</div>

			{/* Mode toggles */}
			{(phase === "setup" || phase === "error") && (
				<div className="p-4 space-y-3">
					<p className="text-xs text-white/50">Select sources to record:</p>
					<div className="grid grid-cols-2 gap-2">
						{(Object.entries(MODE_META) as [RecordingMode, typeof MODE_META.mic][]).map(([mode, meta]) => {
							const active = enabledModes.has(mode);
							return (
								<button
									key={mode}
									onClick={() => toggleMode(mode)}
									className={`flex items-center gap-3 px-3 py-3 rounded-lg border transition-all text-left ${
										active
											? "bg-red-500/15 border-red-500/50 text-white"
											: "bg-white/5 border-white/10 text-white/50 hover:border-white/25 hover:text-white/70"
									}`}
								>
									<span className="text-lg">{meta.icon}</span>
									<div>
										<div className="text-xs font-medium">{meta.label}</div>
										<div className="text-[10px] opacity-60">{active ? "Enabled" : "Disabled"}</div>
									</div>
									<div className={`ml-auto w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
										active ? "bg-red-500 border-red-500" : "border-white/30"
									}`}>
										{active && (
											<svg width="10" height="8" viewBox="0 0 10 8" fill="none">
												<path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										)}
									</div>
								</button>
							);
						})}
					</div>

					{error && (
						<div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
							<p className="text-xs text-red-400">{error}</p>
						</div>
					)}

					<button
						onClick={startRecording}
						disabled={enabledModes.size === 0}
						className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-white/10 disabled:text-white/30 text-white font-semibold rounded-lg transition-colors text-sm"
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="6" /></svg>
						Start Recording{enabledModes.size > 0 ? ` (${enabledModes.size} source${enabledModes.size > 1 ? "s" : ""})` : ""}
					</button>
				</div>
			)}

			{/* Requesting */}
			{phase === "requesting" && (
				<div className="flex-1 flex items-center justify-center p-4">
					<div className="text-center space-y-3">
						<div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
						<p className="text-xs text-white/50">Requesting access to recording sources...</p>
						<p className="text-[10px] text-white/30">Grant permissions in the browser dialogs that appear.</p>
					</div>
				</div>
			)}

			{/* Preview area during recording */}
			{phase === "recording" && (
				<div className="flex-1 p-3 space-y-2 overflow-auto">
					{/* Video previews */}
					{(activeVideoCount > 0 || activeAudioCount > 0) && (
						<div className={`grid gap-2 ${
							activeVideoCount + activeAudioCount > 2 ? "grid-cols-2" :
							activeVideoCount + activeAudioCount === 2 ? "grid-cols-2" : "grid-cols-1"
						}`}>
							{enabledModes.has("screen") && (
								<div className="relative rounded-lg overflow-hidden bg-black border border-white/10">
									<video ref={screenVideoRef} autoPlay muted playsInline className="w-full h-32 object-contain" />
									<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70">Screen</div>
								</div>
							)}
							{enabledModes.has("webcam") && (
								<div className="relative rounded-lg overflow-hidden bg-black border border-white/10">
									<video ref={webcamVideoRef} autoPlay muted playsInline className="w-full h-32 object-cover" />
									<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70">Webcam</div>
								</div>
							)}
							{enabledModes.has("mic") && (
								<div className="relative rounded-lg overflow-hidden bg-black border border-white/10 h-16">
									<canvas ref={micCanvasRef} width={300} height={64} className="w-full h-full" />
									<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70">Mic</div>
								</div>
							)}
							{enabledModes.has("system") && (
								<div className="relative rounded-lg overflow-hidden bg-black border border-white/10 h-16">
									<canvas ref={systemCanvasRef} width={300} height={64} className="w-full h-full" />
									<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white/70">System Audio</div>
								</div>
							)}
						</div>
					)}

					{/* Controls */}
					<div className="flex gap-2 pt-1">
						<button
							onClick={stopRecording}
							className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium"
						>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="10" rx="1" /></svg>
							Stop Recording
						</button>
						<button
							onClick={cancelRecording}
							className="px-3 py-2.5 bg-white/10 hover:bg-white/15 text-white/70 rounded-lg transition-colors text-sm"
							title="Cancel"
						>
							✕
						</button>
					</div>
				</div>
			)}

			{/* Sending / Finalizing */}
			{phase === "sending" && (
				<div className="flex-1 flex items-center justify-center p-4">
					<div className="text-center space-y-4 max-w-xs">
						<div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
						<p className="text-sm font-medium text-white">Finalizing recordings...</p>
						<div className="space-y-2">
							{streamMetas.map((m, i) => (
								<div key={i} className="flex items-center gap-2 text-xs text-white/60">
									<span>{MODE_META[m.mode].icon}</span>
									<span className="flex-1 text-left">{MODE_META[m.mode].label}</span>
									<span className="font-mono text-white/40">{(m.bytesSent / 1024).toFixed(0)} KB</span>
								</div>
							))}
						</div>
						<div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
							<span className="text-yellow-400 text-sm">⚠️</span>
							<p className="text-[10px] text-yellow-300">Do not close this window — sending data to editor</p>
						</div>
					</div>
				</div>
			)}

			{/* Done */}
			{phase === "done" && (
				<div className="flex-1 flex items-center justify-center p-4">
					<div className="text-center space-y-4">
						<div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
						</div>
						<div>
							<p className="text-sm font-medium text-green-400">Sent to Editor</p>
							<p className="text-xs text-white/40 mt-1">{sentCount} recording{sentCount !== 1 ? "s" : ""} sent successfully</p>
						</div>
						<div className="flex gap-2">
							<button
								onClick={() => { setPhase("setup"); setError(null); setSentCount(0); }}
								className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg transition-colors text-xs font-medium"
							>
								Record Again
							</button>
							<button
								onClick={() => window.close()}
								className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-xs font-medium"
							>
								Close Window
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Footer */}
			<div className="px-4 py-2 border-t border-white/10 bg-[#111]">
				<p className="text-[10px] text-white/30 text-center">
					{enabledModes.size > 0
						? `${enabledModes.size} source${enabledModes.size > 1 ? "s" : ""} selected · Each recorded as a separate file`
						: "Select at least one source to begin recording"}
				</p>
			</div>
		</div>
	);
}
