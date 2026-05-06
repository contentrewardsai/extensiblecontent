import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic,
  Monitor,
  Camera,
  Volume2,
  ExternalLink,
  Loader2,
  Check,
  RotateCcw,
} from "lucide-react";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";

type RecordingMode = "mic" | "system" | "screen" | "webcam";

interface ModeConfig {
  mode: RecordingMode;
  icon: React.FC<{ size?: number; className?: string }>;
  label: string;
}

const MODES: ModeConfig[] = [
  { mode: "mic", icon: Mic, label: "Microphone" },
  { mode: "system", icon: Volume2, label: "System Audio" },
  { mode: "screen", icon: Monitor, label: "Screen" },
  { mode: "webcam", icon: Camera, label: "Webcam" },
];

const MODE_ICONS: Record<RecordingMode, string> = {
  mic: "🎙️",
  system: "🔊",
  screen: "🖥️",
  webcam: "📷",
};

interface StreamInfo {
  mode: RecordingMode;
  filename: string;
  mimeType: string;
  bytesReceived: number;
  chunks: ArrayBuffer[];
}

function openRecorderPopup(modes: RecordingMode[]): Window | null {
  const url = `/recorder?modes=${modes.join(",")}`;
  const w = 700;
  const h = 550;
  const left = Math.round((screen.availWidth - w) / 2);
  const top = Math.round((screen.availHeight - h) / 2);
  return window.open(
    url,
    "media-recorder",
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,scrollbars=no`,
  );
}

interface MediaRecordPanelProps {
  onOpenScreenRecorder?: () => void;
}

export const MediaRecordPanel: React.FC<MediaRecordPanelProps> = () => {
  const importMedia = useProjectStore((s) => s.importMedia);
  const [enabledModes, setEnabledModes] = useState<Set<RecordingMode>>(new Set(["mic"]));
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isReceiving, setIsReceiving] = useState(false);

  const popupWinRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const streamsRef = useRef<StreamInfo[]>([]);
  const [streamProgress, setStreamProgress] = useState<Array<{ mode: RecordingMode; bytes: number }>>([]);

  const toggleMode = useCallback((mode: RecordingMode) => {
    setEnabledModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }, []);

  // Assemble received chunks into files and import them
  const assembleAndImport = useCallback(async () => {
    const streams = streamsRef.current;
    const validStreams = streams.filter((s) => s.bytesReceived > 100);
    if (validStreams.length === 0) return;

    setIsImporting(true);

    const uploadFn = (window as unknown as Record<string, unknown>).__mediaEditorUploadBlob as
      | ((blob: Blob, filename: string, contentType: string) => Promise<string>)
      | undefined;

    for (const stream of validStreams) {
      try {
        const blob = new Blob(stream.chunks, { type: stream.mimeType });
        const mediaFile = new File([blob], stream.filename, { type: stream.mimeType });
        const result = await importMedia(mediaFile);

        if (uploadFn) {
          uploadFn(blob, stream.filename, stream.mimeType)
            .then((url) => {
              console.log(`[MediaRecordPanel] Recording uploaded: ${url}`);
              if (result.actionId) {
                const { project } = useProjectStore.getState();
                const item = project.mediaLibrary.items.find((m) => m.id === result.actionId);
                if (item) {
                  const items = project.mediaLibrary.items as Array<typeof item>;
                  const idx = items.indexOf(item);
                  if (idx >= 0) items[idx] = { ...item, originalUrl: url } as typeof item;
                }
              }
            })
            .catch((err) => {
              console.warn("[MediaRecordPanel] Background upload failed:", err);
            });
        }

        toast.success("Recording Imported", stream.filename);
      } catch (err) {
        console.error("[MediaRecordPanel] Failed to import recording:", err);
        toast.error("Import Failed", `Could not import ${stream.filename}`);
      }
    }

    setIsImporting(false);
  }, [importMedia]);

  const cleanupPopup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    popupWinRef.current = null;
    streamsRef.current = [];
    setStreamProgress([]);
    setIsReceiving(false);
  }, []);

  // Handle premature close: import whatever we received
  const handlePrematureClose = useCallback(async () => {
    const hadData = streamsRef.current.some((s) => s.bytesReceived > 100);
    if (hadData) {
      await assembleAndImport();
      toast.success("Partial Recording", "Recorder closed early — imported available data");
    }
    cleanupPopup();
    setIsPopupOpen(false);
  }, [assembleAndImport, cleanupPopup]);

  // Listen for postMessage from the recorder popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "stream-init") {
        // Recording started — initialize receive buffers
        const infos: StreamInfo[] = data.streams.map((s: { mode: RecordingMode; filename: string; mimeType: string }) => ({
          mode: s.mode,
          filename: s.filename,
          mimeType: s.mimeType,
          bytesReceived: 0,
          chunks: [],
        }));
        streamsRef.current = infos;
        setIsReceiving(true);
        setStreamProgress(infos.map((s) => ({ mode: s.mode, bytes: 0 })));
      } else if (data.type === "stream-chunk") {
        const idx: number = data.streamIndex;
        const buf: ArrayBuffer = data.data;
        const stream = streamsRef.current[idx];
        if (stream) {
          stream.chunks.push(buf);
          stream.bytesReceived += buf.byteLength;
          setStreamProgress((prev) => {
            const next = [...prev];
            if (next[idx]) {
              next[idx] = { ...next[idx], bytes: stream.bytesReceived };
            }
            return next;
          });
        }
      } else if (data.type === "stream-done") {
        // All data streamed — assemble and import
        setIsReceiving(false);
        await assembleAndImport();
        cleanupPopup();
        setIsPopupOpen(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [assembleAndImport, cleanupPopup]);

  const handleOpenRecorder = useCallback(() => {
    if (enabledModes.size === 0) return;

    // If popup is still open, just focus it
    if (isPopupOpen && popupWinRef.current && !popupWinRef.current.closed) {
      popupWinRef.current.focus();
      return;
    }

    // Clean up any previous state
    cleanupPopup();

    const win = openRecorderPopup(Array.from(enabledModes));
    popupWinRef.current = win;
    setIsPopupOpen(true);

    // Poll for window close — the only reliable cross-window detection method
    pollRef.current = window.setInterval(() => {
      if (popupWinRef.current && popupWinRef.current.closed) {
        handlePrematureClose();
      }
    }, 500);
  }, [enabledModes, isPopupOpen, cleanupPopup, handlePrematureClose]);

  useEffect(() => {
    return () => {
      cleanupPopup();
    };
  }, [cleanupPopup]);

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-medium text-text-secondary flex items-center gap-1.5 px-1">
        Record
      </h4>

      {/* Multi-select mode toggles */}
      <div className="grid grid-cols-2 gap-1.5">
        {MODES.map(({ mode, icon: Icon, label }) => {
          const active = enabledModes.has(mode);
          return (
            <button
              key={mode}
              onClick={() => toggleMode(mode)}
              disabled={isPopupOpen}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all text-[10px] ${
                active
                  ? "bg-red-500/10 border-red-500/50 text-red-400"
                  : "bg-background-tertiary border-border text-text-muted hover:border-text-secondary hover:text-text-secondary"
              } ${isPopupOpen ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                active ? "bg-red-500 border-red-500" : "border-current"
              }`}>
                {active && <Check size={9} className="text-white" />}
              </div>
              <Icon size={13} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Per-stream receive progress */}
      {isReceiving && streamProgress.length > 0 && (
        <div className="space-y-1 px-1">
          <p className="text-[9px] text-green-400 font-medium flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" />
            Receiving live data...
          </p>
          {streamProgress.map((sp, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px] text-text-muted">
              <span>{MODE_ICONS[sp.mode]}</span>
              <span className="flex-1 truncate">{sp.mode}</span>
              <span className="font-mono text-text-secondary">
                {sp.bytes > 1048576
                  ? `${(sp.bytes / 1048576).toFixed(1)} MB`
                  : `${(sp.bytes / 1024).toFixed(0)} KB`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Open Recorder button */}
      <button
        onClick={handleOpenRecorder}
        disabled={enabledModes.size === 0 || isImporting}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-[11px] font-medium ${
          isImporting
            ? "bg-background-tertiary text-text-muted cursor-not-allowed"
            : isPopupOpen
              ? "bg-amber-600 hover:bg-amber-700 text-white"
              : "bg-red-600 hover:bg-red-700 disabled:bg-background-tertiary disabled:text-text-muted text-white"
        }`}
      >
        {isImporting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Importing recordings...
          </>
        ) : isPopupOpen ? (
          <>
            <RotateCcw size={13} />
            Focus Recorder Window
          </>
        ) : (
          <>
            <ExternalLink size={13} />
            Open Recorder{enabledModes.size > 0 ? ` (${enabledModes.size})` : ""}
          </>
        )}
      </button>

      {enabledModes.size === 0 && (
        <p className="text-[9px] text-text-muted text-center px-2">
          Select at least one source above to record
        </p>
      )}

      {enabledModes.size > 1 && !isPopupOpen && (
        <p className="text-[9px] text-text-muted text-center px-2">
          Each source records as a separate file
        </p>
      )}
    </div>
  );
};

export default MediaRecordPanel;
