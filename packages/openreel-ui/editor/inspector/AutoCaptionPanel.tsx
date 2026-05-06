import React, { useState, useCallback, useMemo } from "react";
import { Subtitles, AlertCircle, Loader2 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import type { Subtitle, SubtitleStyle, CaptionAnimationStyle } from "@openreel/core";
import {
  CAPTION_ANIMATION_STYLES,
  getAnimationStyleDisplayName,
} from "@openreel/core";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";

const CAPTION_STYLE_PRESETS = [
  { id: "default", name: "Default", description: "White text on dark background" },
  { id: "modern", name: "Modern", description: "Clean, minimal style" },
  { id: "bold", name: "Bold", description: "Large, impactful text" },
  { id: "cinematic", name: "Cinematic", description: "Film-style captions" },
  { id: "minimal", name: "Minimal", description: "Subtle, understated" },
];

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial",
  fontSize: 24,
  color: "#ffffff",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  position: "bottom",
};

type Phase = "idle" | "loading-model" | "extracting" | "transcribing" | "done" | "error";

interface WhisperWord {
  text: string;
  start: number;
  end: number;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const totalSize = 44 + dataSize;
  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([ab], { type: "audio/wav" });
}

function groupWordsIntoSubtitles(
  words: WhisperWord[],
  clipStartTime: number,
  animation: CaptionAnimationStyle = "word-highlight",
  maxWords = 10,
  maxDuration = 5,
): Subtitle[] {
  const subtitles: Subtitle[] = [];
  let currentWords: WhisperWord[] = [];
  let groupStart = 0;

  for (const word of words) {
    if (currentWords.length === 0) groupStart = word.start;

    const exceedsWords = currentWords.length >= maxWords;
    const exceedsDuration = word.end - groupStart > maxDuration;
    const isPunctuation = /[.!?]$/.test(word.text);

    if ((exceedsWords || exceedsDuration) && currentWords.length > 0) {
      subtitles.push(buildSubtitle(currentWords, clipStartTime, animation));
      currentWords = [word];
      groupStart = word.start;
    } else {
      currentWords.push(word);
      if (isPunctuation && currentWords.length >= 3) {
        subtitles.push(buildSubtitle(currentWords, clipStartTime, animation));
        currentWords = [];
      }
    }
  }

  if (currentWords.length > 0) {
    subtitles.push(buildSubtitle(currentWords, clipStartTime, animation));
  }
  return subtitles;
}

