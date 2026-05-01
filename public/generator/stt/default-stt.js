/**
 * Default STT for caption generation — zero-setup in the Chrome extension.
 *
 * Fallback chain:
 *   1. API endpoint — set window.__CFS_sttApiUrl
 *   2. Built-in Whisper — routes to the extension's QC sandbox which already runs
 *      Xenova/whisper-tiny.en via @huggingface/transformers. The model auto-downloads
 *      on first use (~40 MB) and is cached. No configuration needed.
 *   3. Browser SpeechRecognition — plays audio through speakers while the Web Speech
 *      API recognises via mic. Fallback for standalone (non-extension) use.
 *
 * Or set window.__CFS_sttGenerate before this script loads.
 */
(function (global) {
  'use strict';

  if (typeof global.__CFS_sttGenerate === 'function') return;

  /* ---- helpers ---- */

  function hasChromeRuntime() {
    return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function';
  }

  function normalizeWords(words) {
    if (!Array.isArray(words) || !words.length) return undefined;
    return words.map(function (w) {
      var s = typeof w.start === 'number' ? w.start : (parseFloat(w.start) || 0);
      var e = typeof w.end === 'number' ? w.end : (parseFloat(w.end) || s + 0.3);
      if (s > 1000 || e > 1000) { s /= 1000; e /= 1000; }
      return { text: String(w.text || '').trim(), start: s, end: e };
    });
  }

  var estimateWords = global.__CFS_estimateWords || function (text, offset) {
    var tokens = (text || '').toString().trim().split(/\s+/).filter(Boolean);
    var t = offset || 0;
    return tokens.map(function (tok, idx) {
      var clean = tok.replace(/[^\w]/g, '');
      var dur = Math.max(0.25, Math.min(0.8, (clean.length || 3) * 0.06));
      var out = { text: tok, start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)) };
      t += dur;
      if (/[.!?]$/.test(tok)) t += 0.40;
      else if (/[,;:]$/.test(tok)) t += 0.25;
      else if (idx < tokens.length - 1) t += 0.08;
      return out;
    });
  };

  /* ---- Strategy 1: API ---- */

  function sttViaApi(audioBlob, options) {
    var form = new FormData();
    form.append('audio', audioBlob, 'audio.webm');
    if (options && options.language) form.append('language', options.language);
    return fetch(global.__CFS_sttApiUrl, { method: 'POST', body: form })
      .then(function (res) {
        if (!res.ok) throw new Error('STT API error: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return { text: String(data && data.text || ''), words: normalizeWords(data && data.words) };
      });
  }

  /* ---- Strategy 2: Whisper via QC sandbox ---- */

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('FileReader failed')); };
      reader.readAsDataURL(blob);
    });
  }

  function sttViaWhisperSandbox(audioBlob, options) {
    /* Convert blob to base64 data URL string — Blobs can't serialize through
       chrome.runtime.sendMessage but strings can. The QC sandbox's 
       transcribeAudio accepts both Blobs and data URL strings. */
    return blobToBase64(audioBlob).then(function (dataUrl) {
      return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage(
          { type: 'QC_CALL', method: 'transcribeAudio', args: [dataUrl] },
          function (response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || !response.ok) {
              reject(new Error((response && response.error) || 'Whisper transcription failed'));
              return;
            }
            var result = response.result || {};
            var text = String(result.text || '').trim();
            var words = normalizeWords(result.words) || (text ? estimateWords(text, 0) : []);
            /* Calibrate timing model from real Whisper word timings */
            if (Array.isArray(result.words) && result.words.length >= 3) {
              var cal = global.__CFS_calibrateFromWords;
              if (typeof cal === 'function') cal(words);
            }
            resolve({ text: text, words: words });
          }
        );
      });
    });
  }

  /* ---- Strategy 3: Browser SpeechRecognition ---- */

  function sttViaBrowser(audioBlob, options) {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error('No STT backend available'));

    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(audioBlob);
      var audio = new Audio(url);
      audio.volume = 1;
      var recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = (options && options.language) || 'en-US';
      var segments = [], originMs = 0, done = false;

      recognition.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            segments.push({ text: e.results[i][0].transcript.trim(), time: (Date.now() - originMs) / 1000 });
          }
        }
      };

      function finish() {
        if (done) return; done = true;
        try { recognition.stop(); } catch (_) {}
        try { audio.pause(); } catch (_) {}
        URL.revokeObjectURL(url);
        var fullText = segments.map(function (s) { return s.text; }).join(' ').trim();
        var words = [];
        segments.forEach(function (s) { words = words.concat(estimateWords(s.text, s.time)); });
        resolve({ text: fullText, words: words });
      }

      audio.onended = function () { setTimeout(finish, 1500); };
      audio.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Audio playback failed')); };
      recognition.onend = function () { if (!done) setTimeout(finish, 500); };
      recognition.onerror = function (e) { if (e.error !== 'no-speech' && e.error !== 'aborted') { console.warn('[CFS] Speech recognition error', e.error, e); } };

      originMs = Date.now();
      try { recognition.start(); } catch (e) { URL.revokeObjectURL(url); reject(e); return; }
      audio.play().catch(function () { finish(); });
    });
  }

  /* ---- main entry ---- */

  function sttGenerate(audioBlob, options) {
    if (global.__CFS_sttApiUrl && typeof fetch !== 'undefined' && audioBlob && audioBlob.size > 0) {
      return sttViaApi(audioBlob, options);
    }

    if (hasChromeRuntime()) {
      return sttViaWhisperSandbox(audioBlob, options).catch(function (err) {
        console.warn('[CFS STT] Whisper sandbox failed (' + (err && err.message ? err.message : err) + '); trying browser SpeechRecognition.');
        return sttViaBrowser(audioBlob, options);
      });
    }

    return sttViaBrowser(audioBlob, options);
  }

  global.__CFS_sttGenerate = sttGenerate;
})(typeof window !== 'undefined' ? window : globalThis);
