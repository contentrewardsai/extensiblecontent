/**
 * Script tags to load the unified editor (Generator tail from ExtensibleContentExtension
 * `load-from-manifest.js`, minus `generator-interface` / `generator.js`).
 * Paths are served from `public/`.
 *
 * Scripts in each inner array load in parallel; groups run in order so dependencies
 * (e.g. fabric → patch, ffmpeg → ffmpeg-local, pixi → pixi-unsafe-eval) are preserved.
 */
export const SHOTSTACK_EDITOR_SCRIPT_GROUPS: string[][] = [
	["/lib/html2canvas.min.js", "/shared/manifest-loader.js"],
	["/lib/fabric.min.js"],
	["/lib/fabric-textbaseline-patch.js"],
	["/generator/inputs/registry.js"],
	[
		"/generator/inputs/text.js",
		"/generator/inputs/textarea.js",
		"/generator/inputs/number.js",
		"/generator/inputs/color.js",
		"/generator/inputs/select.js",
		"/generator/inputs/checkbox.js",
		"/generator/inputs/list.js",
		"/generator/inputs/file.js",
		"/generator/inputs/hidden.js",
		"/generator/inputs/voice.js",
		"/generator/inputs/video.js",
		"/generator/inputs/audio.js",
	],
	["/generator/outputs/registry.js"],
	[
		"/generator/outputs/image.js",
		"/generator/outputs/video.js",
		"/generator/outputs/audio.js",
		"/generator/outputs/book.js",
	],
	["/shared/step-comment.js", "/shared/book-builder.js", "/shared/walkthrough-export.js"],
	["/generator/core/estimate-words.js", "/generator/core/srt.js", "/generator/core/wrap-text.js"],
	["/cfs-web/cfs-web-ai.js"],
	["/generator/tts/default-tts.js", "/generator/tts/tts-audio-cache.js", "/generator/stt/default-stt.js"],
	["/generator/template-engine.js"],
	["/generator/templates/presets/loader.js"],
	["/generator/core/font-loader.js", "/generator/core/position-from-clip.js", "/generator/core/scene.js"],
	["/lib/pixi.min.js"],
	["/lib/pixi-unsafe-eval.min.js"],
	["/generator/core/pixi-timeline-player.js"],
	[
		"/shared/upload-post.js",
		"/generator/editor/extensions/api.js",
		"/generator/editor/extensions/loader.js",
		"/generator/step-generator-ui-loader.js",
		"/generator/editor/fabric-to-timeline.js",
		"/generator/editor/timeline-options.js",
		"/generator/editor/chunk-utils.js",
		"/generator/editor/timeline-panel.js",
	],
	["/lib/ffmpeg/ffmpeg.js"],
	["/shared/ffmpeg-local.js"],
	["/lib/mp4box.all.min.js"],
	["/generator/editor/video-preprocessor.js"],
	["/generator/editor/json-patch.js", "/shared/shotstack-merge-placeholder-fill.js"],
	["/generator/editor/unified-editor.js"],
];

/** Same scripts as `SHOTSTACK_EDITOR_SCRIPT_GROUPS`, in load order (flattened). */
export const SHOTSTACK_EDITOR_SCRIPT_HREFS: string[] = SHOTSTACK_EDITOR_SCRIPT_GROUPS.flat();

export const SHOTSTACK_EDITOR_STYLES: string[] = ["/generator/generator.css", "/generator/editor/editor.css"];
