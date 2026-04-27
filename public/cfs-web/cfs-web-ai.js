/**
 * Installs in-browser Kokoro TTS + Whisper STT (module Web Worker) before
 * /generator/tts/default-tts.js and /generator/stt/default-stt.js run.
 *
 * Requires crossOriginIsolated for ONNX multithreading. When the worker dies
 * (e.g. a kokoro/transformers eval failure) we mark it dead so subsequent
 * calls reject immediately instead of hanging — the template engine then
 * falls back to silent audio for that clip and the render keeps going.
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
		return parts.length ? parts.join(" — ") : "Worker failed to initialise (no details — likely the kokoro/transformers module threw at load).";
	}

	function killWorker(reason) {
		workerDead = true;
		workerDeadReason = reason || "Worker terminated";
		if (worker) {
			try {
				worker.terminate();
			} catch (_) {}
		}
		worker = null;
		var err = new Error(workerDeadReason);
		pending.forEach(function (p) {
			p.reject(err);
		});
		pending.clear();
		emit({ type: "fatal", error: workerDeadReason });
		try {
			console.error("[CFS AI] worker dead:", workerDeadReason);
		} catch (_) {}
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
			worker = new Worker("/cfs-web/cfs-web-ai-worker.js", { type: "module" });
		} catch (e) {
			killWorker("Could not create AI worker: " + ((e && e.message) || String(e)));
			return null;
		}
		worker.onmessage = function (ev) {
			var d = ev.data || {};
			if (d.type === "ready") {
				workerReady = true;
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
				if (d.ok) p.resolve(d);
				else p.reject(new Error(d.error || "AI worker error"));
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
			killWorker(describeErrorEvent(e));
		};
		worker.onmessageerror = function (e) {
			try {
				console.error("[CFS AI worker] messageerror", e);
			} catch (_) {}
			killWorker("Worker postMessage payload could not be deserialised");
		};
		return worker;
	}

	function callTts(text, voice) {
		return new Promise(function (resolve, reject) {
			var w = getWorker();
			if (!w) {
				reject(new Error(workerDeadReason || "AI worker unavailable"));
				return;
			}
			var id = nextId++;
			pending.set(id, { resolve: resolve, reject: reject });
			try {
				w.postMessage({ type: "tts", id: id, text: text, voice: voice || "" });
			} catch (e) {
				pending.delete(id);
				killWorker("postMessage failed: " + ((e && e.message) || String(e)));
				reject(e instanceof Error ? e : new Error(String(e)));
			}
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
					reject(new Error(workerDeadReason || "AI worker unavailable"));
					return;
				}
				var id = nextId++;
				pending.set(id, { resolve: resolve, reject: reject });
				var mt = audioBlob.type || "application/octet-stream";
				try {
					w.postMessage({ type: "stt", id: id, buffer: ab, mimeType: mt }, [ab]);
				} catch (e) {
					pending.delete(id);
					killWorker("postMessage failed: " + ((e && e.message) || String(e)));
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

	global.__CFS_aiWorkerStatus = function () {
		return { dead: workerDead, ready: workerReady, reason: workerDeadReason };
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
