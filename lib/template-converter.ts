/**
 * template-converter.ts — Bidirectional converter between ShotStack template
 * format and OpenReel project format.
 *
 * ShotStack format (stored in DB as `shotstack_templates.edit`):
 *   { timeline: { tracks: [{ clips: [{ asset, start, length, ... }] }] }, output, merge }
 *
 * OpenReel format (used by the editor at runtime):
 *   Project { settings, mediaLibrary, timeline: { tracks, subtitles, duration } }
 */

import { v4 as uuidv4 } from "uuid";

// ─── ShotStack Types ─────────────────────────────────────────────────────────

export interface ShotstackAsset {
	type: string;
	src?: string;
	text?: string;
	html?: string;
	trim?: number;
	speed?: number;
	volume?: number;
	words?: Array<{ text: string; start: number; end: number }>;
	display?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ShotstackClip {
	asset: ShotstackAsset;
	start: number | string;
	length: number | string;
	fit?: string;
	position?: string;
	offset?: { x: number; y: number };
	scale?: number;
	opacity?: number;
	transition?: Record<string, unknown>;
	effect?: string;
	filter?: string;
	transform?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ShotstackTrack {
	clips: ShotstackClip[];
}

export interface ShotstackTimeline {
	tracks: ShotstackTrack[];
	background?: string;
	fonts?: Array<{ family: string; src: string }>;
	soundtrack?: { src: string; volume?: number; effect?: string };
}

export interface ShotstackOutput {
	format?: string;
	resolution?: string;
	fps?: number;
	size?: { width: number; height: number };
}

export interface ShotstackEdit {
	timeline: ShotstackTimeline;
	output?: ShotstackOutput;
	merge?: Array<{ find: string; replace: string }>;
	/** CFS metadata preserved during round-trip */
	__cfs_metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

// ─── OpenReel Types (simplified for converter — full types from @openreel/core) ──

export interface ORMediaItem {
	id: string;
	name: string;
	type: "video" | "audio" | "image";
	fileHandle: null;
	blob: null;
	metadata: {
		duration: number;
		width: number;
		height: number;
		frameRate: number;
		codec: string;
		sampleRate: number;
		channels: number;
		fileSize: number;
	};
	thumbnailUrl: string | null;
	waveformData: null;
	originalUrl?: string;
}

export interface ORTransform {
	position: { x: number; y: number };
	scale: { x: number; y: number };
	rotation: number;
	anchor: { x: number; y: number };
	opacity: number;
	fitMode?: "contain" | "cover" | "stretch" | "none";
}

export interface ORClip {
	id: string;
	mediaId: string;
	trackId: string;
	startTime: number;
	duration: number;
	inPoint: number;
	outPoint: number;
	effects: Array<{ id: string; type: string; params: Record<string, unknown>; enabled: boolean }>;
	audioEffects: Array<{ id: string; type: string; params: Record<string, unknown>; enabled: boolean }>;
	transform: ORTransform;
	volume: number;
	keyframes: Array<{ id: string; time: number; property: string; value: unknown; easing: EasingType }>;
	speed?: number;
}

export interface ORTrack {
	id: string;
	type: "video" | "audio" | "image" | "text" | "graphics";
	name: string;
	clips: ORClip[];
	transitions: Array<{ id: string; clipAId: string; clipBId: string; type: string; duration: number; params: Record<string, unknown> }>;
	locked: boolean;
	hidden: boolean;
	muted: boolean;
	solo: boolean;
}

export interface ORSubtitle {
	id: string;
	text: string;
	startTime: number;
	endTime: number;
	style?: {
		fontFamily: string;
		fontSize: number;
		color: string;
		backgroundColor: string;
		position: "top" | "center" | "bottom";
	};
	words?: Array<{ text: string; startTime: number; endTime: number }>;
	animationStyle?: string;
}

export interface ORProject {
	id: string;
	name: string;
	createdAt: number;
	modifiedAt: number;
	settings: {
		width: number;
		height: number;
		frameRate: number;
		sampleRate: number;
		channels: number;
	};
	mediaLibrary: { items: ORMediaItem[] };
	timeline: {
		tracks: ORTrack[];
		subtitles: ORSubtitle[];
		duration: number;
		markers: Array<{ id: string; time: number; label: string; color: string }>;
	};
	/** Preserved ShotStack data for lossless round-trip */
	_shotstack?: {
		merge?: Array<{ find: string; replace: string }>;
		background?: string;
		fonts?: Array<{ family: string; src: string }>;
		soundtrack?: { src: string; volume?: number; effect?: string };
		outputOverrides?: Record<string, unknown>;
		rawClipData?: Record<string, Record<string, unknown>>;
	};
}

export type EasingType =
	| "linear"
	| "ease-in"
	| "ease-out"
	| "ease-in-out"
	| "bezier"
	| "easeInQuad"
	| "easeOutQuad"
	| "easeInOutQuad"
	| "easeInCubic"
	| "easeOutCubic"
	| "easeInOutCubic"
	| "easeInQuart"
	| "easeOutQuart"
	| "easeInOutQuart"
	| "easeInQuint"
	| "easeOutQuint"
	| "easeInOutQuint"
	| "easeInSine"
	| "easeOutSine"
	| "easeInOutSine"
	| "easeInExpo"
	| "easeOutExpo"
	| "easeInOutExpo"
	| "easeInCirc"
	| "easeOutCirc"
	| "easeInOutCirc"
	| "easeInBack"
	| "easeOutBack"
	| "easeInOutBack"
	| "easeInElastic"
	| "easeOutElastic"
	| "easeInOutElastic"
	| "easeInBounce"
	| "easeOutBounce"
	| "easeInOutBounce";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultTransform(overrides?: Partial<ORTransform>): ORTransform {
	return {
		position: { x: 0, y: 0 },
		scale: { x: 1, y: 1 },
		rotation: 0,
		anchor: { x: 0.5, y: 0.5 },
		opacity: 1,
		...overrides,
	};
}

function resolveNumber(val: number | string | undefined, fallback: number): number {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const n = Number.parseFloat(val);
		return Number.isFinite(n) ? n : fallback;
	}
	return fallback;
}

function assetTypeToTrackType(assetType: string): ORTrack["type"] {
	switch (assetType) {
		case "video":
			return "video";
		case "audio":
		case "text-to-speech":
			return "audio";
		case "image":
		case "svg":
		case "luma":
			return "image";
		case "title":
		case "html":
		case "caption":
		case "rich-caption":
			return "text";
		case "shape":
			return "graphics";
		default:
			return "video";
	}
}

function assetTypeToMediaType(assetType: string): "video" | "audio" | "image" {
	switch (assetType) {
		case "audio":
		case "text-to-speech":
			return "audio";
		case "image":
		case "svg":
		case "luma":
			return "image";
		default:
			return "video";
	}
}

function positionToXY(
	position: string | undefined,
	offset?: { x: number; y: number },
): { x: number; y: number } {
	let x = 0;
	let y = 0;
	if (position) {
		if (position.includes("left")) x = -0.25;
		if (position.includes("right")) x = 0.25;
		if (position.includes("top")) y = -0.25;
		if (position.includes("bottom")) y = 0.25;
	}
	if (offset) {
		x += offset.x || 0;
		y += offset.y || 0;
	}
	return { x, y };
}

function xyToPosition(x: number, y: number): { position: string; offset: { x: number; y: number } } {
	let pos = "center";
	const ox = x;
	const oy = y;

	if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) {
		return { position: "center", offset: { x: 0, y: 0 } };
	}
	if (y < -0.1) pos = x < -0.1 ? "topLeft" : x > 0.1 ? "topRight" : "top";
	else if (y > 0.1) pos = x < -0.1 ? "bottomLeft" : x > 0.1 ? "bottomRight" : "bottom";
	else pos = x < -0.1 ? "left" : x > 0.1 ? "right" : "center";

	return { position: pos, offset: { x: ox, y: oy } };
}

// ─── ShotStack → OpenReel ────────────────────────────────────────────────────

export function shotstackToOpenReel(
	edit: ShotstackEdit,
	options?: { projectName?: string; projectId?: string },
): ORProject {
	const projectId = options?.projectId || uuidv4();
	const now = Date.now();
	const output = edit.output || {};
	const size = (output as Record<string, unknown>).size as { width?: number; height?: number } | undefined;
	const width = size?.width || 1920;
	const height = size?.height || 1080;
	const fps = (output as Record<string, unknown>).fps as number | undefined || 25;

	const mediaItems: ORMediaItem[] = [];
	const mediaUrlMap = new Map<string, string>();

	function getOrCreateMediaItem(src: string, assetType: string, name?: string): string {
		const existing = mediaUrlMap.get(src);
		if (existing) return existing;

		const mediaId = uuidv4();
		mediaUrlMap.set(src, mediaId);

		mediaItems.push({
			id: mediaId,
			name: name || src.split("/").pop() || "media",
			type: assetTypeToMediaType(assetType),
			fileHandle: null,
			blob: null,
			metadata: { duration: 0, width, height, frameRate: fps, codec: "", sampleRate: 44100, channels: 2, fileSize: 0 },
			thumbnailUrl: null,
			waveformData: null,
			originalUrl: src,
		});

		return mediaId;
	}

	const orTracks: ORTrack[] = [];
	const subtitles: ORSubtitle[] = [];
	const rawClipData: Record<string, Record<string, unknown>> = {};
	let maxTime = 0;

	const stTracks = edit.timeline?.tracks || [];
	for (let ti = 0; ti < stTracks.length; ti++) {
		const stTrack = stTracks[ti];
		const trackId = uuidv4();
		const orClips: ORClip[] = [];

		let trackType: ORTrack["type"] = "video";
		if (stTrack.clips.length > 0) {
			trackType = assetTypeToTrackType(stTrack.clips[0].asset?.type || "video");
		}

		for (const stClip of stTrack.clips) {
			const asset = stClip.asset || { type: "video" };
			const assetType = (asset.type || "video").toLowerCase();
			const start = resolveNumber(stClip.start, 0);
			const length = resolveNumber(stClip.length, 5);
			const clipEnd = start + length;
			if (clipEnd > maxTime) maxTime = clipEnd;

			if (assetType === "caption" || assetType === "rich-caption") {
				if (Array.isArray(asset.words)) {
					for (const word of asset.words as Array<{ text: string; start: number; end: number }>) {
						subtitles.push({
							id: uuidv4(),
							text: word.text,
							startTime: start + (word.start || 0),
							endTime: start + (word.end || 0),
						});
					}
				} else if (asset.text) {
					subtitles.push({
						id: uuidv4(),
						text: String(asset.text),
						startTime: start,
						endTime: clipEnd,
					});
				}
				continue;
			}

			const src = asset.src as string | undefined;
			const mediaId = src
				? getOrCreateMediaItem(src, assetType)
				: uuidv4();

			if (!src && (assetType === "title" || assetType === "html")) {
				mediaItems.push({
					id: mediaId,
					name: String(asset.text || asset.html || "Text").slice(0, 50),
					type: "image",
					fileHandle: null,
					blob: null,
					metadata: { duration: length, width, height, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
					thumbnailUrl: null,
					waveformData: null,
				});
			}

			const clipId = uuidv4();
			const pos = positionToXY(stClip.position, stClip.offset);

			const orClip: ORClip = {
				id: clipId,
				mediaId,
				trackId,
				startTime: start,
				duration: length,
				inPoint: resolveNumber(asset.trim, 0),
				outPoint: resolveNumber(asset.trim, 0) + length,
				effects: [],
				audioEffects: [],
				transform: defaultTransform({
					position: pos,
					scale: { x: stClip.scale || 1, y: stClip.scale || 1 },
					opacity: stClip.opacity ?? 1,
					fitMode: (stClip.fit as ORTransform["fitMode"]) || "cover",
				}),
				volume: typeof asset.volume === "number" ? asset.volume : 1,
				keyframes: [],
				speed: typeof asset.speed === "number" ? asset.speed : undefined,
			};

			rawClipData[clipId] = {
				originalAsset: { ...asset },
				originalClip: { ...stClip, asset: undefined },
			};

			orClips.push(orClip);
		}

		if (orClips.length > 0 || stTrack.clips.length > 0) {
			orTracks.push({
				id: trackId,
				type: trackType,
				name: `Track ${ti + 1}`,
				clips: orClips,
				transitions: [],
				locked: false,
				hidden: false,
				muted: false,
				solo: false,
			});
		}
	}

	return {
		id: projectId,
		name: options?.projectName || "Untitled",
		createdAt: now,
		modifiedAt: now,
		settings: {
			width,
			height,
			frameRate: fps,
			sampleRate: 44100,
			channels: 2,
		},
		mediaLibrary: { items: mediaItems },
		timeline: {
			tracks: orTracks,
			subtitles,
			duration: maxTime || 10,
			markers: [],
		},
		_shotstack: {
			merge: edit.merge,
			background: edit.timeline?.background,
			fonts: edit.timeline?.fonts,
			soundtrack: edit.timeline?.soundtrack,
			outputOverrides: edit.output as Record<string, unknown>,
			rawClipData,
		},
	};
}

// ─── OpenReel → ShotStack ────────────────────────────────────────────────────

export function openReelToShotstack(project: ORProject): ShotstackEdit {
	const preserved = project._shotstack || {};
	const rawClipData = preserved.rawClipData || {};

	const stTracks: ShotstackTrack[] = [];

	for (const orTrack of project.timeline.tracks) {
		const clips: ShotstackClip[] = [];

		for (const orClip of orTrack.clips) {
			const raw = rawClipData[orClip.id];
			const originalAsset = (raw?.originalAsset || {}) as Record<string, unknown>;
			const originalClipData = (raw?.originalClip || {}) as Record<string, unknown>;

			const mediaItem = project.mediaLibrary.items.find((m) => m.id === orClip.mediaId);
			const src = mediaItem?.originalUrl || (originalAsset.src as string) || "";

			let assetType = (originalAsset.type as string) || trackTypeToAssetType(orTrack.type);

			const asset: ShotstackAsset = {
				...originalAsset,
				type: assetType,
			};

			if (src && assetType !== "title" && assetType !== "html") {
				asset.src = src;
			}

			if (orClip.inPoint > 0) {
				asset.trim = orClip.inPoint;
			}
			if (orClip.speed && orClip.speed !== 1) {
				asset.speed = orClip.speed;
			}
			if (orClip.volume !== 1) {
				asset.volume = orClip.volume;
			}

			const { position, offset } = xyToPosition(
				orClip.transform.position.x,
				orClip.transform.position.y,
			);

			const stClip: ShotstackClip = {
				...originalClipData,
				asset,
				start: orClip.startTime,
				length: orClip.duration,
				position,
				offset: offset.x !== 0 || offset.y !== 0 ? offset : undefined,
				scale: orClip.transform.scale.x !== 1 ? orClip.transform.scale.x : undefined,
				opacity: orClip.transform.opacity !== 1 ? orClip.transform.opacity : undefined,
				fit: orClip.transform.fitMode || undefined,
			};

			clips.push(stClip);
		}

		if (clips.length > 0) {
			stTracks.push({ clips });
		}
	}

	if (project.timeline.subtitles.length > 0) {
		const captionClip: ShotstackClip = {
			asset: {
				type: "caption",
				text: project.timeline.subtitles.map((s) => s.text).join(" "),
				words: project.timeline.subtitles.map((s) => ({
					text: s.text,
					start: s.startTime,
					end: s.endTime,
				})),
			},
			start: Math.min(...project.timeline.subtitles.map((s) => s.startTime)),
			length: Math.max(...project.timeline.subtitles.map((s) => s.endTime)) -
				Math.min(...project.timeline.subtitles.map((s) => s.startTime)),
		};
		stTracks.push({ clips: [captionClip] });
	}

	const timeline: ShotstackTimeline = {
		tracks: stTracks,
	};
	if (preserved.background) timeline.background = preserved.background;
	if (preserved.fonts) timeline.fonts = preserved.fonts;
	if (preserved.soundtrack) timeline.soundtrack = preserved.soundtrack;

	const edit: ShotstackEdit = {
		timeline,
	};

	if (preserved.outputOverrides) {
		edit.output = {
			...(preserved.outputOverrides as ShotstackOutput),
			size: { width: project.settings.width, height: project.settings.height },
			fps: project.settings.frameRate,
		};
	} else {
		edit.output = {
			format: "mp4",
			size: { width: project.settings.width, height: project.settings.height },
			fps: project.settings.frameRate,
		};
	}

	if (preserved.merge) {
		edit.merge = preserved.merge;
	}

	return edit;
}

function trackTypeToAssetType(trackType: string): string {
	switch (trackType) {
		case "audio":
			return "audio";
		case "text":
			return "title";
		case "image":
			return "image";
		case "graphics":
			return "shape";
		default:
			return "video";
	}
}
