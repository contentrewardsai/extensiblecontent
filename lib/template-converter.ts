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
	/** Aligns with OpenReel MediaItem: hydrated in editor host after fetch/TTS */
	blob: Blob | null;
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
	isPlaceholder?: boolean;
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
		highlightColor?: string;
		upcomingColor?: string;
	};
	words?: Array<{ text: string; startTime: number; endTime: number }>;
	/** Matches @openreel/core CaptionAnimationStyle */
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
		svgClipData?: Record<string, any>;
		textClipData?: Record<string, any>;
		htmlClipData?: Record<string, any>;
		shapeClipData?: Record<string, any>;
		/** Full ShotStack clip per OpenReel subtitle id (caption / rich-caption round-trip) */
		captionSourceBySubtitleId?: Record<string, { originalClip: ShotstackClip }>;
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
		case "text":
		case "rich-text":
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
		if (position.includes("left")) x = -0.5;
		if (position.includes("right")) x = 0.5;
		if (position.includes("top")) y = -0.5;
		if (position.includes("bottom")) y = 0.5;
	}
	if (offset) {
		x += offset.x || 0;
		y -= offset.y || 0;
	}
	return { x, y };
}

/**
 * Given a normalized {x, y} position and a known ShotStack position anchor
 * name, compute the ShotStack offset that reproduces the same position.
 * This is the inverse of positionToXY for a specific anchor.
 */
function xyToOffset(x: number, y: number, anchor: string): { x: number; y: number } {
	let anchorX = 0;
	let anchorY = 0;
	if (anchor.includes("left")) anchorX = -0.5;
	if (anchor.includes("right")) anchorX = 0.5;
	if (anchor.includes("top")) anchorY = -0.5;
	if (anchor.includes("bottom")) anchorY = 0.5;
	const offX = x - anchorX;
	const offY = -(y - anchorY);
	return {
		x: Math.abs(offX) < 0.001 ? 0 : offX,
		y: Math.abs(offY) < 0.001 ? 0 : offY,
	};
}

function xyToPosition(x: number, y: number): { position: string; offset: { x: number; y: number } } {
	if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) {
		return { position: "center", offset: { x: 0, y: 0 } };
	}

	let pos = "center";
	let anchorX = 0;
	let anchorY = 0;

	if (y < -0.25) {
		anchorY = -0.5;
		if (x < -0.25) { pos = "topLeft"; anchorX = -0.5; }
		else if (x > 0.25) { pos = "topRight"; anchorX = 0.5; }
		else { pos = "top"; }
	} else if (y > 0.25) {
		anchorY = 0.5;
		if (x < -0.25) { pos = "bottomLeft"; anchorX = -0.5; }
		else if (x > 0.25) { pos = "bottomRight"; anchorX = 0.5; }
		else { pos = "bottom"; }
	} else {
		if (x < -0.25) { pos = "left"; anchorX = -0.5; }
		else if (x > 0.25) { pos = "right"; anchorX = 0.5; }
		else { pos = "center"; }
	}

	const residualX = x - anchorX;
	const residualY = -(y - anchorY);
	return {
		position: pos,
		offset: {
			x: Math.abs(residualX) < 0.001 ? 0 : residualX,
			y: Math.abs(residualY) < 0.001 ? 0 : residualY,
		},
	};
}

const OPENREEL_CAPTION_ANIMATIONS = new Set([
	"none",
	"word-highlight",
	"word-by-word",
	"karaoke",
	"bounce",
	"typewriter",
]);

/** Map ShotStack / legacy generator caption animation names to OpenReel CaptionAnimationStyle */
function shotstackCaptionStyleToOpenReel(raw?: string): string {
	const s = String(raw ?? "")
		.toLowerCase()
		.trim();
	if (OPENREEL_CAPTION_ANIMATIONS.has(s)) return s;
	switch (s) {
		case "highlight":
			return "word-highlight";
		case "pop":
		case "fade":
			return "word-highlight";
		default:
			return "karaoke";
	}
}

function shotstackClipPositionToSubtitleVertical(position?: string): "top" | "center" | "bottom" {
	if (!position) return "bottom";
	if (position.includes("top")) return "top";
	if (position.includes("bottom")) return "bottom";
	return "center";
}

function subtitleStyleFromCaptionAsset(asset: ShotstackAsset, stClipPosition?: string): NonNullable<ORSubtitle["style"]> {
	const font = (asset.font || {}) as Record<string, unknown>;
	const bg = (asset.background || {}) as Record<string, unknown>;
	const active = (asset.active || {}) as Record<string, unknown>;
	const activeFont = (active.font || {}) as Record<string, unknown>;

	const fontFamily = String(font.family || font.fontFamily || "Inter");
	const fontSizeRaw = font.size ?? font.fontSize ?? 48;
	const fontSize = typeof fontSizeRaw === "number" ? fontSizeRaw : Number(fontSizeRaw);
	const color = String(font.color || "#ffffff");

	let backgroundColor = "rgba(0, 0, 0, 0.7)";
	if (typeof bg.color === "string" && bg.color.length > 0) {
		backgroundColor = bg.color;
	} else if (typeof font.background === "string") {
		backgroundColor = font.background;
	}

	const position = shotstackClipPositionToSubtitleVertical(stClipPosition);
	const highlightColor =
		activeFont.color != null && String(activeFont.color) !== ""
			? String(activeFont.color)
			: "#efbf04";

	return {
		fontFamily,
		fontSize: Number.isFinite(fontSize) ? fontSize : 48,
		color,
		backgroundColor,
		position,
		highlightColor,
		upcomingColor: color,
	};
}

