/**
 * Default TTS for video export — zero-setup in the Chrome extension.
 *
 * Fallback chain:
 *   1. API endpoint — set window.__CFS_ttsApiUrl
 *   2. Kokoro-82M via QC sandbox — runs entirely in-browser via WASM,
 *      no external service needed. ~50 MB model auto-downloads on first
 *      use and is cached. Produces high-quality WAV audio.
 *   3. chrome.tabCapture + speechSynthesis — captures the tab's audio
 *      while the browser speaks. Works from normal web pages but NOT from
 *      chrome-extension:// pages.
 *   4. Silent WAV placeholder — so clip timing is correct even when all
 *      strategies fail.
 *
 * Or set window.__CFS_ttsGenerate before this script loads.
 */
(function (global) {
  'use strict';

  if (typeof global.__CFS_ttsGenerate === 'function') return;

  /* ---- helpers ---- */

  function estimateDurationSec(text) {
    var words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(0.5, words / 2.5);
  }

  function silentWav(sec) {
    var rate = 22050, n = Math.max(1, Math.round(rate * sec)), bytes = n * 2;
    var buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    function w(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes, true);
    return new Blob([buf], { type: 'audio/wav' });
  }

  function findVoice(name) {
    if (!name || !global.speechSynthesis) return null;
    var voices = global.speechSynthesis.getVoices();
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].name === name) return voices[i];
    }
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang === name) return voices[i];
    }
    return null;
  }

  function hasChromeRuntime() {
    return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function';
  }

  /* ---- Strategy 1: API ---- */

  function ttsViaApi(text, options) {
    return fetch(global.__CFS_ttsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice: (options && options.voice) || '',
        language: (options && options.language) || ''
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('TTS API error: ' + (res.status || ''));
      return res.blob();
    });
  }

  /* ---- Strategy 2: Kokoro via QC sandbox ---- */

  function ttsViaKokoro(text, options) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'QC_CALL',
        method: 'synthesizeSpeech',
        args: [text, { voice: (options && options.voice) || '' }],
      }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          var innerResult = resp && resp.result;
          var innerError = innerResult && innerResult.error;
          reject(new Error(innerError || (resp && resp.error) || 'Kokoro TTS failed'));
          return;
        }
        var result = resp.result || resp;
        if (!result.audioBase64) {
          reject(new Error(result.error || 'No audio returned'));
          return;
        }
        /* Decode base64 → Blob */
        try {
          var binary = atob(result.audioBase64);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          var blob = new Blob([bytes], { type: result.contentType || 'audio/wav' });
          if (blob.size < 100) {
            reject(new Error('Kokoro returned too-small audio (' + blob.size + ' bytes)'));
            return;
          }
          resolve(blob);
        } catch (e) {
          reject(new Error('Failed to decode Kokoro audio: ' + (e && e.message)));
        }
      });
    });
  }

  /* ---- Strategy 3: chrome.tabCapture + speechSynthesis ---- */

  function ttsViaTabCapture(text, options) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: 'TTS_GET_STREAM_ID' }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok || !resp.streamId) {
          reject(new Error((resp && resp.error) || 'No stream ID'));
          return;
        }

        navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: resp.streamId } },
          video: false
        }).then(function (media) {
          var mime = 'audio/webm';
          if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
          }

          var recorder = new MediaRecorder(media, { mimeType: mime });
          var chunks = [];
          recorder.ondataavailable = function (e) { if (e.data && e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = function () {
            media.getTracks().forEach(function (t) { t.stop(); });
            resolve(new Blob(chunks, { type: recorder.mimeType || mime }));
          };
          recorder.onerror = function () {
            media.getTracks().forEach(function (t) { t.stop(); });
            reject(new Error('MediaRecorder error'));
          };

          recorder.start(50);

          var utterance = new global.SpeechSynthesisUtterance(text);
          var voice = findVoice((options && options.voice) || '');
          if (voice) utterance.voice = voice;
          if (options && options.language) utterance.lang = options.language;

          var settled = false;
          function finish() {
            if (settled) return;
            settled = true;
            setTimeout(function () {
              try { if (recorder.state === 'recording') recorder.stop(); } catch (_) {}
            }, 350);
          }
          utterance.onend = finish;
          utterance.onerror = function () { finish(); };

          global.speechSynthesis.cancel();
          global.speechSynthesis.speak(utterance);

          var maxMs = Math.max(30000, estimateDurationSec(text) * 3000);
          setTimeout(function () { if (!settled) finish(); }, maxMs);
        }).catch(reject);
      });
    });
  }

  /* ---- main entry ---- */

  var _ttsAudioWarned = false;

  function ttsGenerate(text, options) {
    if (global.__CFS_ttsApiUrl && typeof fetch !== 'undefined') {
      return ttsViaApi(text, options);
    }

    if (hasChromeRuntime()) {
      /* Primary: Kokoro via QC sandbox (works from extension pages, no tabCapture needed). */
      return ttsViaKokoro(text, options).catch(function (err1) {
        console.warn('[CFS TTS] Kokoro failed (' + (err1 && err1.message ? err1.message : err1) + '); trying tabCapture.');
        /* Fallback: direct tabCapture (works from normal web pages). */
        if (global.speechSynthesis && typeof global.SpeechSynthesisUtterance !== 'undefined') {
          return ttsViaTabCapture(text, options).catch(function (err2) {
            if (!_ttsAudioWarned) {
              _ttsAudioWarned = true;
              console.warn('[CFS TTS] All TTS strategies failed. Export audio will be silent.');
            }
            return silentWav(estimateDurationSec(text));
          });
        }
        if (!_ttsAudioWarned) {
          _ttsAudioWarned = true;
          console.warn('[CFS TTS] All TTS strategies failed. Export audio will be silent.');
        }
        return silentWav(estimateDurationSec(text));
      });
    }

    return Promise.resolve(silentWav(estimateDurationSec(text)));
  }

  global.__CFS_ttsGenerate = ttsGenerate;
})(typeof window !== 'undefined' ? window : globalThis);
