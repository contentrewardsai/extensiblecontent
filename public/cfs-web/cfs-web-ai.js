/**
 * Installs in-browser Kokoro TTS + Whisper STT (module Web Worker) before
 * /generator/tts/default-tts.js and /generator/stt/default-stt.js run.
 * Requires crossOriginIsolated (COOP+COEP on the host page) for full ONNX
 * multithreading; numThreads falls back to 1 in the worker if not isolated.
 */
(function (global) {
	"use strict";

	var listeners = new Set();
	global.__CFS_subscribeAiProgress = function (fn) {
		if (typeof fn !== "function") {
			return function () {};
		}
		listeners.add(fn);
		return function () {
			listeners.delete(fn);
		};
	};

	function emit(d) {
		listeners.forEach(function (fn) {
			try {
				fn(d);
			} catch (_) {}
		});
	}

	var worker = null;
	var nextId = 1;
	/** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
	var pending = new Map();

	function getWorker() {
		if (worker) return worker;
		if (typeof Worker === "undefined") return null;
		if (typeof global.crossOriginIsolated !== "undefined" && !global.crossOriginIsolated) return null;
		try {
			worker = new Worker("/cfs-web/cfs-web-ai-worker.js", { type: "module" });
			worker.onmessage = function (ev) {
				var d = ev.data || {};
				if (d.type === "progress") {
					emit(d);
					return;
				}
				if (d.type === "result") {
					var p = pending.get(d.id);
					if (!p) return;
					pending.delete(d.id);
					if (d.ok) p.resolve(d);
					else p.reject(new Error(d.error || "AI worker error"));
				}
			};
			worker.onerror = function (e) {
				try {
					console.error("[CFS AI worker]", e);
				} catch (_) {}
				pending.forEach(function (p) {
					p.reject(new Error("Worker error"));
				});
				pending.clear();
			};
		} catch (e) {
			try {
				console.warn("[CFS AI] Worker not available", e);
			} catch (_) {}
			return null;
		}
		return worker;
	}

	function callTts(text, voice) {
		return new Promise(function (resolve, reject) {
			var w = getWorker();
			if (!w) {
				reject(new Error("No worker"));
				return;
			}
			var id = nextId++;
			pending.set(id, { resolve: resolve, reject: reject });
			w.postMessage({ type: "tts", id: id, text: text, voice: voice || "" });
		}).then(function (r) {
			/** @type {{ blob?: Blob }} */
			var res = r;
			if (res && res.blob instanceof Blob) return res.blob;
			throw new Error("No audio blob from worker");
		});
	}

	function callStt(audioBlob) {
		return audioBlob.arrayBuffer().then(function (ab) {
			return new Promise(function (resolve, reject) {
				var w = getWorker();
				if (!w) {
					reject(new Error("No worker"));
					return;
				}
				var id = nextId++;
				pending.set(id, { resolve: resolve, reject: reject });
				var mt = audioBlob.type || "application/octet-stream";
				try {
					w.postMessage({ type: "stt", id: id, buffer: ab, mimeType: mt }, [ab]);
				} catch (e) {
					pending.delete(id);
					if (e instanceof Error) reject(e);
					else reject(new Error(String(e)));
				}
			});
		}).then(function (r) {
			/** @type {{ text?: string, words?: Array<{ text: string, start: number, end: number }> }} */
			var res = r;
			return { text: String((res && res.text) || ""), words: res.words };
		});
	}

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