function buildSubtitle(
  words: WhisperWord[],
  clipStartTime: number,
  animation: CaptionAnimationStyle = "word-highlight",
): Subtitle {
  const text = words.map((w) => w.text).join(" ").trim();
  return {
    id: `auto-caption-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text,
    startTime: clipStartTime + words[0].start,
    endTime: clipStartTime + words[words.length - 1].end,
    style: DEFAULT_SUBTITLE_STYLE,
    words: words.map((w) => ({
      text: w.text,
      startTime: clipStartTime + w.start,
      endTime: clipStartTime + w.end,
    })),
    animationStyle: animation,
  };
}

export const AutoCaptionPanel: React.FC = () => {
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const applySubtitleStylePreset = useProjectStore((state) => state.applySubtitleStylePreset);
  const project = useProjectStore((state) => state.project);
  const selectedItems = useUIStore((state) => state.selectedItems);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("default");
  const [animationStyle, setAnimationStyle] = useState<CaptionAnimationStyle>("word-highlight");
  const [error, setError] = useState<string | null>(null);
  const [generatedSubtitles, setGeneratedSubtitles] = useState<Subtitle[]>([]);

  const selectedClip = useMemo(() => {
    const clipSel = selectedItems.find(
      (s) => s.type === "clip",
    );
    if (!clipSel) return null;
    for (const track of project.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipSel.id);
      if (clip) return clip;
    }
    return null;
  }, [selectedItems, project.timeline.tracks]);

  const selectedMediaItem = useMemo(() => {
    if (!selectedClip) return null;
    return project.mediaLibrary.items.find((m) => m.id === selectedClip.mediaId) ?? null;
  }, [selectedClip, project.mediaLibrary.items]);

  const allAudioVideoClips = useMemo(() => {
    return project.timeline.tracks
      .filter((t) => t.type === "video" || t.type === "audio")
      .flatMap((t) => t.clips);
  }, [project.timeline.tracks]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setGeneratedSubtitles([]);

    const clip = selectedClip;
    const mediaItem = selectedMediaItem;

    if (!clip || !mediaItem) {
      if (allAudioVideoClips.length === 0) {
        setError("No audio or video clips on the timeline. Import media first.");
        return;
      }
      setError("Select an audio or video clip on the timeline to generate captions.");
      return;
    }

    if (!mediaItem.blob && !mediaItem.fileHandle) {
      setError("No audio data available for this clip. Try re-importing the media.");
      return;
    }

    try {
      setPhase("loading-model");
      setStatusMessage("Loading Whisper model...");

      const { ensureSTTLoaded, generateSTT } = await import("@/lib/openreel-service-bridge");
      await ensureSTTLoaded();

      setPhase("extracting");
      setStatusMessage("Extracting audio...");

      let arrayBuffer: ArrayBuffer;
      if (mediaItem.blob) {
        arrayBuffer = await mediaItem.blob.arrayBuffer();
      } else {
        const file = await mediaItem.fileHandle!.getFile();
        arrayBuffer = await file.arrayBuffer();
      }

      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const inPoint = clip.inPoint || 0;
      const outPoint = clip.outPoint || audioBuffer.duration;
      const duration = Math.min(outPoint - inPoint, clip.duration);

      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(inPoint * sampleRate);
      const endSample = Math.floor((inPoint + duration) * sampleRate);
      const numSamples = Math.max(1, endSample - startSample);

      const offlineCtx = new OfflineAudioContext(1, numSamples, sampleRate);
      const trimmedBuffer = offlineCtx.createBuffer(1, numSamples, sampleRate);
      const channelData = trimmedBuffer.getChannelData(0);
      const sourceData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = sourceData[startSample + i] || 0;
      }
      const src = offlineCtx.createBufferSource();
      src.buffer = trimmedBuffer;
      src.connect(offlineCtx.destination);
      src.start(0);

      const rendered = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(rendered);
      audioCtx.close().catch(() => {});

      setPhase("transcribing");
      setStatusMessage("Transcribing audio with Whisper...");

      const result = await generateSTT(wavBlob);
      const words: WhisperWord[] = Array.isArray(result.words) ? result.words : [];

      if (words.length === 0) {
        setPhase("done");
        setStatusMessage("No speech detected in the audio.");
        return;
      }

      const subtitles = groupWordsIntoSubtitles(words, clip.startTime, animationStyle);
      setGeneratedSubtitles(subtitles);
      setPhase("done");
      setStatusMessage(`${subtitles.length} caption${subtitles.length !== 1 ? "s" : ""} generated.`);
    } catch (err) {
      console.error("[AutoCaptionPanel] Transcription failed:", err);
      setPhase("error");
      setError(err instanceof Error ? err.message : "Transcription failed");
    }
  }, [selectedClip, selectedMediaItem, allAudioVideoClips, animationStyle]);

  const handleApply = useCallback(async () => {
    for (const sub of generatedSubtitles) {
      await addSubtitle(sub);
    }
    if (selectedStyle !== "default") {
      await applySubtitleStylePreset(selectedStyle);
    }
    setGeneratedSubtitles([]);
    setPhase("idle");
    setStatusMessage("");
  }, [generatedSubtitles, addSubtitle, applySubtitleStylePreset, selectedStyle]);

  const isProcessing = phase === "loading-model" || phase === "extracting" || phase === "transcribing";

  return (
    <div className="space-y-4 w-full min-w-0 max-w-full">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Subtitles size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Auto-Caption
          </span>
          <p className="text-[9px] text-text-muted">
            Generate captions from audio using Whisper AI
          </p>
        </div>
      </div>

      {selectedClip ? (
        <div className="p-2 bg-background-tertiary rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">Selected Clip</span>
            <span className="text-[10px] text-text-primary font-mono truncate ml-2">
              {selectedMediaItem?.name || selectedClip.id.slice(0, 12)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-text-muted">Duration</span>
            <span className="text-[10px] text-text-muted font-mono">
              {selectedClip.duration.toFixed(1)}s
            </span>
          </div>
        </div>
      ) : (
        <div className="p-3 bg-background-tertiary rounded-lg text-center">
          <p className="text-[10px] text-text-muted">
            Select an audio or video clip on the timeline to generate captions.
          </p>
        </div>
      )}

      <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Caption Style</span>
          <Select
            value={selectedStyle}
            onValueChange={setSelectedStyle}
            disabled={isProcessing}
          >
            <SelectTrigger className="w-auto min-w-[100px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {CAPTION_STYLE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">Animation</span>
          <Select
            value={animationStyle}
            onValueChange={(v) => setAnimationStyle(v as CaptionAnimationStyle)}
            disabled={isProcessing}
          >
            <SelectTrigger className="w-auto min-w-[120px] bg-background-secondary border-border text-text-primary text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {CAPTION_ANIMATION_STYLES.map((style) => (
                <SelectItem key={style} value={style}>
                  {getAnimationStyleDisplayName(style)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400">{error}</span>
        </div>
      )}

      {isProcessing && (
        <div className="space-y-2 p-3 bg-background-tertiary rounded-lg">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="text-primary animate-spin" />
            <span className="text-[10px] text-text-primary">{statusMessage}</span>
          </div>
          <div className="w-full bg-background-secondary rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-500"
              style={{
                width:
                  phase === "loading-model" ? "20%" :
                  phase === "extracting" ? "40%" :
                  "70%",
              }}
            />
          </div>
        </div>
      )}

      {generatedSubtitles.length > 0 && phase === "done" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary">
              {generatedSubtitles.length} caption{generatedSubtitles.length !== 1 ? "s" : ""} generated
            </span>
            <button
              onClick={handleApply}
              className="px-2 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/80 transition-colors"
            >
              Add to Timeline
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {generatedSubtitles.map((sub) => (
              <div
                key={sub.id}
                className="p-2 bg-background-secondary rounded text-[10px] text-text-primary"
              >
                <span className="text-text-muted font-mono">
                  [{sub.startTime.toFixed(1)}s - {sub.endTime.toFixed(1)}s]
                </span>
                <span className="ml-2">{sub.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={isProcessing}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50"
      >
        {isProcessing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Subtitles size={16} />
        )}
        <span className="text-[11px] font-medium">
          {isProcessing ? "Generating..." : "Generate Captions"}
        </span>
      </button>

      <p className="text-[9px] text-text-muted text-center">
        Uses Whisper AI (in-browser) to transcribe audio with word-level timestamps.
        Works best with clear speech in English.
      </p>
    </div>
  );
};

export default AutoCaptionPanel;
