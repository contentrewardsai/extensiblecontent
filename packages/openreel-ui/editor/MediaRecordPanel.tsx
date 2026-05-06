import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Mic,
  Monitor,
  Camera,
  Volume2,
  ExternalLink,
  Loader2,
  Check,
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

function openRecorderPopup(modes: RecordingMode[]): { channelId: string; channel: BroadcastChannel } {
  const channelId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const url = `/recorder?channel=${channelId}&modes=${modes.join(",")}`;
  const w = 700;
  const h = 550;
  const left = Math.round((screen.availWidth - w) / 2);
  const top = Math.round((screen.availHeight - h) / 2);
  window.open(
    url,
    "media-recorder",
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,scrollbars=no`,
  );
  const channel = new BroadcastChannel(`recorder-${channelId}`);
  return { channelId, channel };
}

interface MediaRecordPanelProps {
  onOpenScreenRecorder?: () => void;
}

export const MediaRecordPanel: React.FC<MediaRecordPanelProps> = () => {
  const importMedia = useProjectStore((s) => s.importMedia);
  const [enabledModes, setEnabledModes] = useState<Set<RecordingMode>>(new Set(["mic"]));
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const toggleMode = useCallback((mode: RecordingMode) => {
    setEnabledModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }, []);

  const handleOpenRecorder = useCallback(() => {
    if (enabledModes.size === 0) return;

    channelRef.current?.close();

    const { channel } = openRecorderPopup(Array.from(enabledModes));
    channelRef.current = channel;
    setIsPopupOpen(true);

    channel.onmessage = async (event) => {
      const data = event.data;

      if (data.type === "recording-complete") {
        setIsImporting(true);
        const files: Array<{ buffer: ArrayBuffer; filename: string; mimeType: string }> = data.files;

        const uploadFn = (window as unknown as Record<string, unknown>).__mediaEditorUploadBlob as
          | ((blob: Blob, filename: string, contentType: string) => Promise<string>)
          | undefined;

        for (const file of files) {
          try {
            const blob = new Blob([file.buffer], { type: file.mimeType });
            const mediaFile = new File([blob], file.filename, { type: file.mimeType });
            const result = await importMedia(mediaFile);

            if (uploadFn) {
              uploadFn(blob, file.filename, file.mimeType)
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

            toast.success("Recording Imported", file.filename);
          } catch (err) {
            console.error("[MediaRecordPanel] Failed to import recording:", err);
            toast.error("Import Failed", `Could not import ${file.filename}`);
          }
        }

        setIsImporting(false);
        setIsPopupOpen(false);
      } else if (data.type === "recorder-closed") {
        setIsPopupOpen(false);
      }
    };
  }, [enabledModes, importMedia]);

  useEffect(() => {
    return () => {
      channelRef.current?.close();
    };
  }, []);

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

      {/* Open Recorder button */}
      <button
        onClick={handleOpenRecorder}
        disabled={enabledModes.size === 0 || isPopupOpen}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-background-tertiary disabled:text-text-muted text-white rounded-lg transition-colors text-[11px] font-medium"
      >
        {isImporting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Importing recordings...
          </>
        ) : isPopupOpen ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Recorder open...
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
