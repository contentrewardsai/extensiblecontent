/**
 * Module Web Worker: Kokoro TTS + Whisper STT via same-origin vendored bundles
 * (/lib/kokoro/kokoro.web.js, /lib/transformers/transformers.min.js + ORT wasm).
 * Mirrors ExtensibleContentExtension sandbox/quality-check.js (synthesise + transcribe).
 */
const ORIGIN = typeof self !== "undefined" && self.location && self.location.origin ? self.location.origin : "";

let kokoroTts = null;
let asrPipeline = null;

function emitProgress(stage, ev) {
	if (!ev || typeof ev !== "object") {
		self.postMessage({ type: "progress", stage, status: "init" });
		return;
	}
	const file = ev.file ?? ev.name ?? "";
	const loaded = typeof ev.loaded === "number" ? ev.loaded : undefined;
	const total = typeof ev.total === "number" ? ev.total : undefined;
	const status = ev.status ?? "";
	self.postMessage({
		type: "progress",
		stage,
		file: String(file),
		loaded,
		total,
		status: String(status),
	});
}

async function ensureKokoro() {
	if (kokoroTts) return kokoroTts;
	const mod = await import(new URL("/lib/kokoro/kokoro.web.js", ORIGIN).href);
	const { KokoroTTS, env } = mod;
	const wasmBase = `${ORIGIN}/lib/transformers/`;
	/* `env` is a thin proxy; setting wasmPaths wires ORT to our same-origin ORT wasm files */
	env.wasmPaths = wasmBase;
	kokoroTts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
		dtype: "q8",
		device: "wasm",
		progress_callback: (e) => emitProgress("tts", e),
	});
	return kokoroTts;
}

const DEFAULT_VOICE = "af_heart";

function isKokoroVoice(v) {
	if (!v || typeof v !== "string") return false;
	if (/^[a-z]{2}_[a-z]+$/i.test(v)) return true;
	if (/^[a-z]{2}$/i.test(v)) return true;
	return false;
}

async function runTts(text, voiceOpt) {
	const t = String(text || "").trim();
	if (!t) throw new Error("No text");
	const tts = await ensureKokoro();
	let voice = voiceOpt || "";
	if (!isKokoroVoice(voice)) {
		voice = DEFAULT_VOICE;
	} else {
		try {
			const voices = tts.voices;
			if (voices && typeof voices === "object" && !Object.prototype.hasOwnProperty.call(voices, voice)) {
				voice = DEFAULT_VOICE;
			}
		} catch (_) {
			/* keep voice */
		}
	}
	let audio;
	try {
		audio = await tts.generate(t, { voice });
	} catch (e) {
		if (voice !== DEFAULT_VOICE) {
			audio = await tts.generate(t, { voice: DEFAULT_VOICE });
		} else {
			throw e;
		}
	}
	return audio.toBlob();
}

async function ensureAsr() {
	if (asrPipeline) return asrPipeline;
	const { pipeline, env } = await import(new URL("/lib/transformers/transformers.min.js", ORIGIN).href);
	const wasmBase = `${ORIGIN}/lib/transformers/`;
	env.allowLocalModels = false;
	env.useBrowserCache = true;
	env.useWasmCache = true;
	if (env?.backends?.onnx?.wasm) {
		env.backends.onnx.wasm.wasmPaths = wasmBase;
		env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
	}
	asrPipeline = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
		quantized: true,
		progress_callback: (e) => emitProgress("stt", e),
	});
	return asrPipeline;
}

function parseWhisperResult(result) {
	let text = "";
	let words = [];
	if (typeof result === "string") {
		text = result;
	} else if (result && result.text) {
		text = result.text;
	}
	if (Array.isArray(result && result.chunks)) {
		if (!text) text = result.chunks.map((c) => c.text || "").join(" ");
		words = result.chunks
			.filter((c) => c && c.text && String(c.text).trim())
			.map((c) => {
				const ts = Array.isArray(c.timestamp) ? c.timestamp : [];
				return {
					text: String(c.text).trim(),
					start: typeof ts[0] === "number" ? ts[0] : -1,
					end: typeof ts[1] === "number" ? ts[1] : -1,
				};
			})
			.filter((w) => w.start >= 0 && w.end >= 0 && w.end > w.start);
	}
	return { text: String(text || "").trim(), words };
}

async function runStt(audioBlob) {
	const pipe = await ensureAsr();
	const objectUrl = URL.createObjectURL(audioBlob);
	try {
		let parsed = parseWhisperResult(
			await pipe(objectUrl, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 }),
		);
		if (!parsed.words.length) {
			try {
				parsed = parseWhisperResult(await pipe(objectUrl, { return_timestamps: "word" }));
			} catch (_) {
				/* keep first result */
			}
		}
		return { text: parsed.text, words: parsed.words.length ? parsed.words : undefined };
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

self.onmessage = async (ev) => {
	const d = ev.data || {};
	const { type, id } = d;
	if (!id) return;
	try {
		if (type === "tts") {
			const blob = await runTts(d.text, d.voice);
			self.postMessage({ type: "result", id, ok: true, blob });
		} else if (type === "stt") {
			const buf = d.buffer;
			if (!buf) throw new Error("No audio buffer");
			const audioBlob = new Blob([buf], { type: d.mimeType || "application/octet-stream" });
			const out = await runStt(audioBlob);
			self.postMessage({ type: "result", id, ok: true, text: out.text, words: out.words });
		} else {
			self.postMessage({ type: "result", id, ok: false, error: "Unknown message type" });
		}
	} catch (e) {
		self.postMessage({
			type: "result",
			id,
			ok: false,
			error: (e && e.message) || String(e),
		});
	}
};
