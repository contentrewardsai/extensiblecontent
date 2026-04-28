/**
 * In-browser Kokoro TTS + Whisper STT bridge for the vendored generator.
 *
 * Tries to run the heavy ONNX inference in a module Web Worker (so it doesn't
 * block the editor UI). If the worker fails to initialise — Chrome occasionally
 * surfaces module-worker module-graph failures as sparse `error` events with
 * no message under COEP `credentialless` — we transparently fall back to the
 * main thread instead of leaving the user with silent narration.
 *
 * Public surface (consumed by `template-engine.js` etc.):
 *   - window.__CFS_ttsGenerate(text, opts)        → Promise<Blob>
 *   - window.__CFS_sttGenerate(audioBlob, opts)   → Promise<{ text, words? }>
 *   - window.__CFS_subscribeAiProgress(fn)        → unsubscribe()
 *       fn receives { type: "progress" | "fatal" | "ready" | "info", ... }
 *   - window.__CFS_aiBackendStatus()              → { backend, dead, ready, reason }
 */
(function (global) {
	"use strict";

	var ORIGIN = global.location && global.location.origin ? global.location.origin : "";
	var WORKER_URL = "/cfs-web/cfs-web-ai-worker.js";
	var KOKORO_URL = "/lib/kokoro/kokoro.web.js";
	var TRANSFORMERS_URL = "/lib/transformers/transformers.min.js";
	var ORT_WASM_BASE = ORIGIN + "/lib/transformers/";

	var listeners = new Set();
	function emit(d) {
		listeners.forEach(function (fn) {
			try {
				fn(d);
			} catch (_) {}
		});
	}
	global.__CFS_subscribeAiProgress = function (fn) {
		if (typeof fn !== "function") return function () {};
		listeners.add(fn);
		return function () {
			listeners.delete(fn);
		};
	};

	/* ---------------- HEAD preflight so next failure is diagnosable ---------------- */
	var preflightPromise = null;
	function preflightAssets() {
		if (preflightPromise) return preflightPromise;
		var urls = [
			WORKER_URL,
			KOKORO_URL,
			TRANSFORMERS_URL,
			"/lib/transformers/ort-wasm-simd-threaded.wasm",
			"/lib/transformers/ort-wasm-simd-threaded.jsep.wasm",
			// ONNX Runtime Web 1.20+ JSEP loader. Missing this causes:
			// "no available backend found. ERR: [wasm] TypeError: Failed to
			// fetch dynamically imported module: …jsep.mjs"
			"/lib/transformers/ort-wasm-simd-threaded.jsep.mjs",
			"/lib/transformers/ort-wasm-simd-threaded.mjs",
		];
		preflightPromise = Promise.all(
			urls.map(function (u) {
				return fetch(u, { method: "HEAD", credentials: "include" })
					.then(function (r) {
						return { url: u, ok: r.ok, status: r.status };
					})
					.catch(function (e) {
						return { url: u, ok: false, status: 0, error: (e && e.message) || String(e) };
					});
			}),
		).then(function (results) {
			var missing = results.filter(function (r) {
				return !r.ok;
			});
			if (missing.length) {
				var summary = missing
					.map(function (r) {
						return r.url + " → " + (r.status || "fetch error: " + (r.error || ""));
					})
					.join(", ");
				return { ok: false, summary: summary };
			}
			return { ok: true };
		});
		return preflightPromise;
	}

	/* ---------------- Worker backend ---------------- */
	var worker = null;
	var workerDead = false;
	var workerDeadReason = "";
	var workerReady = false;
	var nextId = 1;
	/** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
	var pending = new Map();

	function describeErrorEvent(e) {
		if (!e) return "unknown worker error";
		var parts = [];
		if (e.message) parts.push(String(e.message));
		if (e.filename) parts.push("at " + String(e.filename) + (e.lineno ? ":" + e.lineno : ""));
		if (e.error && e.error.message && e.error.message !== e.message) {
			parts.push(String(e.error.message));
		}
		if (parts.length) return parts.join(" — ");
		return "Worker failed to initialise (sparse error event — module worker likely couldn't load).";
	}

	function killWorker(reason) {
		if (workerDead) return;
		workerDead = true;
		workerDeadReason = reason || "Worker terminated";
		if (worker) {
			try {
				worker.terminate();
			} catch (_) {}
		}
		worker = null;
		var err = new Error(workerDeadReason);
		var queued = Array.from(pending.entries());
		pending.clear();
		emit({ type: "fatal", error: workerDeadReason });
		try {
			console.warn("[CFS AI] worker dead — falling back to main thread:", workerDeadReason);
		} catch (_) {}
		// Reroute every queued call to the main-thread backend rather than
		// rejecting them. The user gets actual TTS instead of silent audio.
		queued.forEach(function (entry) {
			var p = entry[1];
			var pendingCall = p.__call;
			if (!pendingCall) {
				p.reject(err);
				return;
			}
			runOnMainThread(pendingCall).then(p.resolve, p.reject);
		});
	}

	function getWorker() {
		if (workerDead) return null;
		if (worker) return worker;
		if (typeof Worker === "undefined") {
			workerDead = true;
			workerDeadReason = "Web Worker unsupported";
			return null;
		}
		if (typeof global.crossOriginIsolated !== "undefined" && !global.crossOriginIsolated) {
			workerDead = true;
			workerDeadReason = "Page is not crossOriginIsolated";
			return null;
		}
		try {
			worker = new Worker(WORKER_URL, { type: "module" });
		} catch (e) {
			killWorker("Could not create AI worker: " + ((e && e.message) || String(e)));
			return null;
		}
		worker.onmessage = function (ev) {
			var d = ev.data || {};
			if (d.type === "ready") {
				workerReady = true;
				emit({ type: "ready" });
				return;
			}
			if (d.type === "progress") {
				emit(d);
				return;
			}
			if (d.type === "fatal") {
				var msg = (d.error && (d.error.message || d.error)) || "AI worker fatal error";
				killWorker("AI worker fatal: " + msg);
				return;
			}
			if (d.type === "result") {
				var p = pending.get(d.id);
				if (!p) return;
				pending.delete(d.id);
				if (!d.ok) {
					p.reject(new Error(d.error || "AI worker error"));
					return;
				}
				// Normalise to the same shape the main-thread path resolves
				// with, so dispatch() doesn't have to re-shape per backend:
				//   tts → Blob
				//   stt → { text, words? }
				var kind = p.__call && p.__call.kind;
				if (kind === "tts") {
					if (d.blob instanceof Blob) p.resolve(d.blob);
					else p.reject(new Error("Worker returned no audio blob"));
				} else {
					p.resolve({ text: String((d && d.text) || ""), words: d && d.words });
				}
			}
		};
		worker.onerror = function (e) {
			try {
				console.error("[CFS AI worker]", {
					message: e && e.message,
					filename: e && e.filename,
					lineno: e && e.lineno,
					colno: e && e.colno,
					error: e && e.error,
				});
			} catch (_) {}
			// Preflight subresources so the user knows which file (if any)
			// can't be reached from this context. Surface that as the kill
			// reason; otherwise we just say "sparse event".
			var base = describeErrorEvent(e);
			preflightAssets().then(function (p) {
				killWorker(p.ok ? base : base + " | unreachable: " + p.summary);
			});
		};
		worker.onmessageerror = function (e) {
			try {
				console.error("[CFS AI worker] messageerror", e);
			} catch (_) {}
			killWorker("Worker postMessage payload could not be deserialised");
		};
		return worker;
	}

	/* ---------------- Main-thread backend ---------------- */
	var mtKokoro = null;
	var mtAsr = null;

	function emitMainProgress(stage, ev) {
		if (!ev || typeof ev !== "object") {
			emit({ type: "progress", stage: stage, status: "init" });
			return;
		}
		emit({
			type: "progress",
			stage: stage,
			file: String(ev.file || ev.name || ""),
			loaded: typeof ev.loaded === "number" ? ev.loaded : undefined,
			total: typeof ev.total === "number" ? ev.total : undefined,
			status: String(ev.status || ""),
		});
	}

	async function ensureMainKokoro() {
		if (mtKokoro) return mtKokoro;
		emit({ type: "info", message: "Loading Kokoro TTS on main thread…" });
		var mod;
		try {
			mod = await import(/* @vite-ignore */ ORIGIN + KOKORO_URL);
		} catch (e) {
			throw new Error("Failed to import kokoro.web.js: " + ((e && e.message) || String(e)));
		}
		var KokoroTTS = mod.KokoroTTS;
		var env = mod.env;
		if (!KokoroTTS) throw new Error("kokoro.web.js did not export KokoroTTS");
		// Force ORT into single-threaded mode. The threaded build silently
		// hangs in some Chrome contexts (COEP credentialless) because the
		// pthread module Workers it spawns die without a proper error event,
		// so ORT waits forever for a "loaded" ack that never comes.
		// numThreads=1 skips the pthread pool entirely.
		try {
			if (env) {
				if ("wasmPaths" in env) env.wasmPaths = ORT_WASM_BASE;
				if ("numThreads" in env) env.numThreads = 1;
				if ("proxy" in env) env.proxy = false;
				if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
					env.backends.onnx.wasm.numThreads = 1;
					env.backends.onnx.wasm.proxy = false;
				}
			}
		} catch (_) {}
		mtKokoro = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
			dtype: "q8",
			device: "wasm",
			progress_callback: function (e) {
				emitMainProgress("tts", e);
			},
		});
		return mtKokoro;
	}

	async function ensureMainAsr() {
		if (mtAsr) return mtAsr;
		emit({ type: "info", message: "Loading Whisper STT on main thread…" });
		var mod;
		try {
			mod = await import(/* @vite-ignore */ ORIGIN + TRANSFORMERS_URL);
		} catch (e) {
			throw new Error("Failed to import transformers.min.js: " + ((e && e.message) || String(e)));
		}
		var pipeline = mod.pipeline;
		var env = mod.env;
		if (!pipeline) throw new Error("transformers.min.js did not export pipeline");
		try {
			if (env) {
				env.allowLocalModels = false;
				env.useBrowserCache = true;
				env.useWasmCache = true;
				if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
					env.backends.onnx.wasm.wasmPaths = ORT_WASM_BASE;
					// Single-threaded — see ensureMainKokoro() for why.
					env.backends.onnx.wasm.numThreads = 1;
					env.backends.onnx.wasm.proxy = false;
				}
			}
		} catch (_) {}
		mtAsr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
			quantized: true,
			progress_callback: function (e) {
				emitMainProgress("stt", e);
			},
		});
		return mtAsr;
	}

	var DEFAULT_VOICE = "af_heart";
	function isKokoroVoice(v) {
		if (!v || typeof v !== "string") return false;
		return /^[a-z]{2}_[a-z]+$/i.test(v) || /^[a-z]{2}$/i.test(v);
	}

	async function runMainTts(text, voiceOpt) {
		var t = String(text || "").trim();
		if (!t) throw new Error("No text");
		var tts = await ensureMainKokoro();
		var voice = voiceOpt || "";
		if (!isKokoroVoice(voice)) voice = DEFAULT_VOICE;
		else {
			try {
				var voices = tts.voices;
				if (voices && typeof voices === "object" && !Object.prototype.hasOwnProperty.call(voices, voice)) {
					voice = DEFAULT_VOICE;
				}
			} catch (_) {}
		}
		var audio;
		try {
			audio = await tts.generate(t, { voice: voice });
		} catch (e) {
			if (voice !== DEFAULT_VOICE) audio = await tts.generate(t, { voice: DEFAULT_VOICE });
			else throw e;
		}
		return audio.toBlob();
	}

	function parseWhisperResult(result) {
		var text = "";
		var words = [];
		if (typeof result === "string") text = result;
		else if (result && result.text) text = result.text;
		if (Array.isArray(result && result.chunks)) {
			if (!text) text = result.chunks.map(function (c) { return c.text || ""; }).join(" ");
			words = result.chunks
				.filter(function (c) { return c && c.text && String(c.text).trim(); })
				.map(function (c) {
					var ts = Array.isArray(c.timestamp) ? c.timestamp : [];
					return {
						text: String(c.text).trim(),
						start: typeof ts[0] === "number" ? ts[0] : -1,
						end: typeof ts[1] === "number" ? ts[1] : -1,
					};
				})
				.filter(function (w) { return w.start >= 0 && w.end >= 0 && w.end > w.start; });
		}
		return { text: String(text || "").trim(), words: words };
	}

	async function runMainStt(audioBlob) {
		var pipe = await ensureMainAsr();
		var url = URL.createObjectURL(audioBlob);
		try {
			var parsed = parseWhisperResult(
				await pipe(url, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 }),
			);
			if (!parsed.words.length) {
				try {
					parsed = parseWhisperResult(await pipe(url, { return_timestamps: "word" }));
				} catch (_) {}
			}
			return { text: parsed.text, words: parsed.words.length ? parsed.words : undefined };
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	function runOnMainThread(call) {
		if (call.kind === "tts") return runMainTts(call.text, call.voice);
		if (call.kind === "stt") return runMainStt(call.audioBlob);
		return Promise.reject(new Error("Unknown call kind"));
	}

	/* ---------------- Public dispatch (worker-first, main-thread fallback) ---------------- */
	function dispatch(call) {
		// If the worker is already known dead, go straight to the main thread.
		if (workerDead) return runOnMainThread(call);

		var w = getWorker();
		if (!w) return runOnMainThread(call);

		return new Promise(function (resolve, reject) {
			var id = nextId++;
			var entry = { resolve: resolve, reject: reject, __call: call };
			pending.set(id, entry);

			try {
				if (call.kind === "tts") {
					w.postMessage({ type: "tts", id: id, text: call.text, voice: call.voice || "" });
				} else if (call.kind === "stt") {
					call.audioBlob
						.arrayBuffer()
						.then(function (ab) {
							if (!pending.has(id)) return; // already rerouted
							try {
								w.postMessage(
									{
										type: "stt",
										id: id,
										buffer: ab,
										mimeType: call.audioBlob.type || "application/octet-stream",
									},
									[ab],
								);
							} catch (e) {
								pending.delete(id);
								killWorker("postMessage failed: " + ((e && e.message) || String(e)));
								// killWorker will retry the still-queued ones; this one already left pending
								runOnMainThread(call).then(resolve, reject);
							}
						})
						.catch(reject);
				} else {
					reject(new Error("Unknown call kind"));
				}
			} catch (e) {
				pending.delete(id);
				killWorker("postMessage failed: " + ((e && e.message) || String(e)));
				runOnMainThread(call).then(resolve, reject);
			}
		});
		// Both backends already resolve with the public shape:
		//   tts → Blob, stt → { text, words? }
		// (worker.onmessage normalises; runOnMainThread returns natively).
	}

	function callTts(text, voice) {
		return dispatch({ kind: "tts", text: text, voice: voice || "" });
	}
	function callStt(audioBlob) {
		return dispatch({ kind: "stt", audioBlob: audioBlob });
	}

	global.__CFS_aiBackendStatus = function () {
		return {
			backend: workerDead ? "main" : worker ? "worker" : "uninitialised",
			dead: workerDead,
			ready: workerReady,
			reason: workerDeadReason,
		};
	};

	if (typeof global.crossOriginIsolated !== "undefined" && global.crossOriginIsolated) {
		if (typeof global.__CFS_ttsApiUrl === "string" && global.__CFS_ttsApiUrl) {
			/* default-tts strategy 1 wins — do not override */
		} else {
			global.__CFS_ttsGenerate = function (text, opts) {
				return callTts(text, opts && opts.voice);
			};
		}
		if (typeof global.__CFS_sttApiUrl === "string" && global.__CFS_sttApiUrl) {
			/* default-stt API wins */
		} else {
			global.__CFS_sttGenerate = function (audioBlob, _opts) {
				return callStt(audioBlob);
			};
		}
	}
})(typeof window !== "undefined" ? window : globalThis);
