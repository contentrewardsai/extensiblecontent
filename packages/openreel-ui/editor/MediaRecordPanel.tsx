import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic,
  Monitor,
  Camera,
  Volume2,
  Square,
  X,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { useProjectStore } from "../stores/project-store";
import { formatDuration } from "../services/screen-recorder";

type RecordingMode = "mic" | "system" | "screen" | "webcam";
type RecordPhase = "idle" | "requesting" | "recording" | "processing" | "done";

interface ModeConfig {
  mode: RecordingMode;
  icon: React.FC<{ size?: number; className?: string }>;
  label: string;
  description: string;
}

const MODES: ModeConfig[] = [
  { mode: "mic", icon: Mic, label: "Microphone", description: "Record audio from mic" },
  { mode: "system", icon: Volume2, label: "System Audio", description: "Capture computer audio" },
  { mode: "screen", icon: Monitor, label: "Screen", description: "Record screen capture" },
  { mode: "webcam", icon: Camera, label: "Webcam", description: "Record webcam video" },
];

function isInsideIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("permission") ||
    msg.includes("not allowed") ||
    msg.includes("denied") ||
    msg.includes("disallowed by permissions policy")
  );
}

function openPopoutWindow(): void {
  const url = window.location.href;
  const w = Math.min(1400, screen.availWidth - 100);
  const h = Math.min(900, screen.availHeight - 100);
  const left = Math.round((screen.availWidth - w) / 2);
  const top = Math.round((screen.availHeight - h) / 2);
  window.open(url, "_blank", `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`);
}

function getBestAudioMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

