/**
 * Local FFmpeg WASM wrapper.
 * Lazy-loads @ffmpeg/ffmpeg UMD + @ffmpeg/core WASM from lib/ffmpeg/
 * and exposes window.FFmpegLocal for in-browser WebM-to-MP4 conversion.
 */
(function (global) {
  'use strict';

  var ffmpegInstance = null;
  var loading = null;

  function coreURL() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.js');
    }
    if (typeof location !== 'undefined' && location.origin) {
      return location.origin + '/lib/ffmpeg/ffmpeg-core.js';
    }
    return '/lib/ffmpeg/ffmpeg-core.js';
  }
  function wasmURL() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('lib/ffmpeg/ffmpeg-core.wasm');
    }
    if (typeof location !== 'undefined' && location.origin) {
      return location.origin + '/lib/ffmpeg/ffmpeg-core.wasm';
    }
    return '/lib/ffmpeg/ffmpeg-core.wasm';
  }

  function workerChunkURL() {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL('lib/ffmpeg/814.ffmpeg.js');
      }
      if (typeof location !== 'undefined' && location.origin) {
        return location.origin + '/lib/ffmpeg/814.ffmpeg.js';
      }
      return '/lib/ffmpeg/814.ffmpeg.js';
    }
  
    /**
     * Pre-fetch the FFmpeg worker chunk and return a Blob URL.
     *
     * Under Cross-Origin-Embedder-Policy: credentialless (required for
     * SharedArrayBuffer / crossOriginIsolated), Chrome blocks direct Worker
     * script loading with a silent, sparse error event (all fields undefined).
     * Loading the script ourselves and creating a blob: URL side-steps COEP
     * entirely because blob: URLs are same-origin by definition.
     *
     * All URLs used inside the worker (coreURL, wasmURL for importScripts /
     * fetch) are absolute, so changing the Worker's base URL to blob: has no
     * effect on them.
     */
    var _workerBlobUrlCache = null;
    function fetchWorkerBlobUrl() {
      if (_workerBlobUrlCache) return Promise.resolve(_workerBlobUrlCache);
      var url = workerChunkURL();
      try { console.log('[FFmpegLocal] fetching worker chunk for Blob URL', url); } catch (_) {}
      return fetch(url, { credentials: 'same-origin' })
        .then(function (resp) {
          if (!resp.ok) throw new Error('Failed to fetch FFmpeg worker chunk (' + resp.status + ')');
          return resp.text();
        })
        .then(function (text) {
          var blob = new Blob([text], { type: 'application/javascript' });
          _workerBlobUrlCache = URL.createObjectURL(blob);
          try { console.log('[FFmpegLocal] worker Blob URL created'); } catch (_) {}
          return _workerBlobUrlCache;
        });
    }
  
    function ensureLoaded(report) {
      try { console.log('[FFmpegLocal] ensureLoaded called', { hasInstance: !!ffmpegInstance, loaded: ffmpegInstance && ffmpegInstance.loaded }); } catch (_) {}
    if (ffmpegInstance && ffmpegInstance.loaded) return Promise.resolve(ffmpegInstance);
    if (loading) return loading;

    loading = fetchWorkerBlobUrl().then(function (blobUrl) {
      var FFmpegClass = global.FFmpegWASM && global.FFmpegWASM.FFmpeg;
      if (!FFmpegClass) {
        throw new Error('FFmpegWASM.FFmpeg not found – is lib/ffmpeg/ffmpeg.js loaded?');
      }
      ffmpegInstance = new FFmpegClass();

      /**
       * ffmpeg.wasm progress payloads are supposed to use progress in [0, 1]; some ffmpeg-core
       * builds emit signed or time-like values. Never multiply bogus numbers by 100 for UI.
       */
      function ffmpegProgressToPercent(ev) {
        if (!ev || typeof ev !== 'object') return null;
        var r = ev.progress;
        if (typeof r !== 'number' || !isFinite(r)) {
          r = ev.ratio;
        }
        if (typeof r !== 'number' || !isFinite(r)) return null;
        if (r >= 0 && r <= 1) return Math.max(0, Math.min(100, Math.round(r * 100)));
        if (r > 1 && r <= 100) return Math.round(r);
        return null;
      }

      ffmpegInstance.on('progress', function (ev) {
        if (typeof report === 'function') {
          var pct = ffmpegProgressToPercent(ev);
          if (pct != null) {
            report('Converting... ' + pct + '%');
          } else {
            report('Converting...');
          }
        }
      });

      try { console.log('[FFmpegLocal] calling FFmpeg.load()', { coreURL: coreURL(), wasmURL: wasmURL(), workerBlobUrl: blobUrl }); } catch (_) {}
      ffmpegInstance.on('log', function (ev) { try { console.log('[FFmpeg core]', ev && ev.type, ev && ev.message); } catch (_) {} });

      // Monkey-patch Worker to use Blob URL — bypasses COEP restrictions
      var __origWorker = global.Worker;
      var __workerErrorReject = null;
      var __wrappedWorker = function (url, opts) {
        try { console.log('[FFmpegLocal] new Worker (intercepted)', { originalUrl: String(url), blobUrl: blobUrl, opts: opts }); } catch (_) {}
        var w = new __origWorker(blobUrl, opts);
        try {
          w.addEventListener('error', function (e) {
            var detail = { message: e && e.message, filename: e && e.filename, lineno: e && e.lineno, colno: e && e.colno, error: e && e.error };
            try { console.error('[FFmpeg worker] error event', detail); } catch (_) {}
            if (typeof __workerErrorReject === 'function') {
              __workerErrorReject(new Error('FFmpeg worker error: ' + (detail.message || detail.filename || 'unknown')));
              __workerErrorReject = null;
            }
          });
          w.addEventListener('messageerror', function (e) {
            try { console.error('[FFmpeg worker] messageerror event', e); } catch (_) {}
          });
        } catch (_) {}
        return w;
      };
      __wrappedWorker.prototype = __origWorker.prototype;
      try { global.Worker = __wrappedWorker; } catch (_) {}
      var __restoreWorker = function () { try { global.Worker = __origWorker; } catch (_) {} };

      var workerErrorPromise = new Promise(function (_resolve, reject) {
        __workerErrorReject = reject;
      });
      var safetyTimeout = new Promise(function (_resolve, reject) {
        setTimeout(function () {
          reject(new Error('FFmpeg load() did not resolve within 60s — worker likely hung.'));
        }, 60000);
      });

      return Promise.race([
        ffmpegInstance.load({
          coreURL: coreURL(),
          wasmURL: wasmURL(),
        }),
        workerErrorPromise,
        safetyTimeout,
      ]).then(function () {
        __restoreWorker();
        __workerErrorReject = null;
        try { console.log('[FFmpegLocal] FFmpeg.load() resolved'); } catch (_) {}
        return ffmpegInstance;
      });
    });

    loading.catch(function (err) {
      try { console.error('[FFmpegLocal] FFmpeg.load() rejected', err); } catch (_) {}
      try { if (ffmpegInstance && typeof ffmpegInstance.terminate === 'function') ffmpegInstance.terminate(); } catch (_) {}
      ffmpegInstance = null;
      loading = null;
    });

    return loading;
  }

  /**
   * Convert a video/audio Blob to MP4 locally via FFmpeg WASM.
   * @param {Blob} blob - Input media blob (e.g. video/webm).
   * @param {function} [onProgress] - Optional callback receiving status strings.
   * @returns {Promise<{ok:boolean, blob?:Blob, error?:string}>}
   */
  function convertToMp4(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};

    report('Loading FFmpeg WASM...');

    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var inputName = 'input.webm';
          var outputName = 'output.mp4';
          report('Writing input file...');
          return ff.writeFile(inputName, new Uint8Array(buf))
            .then(function () {
              report('Converting to MP4...');
              return ff.exec([
                '-i', inputName,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '128k',
                outputName,
              ]);
            })
            .then(function () {
              report('Reading output...');
              return ff.readFile(outputName);
            })
            .then(function (data) {
              var mp4Blob = new Blob([data], { type: 'video/mp4' });
              ff.deleteFile(inputName).catch(function () {});
              ff.deleteFile(outputName).catch(function () {});
              report('Conversion complete.');
              return { ok: true, blob: mp4Blob };
            });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        return { ok: false, error: msg };
      });
  }

  /**
   * Convert a WAV/WebM audio Blob to M4A (MP4 audio) locally.
   */
  function convertToM4a(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};

    report('Loading FFmpeg WASM...');

    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var ext = (blob.type || '').indexOf('wav') >= 0 ? 'wav' : 'webm';
          var inputName = 'input.' + ext;
          var outputName = 'output.m4a';
          report('Writing input file...');
          return ff.writeFile(inputName, new Uint8Array(buf))
            .then(function () {
              report('Converting to M4A...');
              return ff.exec([
                '-i', inputName,
                '-vn',
                '-c:a', 'aac',
                '-b:a', '192k',
                outputName,
              ]);
            })
            .then(function () {
              report('Reading output...');
              return ff.readFile(outputName);
            })
            .then(function (data) {
              var m4aBlob = new Blob([data], { type: 'audio/mp4' });
              ff.deleteFile(inputName).catch(function () {});
              ff.deleteFile(outputName).catch(function () {});
              report('Conversion complete.');
              return { ok: true, blob: m4aBlob };
            });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        return { ok: false, error: msg };
      });
  }

  /**
   * Convert a WAV/WebM audio Blob to MP3 locally.
   * MP3 is the safest format for third-party media libraries (GHL, etc.)
   * that may reject M4A/AAC containers despite valid audio content.
   */
  function convertToMp3(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};

    report('Loading FFmpeg WASM...');

    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var ext = (blob.type || '').indexOf('wav') >= 0 ? 'wav' : 'webm';
          var inputName = 'input.' + ext;
          var outputName = 'output.mp3';
          report('Writing input file...');
          return ff.writeFile(inputName, new Uint8Array(buf))
            .then(function () {
              report('Converting to MP3...');
              return ff.exec([
                '-i', inputName,
                '-vn',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                '-q:a', '2',
                outputName,
              ]);
            })
            .then(function () {
              report('Reading output...');
              return ff.readFile(outputName);
            })
            .then(function (data) {
              var mp3Blob = new Blob([data], { type: 'audio/mpeg' });
              ff.deleteFile(inputName).catch(function () {});
              ff.deleteFile(outputName).catch(function () {});
              report('Conversion complete.');
              return { ok: true, blob: mp3Blob };
            });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        return { ok: false, error: msg };
      });
  }

  /**
   * Best-effort duration in seconds from media blob (parses ffmpeg -i log line).
   * @returns {Promise<number>} 0 if unknown
   */
  function probeDurationSeconds(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var inputName = 'probe_in.webm';
          if ((blob.type || '').indexOf('mp4') >= 0) inputName = 'probe_in.mp4';
          else if ((blob.type || '').indexOf('wav') >= 0) inputName = 'probe_in.wav';
          var duration = 0;
          function onLog(ev) {
            var msg = (ev && ev.message) ? String(ev.message) : '';
            var m = /Duration:\s*(\d{2}):(\d{2}):([\d.]+)/.exec(msg);
            if (m) {
              duration = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
            }
          }
          ff.on('log', onLog);
          return ff.writeFile(inputName, new Uint8Array(buf))
            .then(function () {
              return ff.exec(['-i', inputName]).catch(function () { return null; });
            })
            .then(function () {
              ff.off('log', onLog);
              ff.deleteFile(inputName).catch(function () {});
              return duration;
            });
        });
      })
      .catch(function () {
        return 0;
      });
  }

  /**
   * Extract [startSec, startSec+durationSec) into a new MP4 (video+audio) or M4A (audio-only).
   * @param {Blob} blob
   * @param {number} startSec
   * @param {number} durationSec
   * @param {{ mode?: 'video'|'audio', includeAudio?: boolean, onProgress?: function }} opts
   *   includeAudio: for mode video, false = video-only MP4 (no audio track). Default true.
   */
  function extractSegment(blob, startSec, durationSec, opts) {
    opts = opts || {};
    var mode = opts.mode === 'audio' ? 'audio' : 'video';
    var includeAudio = opts.includeAudio !== false;
    var report = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var inName = 'ext_in.webm';
    var bt = (blob.type || '').toLowerCase();
    var bn = (typeof blob.name === 'string' ? blob.name : '').toLowerCase();
    if (bt.indexOf('mp4') >= 0 || bt.indexOf('m4a') >= 0 || bt.indexOf('audio/mp4') >= 0) inName = 'ext_in.mp4';
    else if (bt.indexOf('audio/') === 0) inName = 'ext_in.mp4';
    else if (bn.endsWith('.m4a') || bn.endsWith('.mp4')) inName = 'ext_in.mp4';
    var outName = mode === 'audio' ? 'ext_out.m4a' : 'ext_out.mp4';

    function headArgs(beforeInput) {
      return beforeInput
        ? ['-ss', String(startSec), '-i', inName, '-t', String(durationSec)]
        : ['-i', inName, '-ss', String(startSec), '-t', String(durationSec)];
    }

    function videoArgs(beforeInput, withAudio, mapVideo) {
      var a = headArgs(beforeInput).slice();
      if (mapVideo && !withAudio) {
        a.push('-map', '0:v:0');
      }
      a.push(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p'
      );
      if (withAudio) {
        a.push('-c:a', 'aac', '-b:a', '128k');
      } else {
        a.push('-an');
      }
      a.push(outName);
      return a;
    }

    function audioArgs(beforeInput) {
      return headArgs(beforeInput).concat([
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        outName,
      ]);
    }

    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          report('Writing segment input...');
          return ff.writeFile(inName, new Uint8Array(buf))
            .then(function () {
              report('Extracting segment...');
              if (mode === 'audio') {
                return ff
                  .exec(audioArgs(true))
                  .catch(function () {
                    return ff.exec(audioArgs(false));
                  });
              }
              if (!includeAudio) {
                return ff
                  .exec(videoArgs(true, false, true))
                  .catch(function () {
                    return ff.exec(videoArgs(true, false, false));
                  })
                  .catch(function () {
                    return ff.exec(videoArgs(false, false, true));
                  })
                  .catch(function () {
                    return ff.exec(videoArgs(false, false, false));
                  });
              }
              return ff
                .exec(videoArgs(true, true, false))
                .catch(function () {
                  return ff.exec(videoArgs(true, false, false));
                })
                .catch(function () {
                  return ff.exec(videoArgs(false, true, false));
                })
                .catch(function () {
                  return ff.exec(videoArgs(false, false, false));
                });
            })
            .then(function () {
              return ff.readFile(outName);
            })
            .then(function (data) {
              var mime = mode === 'audio' ? 'audio/mp4' : 'video/mp4';
              var outBlob = new Blob([data], { type: mime });
              ff.deleteFile(inName).catch(function () {});
              ff.deleteFile(outName).catch(function () {});
              report('Segment done.');
              return { ok: true, blob: outBlob, mimeType: mime };
            });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        return { ok: false, error: msg };
      });
  }

  /**
   * Strip video container to AAC/M4A audio (for transcription pipelines).
   * @param {Blob} blob - video blob (webm, mp4, mov, etc.)
   * @param {function} [onProgress]
   * @returns {Promise<{ok:boolean, blob?:Blob, error?:string}>}
   */
  function extractAudioFromVideo(blob, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    return ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var bt = (blob.type || '').toLowerCase();
          var bn = (typeof blob.name === 'string' ? blob.name : '').toLowerCase();
          var inName = 'in_vid.webm';
          if (bt.indexOf('mp4') >= 0 || bn.endsWith('.mp4') || bn.endsWith('.m4v')) inName = 'in_vid.mp4';
          else if (bt.indexOf('quicktime') >= 0 || bn.endsWith('.mov')) inName = 'in_vid.mov';
          else if (bt.indexOf('matroska') >= 0 || bn.endsWith('.mkv')) inName = 'in_vid.mkv';
          var outName = 'out_aud.m4a';
          report('Extracting audio...');
          return ff
            .writeFile(inName, new Uint8Array(buf))
            .then(function () {
              return ff.exec(['-i', inName, '-vn', '-c:a', 'aac', '-b:a', '128k', outName]);
            })
            .then(function () {
              return ff.readFile(outName);
            })
            .then(function (data) {
              var outBlob = new Blob([data], { type: 'audio/mp4' });
              ff.deleteFile(inName).catch(function () {});
              ff.deleteFile(outName).catch(function () {});
              report('Audio extract done.');
              return { ok: true, blob: outBlob };
            });
        });
      })
      .catch(function (err) {
        var m = err && err.message ? err.message : String(err);
        return { ok: false, error: m };
      });
  }

  global.FFmpegLocal = {
    ensureLoaded: ensureLoaded,
    convertToMp4: convertToMp4,
    convertToM4a: convertToM4a,
    convertToMp3: convertToMp3,
    probeDurationSeconds: probeDurationSeconds,
    extractSegment: extractSegment,
    extractAudioFromVideo: extractAudioFromVideo,
    isLoaded: function () { return !!(ffmpegInstance && ffmpegInstance.loaded); },
  };
})(typeof window !== 'undefined' ? window : self);