function openReelCaptionStyleToShotstack(raw?: string): string {
	const s = String(raw || "karaoke").toLowerCase();
	if (s === "word-highlight") return "highlight";
	return s;
}

function deepCloneShotstackClip(clip: ShotstackClip): ShotstackClip {
	return JSON.parse(JSON.stringify(clip)) as ShotstackClip;
}

/** Infer merge field types (text, image, video) from how tokens are used in ShotStack assets. */
function inferMergeTypes(
	merge: Array<{ find: string; replace: string }> | undefined,
	stTracks: ShotstackTrack[],
): Array<{ find: string; replace: string; type?: "text" | "image" | "video" }> | undefined {
	if (!merge || merge.length === 0) return merge;

	// Build a map: MERGE_KEY → "text" | "image" | "video"
	const keyUsage = new Map<string, "text" | "image" | "video">();

	for (const track of stTracks) {
		for (const clip of track.clips) {
			const asset = clip.asset;
			if (!asset) continue;
			const assetType = (asset.type || "").toLowerCase();

			const checkField = (val: unknown, fieldContext: "src" | "text") => {
				if (typeof val !== "string") return;
				const regex = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
				let m: RegExpExecArray | null;
				while ((m = regex.exec(val)) !== null) {
					const key = m[1].toUpperCase();
					if (keyUsage.has(key)) continue;
					if (fieldContext === "src") {
						keyUsage.set(key, assetType === "image" || assetType === "svg" || assetType === "luma" ? "image" : "video");
					} else {
						keyUsage.set(key, "text");
					}
				}
			};

			checkField(asset.src, "src");
			checkField(asset.text, "text");
			checkField(asset.html, "text");
		}
	}

	return merge.map((m) => ({
		...m,
		type: keyUsage.get(m.find.toUpperCase()) ?? "text",
	}));
}

/**
 * Apply programmatic style overrides from merge entries to ShotStack assets.
 *
 * ShotStack templates embed a __CFS_INPUT_SCHEMA in their merge array that
 * defines UI inputs (font family, size, color, background, inset, etc.).
 * Each input has an `id` (e.g. "nameFontFamily") whose value is stored in the
 * merge array, and a `mergeField` (e.g. "AD_APPLE_NOTES_TITLE_FONT_FAMILY")
 * that names the template variable.
 *
 * Unlike text content (which uses {{ KEY }} tokens), style fields are applied
 * programmatically: the generator reads the merge values and patches asset
 * properties by matching clip aliases.  We replicate that logic here so the
 * OpenReel editor sees the correct styles at conversion time.
 */
