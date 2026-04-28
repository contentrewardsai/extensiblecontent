/**
 * Module Web Worker: Kokoro TTS + Whisper STT via same-origin vendored bundles
 * (/lib/kokoro/kokoro.web.js, /lib/transformers/transformers.min.js + ORT wasm).
 * Mirrors ExtensibleContentExtension sandbox/quality-check.js (synthesise + transcribe).
 *
 * Diagnostics protocol:
 *   - posts { type: "ready" } once after script eval succeeds
 *   - posts { type: "fatal", error, stack } from self.onerror / unhandledrejection
 *   - posts { type: "result", id, ok: false, error } for any per-call failure
 * The shim treats `fatal` as a permanent worker death and nulls out its reference
 * so subsequent calls fail fast (or fall back to silent TTS) instead of hanging
 * on a dead worker forever.
 */
const ORIGIN = typeof self !== "undefined" && self.location && self.location.origin ? self.location.origin : "";

let kokoroTts = null;
let asrPipeline = null;

function safePost(payload) {
	try {
		self.postMessage(payload);
	} catch (_) {
		/* never throw out of error handlers */
	}
}

function describeError(err) {
	if (!err) return { message: "unknown" };
	if (typeof err === "string") return { message: err };
	const out = {};
	if (typeof err.message === "string") out.message = err.message;
	if (typeof err.name === "string") out.name = err.name;
	if (typeof err.stack === "string") out.stack = err.stack.slice(0, 4000);
	if (typeof err.filename === "string") out.filename = err.filename;
	if (typeof err.lineno === "number") out.lineno = err.lineno;
	if (typeof err.colno === "number") out.colno = err.colno;
	if (!out.message) out.message = String(err);
	return out;
}

self.addEventListener("error", (ev) => {
	safePost({
		type: "fatal",
		source: "error",
		error: describeError(ev && (ev.error || ev)),
	});
});
self.addEventListener("unhandledrejection", (ev) => {
	safePost({
		type: "fatal",
		source: "unhandledrejection",
		error: describeError(ev && ev.reason),
	});
});

function emitProgress(stage, ev) {
	if (!ev || typeof ev !== "object") {
		safePost({ type: "progress", stage, status: "init" });
		return;
	}
	const file = ev.file ?? ev.name ?? "";
	const loaded = typeof ev.loaded === "number" ? ev.loaded : undefined;
	const total = typeof ev.total === "number" ? ev.total : undefined;
	const status = ev.status ?? "";
	safePost({
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
	let mod;
	try {
		mod = await import(new URL("/lib/kokoro/kokoro.web.js", ORIGIN).href);
	} catch (e) {
		throw new Error(`Failed to import kokoro.web.js: ${(e && e.message) || e}`);
	}
	const { KokoroTTS, env } = mod;
	if (!KokoroTTS) throw new Error("kokoro.web.js did not export KokoroTTS");
	const wasmBase = `${ORIGIN}/lib/transformers/`;
	// Force single-threaded ORT. The threaded build's pthread Workers spawn
	// silently and can stall the parent forever in some COEP setups; numThreads=1
	// avoids the pthread pool entirely. See cfs-web-ai.js ensureMainKokoro().
	if (env) {
		if ("wasmPaths" in env) env.wasmPaths = wasmBase;
		if ("numThreads" in env) env.numThreads = 1;
		if ("proxy" in env) env.proxy = false;
		if (env.backends?.onnx?.wasm) {
			env.backends.onnx.wasm.numThreads = 1;
			env.backends.onnx.wasm.proxy = false;
		}
	}
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
	let mod;
	try {
		mod = await import(new URL("/lib/transformers/transformers.min.js", ORIGIN).href);
	} catch (e) {
		throw new Error(`Failed to import transformers.min.js: ${(e && e.message) || e}`);
	}
	const { pipeline, env } = mod;
	if (!pipeline) throw new Error("transformers.min.js did not export pipeline");
	const wasmBase = `${ORIGIN}/lib/transformers/`;
	if (env) {
		env.allowLocalModels = false;
		env.useBrowserCache = true;
		env.useWasmCache = true;
		if (env.backends?.onnx?.wasm) {
			env.backends.onnx.wasm.wasmPaths = wasmBase;
			env.backends.onnx.wasm.numThreads = 1;
			env.backends.onnx.wasm.proxy = false;
		}
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
	if (type === "ping") {
		safePost({ type: "pong" });
		return;
	}
	if (!id) return;
	try {
		if (type === "tts") {
			const blob = await runTts(d.text, d.voice);
			safePost({ type: "result", id, ok: true, blob });
		} else if (type === "stt") {
			const buf = d.buffer;
			if (!buf) throw new Error("No audio buffer");
			const audioBlob = new Blob([buf], { type: d.mimeType || "application/octet-stream" });
			const out = await runStt(audioBlob);
			safePost({ type: "result", id, ok: true, text: out.text, words: out.words });
		} else {
			safePost({ type: "result", id, ok: false, error: "Unknown message type" });
		}
	} catch (e) {
		safePost({ type: "result", id, ok: false, error: (e && e.message) || String(e) });
	}
};

safePost({ type: "ready" });