function getBestVideoMimeType(): string {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

interface RecordingSessionProps {
  mode: RecordingMode;
  onDone: () => void;
  onPermissionBlocked: () => void;
}

const RecordingSession: React.FC<RecordingSessionProps> = ({ mode, onDone, onPermissionBlocked }) => {
  const importMedia = useProjectStore((s) => s.importMedia);
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stoppingRef = useRef(false);
  const startedRef = useRef(false);

  const stopAllStreams = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // For system audio: the display stream has the video track we kept alive
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => () => stopAllStreams(), [stopAllStreams]);

  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#22c55e";
      ctx.beginPath();
      const sliceWidth = canvas.width / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = data[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };
    draw();
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stoppingRef.current = false;
      return;
    }

    setPhase("processing");

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    stopAllStreams();

    const isAudioOnly = mode === "mic" || mode === "system";
    const mimeType = recorder.mimeType || (isAudioOnly ? "audio/webm" : "video/webm");
    const blob = new Blob(chunksRef.current, { type: mimeType });

    if (blob.size < 100) {
      setError("Recording too short or empty.");
      setPhase("idle");
      stoppingRef.current = false;
      return;
    }

    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const prefix = mode === "mic" ? "mic-recording" :
                   mode === "system" ? "system-audio" :
                   mode === "screen" ? "screen-recording" :
                   "webcam-recording";
    const filename = `${prefix}-${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: mimeType });

    try {
      const result = await importMedia(file);

      const uploadFn = (window as unknown as Record<string, unknown>).__mediaEditorUploadBlob as
        ((blob: Blob, filename: string, contentType: string) => Promise<string>) | undefined;

      if (uploadFn) {
        uploadFn(blob, filename, mimeType)
          .then((url) => {
            console.log(`[MediaRecordPanel] Recording uploaded to ${url}`);
            if (result.actionId) {
              const { project } = useProjectStore.getState();
              const item = project.mediaLibrary.items.find((m) => m.id === result.actionId);
              if (item) {
                const items = project.mediaLibrary.items as Array<typeof item>;
                const idx = items.indexOf(item);
                if (idx >= 0) {
                  items[idx] = { ...item, originalUrl: url } as typeof item;
                }
              }
            }
          })
          .catch((err) => {
            console.warn("[MediaRecordPanel] Background upload failed (recording still works in-session):", err);
          });
      }
    } catch (err) {
      console.error("[MediaRecordPanel] Import failed:", err);
      setError("Failed to import recording.");
    }

    setPhase("done");
    setElapsed(0);
    stoppingRef.current = false;
  }, [mode, importMedia, stopAllStreams]);

  const cancelRecording = useCallback(() => {
    stoppingRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    stopAllStreams();
    setPhase("idle");
    setElapsed(0);
    stoppingRef.current = false;
    onDone();
  }, [stopAllStreams, onDone]);

  const startRecording = useCallback(async () => {
    setError(null);
    setPhase("requesting");
    chunksRef.current = [];
    stoppingRef.current = false;

    try {
      let stream: MediaStream;

      if (mode === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } else if (mode === "system") {
        // getDisplayMedia requires video; we keep the full stream alive so
        // Chrome doesn't kill the audio when the video track is stopped.
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        displayStreamRef.current = displayStream;

        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          throw new Error("No system audio captured. Make sure to check 'Share audio' in the browser dialog.");
        }
        // Feed only audio tracks to the recorder; video track stays alive
        // on displayStreamRef but isn't recorded.
        stream = new MediaStream(audioTracks);
      } else if (mode === "screen") {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: true,
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      }

      streamRef.current = stream;

      if ((mode === "webcam" || mode === "screen") && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }

      if (mode === "mic" || mode === "system") {
        const actx = new AudioContext();
        audioCtxRef.current = actx;
        const source = actx.createMediaStreamSource(stream);
        const analyser = actx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        analyserRef.current = analyser;
        drawWaveform();
      }

      const isAudioOnly = mode === "mic" || mode === "system";
      const mimeType = isAudioOnly ? getBestAudioMimeType() : getBestVideoMimeType();

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onerror = () => {
        setError("Recording error occurred.");
        setPhase("idle");
        stopAllStreams();
      };

      // Only stop when the user-facing track actually ends (e.g. Chrome
      // "Stop sharing" button) — NOT when we programmatically stop tracks.
      const primaryTrack = isAudioOnly ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (primaryTrack) {
        primaryTrack.onended = () => {
          if (mediaRecorderRef.current?.state === "recording") {
            stopRecording();
          }
        };
      }

      recorder.start(1000);
      startTimeRef.current = Date.now();
      setPhase("recording");

      timerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current);
      }, 100);
    } catch (err) {
      console.error("[MediaRecordPanel] Failed to start recording:", err);
      if (isPermissionError(err)) {
        onPermissionBlocked();
      }
      setError(err instanceof Error ? err.message : "Failed to start recording");
      setPhase("idle");
      stopAllStreams();
    }
  }, [mode, drawWaveform, stopAllStreams, onPermissionBlocked, stopRecording]);

  // Auto-start recording on mount
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      startRecording();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasVideo = mode === "webcam" || mode === "screen";
  const hasAudioViz = mode === "mic" || mode === "system";

  return (
    <div className="space-y-3">
      {/* Preview area */}
      <div className="relative rounded-lg overflow-hidden bg-black border border-border" style={{ minHeight: hasVideo ? 160 : 60 }}>
        {hasVideo && (
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="w-full h-40 object-cover"
          />
        )}
        {hasAudioViz && (
          <canvas
            ref={canvasRef}
            width={280}
            height={60}
            className="w-full h-[60px]"
          />
        )}
        {phase === "recording" && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5 bg-black/70 rounded-full">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-white font-mono">{formatDuration(elapsed)}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        {phase === "idle" && (
          <button
            onClick={startRecording}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-[11px] font-medium"
          >
            <div className="w-3 h-3 bg-white rounded-full" />
            Start Recording
          </button>
        )}
        {phase === "requesting" && (
          <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-background-tertiary text-text-muted rounded-lg text-[11px]">
            <Loader2 size={14} className="animate-spin" />
            Requesting access...
          </div>
        )}
        {phase === "recording" && (
          <>
            <button
              onClick={stopRecording}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-[11px] font-medium"
            >
              <Square size={12} className="fill-current" />
              Stop Recording
            </button>
            <button
              onClick={cancelRecording}
              className="px-3 py-2 bg-background-tertiary hover:bg-background-elevated text-text-secondary rounded-lg transition-colors text-[11px]"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </>
        )}
        {phase === "processing" && (
          <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-background-tertiary text-text-muted rounded-lg text-[11px]">
            <Loader2 size={14} className="animate-spin" />
            Saving recording...
          </div>
        )}
        {phase === "done" && (
          <div className="flex gap-2 w-full">
            <button
              onClick={startRecording}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-[11px] font-medium"
            >
              <div className="w-3 h-3 bg-white rounded-full" />
              Record Again
            </button>
            <button
              onClick={onDone}
              className="px-3 py-2 bg-background-tertiary hover:bg-background-elevated text-text-secondary rounded-lg transition-colors text-[11px]"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface MediaRecordPanelProps {
  onOpenScreenRecorder?: () => void;
}

export const MediaRecordPanel: React.FC<MediaRecordPanelProps> = ({ onOpenScreenRecorder }) => {
  const [activeMode, setActiveMode] = useState<RecordingMode | null>(null);
  const [showPopoutHint, setShowPopoutHint] = useState(false);

  const handleSelectMode = useCallback((mode: RecordingMode) => {
    if (mode === "screen" && onOpenScreenRecorder) {
      onOpenScreenRecorder();
      return;
    }
    setActiveMode((prev) => (prev === mode ? null : mode));
    setShowPopoutHint(false);
  }, [onOpenScreenRecorder]);

  const handleDone = useCallback(() => {
    setActiveMode(null);
  }, []);

  const handlePermissionBlocked = useCallback(() => {
    if (isInsideIframe()) {
      setShowPopoutHint(true);
    }
  }, []);

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-medium text-text-secondary flex items-center gap-1.5 px-1">
        Record
      </h4>
      <div className="grid grid-cols-4 gap-1.5">
        {MODES.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => handleSelectMode(mode)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-[9px] ${
              activeMode === mode
                ? "bg-red-500/10 border-red-500/50 text-red-400"
                : "bg-background-tertiary border-border text-text-muted hover:border-text-secondary hover:text-text-secondary"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {showPopoutHint && (
        <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-2">
          <p className="text-[10px] text-yellow-300">
            Recording permissions are blocked because the editor is embedded. Open in a new window to use recording.
          </p>
          <button
            onClick={openPopoutWindow}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors text-[11px] font-medium"
          >
            <ExternalLink size={14} />
            Open Editor in New Window
          </button>
        </div>
      )}

      {activeMode && activeMode !== "screen" && (
        <RecordingSession
          key={activeMode}
          mode={activeMode}
          onDone={handleDone}
          onPermissionBlocked={handlePermissionBlocked}
        />
      )}
    </div>
  );
};

export default MediaRecordPanel;