function applyStyleMergeOverrides(
	edit: ShotstackEdit,
	mergeMap: Map<string, string>,
): void {
	if (!edit.merge || !edit.timeline?.tracks) return;

	// Build a case-insensitive values map from all merge entries
	const vals = new Map<string, string>();
	for (const m of edit.merge) {
		if (m.find && m.replace != null) {
			vals.set(m.find, m.replace);
			vals.set(m.find.toUpperCase(), m.replace);
		}
	}

	// Helper: look up a value by multiple key variants
	function v(primary: string, ...fallbacks: string[]): string | undefined {
		const keys = [primary, ...fallbacks];
		for (const k of keys) {
			const val = vals.get(k) ?? vals.get(k.toUpperCase());
			if (val !== undefined && val !== "") return val;
		}
		return undefined;
	}

	function numV(primary: string, ...fallbacks: string[]): number | undefined {
		const raw = v(primary, ...fallbacks);
		if (raw === undefined) return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	// Parse __CFS_INPUT_SCHEMA for field→property mappings
	interface InputField {
		id: string;
		type: string;
		mergeField?: string;
		default?: unknown;
	}
	let inputSchema: InputField[] = [];
	for (const m of edit.merge) {
		if (m.find === "__CFS_INPUT_SCHEMA" && m.replace) {
			try {
				inputSchema = JSON.parse(m.replace);
			} catch {
				/* ignore parse failures */
			}
			break;
		}
	}

	// Build alias→clip lookup from all tracks
	const clipsByAlias = new Map<string, ShotstackClip[]>();
	for (const track of edit.timeline.tracks) {
		for (const clip of track.clips) {
			const a = (clip as Record<string, unknown>).alias as string | undefined;
			if (a) {
				const arr = clipsByAlias.get(a) || [];
				arr.push(clip);
				clipsByAlias.set(a, arr);
			}
		}
	}

	// Build a map: mergeField → { property, inputId, value }
	// Property is inferred from the input field's id suffix.
	interface StyleOverride {
		property: "fontFamily" | "fontSize" | "fontColor" | "fontWeight" | "fontStyle" | "insetX" | "background";
		value: string;
		mergeField?: string;
	}

	const overridesByMergePrefix = new Map<string, StyleOverride[]>();

	for (const field of inputSchema) {
		const value = v(field.id, field.mergeField || "");
		if (value === undefined) continue;

		const idLower = field.id.toLowerCase();
		let property: StyleOverride["property"] | undefined;

		if (idLower.endsWith("fontfamily")) property = "fontFamily";
		else if (idLower.endsWith("fontsize")) property = "fontSize";
		else if (idLower === "namecolor" || idLower === "textcolor" || idLower.endsWith("fontcolor")) property = "fontColor";
		else if (idLower.endsWith("fontstyle")) property = "fontStyle";
		else if (idLower.endsWith("fontweight")) property = "fontWeight";
		else if (idLower.endsWith("insetx")) property = "insetX";
		else if (idLower === "backgroundcolor" || idLower === "background") property = "background";

		if (!property) continue;

		// If the field has a mergeField, use its prefix to find the target clip alias.
		// Convention: mergeField like "AD_APPLE_NOTES_TITLE_FONT_FAMILY" → strip the
		// suffix to get a prefix, then find clips whose alias shares that base.
		if (field.mergeField) {
			const mf = field.mergeField.toUpperCase();
			const arr = overridesByMergePrefix.get(mf) || [];
			arr.push({ property, value, mergeField: mf });
			overridesByMergePrefix.set(mf, arr);
		}

		// Also store by input id prefix (e.g. "name" from "nameFontFamily")
		const prefixMatch = field.id.match(/^([a-z]+?)(?:FontFamily|FontSize|FontWeight|FontStyle|Color|InsetX)$/i);
		if (prefixMatch) {
			const prefix = prefixMatch[1].toLowerCase();
			const key = `__prefix:${prefix}`;
			const arr = overridesByMergePrefix.get(key) || [];
			arr.push({ property, value });
			overridesByMergePrefix.set(key, arr);
		}
	}

	// Apply background color to timeline
	const bg = v("backgroundColor", "background");
	if (bg && edit.timeline.background) {
		edit.timeline.background = bg;
	} else if (bg && !edit.timeline.background) {
		edit.timeline.background = bg;
	}

	// For each clip, determine which overrides apply based on alias matching.
	// The input schema links input IDs to merge fields via naming conventions.
	// We use two strategies to match clips to overrides:
	// 1. The clip alias itself appears as a text content mergeField in the schema
	//    (e.g. "nameInput" has mergeField "AD_APPLE_NOTES_NAME_1" → this links
	//    "name*" prefix overrides to clips with alias "AD_APPLE_NOTES_NAME_1")
	// 2. Direct matching by merge field prefix similarity to alias

	// Build prefix→alias mapping from text/textarea input fields
	const prefixToAliases = new Map<string, string[]>();
	for (const field of inputSchema) {
		if ((field.type === "text" || field.type === "textarea") && field.mergeField) {
			const prefixMatch = field.id.match(/^([a-z]+?)(?:Input|Text)$/i);
			if (prefixMatch) {
				const prefix = prefixMatch[1].toLowerCase();
				const aliases = prefixToAliases.get(prefix) || [];
				aliases.push(field.mergeField.toUpperCase());
				prefixToAliases.set(prefix, aliases);
			}
		}
	}

	// Apply overrides to matching clips
	for (const [prefix, aliases] of prefixToAliases) {
		const overrides = overridesByMergePrefix.get(`__prefix:${prefix}`);
		if (!overrides || overrides.length === 0) continue;

		for (const alias of aliases) {
			const clips = clipsByAlias.get(alias);
			if (!clips) continue;

			for (const clip of clips) {
				const asset = clip.asset;
				if (!asset) continue;
				const font = (asset.font || {}) as Record<string, unknown>;
				let fontModified = false;

				for (const ov of overrides) {
					switch (ov.property) {
						case "fontFamily":
							font.family = ov.value;
							fontModified = true;
							break;
						case "fontSize": {
							const n = Number(ov.value);
							if (Number.isFinite(n) && n > 0) {
								font.size = n;
								fontModified = true;
							}
							break;
						}
						case "fontColor":
							font.color = ov.value;
							fontModified = true;
							break;
						case "fontWeight":
							font.weight = ov.value;
							fontModified = true;
							break;
						case "fontStyle":
							font.style = ov.value;
							fontModified = true;
							break;
						case "insetX": {
							const n = Number(ov.value);
							if (Number.isFinite(n) && n >= 0) {
								const pad = (asset.padding || {}) as Record<string, unknown>;
								pad.left = n;
								pad.right = n;
								asset.padding = pad;
								(asset as Record<string, unknown>).left = n;
								(asset as Record<string, unknown>).right = n;
							}
							break;
						}
					}
				}

				if (fontModified) {
					asset.font = font;
				}
			}
		}
	}

	// Also apply inset to all rich-text clips if a global inset is defined
	const globalInset = numV("textInsetX", "AD_APPLE_NOTES_TEXT_INSET_X");
	if (globalInset !== undefined && globalInset >= 0) {
		for (const track of edit.timeline.tracks) {
			for (const clip of track.clips) {
				const asset = clip.asset;
				if (!asset) continue;
				const type = (asset.type as string || "").toLowerCase();
				if (type === "rich-text" || type === "text") {
					const a = (clip as Record<string, unknown>).alias as string | undefined;
					if (a) {
						const pad = (asset.padding || {}) as Record<string, unknown>;
						if (pad.left === undefined) pad.left = globalInset;
						if (pad.right === undefined) pad.right = globalInset;
						asset.padding = pad;
					}
				}
			}
		}
	}
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

	const mergeMap = new Map<string, string>();
	if (edit.merge) {
		for (const m of edit.merge) {
			if (m.find && m.replace != null) mergeMap.set(m.find.toUpperCase(), m.replace);
		}
	}
	function resolveMerge(val: unknown): string {
		if (typeof val !== "string") return String(val ?? "");
		if (!val.includes("{{")) return val;
		return val.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
			const resolved = mergeMap.get(key.toUpperCase());
			return resolved !== undefined ? resolved : match;
		});
	}
	function parseMergeNumber(val: unknown, fallback: number): number {
		if (typeof val === "number" && Number.isFinite(val)) return val;
		if (typeof val === "string") {
			const resolved = resolveMerge(val);
			const n = Number(resolved);
			if (Number.isFinite(n)) return n;
		}
		return fallback;
	}

	// ── Pre-process: apply style merge overrides to ShotStack assets ──
	// The generator has two mechanisms:
	// 1. {{ KEY }} token substitution (handled above by resolveMerge)
	// 2. Programmatic style overrides: merge entries like nameFontFamily,
	//    nameFontSize, textColor etc. override hardcoded asset properties.
	//    These are NOT {{ }} tokens; the generator applies them by matching
	//    clip aliases to input schema fields.
	applyStyleMergeOverrides(edit, mergeMap);

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
	const svgClipData: Record<string, any> = {};
	const textClipData: Record<string, any> = {};
	const htmlClipData: Record<string, any> = {};
	const shapeClipData: Record<string, any> = {};
	const captionSourceBySubtitleId: Record<string, { originalClip: ShotstackClip }> = {};
	let maxTime = 0;
	
	const stTracks = edit.timeline?.tracks || [];
	for (let ti = 0; ti < stTracks.length; ti++) {
		const stTrack = stTracks[ti];

		// ShotStack allows mixed asset types on one track, but OpenReel
		// tracks are typed (video, audio, text, image, graphics).  Group
		// the clips by their resolved track type so each OpenReel track
		// contains only homogeneous clip types.
		const clipsByTrackType = new Map<ORTrack["type"], { trackId: string; clips: ORClip[] }>();

		// Per-ShotStack-track IDs for special clip types (text, graphics, HTML).
		// Each ShotStack track gets its own OpenReel track(s) to preserve z-ordering.
		let perTrackTextId: string | undefined;
		let perTrackGraphicsId: string | undefined;
		let perTrackHtmlId: string | undefined;
		let hasTextInTrack = false;
		let hasGraphicsInTrack = false;
		let hasHtmlInTrack = false;

		for (const stClip of stTrack.clips) {
			const asset = stClip.asset || { type: "video" };
			const assetType = (asset.type || "video").toLowerCase();
			const start = resolveNumber(stClip.start, 0);
			const length = resolveNumber(stClip.length, 5);
			const clipEnd = start + length;
			if (clipEnd > maxTime) maxTime = clipEnd;

			if (assetType === "caption" || assetType === "rich-caption") {
				const subtitleId = uuidv4();
				const animObj = asset.animation as Record<string, unknown> | undefined;
				const animRaw = typeof animObj?.style === "string" ? animObj.style : undefined;
				const wordRows = Array.isArray(asset.words)
					? (asset.words as Array<{ text: string; start: number; end: number }>)
					: [];
				const animationStyle =
					wordRows.length > 0
						? shotstackCaptionStyleToOpenReel(animRaw ?? "karaoke")
						: "none";

				const style = subtitleStyleFromCaptionAsset(asset, stClip.position);

				let fullText = "";
				let wordsAbsolute: Array<{ text: string; startTime: number; endTime: number }> | undefined;

				if (wordRows.length > 0) {
					wordsAbsolute = wordRows.map((w) => ({
						text: w.text,
						startTime: start + (w.start ?? 0),
						endTime: start + (w.end ?? 0),
					}));
					fullText = wordRows.map((w) => w.text).join(" ");
				} else if (asset.text) {
					fullText = String(asset.text);
				}

				if (fullText.trim().length > 0) {
					subtitles.push({
						id: subtitleId,
						text: fullText,
						startTime: start,
						endTime: clipEnd,
						style,
						words: wordsAbsolute,
						animationStyle,
					});
					captionSourceBySubtitleId[subtitleId] = {
						originalClip: deepCloneShotstackClip(stClip),
					};
				}
				continue;
			}

			const clipId = uuidv4();

			console.log(`[ShotStack→OR] Track ${ti}, clip: type="${assetType}", src="${(asset.src as string || "").slice(0, 80)}", text="${(asset.text as string || "").slice(0, 40)}", html="${(asset.html as string || "").slice(0, 40)}", position="${stClip.position || ""}", offset=${JSON.stringify(stClip.offset || {})}, w=${stClip.width ?? asset.width ?? "?"}, h=${stClip.height ?? asset.height ?? "?"}, scale=${stClip.scale ?? 1}`);

			if (assetType === "svg") {
				if (!perTrackGraphicsId) perTrackGraphicsId = uuidv4();
				svgClipData[clipId] = {
					svgSrc: asset.src,
					startTime: start,
					duration: length,
					trackId: perTrackGraphicsId,
					position: positionToXY(stClip.position, stClip.offset),
					positionAnchor: (stClip.position as string) || "center",
					scale: stClip.scale || 1,
					opacity: stClip.opacity ?? 1,
					originalAsset: { ...asset },
					originalTrackIndex: ti,
				};
				hasGraphicsInTrack = true;
				continue;
			}

			if (assetType === "shape") {
				const shapeType = (asset.shape as string) || "rectangle";
				const fillColor = resolveMerge((asset.fill as any)?.color) || "#cccccc";
				const strokeColor = (asset.stroke as any)?.color ? resolveMerge((asset.stroke as any).color) : undefined;
				const strokeWidth = (asset.stroke as any)?.width || 0;
				const cornerRadius = (asset.rectangle as any)?.cornerRadius ?? (asset.circle as any)?.radius ?? 0;
				if (!perTrackGraphicsId) perTrackGraphicsId = uuidv4();

				// Auto-correct corrupted position data: if position is a
				// vertical-only anchor ("top"/"bottom") with a small positive
				// offset.x, the position was likely "topLeft"/"bottomLeft"
				// before a bad round-trip stripped the horizontal component.
				let correctedPosition = (stClip.position as string) || "center";
				const rawOff = stClip.offset as { x?: number; y?: number } | undefined;
				if (rawOff && typeof rawOff.x === "number" && rawOff.x > 0 && rawOff.x < 0.3) {
					if (correctedPosition === "top") correctedPosition = "topLeft";
					else if (correctedPosition === "bottom") correctedPosition = "bottomLeft";
				}
				if (rawOff && typeof rawOff.x === "number" && rawOff.x < 0 && rawOff.x > -0.3) {
					if (correctedPosition === "top") correctedPosition = "topRight";
					else if (correctedPosition === "bottom") correctedPosition = "bottomRight";
				}

				shapeClipData[clipId] = {
					shapeType,
					fillColor,
					strokeColor,
					strokeWidth,
					cornerRadius,
					width: resolveNumber(stClip.width as number, asset.width as number || 100),
					height: resolveNumber(stClip.height as number, asset.height as number || 100),
					startTime: start,
					duration: length,
					trackId: perTrackGraphicsId,
					position: positionToXY(correctedPosition, stClip.offset),
					positionAnchor: correctedPosition,
					originalShotStackPosition: (stClip.position as string) || "center",
					originalShotStackOffset: stClip.offset ? { ...stClip.offset as Record<string, number> } : undefined,
					canvasWidth: width,
					canvasHeight: height,
					scale: stClip.scale || 1,
					opacity: stClip.opacity ?? 1,
					originalAsset: { ...asset },
					originalTrackIndex: ti,
				};
				hasGraphicsInTrack = true;
				continue;
			}

			if (assetType === "html") {
				if (!perTrackHtmlId) perTrackHtmlId = uuidv4();
				const htmlMediaId = uuidv4();
				const htmlW = resolveNumber(asset.width as number, 800);
				const htmlH = resolveNumber(asset.height as number, 200);
				htmlClipData[clipId] = {
					html: resolveMerge(asset.html) || "",
					css: resolveMerge(asset.css) || "",
					width: htmlW,
					height: htmlH,
					background: resolveMerge(asset.background) || "transparent",
					startTime: start,
					duration: length,
					trackId: perTrackHtmlId,
					mediaId: htmlMediaId,
					position: positionToXY(stClip.position, stClip.offset),
					scale: stClip.scale || 1,
					opacity: stClip.opacity ?? 1,
					originalAsset: { ...asset },
					originalTrackIndex: ti,
				};
				mediaItems.push({
					id: htmlMediaId,
					name: `HTML Clip`,
					type: "image",
					fileHandle: null,
					blob: null,
					isPlaceholder: true,
					metadata: { duration: 0, width: htmlW, height: htmlH, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 0 },
					thumbnailUrl: null,
					waveformData: null,
				});
				hasHtmlInTrack = true;
				continue;
			}

			if (assetType === "title" || assetType === "text" || assetType === "rich-text") {
				if (!perTrackTextId) perTrackTextId = uuidv4();

				let textPosition = positionToXY(stClip.position, stClip.offset);
				let textMaxWidth: number | undefined;
				let textAlign: string = "center";
				let verticalAlign: string = "middle";
				let absolutePosition = false;
				const stLineHeight = (asset.style as any)?.lineHeight;

				if (assetType === "rich-text") {
					const padding = asset.padding as { left?: number; top?: number; right?: number } | number | undefined;
					const assetLeft = asset.left as number | undefined;
					const assetTop = asset.top as number | undefined;
					const assetRight = asset.right as number | undefined;
					const clipW = resolveNumber(stClip.width as number, asset.width as number || 0);
					const clipH = resolveNumber(stClip.height as number, asset.height as number || 0);

					let pixelLeft: number | undefined;
					let pixelTop: number | undefined;

					if (typeof padding === "number") {
						pixelLeft = padding;
						pixelTop = padding;
						textMaxWidth = Math.max(50, width - padding * 2);
					} else if (padding && typeof padding === "object") {
						pixelLeft = padding.left ?? 0;
						pixelTop = padding.top ?? 0;
						const padRight = padding.right ?? padding.left ?? 0;
						textMaxWidth = Math.max(50, width - (pixelLeft ?? 0) - padRight);
					} else if (assetLeft != null && assetTop != null) {
						pixelLeft = assetLeft;
						pixelTop = assetTop;
						if (assetRight != null) {
							textMaxWidth = Math.max(50, width - assetLeft - assetRight);
						} else if (clipW > 0) {
							textMaxWidth = clipW;
						}
					}

					if (pixelLeft != null && pixelTop != null) {
						textPosition = { x: pixelLeft / width, y: pixelTop / height };
						absolutePosition = true;
					}

					if (!textMaxWidth && clipW > 0) {
						textMaxWidth = clipW;
					}

					textAlign = "left";
					verticalAlign = "top";

					const align = asset.align as string | { horizontal?: string; vertical?: string } | undefined;
					if (typeof align === "string") {
						textAlign = align;
					} else if (align && typeof align === "object") {
						if (align.horizontal) textAlign = align.horizontal;
						if (align.vertical) verticalAlign = align.vertical;
					}
				}

				const font = asset.font as Record<string, unknown> | undefined;
				textClipData[clipId] = {
					text: asset.text || asset.html || "Text",
					startTime: start,
					duration: length,
					trackId: perTrackTextId,
					position: textPosition,
					absolutePosition,
					scale: stClip.scale || 1,
					opacity: stClip.opacity ?? 1,
					fontFamily: resolveMerge(font?.family) || "Inter",
					fontSize: parseMergeNumber(font?.size, 48),
					fontWeight: resolveMerge(font?.weight) || "normal",
					fontStyle: resolveMerge(font?.style) || "normal",
					color: resolveMerge(font?.color) || "#ffffff",
					textAlign,
					verticalAlign,
					lineHeight: typeof stLineHeight === "number" ? stLineHeight : undefined,
					maxWidth: textMaxWidth,
					originalAsset: { ...asset },
					originalTrackIndex: ti,
				};
				hasTextInTrack = true;
				continue;
			}

			// Resolve track type per-clip so mixed tracks get split properly
			const resolvedTrackType = assetTypeToTrackType(assetType);
			if (!clipsByTrackType.has(resolvedTrackType)) {
				clipsByTrackType.set(resolvedTrackType, { trackId: uuidv4(), clips: [] });
			}
			const bucket = clipsByTrackType.get(resolvedTrackType)!;

			const rawSrc = asset.src as string | undefined;
			const src = rawSrc ? resolveMerge(rawSrc) : undefined;
			const mediaId = src
				? getOrCreateMediaItem(src, assetType)
				: uuidv4();

			if (!src && (assetType === "text-to-speech")) {
				mediaItems.push({
					id: mediaId,
					name: String(asset.text || "TTS Audio").slice(0, 50),
					type: "audio",
					fileHandle: null,
					blob: null,
					isPlaceholder: true,
					metadata: { duration: length, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 44100, channels: 2, fileSize: 0 },
					thumbnailUrl: null,
					waveformData: null,
				});
			}

			const pos = positionToXY(stClip.position, stClip.offset);

			const orClip: ORClip = {
				id: clipId,
				mediaId,
				trackId: bucket.trackId,
				startTime: start,
				duration: length,
				inPoint: resolveNumber(asset.trim, 0),
				outPoint: resolveNumber(asset.trim, 0) + length,
				effects: [],
				audioEffects: [],
				transform: defaultTransform({
					position: { x: pos.x * width, y: pos.y * height },
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
				originalTrackIndex: ti,
				...(assetType === "text-to-speech" ? {
					voiceId: asset.voice ?? asset.localVoice ?? undefined,
					ttsText: asset.text ?? undefined,
				} : {}),
			};

			bucket.clips.push(orClip);
		}

		// Emit one OpenReel track per resolved track type
		for (const [tType, bucket] of clipsByTrackType) {
			const suffix = clipsByTrackType.size > 1 ? ` (${tType})` : "";
			orTracks.push({
				id: bucket.trackId,
				type: tType,
				name: `Track ${ti + 1}${suffix}`,
				clips: bucket.clips,
				transitions: [],
				locked: false,
				hidden: false,
				muted: false,
				solo: false,
			});
		}

		// Emit per-ShotStack-track special tracks inline to preserve z-ordering.
		// Each ShotStack track that contains text/graphics/html clips gets its
		// own dedicated OpenReel track at the correct z-position.
		if (hasTextInTrack) {
			orTracks.push({
				id: perTrackTextId!,
				type: "text",
				name: "Text Track",
				clips: [],
				transitions: [],
				locked: false,
				hidden: false,
				muted: false,
				solo: false,
			});
		}
		if (hasGraphicsInTrack) {
			orTracks.push({
				id: perTrackGraphicsId!,
				type: "graphics",
				name: "Graphics Track",
				clips: [],
				transitions: [],
				locked: false,
				hidden: false,
				muted: false,
				solo: false,
			});
		}
		if (hasHtmlInTrack) {
			const htmlImageClips: ORClip[] = [];
			for (const [cid, hd] of Object.entries(htmlClipData)) {
				if (hd.trackId !== perTrackHtmlId) continue;
				htmlImageClips.push({
					id: cid,
					mediaId: hd.mediaId,
					trackId: perTrackHtmlId!,
					startTime: hd.startTime,
					duration: hd.duration,
					inPoint: 0,
					outPoint: hd.duration,
					effects: [],
					audioEffects: [],
					transform: defaultTransform({
						position: { x: hd.position.x * width, y: hd.position.y * height },
						scale: { x: hd.scale, y: hd.scale },
						opacity: hd.opacity,
						fitMode: "contain",
					}),
					volume: 1,
					keyframes: [],
				});
			}
			orTracks.push({
				id: perTrackHtmlId!,
				type: "image",
				name: "HTML Track",
				clips: htmlImageClips,
				transitions: [],
				locked: false,
				hidden: false,
				muted: false,
				solo: false,
			});
		}
	}

	const result: ORProject = {
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
			merge: inferMergeTypes(edit.merge, stTracks),
			background: edit.timeline?.background ? resolveMerge(edit.timeline.background) : undefined,
			fonts: edit.timeline?.fonts,
			soundtrack: edit.timeline?.soundtrack,
			outputOverrides: edit.output as Record<string, unknown>,
			rawClipData,
			svgClipData,
			textClipData,
			htmlClipData,
			shapeClipData,
			captionSourceBySubtitleId,
		},
	};

	// ── Soundtrack → audio track ─────────────────────────────────────────────
	if (edit.timeline?.soundtrack?.src) {
		const stSrc = edit.timeline.soundtrack.src;
		const stVol = edit.timeline.soundtrack.volume ?? 1;
		const soundtrackMediaId = getOrCreateMediaItem(stSrc, "audio", "Soundtrack");
		const soundtrackTrackId = uuidv4();
		const soundtrackClipId = uuidv4();
		const soundtrackClip: ORClip = {
			id: soundtrackClipId,
			mediaId: soundtrackMediaId,
			trackId: soundtrackTrackId,
			startTime: 0,
			duration: maxTime || 10,
			inPoint: 0,
			outPoint: maxTime || 10,
			effects: [],
			audioEffects: [],
			transform: defaultTransform(),
			volume: typeof stVol === "number" ? stVol : 1,
			keyframes: [],
		};
		rawClipData[soundtrackClipId] = {
			_isSoundtrack: true,
			originalAsset: { type: "audio", src: stSrc, volume: stVol },
			originalClip: {},
		};
		result.timeline.tracks.push({
			id: soundtrackTrackId,
			type: "audio",
			name: "Soundtrack",
			clips: [soundtrackClip],
			transitions: [],
			locked: false,
			hidden: false,
			muted: false,
			solo: false,
		});
		result.mediaLibrary.items = mediaItems;
	}

	return result;
}

