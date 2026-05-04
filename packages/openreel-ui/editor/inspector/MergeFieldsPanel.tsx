import React, { useState, useCallback, useMemo } from "react";
import {
  Settings2,
  Type,
  Image,
  Video,
  Undo2,
  RotateCcw,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import {
  useShotstackMetadataStore,
  type ShotstackMergeEntry,
} from "../../stores/shotstack-metadata-store";

/* ─── Individual merge field input ───────────────────────────────────── */

interface MergeFieldInputProps {
  entry: ShotstackMergeEntry;
  onUpdate: (find: string, replace: string) => void;
  onRemove: (find: string) => void;
}

const typeIcon = (type?: string) => {
  switch (type) {
    case "image":
      return <Image size={12} className="text-blue-400" />;
    case "video":
      return <Video size={12} className="text-green-400" />;
    default:
      return <Type size={12} className="text-primary" />;
  }
};

const MergeFieldInput: React.FC<MergeFieldInputProps> = ({
  entry,
  onUpdate,
  onRemove,
}) => {
  const [value, setValue] = useState(entry.replace ?? "");

  const handleChange = useCallback(
    (newValue: string) => {
      setValue(newValue);
      onUpdate(entry.find, newValue);
    },
    [entry.find, onUpdate],
  );

  const isModified = value !== "" && value !== entry.replace;
  const isMediaField = entry.type === "image" || entry.type === "video";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {typeIcon(entry.type)}
          <span className="text-[11px] font-medium text-text-primary">
            {formatLabel(entry.find)}
          </span>
          <code className="text-[8px] text-text-muted bg-background-secondary px-1 py-0.5 rounded font-mono">
            {"{{ "}
            {entry.find}
            {" }}"}
          </code>
        </div>
        <div className="flex items-center gap-1">
          {isModified && (
            <button
              onClick={() => handleChange(entry.replace ?? "")}
              className="p-1 text-text-muted hover:text-text-primary"
              title="Reset to default"
            >
              <Undo2 size={10} />
            </button>
          )}
          <button
            onClick={() => onRemove(entry.find)}
            className="p-1 text-text-muted hover:text-red-400 transition-colors"
            title="Remove merge field"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {isMediaField ? (
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-2 py-1.5 text-[11px] text-text-primary bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none"
          placeholder={`Enter ${entry.type} URL...`}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          rows={Math.min(3, Math.max(1, Math.ceil((value.length || 20) / 40)))}
          className="w-full px-2 py-1.5 text-[11px] text-text-primary bg-background-tertiary border border-border rounded-lg focus:border-primary focus:outline-none resize-none"
          placeholder="Enter replacement value..."
        />
      )}

      {entry.replace && value !== entry.replace && (
        <p className="text-[9px] text-text-muted">
          Default: <span className="text-text-secondary">{entry.replace}</span>
        </p>
      )}
    </div>
  );
};

/* ─── Helpers ─────────────────────────────────────────────────────────── */

/** Convert UPPER_SNAKE to Title Case. */
function formatLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── Add field form ──────────────────────────────────────────────────── */

interface AddFieldFormProps {
  onAdd: (entry: ShotstackMergeEntry) => void;
  existingKeys: Set<string>;
}

const AddFieldForm: React.FC<AddFieldFormProps> = ({ onAdd, existingKeys }) => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [type, setType] = useState<"text" | "image" | "video">("text");

  const normalizedKey = key
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");

  const isDuplicate = existingKeys.has(normalizedKey);

  const handleSubmit = useCallback(() => {
    if (!normalizedKey || isDuplicate) return;
    onAdd({ find: normalizedKey, replace: "", type });
    setKey("");
    setOpen(false);
  }, [normalizedKey, isDuplicate, type, onAdd]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] border border-dashed border-border text-text-muted hover:text-text-primary hover:border-primary/50 transition-colors"
      >
        <Plus size={10} />
        Add Merge Field
      </button>
    );
  }

  return (
    <div className="p-3 bg-background-tertiary rounded-lg border border-border space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 px-2 py-1 text-[11px] text-text-primary bg-background-secondary border border-border rounded-lg focus:border-primary focus:outline-none font-mono"
          placeholder="FIELD_NAME"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <select
          value={type}
          onChange={(e) =>
            setType(e.target.value as "text" | "image" | "video")
          }
          className="px-2 py-1 text-[10px] text-text-primary bg-background-secondary border border-border rounded-lg focus:border-primary focus:outline-none"
        >
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </div>

      {isDuplicate && (
        <p className="text-[9px] text-red-400">
          A field with this key already exists.
        </p>
      )}
      {normalizedKey && !isDuplicate && (
        <p className="text-[9px] text-text-muted">
          Token: <code className="font-mono text-text-secondary">{"{{ "}{normalizedKey}{" }}"}</code>
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!normalizedKey || isDuplicate}
          className="flex-1 py-1 bg-primary text-white rounded-lg text-[10px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
        <button
          onClick={() => { setOpen(false); setKey(""); }}
          className="px-3 py-1 bg-background-secondary text-text-secondary rounded-lg text-[10px] border border-border"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

/* ─── Main panel ──────────────────────────────────────────────────────── */

export const MergeFieldsPanel: React.FC = () => {
  const { metadata, updateMergeValue, addMergeEntry, removeMergeEntry, setMetadata } =
    useShotstackMetadataStore();

  const mergeEntries = metadata.merge ?? [];

  const existingKeys = useMemo(
    () => new Set(mergeEntries.map((m) => m.find.toUpperCase())),
    [mergeEntries],
  );

  const handleResetAll = useCallback(() => {
    setMetadata({ ...metadata, merge: [] });
  }, [metadata, setMetadata]);

  const hasChanges = mergeEntries.length > 0;

  if (mergeEntries.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-text-primary">
            Merge Fields
          </span>
        </div>
        <div className="text-center py-4">
          <p className="text-[10px] text-text-muted mb-3">
            No merge fields defined yet.
          </p>
          <AddFieldForm onAdd={addMergeEntry} existingKeys={existingKeys} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" />
          <span className="text-[11px] font-medium text-text-primary">
            Merge Fields
          </span>
          <span className="text-[9px] text-text-muted bg-background-tertiary px-1.5 py-0.5 rounded">
            {mergeEntries.length}
          </span>
        </div>
        {hasChanges && (
          <button
            onClick={handleResetAll}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
          >
            <RotateCcw size={10} />
            Clear All
          </button>
        )}
      </div>

      <div className="space-y-3">
        {mergeEntries.map((entry) => (
          <div
            key={entry.find}
            className="p-3 bg-background-tertiary rounded-lg border border-border"
          >
            <MergeFieldInput
              entry={entry}
              onUpdate={updateMergeValue}
              onRemove={removeMergeEntry}
            />
          </div>
        ))}
      </div>

      <AddFieldForm onAdd={addMergeEntry} existingKeys={existingKeys} />

      <p className="text-[9px] text-text-muted text-center">
        Merge fields use{" "}
        <code className="font-mono text-text-secondary">{"{{ KEY }}"}</code>{" "}
        tokens in text and media URLs
      </p>
    </div>
  );
};

export default MergeFieldsPanel;
