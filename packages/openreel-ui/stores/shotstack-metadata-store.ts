/**
 * shotstack-metadata-store.ts — Session-scoped Zustand store for ShotStack
 * sidecar data (`_shotstack`) that must survive OpenReel editor operations
 * but is NOT persisted to IndexedDB.  Re-populated on every template load
 * from the DB's ShotStack JSON.
 */

import { create } from "zustand";

export interface ShotstackMergeEntry {
	find: string;
	replace: string;
	/** Type hint for merge field UI: text, image, or video */
	type?: "text" | "image" | "video";
}

export interface ShotstackMetadata {
	merge?: ShotstackMergeEntry[];
	background?: string;
	fonts?: Array<{ family: string; src: string }>;
	soundtrack?: { src: string; volume?: number; effect?: string };
	outputOverrides?: Record<string, unknown>;
	rawClipData?: Record<string, Record<string, unknown>>;
	captionSourceBySubtitleId?: Record<string, { originalClip: unknown }>;
}

export interface ShotstackMetadataState {
	metadata: ShotstackMetadata;

	/** Replace the entire metadata blob (called on project load). */
	setMetadata: (metadata: ShotstackMetadata) => void;

	/** Get the current metadata snapshot. */
	getMetadata: () => ShotstackMetadata;

	/** Update a single merge entry's `replace` value. */
	updateMergeValue: (find: string, replace: string) => void;

	/** Add a new merge entry if it doesn't already exist. */
	addMergeEntry: (entry: ShotstackMergeEntry) => void;

	/** Remove a merge entry by its `find` key. */
	removeMergeEntry: (find: string) => void;

	/** Reset to empty metadata. */
	clear: () => void;
}

const EMPTY_METADATA: ShotstackMetadata = {};

function normKey(f: string): string {
	return String(f ?? "")
		.trim()
		.toUpperCase()
		.replace(/\s+/g, "_");
}

export const useShotstackMetadataStore = create<ShotstackMetadataState>()(
	(set, get) => ({
		metadata: { ...EMPTY_METADATA },

		setMetadata: (metadata: ShotstackMetadata) => set({ metadata }),

		getMetadata: () => get().metadata,

		updateMergeValue: (find: string, replace: string) => {
			const { metadata } = get();
			const merge = (metadata.merge ?? []).map((m) =>
				normKey(m.find) === normKey(find) ? { ...m, replace } : m,
			);
			set({ metadata: { ...metadata, merge } });
		},

		addMergeEntry: (entry: ShotstackMergeEntry) => {
			const { metadata } = get();
			const merge = metadata.merge ?? [];
			const key = normKey(entry.find);
			if (merge.some((m) => normKey(m.find) === key)) return;
			set({ metadata: { ...metadata, merge: [...merge, entry] } });
		},

		removeMergeEntry: (find: string) => {
			const { metadata } = get();
			const key = normKey(find);
			const merge = (metadata.merge ?? []).filter(
				(m) => normKey(m.find) !== key,
			);
			set({ metadata: { ...metadata, merge } });
		},

		clear: () => set({ metadata: { ...EMPTY_METADATA } }),
	}),
);