// ─── OpenReel → ShotStack ────────────────────────────────────────────────────

export function openReelToShotstack(project: ORProject): ShotstackEdit {
	const preserved = project._shotstack || {};
	const rawClipData = preserved.rawClipData || {};

	const stTracks: ShotstackTrack[] = [];

	const svgClipDataRt = preserved.svgClipData || {};
	const textClipDataRt = preserved.textClipData || {};
	const htmlClipDataRt = preserved.htmlClipData || {};
	const shapeClipDataRt = preserved.shapeClipData || {};
	const canvasW = project.settings.width || 1920;
	const canvasH = project.settings.height || 1080;

	for (const orTrack of project.timeline.tracks) {
		const clips: ShotstackClip[] = [];

		// ── Regular clips from the OR track's clips array ──
		for (const orClip of orTrack.clips) {
			const raw = rawClipData[orClip.id];
			const originalAsset = (raw?.originalAsset || {}) as Record<string, unknown>;
			const originalClipData = (raw?.originalClip || {}) as Record<string, unknown>;

			if (raw?._isSoundtrack) {
				const mediaItem = project.mediaLibrary.items.find((m) => m.id === orClip.mediaId);
				const soundtrackSrc = mediaItem?.originalUrl || (originalAsset.src as string) || "";
				if (soundtrackSrc) {
					(preserved as Record<string, unknown>)._reconstructedSoundtrack = {
						src: soundtrackSrc,
						volume: orClip.volume !== 1 ? orClip.volume : undefined,
						effect: (originalAsset.effect as string) || undefined,
					};
				}
				continue;
			}

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
				orClip.transform.position.x / canvasW,
				orClip.transform.position.y / canvasH,
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

		// ── Reconstruct side-band clips that belong to this OR track ──
		// Text, SVG, shape, and HTML clips are stored in engine-side data
		// structures; match them back to this track by trackId.

		for (const [, data] of Object.entries(svgClipDataRt)) {
			if (data.trackId !== orTrack.id) continue;
			const origAsset = (data as Record<string, unknown>).originalAsset as ShotstackAsset | undefined;
			if (!origAsset) continue;
			const pos = data.position as { x: number; y: number } | undefined;
			const { position: stPos, offset: stOff } = pos
				? xyToPosition(pos.x, pos.y)
				: { position: undefined, offset: undefined };
			clips.push({
				asset: origAsset,
				start: data.startTime as number,
				length: data.duration as number,
				position: stPos,
				offset: stOff && (stOff.x !== 0 || stOff.y !== 0) ? stOff : undefined,
				scale: data.scale !== 1 ? data.scale : undefined,
				opacity: data.opacity !== 1 ? data.opacity : undefined,
			});
		}

		for (const [, data] of Object.entries(shapeClipDataRt)) {
			if (data.trackId !== orTrack.id) continue;
			const origAsset = (data as Record<string, unknown>).originalAsset as ShotstackAsset | undefined;
			if (!origAsset) continue;
			// Prefer the corrected position anchor + recomputed offset to
			// preserve any auto-correction applied during load, while
			// falling back to xyToPosition for user-moved shapes.
			const correctedAnchor = data.positionAnchor as string | undefined;
			const pos = data.position as { x: number; y: number } | undefined;
			let stPos: string | undefined;
			let stOff: { x: number; y: number } | undefined;
			if (correctedAnchor && pos) {
				stPos = correctedAnchor;
				stOff = xyToOffset(pos.x, pos.y, correctedAnchor);
			} else if (pos) {
				const result = xyToPosition(pos.x, pos.y);
				stPos = result.position;
				stOff = result.offset;
			}
			clips.push({
				asset: origAsset,
				start: data.startTime as number,
				length: data.duration as number,
				position: stPos,
				offset: stOff && (stOff.x !== 0 || stOff.y !== 0) ? stOff : undefined,
				scale: data.scale !== 1 ? data.scale : undefined,
				opacity: data.opacity !== 1 ? data.opacity : undefined,
			});
		}

		for (const [, data] of Object.entries(textClipDataRt)) {
			if (data.trackId !== orTrack.id) continue;
			const origAsset = (data as Record<string, unknown>).originalAsset as ShotstackAsset | undefined;
			if (!origAsset) continue;
			const pos = data.position as { x: number; y: number } | undefined;
			const { position: stPos, offset: stOff } = pos
				? xyToPosition(pos.x, pos.y)
				: { position: undefined, offset: undefined };
			clips.push({
				asset: { ...origAsset, text: data.text as string },
				start: data.startTime as number,
				length: data.duration as number,
				position: stPos,
				offset: stOff && (stOff.x !== 0 || stOff.y !== 0) ? stOff : undefined,
				scale: data.scale !== 1 ? data.scale : undefined,
				opacity: data.opacity !== 1 ? data.opacity : undefined,
			});
		}

		for (const [, data] of Object.entries(htmlClipDataRt)) {
			if (data.trackId !== orTrack.id) continue;
			const origAsset = (data as Record<string, unknown>).originalAsset as ShotstackAsset | undefined;
			if (!origAsset) continue;
			const pos = data.position as { x: number; y: number } | undefined;
			const { position: stPos, offset: stOff } = pos
				? xyToPosition(pos.x, pos.y)
				: { position: undefined, offset: undefined };
			clips.push({
				asset: { ...origAsset, html: data.html as string, css: data.css as string },
				start: data.startTime as number,
				length: data.duration as number,
				position: stPos,
				offset: stOff && (stOff.x !== 0 || stOff.y !== 0) ? stOff : undefined,
				scale: data.scale !== 1 ? data.scale : undefined,
				opacity: data.opacity !== 1 ? data.opacity : undefined,
			});
		}

		if (clips.length > 0) {
			stTracks.push({ clips });
		}
	}

	const captionMeta = preserved.captionSourceBySubtitleId || {};
	const consumedSubtitleIds = new Set<string>();

	for (const sub of project.timeline.subtitles) {
		const meta = captionMeta[sub.id];
		if (!meta) continue;
		consumedSubtitleIds.add(sub.id);

		const clipStart = sub.startTime;
		const clipLen = Math.max(0.001, sub.endTime - sub.startTime);
		const oc = meta.originalClip;
		const baseAsset = (oc.asset || { type: "caption" }) as ShotstackAsset;

		const asset: ShotstackAsset = {
			...baseAsset,
			type: String(baseAsset.type || "caption"),
			text: sub.text,
		};

		if (sub.words && sub.words.length > 0) {
			asset.words = sub.words.map((w) => ({
				text: w.text,
				start: w.startTime - clipStart,
				end: w.endTime - clipStart,
			}));
		}

		const stAnim = openReelCaptionStyleToShotstack(sub.animationStyle);
		const prevAnim = (baseAsset.animation || {}) as Record<string, unknown>;
		asset.animation = { ...prevAnim, style: stAnim };

		if (sub.style?.highlightColor) {
			const prevActive = (baseAsset.active || {}) as Record<string, unknown>;
			const prevActiveFont = (prevActive.font || {}) as Record<string, unknown>;
			asset.active = {
				...prevActive,
				font: { ...prevActiveFont, color: sub.style.highlightColor },
			};
		}

		if (sub.style) {
			const prevFont = (baseAsset.font || {}) as Record<string, unknown>;
			asset.font = {
				...prevFont,
				family: sub.style.fontFamily,
				size: sub.style.fontSize,
				color: sub.style.color,
			};
		}

		if (sub.style?.backgroundColor) {
			const prevBg = (baseAsset.background || {}) as Record<string, unknown>;
			asset.background = { ...prevBg, color: sub.style.backgroundColor };
		}

		const stClip: ShotstackClip = {
			...oc,
			asset,
			start: clipStart,
			length: clipLen,
		};

		stTracks.push({ clips: [stClip] });
	}

	const remainingSubs = project.timeline.subtitles.filter((s) => !consumedSubtitleIds.has(s.id));
	if (remainingSubs.length > 0) {
		const clipStart = Math.min(...remainingSubs.map((s) => s.startTime));
		const clipEnd = Math.max(...remainingSubs.map((s) => s.endTime));

		const mergedWords = remainingSubs.flatMap((s) =>
			s.words && s.words.length > 0
				? s.words.map((w) => ({
						text: w.text,
						start: w.startTime - clipStart,
						end: w.endTime - clipStart,
					}))
				: [
						{
							text: s.text,
							start: s.startTime - clipStart,
							end: s.endTime - clipStart,
						},
					],
		);

		const captionClip: ShotstackClip = {
			asset: {
				type: "caption",
				text: remainingSubs.map((s) => s.text).join(" "),
				words: mergedWords,
				animation: {
					style: openReelCaptionStyleToShotstack(remainingSubs[0]?.animationStyle),
				},
			},
			start: clipStart,
			length: clipEnd - clipStart,
		};
		stTracks.push({ clips: [captionClip] });
	}

	const timeline: ShotstackTimeline = {
		tracks: stTracks,
	};
	if (preserved.background) timeline.background = preserved.background;
	if (preserved.fonts) timeline.fonts = preserved.fonts;
	// Use reconstructed soundtrack (from edited audio track) if available, else preserved
	const reconstructed = (preserved as Record<string, unknown>)._reconstructedSoundtrack as { src: string; volume?: number; effect?: string } | undefined;
	if (reconstructed) {
		timeline.soundtrack = reconstructed;
	} else if (preserved.soundtrack) {
		timeline.soundtrack = preserved.soundtrack;
	}

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
		edit.merge = preserved.merge as Array<{ find: string; replace: string }>;
	}

	// Auto-detect {{ MERGE_KEY }} tokens in text assets and add missing merge entries
	const mergeTokenRegex = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
	const existingKeys = new Set((edit.merge ?? []).map((m) => m.find.toUpperCase()));

	for (const stTrack of stTracks) {
		for (const stClip of stTrack.clips) {
			const searchFields = [
				stClip.asset?.text,
				stClip.asset?.html,
				stClip.asset?.src,
			].filter(Boolean);
			for (const field of searchFields) {
				let match: RegExpExecArray | null;
				mergeTokenRegex.lastIndex = 0;
				while ((match = mergeTokenRegex.exec(String(field))) !== null) {
					const key = match[1].toUpperCase();
					if (!existingKeys.has(key)) {
						existingKeys.add(key);
						if (!edit.merge) edit.merge = [];
						edit.merge.push({ find: key, replace: "" });
					}
				}
			}
		}
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
