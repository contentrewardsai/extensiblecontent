/**
 * TTS Audio Cache — persists TTS audio chunks as WAV files in the project
 * folder for reuse across both Fabric.js preview and Pixi.js export.
 *
 * Storage location:
 *   uploads/{projectId}/generations/{templateId}/audio/
 *     manifest.json        — cache index mapping key → metadata
 *     {voice}_{hash}.wav   — individual audio chunks
 *
 * Exposed as window.__CFS_ttsAudioCache.
 */
(function (global) {
  'use strict';

  /* ── FNV-1a 32-bit hash (no crypto dependency) ── */
  function fnv1a(str) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Build a deterministic cache key from voice + text.
   * Format: {voice}_{8-char-hex-hash}
   */
  function getChunkKey(voice, text) {
    var v = (voice || 'default').replace(/[^a-z0-9_-]/gi, '_');
    var h = fnv1a((voice || '') + '|' + (text || ''));
    return v + '_' + h;
  }

  /* ── File System helpers ── */

  async function ensureDir(parent, name) {
    return parent.getDirectoryHandle(name, { create: true });
  }

  async function audioDir(projectRoot, projectId, templateId) {
    var uploads = await ensureDir(projectRoot, 'uploads');
    var proj = await ensureDir(uploads, projectId);
    var gens = await ensureDir(proj, 'generations');
    var tmpl = await ensureDir(gens, templateId);
    return ensureDir(tmpl, 'audio');
  }

  async function getWritableRoot(projectRoot) {
    if (!projectRoot) return null;
    try {
      var perm = await projectRoot.requestPermission({ mode: 'readwrite' });
      return perm === 'granted' ? projectRoot : null;
    } catch (_) { return null; }
  }

  async function readManifest(dir) {
    try {
      var fh = await dir.getFileHandle('manifest.json');
      var file = await fh.getFile();
      var text = await file.text();
      return JSON.parse(text);
    } catch (_) {
      return { version: 1, chunks: {} };
    }
  }

  async function writeManifest(dir, manifest) {
    var fh = await dir.getFileHandle('manifest.json', { create: true });
    var w = await fh.createWritable();
    await w.write(JSON.stringify(manifest, null, 2));
    await w.close();
  }

  /* ── Public API ── */

  /**
   * Load the manifest for a template's audio cache.
   */
  async function loadManifest(projectRoot, projectId, templateId) {
    var root = await getWritableRoot(projectRoot);
    if (!root || !projectId || !templateId) return { version: 1, chunks: {} };
    try {
      var dir = await audioDir(root, projectId, templateId);
      return readManifest(dir);
    } catch (_) {
      return { version: 1, chunks: {} };
    }
  }

  /**
   * Load a cached TTS chunk from disk by key.
   * Returns { blob: Blob, duration: number } or null if not cached.
   */
  async function loadTtsChunk(projectRoot, projectId, templateId, key) {
    var root = await getWritableRoot(projectRoot);
    if (!root || !projectId || !templateId || !key) return null;
    try {
      var dir = await audioDir(root, projectId, templateId);
      var manifest = await readManifest(dir);
      var entry = manifest.chunks && manifest.chunks[key];
      if (!entry || !entry.filename) return null;
      var fh = await dir.getFileHandle(entry.filename);
      var file = await fh.getFile();
      return { blob: file, duration: entry.duration || 0, words: entry.words || null };
    } catch (_) {
      return null;
    }
  }

  /**
   * Save a TTS audio chunk to disk and update the manifest.
   * @param {Array} [words] — optional per-word timings [{ text, start, end }, ...]
   * Returns { filename, key, duration } or null on failure.
   */
  async function saveTtsChunk(projectRoot, projectId, templateId, voice, text, blob, duration, words) {
    var root = await getWritableRoot(projectRoot);
    if (!root || !projectId || !templateId || !blob) return null;
    try {
      var dir = await audioDir(root, projectId, templateId);
      var key = getChunkKey(voice, text);
      var filename = key + '.wav';

      /* Write audio file */
      var fh = await dir.getFileHandle(filename, { create: true });
      var w = await fh.createWritable();
      await w.write(blob);
      await w.close();

      /* Update manifest */
      var manifest = await readManifest(dir);
      if (!manifest.chunks) manifest.chunks = {};
      var entry = {
        voice: voice || 'default',
        text: text || '',
        duration: duration || 0,
        filename: filename,
        createdAt: new Date().toISOString(),
      };
      if (Array.isArray(words) && words.length) {
        entry.words = words.map(function (w) {
          return { text: w.text || '', start: w.start || 0, end: w.end || 0 };
        });
      }
      manifest.chunks[key] = entry;
      manifest.version = 1;
      await writeManifest(dir, manifest);

      return { filename: filename, key: key, duration: duration || 0 };
    } catch (e) {
      console.warn('[tts-audio-cache] saveTtsChunk failed:', e);
      return null;
    }
  }

  /**
   * Update word timings for an existing cached chunk (e.g. after STT).
   * Does not touch the audio file — only updates the manifest entry.
   */
  async function updateChunkWords(projectRoot, projectId, templateId, key, words) {
    var root = await getWritableRoot(projectRoot);
    if (!root || !projectId || !templateId || !key || !Array.isArray(words)) return;
    try {
      var dir = await audioDir(root, projectId, templateId);
      var manifest = await readManifest(dir);
      if (!manifest.chunks || !manifest.chunks[key]) return;
      manifest.chunks[key].words = words.map(function (w) {
        return { text: w.text || '', start: w.start || 0, end: w.end || 0 };
      });
      await writeManifest(dir, manifest);
    } catch (e) {
      console.warn('[tts-audio-cache] updateChunkWords failed:', e);
    }
  }

  /**
   * Prune cached chunks that are no longer referenced.
   * @param {string[]} activeKeys — keys currently in use by the template
   * Deletes any chunk in the manifest whose key is NOT in activeKeys.
   */
  async function pruneUnusedChunks(projectRoot, projectId, templateId, activeKeys) {
    var root = await getWritableRoot(projectRoot);
    if (!root || !projectId || !templateId) return 0;
    try {
      var dir = await audioDir(root, projectId, templateId);
      var manifest = await readManifest(dir);
      if (!manifest.chunks) return 0;

      var activeSet = {};
      (activeKeys || []).forEach(function (k) { activeSet[k] = true; });

      var removed = 0;
      var keys = Object.keys(manifest.chunks);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (activeSet[key]) continue;
        /* Delete the audio file */
        var entry = manifest.chunks[key];
        if (entry && entry.filename) {
          try { await dir.removeEntry(entry.filename); } catch (_) {}
        }
        delete manifest.chunks[key];
        removed++;
      }

      if (removed > 0) {
        await writeManifest(dir, manifest);
      }
      return removed;
    } catch (e) {
      console.warn('[tts-audio-cache] pruneUnusedChunks failed:', e);
      return 0;
    }
  }

  /* ── Silence trimming ── */

  /**
   * Trim leading and trailing silence from an audio Blob.
   * Uses AudioContext to decode, scans for samples above threshold,
   * then re-encodes as a WAV blob.
   * @param {Blob} blob — input audio blob (WAV, etc.)
   * @param {object} [opts]
   * @param {number} [opts.threshold=0.01] — amplitude below which samples are "silence"
   * @param {number} [opts.marginMs=15]    — milliseconds of silence to preserve at edges
   * @returns {Promise<{ blob: Blob, duration: number }>}
   */
  async function trimSilence(blob, opts) {
    opts = opts || {};
    var threshold = opts.threshold != null ? opts.threshold : 0.01;
    var marginMs = opts.marginMs != null ? opts.marginMs : 15;

    var AudioCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
      : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);
    if (!AudioCtx || !blob || blob.size < 100) {
      return { blob: blob, duration: 0 };
    }

    try {
      var arrayBuf = await blob.arrayBuffer();
      /* Decode at 24000 Hz (Kokoro's native sample rate) for efficiency */
      var sampleRate = 24000;
      var tempCtx = new AudioCtx(1, sampleRate, sampleRate);
      var audioBuffer = await tempCtx.decodeAudioData(arrayBuf);
      var sr = audioBuffer.sampleRate;
      var ch = audioBuffer.numberOfChannels;
      var samples = audioBuffer.getChannelData(0); /* use first channel for silence detection */
      var length = samples.length;

      /* Find first sample above threshold */
      var startSample = 0;
      for (var i = 0; i < length; i++) {
        if (Math.abs(samples[i]) > threshold) {
          startSample = i;
          break;
        }
      }

      /* Find last sample above threshold */
      var endSample = length - 1;
      for (var j = length - 1; j >= startSample; j--) {
        if (Math.abs(samples[j]) > threshold) {
          endSample = j;
          break;
        }
      }

      /* Add margin (convert ms to samples) */
      var marginSamples = Math.round((marginMs / 1000) * sr);
      startSample = Math.max(0, startSample - marginSamples);
      endSample = Math.min(length - 1, endSample + marginSamples);

      var trimmedLength = endSample - startSample + 1;
      if (trimmedLength <= 0 || trimmedLength >= length) {
        /* Nothing to trim or would trim everything */
        return { blob: blob, duration: audioBuffer.duration };
      }

      /* Build WAV from trimmed samples */
      var numChannels = ch;
      var trimmedChannels = [];
      for (var c = 0; c < numChannels; c++) {
        trimmedChannels.push(audioBuffer.getChannelData(c).slice(startSample, endSample + 1));
      }
      var wavBlob = encodeWav(trimmedChannels, sr, numChannels);
      var trimmedDuration = trimmedLength / sr;

      console.log('[TTS trim] ' + (audioBuffer.duration).toFixed(2) + 's → ' +
        trimmedDuration.toFixed(2) + 's (removed ' +
        ((audioBuffer.duration - trimmedDuration) * 1000).toFixed(0) + 'ms silence)');

      return { blob: wavBlob, duration: trimmedDuration };
    } catch (e) {
      console.warn('[tts-audio-cache] trimSilence failed:', e);
      return { blob: blob, duration: 0 };
    }
  }

  /**
   * Encode float32 PCM channels into a WAV Blob.
   */
  function encodeWav(channels, sampleRate, numChannels) {
    var length = channels[0].length;
    var bytesPerSample = 2; /* 16-bit PCM */
    var dataSize = length * numChannels * bytesPerSample;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    /* RIFF header */
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    /* fmt sub-chunk */
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); /* sub-chunk size */
    view.setUint16(20, 1, true);  /* PCM format */
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); /* byte rate */
    view.setUint16(32, numChannels * bytesPerSample, true); /* block align */
    view.setUint16(34, bytesPerSample * 8, true); /* bits per sample */

    /* data sub-chunk */
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    /* Interleave channels and write 16-bit samples */
    var offset = 44;
    for (var i = 0; i < length; i++) {
      for (var c = 0; c < numChannels; c++) {
        var sample = channels[c][i];
        /* Clamp to [-1, 1] */
        sample = Math.max(-1, Math.min(1, sample));
        /* Convert to 16-bit integer */
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (var i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /* ── Expose ── */

  global.__CFS_ttsAudioCache = {
    getChunkKey: getChunkKey,
    loadManifest: loadManifest,
    loadTtsChunk: loadTtsChunk,
    saveTtsChunk: saveTtsChunk,
    updateChunkWords: updateChunkWords,
    pruneUnusedChunks: pruneUnusedChunks,
    trimSilence: trimSilence,
  };

})(typeof window !== 'undefined' ? window : globalThis);
