import type { Project } from "@openreel/core";
import type { TextClip } from "@openreel/core";
import type { ShapeClip, SVGClip, StickerClip } from "@openreel/core";

/**
 * Proportionally reposition and rescale all project elements
 * when canvas dimensions change.
 *
 * Algorithm:
 * 1. Compute scale factors from old→new dimensions
 * 2. Proportionally scale positions, element sizes, and font sizes
 * 3. Use min(scaleX, scaleY) for uniform element scaling to avoid distortion
 */
export interface ResponsiveResizeResult {
	/** Updated timeline clips (position/scale transforms adjusted) */
	clips: Project["timeline"]["tracks"];
	/** Updated subtitles (position + fontSize adjusted) */
	subtitles: Project["timeline"]["subtitles"];
}

export function responsiveResize(
	oldWidth: number,
	oldHeight: number,
	newWidth: number,
	newHeight: number,
	project: Project,
): ResponsiveResizeResult {
	if (oldWidth === newWidth && oldHeight === newHeight) {
		return {
			clips: project.timeline.tracks,
			subtitles: project.timeline.subtitles,
		};
	}

	const scaleX = newWidth / oldWidth;
	const scaleY = newHeight / oldHeight;
	const uniformScale = Math.min(scaleX, scaleY);

	// ── Rescale timeline track clips ──────────────────────────────
	const tracks = project.timeline.tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) => ({
			...clip,
			transform: {
				...clip.transform,
				position: {
					x: clip.transform.position.x * scaleX,
					y: clip.transform.position.y * scaleY,
				},
				scale: {
					x: clip.transform.scale.x * uniformScale,
					y: clip.transform.scale.y * uniformScale,
				},
			},
		})),
	}));

	// ── Rescale subtitles (fontSize only — position is semantic top/center/bottom) ──
	const subtitles = project.timeline.subtitles.map((sub) => ({
		...sub,
		style: sub.style
			? {
					...sub.style,
					fontSize: Math.round(sub.style.fontSize * uniformScale),
				}
			: sub.style,
	}));

	return { clips: tracks, subtitles };
}

/**
 * Rescale TextClip transforms when dimensions change.
 */
export function rescaleTextClips(
	textClips: readonly TextClip[],
	scaleX: number,
	scaleY: number,
	uniformScale: number,
): TextClip[] {
	return textClips.map((clip) => ({
		...clip,
		transform: {
			...clip.transform,
			position: {
				x: clip.transform.position.x * scaleX,
				y: clip.transform.position.y * scaleY,
			},
			scale: {
				x: clip.transform.scale.x * uniformScale,
				y: clip.transform.scale.y * uniformScale,
			},
		},
	}));
}

/**
 * Rescale ShapeClip / SVGClip / StickerClip transforms.
 */
export function rescaleGraphicClips<T extends ShapeClip | SVGClip | StickerClip>(
	clips: readonly T[],
	scaleX: number,
	scaleY: number,
	uniformScale: number,
): T[] {
	return clips.map((clip) => ({
		...clip,
		transform: {
			...clip.transform,
			position: {
				x: clip.transform.position.x * scaleX,
				y: clip.transform.position.y * scaleY,
			},
			scale: {
				x: clip.transform.scale.x * uniformScale,
				y: clip.transform.scale.y * uniformScale,
			},
		},
	}));
}
