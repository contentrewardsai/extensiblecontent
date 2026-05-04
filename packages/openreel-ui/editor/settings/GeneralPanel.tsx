import React from "react";
import { Switch, Input, Label } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../stores/settings-store";
import { useProjectStore } from "../../stores/project-store";

export const GeneralPanel: React.FC = () => {
  const {
    autoSave,
    autoSaveInterval,
    defaultTtsProvider,
    defaultLlmProvider,
    defaultAggregator,
    configuredServices,
    setAutoSave,
    setAutoSaveInterval,
    setDefaultTtsProvider,
    setDefaultLlmProvider,
    setDefaultAggregator,
  } = useSettingsStore();

  const { project, updateSettings } = useProjectStore();

  const ttsProviders = [
    { id: "kokoro", label: "Kokoro (Free / Built-in)" },
    ...SERVICE_REGISTRY.filter(
      (s) => s.id === "elevenlabs" || configuredServices.includes(s.id),
    ),
  ];

  const llmProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "openai" ||
      s.id === "anthropic" ||
      configuredServices.includes(s.id),
  );

  const aggregatorProviders = SERVICE_REGISTRY.filter(
    (s) =>
      s.id === "kie-ai" ||
      s.id === "freepik" ||
      configuredServices.includes(s.id),
  );

  return (
    <div className="space-y-6 pb-4">
      {/* Auto-save */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">Auto-Save</h3>

        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm text-text-secondary">Enable auto-save</Label>
            <p className="text-xs text-text-muted mt-0.5">
              Automatically save your project at regular intervals
            </p>
          </div>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>

        {autoSave && (
          <div className="flex items-center gap-3">
            <Label className="text-sm text-text-secondary whitespace-nowrap">
              Save every
            </Label>
            <select
              value={autoSaveInterval}
              onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              style={{ colorScheme: 'dark' }}
            >
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Canvas Dimensions */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">Canvas Size</h3>
        <p className="text-xs text-text-muted">
          Current aspect ratio: {(project.settings.width / project.settings.height).toFixed(2)}
        </p>

        <div className="flex gap-2">
          {["1920x1080", "1080x1920", "1080x1080", "1280x720", "720x1280"].map((preset) => {
            const [w, h] = preset.split("x").map(Number);
            const isSelected = project.settings.width === w && project.settings.height === h;
            return (
              <button
                key={preset}
                onClick={() => updateSettings({ width: w, height: h })}
                className={`px-3 py-1.5 rounded text-[10px] transition-colors ${
                  isSelected
                    ? "bg-primary text-white"
                    : "bg-background-tertiary border border-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-text-secondary">W</Label>
            <Input
              type="number"
              value={project.settings.width}
              onChange={(e) => updateSettings({ width: parseInt(e.target.value) || project.settings.width })}
              className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary"
            />
          </div>
          <span className="text-[10px] text-text-muted">x</span>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-text-secondary">H</Label>
            <Input
              type="number"
              value={project.settings.height}
              onChange={(e) => updateSettings({ height: parseInt(e.target.value) || project.settings.height })}
              className="w-20 h-7 text-[10px] bg-background-tertiary border-border text-text-primary"
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Default providers */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-text-primary">
          Default AI Providers
        </h3>
        <p className="text-xs text-text-muted">
          Choose which service to use by default for AI features.
          Configure API keys in the &quot;API Keys&quot; tab first.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              Text to Speech/Voice To Speech/Sound Effects
            </Label>
            <select
              value={defaultTtsProvider}
              onChange={(e) => setDefaultTtsProvider(e.target.value as TtsProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px] text-foreground"
              style={{ colorScheme: 'dark' }}
            >
              {ttsProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm text-text-secondary">
              AI Assistant (LLM)
            </Label>
            <select
              value={defaultLlmProvider}
              onChange={(e) => setDefaultLlmProvider(e.target.value as LlmProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px] text-foreground"
              style={{ colorScheme: 'dark' }}
            >
              {llmProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-text-secondary">
                AI Aggregator
              </Label>
              <p className="text-xs text-text-muted mt-0.5">
                Video/image generation, upscaling, and creative AI tools
              </p>
            </div>
            <select
              value={defaultAggregator}
              onChange={(e) => setDefaultAggregator(e.target.value as AggregatorProvider)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[140px] text-foreground"
              style={{ colorScheme: 'dark' }}
            >
              {aggregatorProviders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
