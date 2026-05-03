/**
 * CfsVideoPreprocessor — Tiered video preprocessing for the Fabric editor.
 *
 * Tier 1: FFmpeg WASM   — full transcode (trim + scale + speed + format) for manageable files
 * Tier 2: WebCodecs     — stream-copy clip for large / 4K files (low memory, near-instant)
 * Tier 3: Direct load   — fallback when neither tier is available
 *
 * Exposes window.CfsVideoPreprocessor.
 */
(function (global) {
  'use strict';

  /* ── Feature detection ─────────────────────────────────────────────── */

  function hasFFmpeg() {
    return typeof global.FFmpegLocal !== 'undefined' && typeof global.FFmpegLocal.ensureLoaded === 'function';
  }

  function hasWebCodecs() {
    return typeof VideoDecoder !== 'undefined' &&
           typeof VideoEncoder !== 'undefined' &&
           !!global.isSecureContext;
  }

  function hasMP4Box() {
    return typeof global.MP4Box !== 'undefined' && typeof global.MP4Box.createFile === 'function';
  }

  /* ── Quick probe via HTML5 <video> element ──────────────────────────── */

  /**
   * Fast probe using a temporary <video> element.
   * Returns width, height, duration — no FFmpeg needed.
   */
  function quickProbe(src, onProgress) {
    onProgress('Analyzing video…');
    return new Promise(function (resolve) {
      if (!src || (typeof src === 'string' && /^\s*\{\{/.test(src))) {
        resolve({ width: 0, height: 0, duration: 0, fileSize: 0 });
        return;
      }

      var result = { width: 0, height: 0, duration: 0, fileSize: 0 };
      var resolved = false;
      var video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      /* Some browsers need the element in the DOM to fire loadedmetadata */
      document.body.appendChild(video);

      function done() {
        if (resolved) return;
        resolved = true;
        if (video.videoWidth > 0) result.width = video.videoWidth;
        if (video.videoHeight > 0) result.height = video.videoHeight;
        if (video.duration && isFinite(video.duration)) result.duration = video.duration;
        try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
        try { document.body.removeChild(video); } catch (_) {}
        resolve(result);
      }

      video.addEventListener('loadedmetadata', done);
      video.addEventListener('error', function () {
        /* CORS may block crossOrigin — retry without it */
        if (video.crossOrigin) {
          video.crossOrigin = '';
          video.src = src;
          video.load();
          return;
        }
        done();
      });
      video.src = src;
      video.load();
      setTimeout(done, 10000);
    });
  }

  /* ── Fetch source with progress ────────────────────────────────────── */

  /**
   * Fetch a video URL as a Blob with download progress reporting.
   * Retries up to 3 times with exponential backoff on network failure.
   */
  function fetchWithProgress(src, onProgress, retries) {
    retries = typeof retries === 'number' ? retries : 3;
    var attempt = 0;

    /* blob: URLs are local — fetch once, no retry needed */
    if (src && src.indexOf('blob:') === 0) {
      onProgress('Reading local file…');
      return fetch(src).then(function (r) { return r.blob(); });
    }

    function tryFetch() {
      attempt++;
      return fetch(src).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var total = resp.headers.get('content-length');
        total = total ? parseInt(total, 10) : 0;
        var reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
        if (!reader) {
          return resp.blob();
        }

        var chunks = [];
        var loaded = 0;
        var lastReport = 0;

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) {
              return new Blob(chunks, { type: resp.headers.get('content-type') || 'video/mp4' });
            }
            chunks.push(r.value);
            loaded += r.value.byteLength;
            var now = Date.now();
            if (now - lastReport > 200) {
              lastReport = now;
              var mb = (loaded / 1e6).toFixed(1);
              if (total > 0) {
                var pct = Math.min(100, Math.round(100 * loaded / total));
                onProgress('Downloading… ' + mb + ' / ' + (total / 1e6).toFixed(1) + ' MB (' + pct + '%)');
              } else {
                onProgress('Downloading… ' + mb + ' MB');
              }
            }
            return pump();
          });
        }
        return pump();
      }).catch(function (err) {
        if (attempt < retries) {
          var delay = Math.pow(3, attempt - 1) * 1000; // 1s, 3s, 9s
          onProgress('Download failed, retrying… (' + attempt + '/' + retries + ')');
          return new Promise(function (resolve) {
            setTimeout(resolve, delay);
          }).then(tryFetch);
        }
        throw err;
      });
    }

    return tryFetch();
  }

  /* ── Smart tier selection ───────────────────────────────────────────── */

  /**
   * Select the best processing tier based on probe results.
   * @param {object} probe - { width, height, duration, fileSize, videoCodec, ... }
   * @param {object} opts  - { duration (clip duration needed), ... }
   * @returns {string} 'ffmpeg' | 'webcodecs' | 'direct'
   */
  function selectTier(probe, opts) {
    var totalPixels = probe.width * probe.height;
    var is4KPlus = totalPixels >= 3840 * 2160;
    var fileSize = probe.fileSize || 0;
    var sourceDuration = probe.duration || 0;
    var clipDuration = opts.duration || sourceDuration;
    var clipRatio = sourceDuration > 0 ? clipDuration / sourceDuration : 1;

    /* Prefer WebCodecs for large/high-res files */
    if (fileSize > 150 * 1024 * 1024 && hasWebCodecs() && hasMP4Box()) return 'webcodecs';
    if (is4KPlus && hasWebCodecs() && hasMP4Box()) return 'webcodecs';
    /* Long video but only need small slice — stream copy is much faster */
    if (sourceDuration > 300 && clipRatio < 0.2 && hasWebCodecs() && hasMP4Box()) return 'webcodecs';

    /* FFmpeg for everything else (guaranteed format match) */
    if (hasFFmpeg()) return 'ffmpeg';

    /* WebCodecs as fallback if FFmpeg unavailable */
    if (hasWebCodecs() && hasMP4Box()) return 'webcodecs';

    /* Last resort */
    return 'direct';
  }

  /* ── Tier 1: FFmpeg WASM processing ─────────────────────────────────── */

  /**
   * Preprocess a video clip using FFmpeg WASM.
   * Self-contained — calls FFmpegLocal.ensureLoaded() directly.
   */
  function ffmpegPreprocessClip(blob, opts, onProgress) {
    opts = opts || {};
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    var trimStart = opts.trimStart || 0;
    var duration = opts.duration || 0;
    var speed = opts.speed || 1;
    var targetW = opts.width || 0;
    var targetH = opts.height || 0;
    var fps = opts.fps || 30;
    var crf = opts.crf || 23;

    return global.FFmpegLocal.ensureLoaded(report)
      .then(function (ff) {
        return blob.arrayBuffer().then(function (buf) {
          var bt = (blob.type || '').toLowerCase();
          var bn = (typeof blob.name === 'string' ? blob.name : '').toLowerCase();
          var inName = 'preprocess_in.webm';
          if (bt.indexOf('mp4') >= 0 || bn.endsWith('.mp4') || bn.endsWith('.m4v')) inName = 'preprocess_in.mp4';
          else if (bt.indexOf('quicktime') >= 0 || bn.endsWith('.mov')) inName = 'preprocess_in.mov';
          else if (bt.indexOf('matroska') >= 0 || bn.endsWith('.mkv')) inName = 'preprocess_in.mkv';
          else if (bt.indexOf('avi') >= 0 || bn.endsWith('.avi')) inName = 'preprocess_in.avi';
          var outName = 'preprocess_out.mp4';

          report('Writing source file…');
          return ff.writeFile(inName, new Uint8Array(buf))
            .then(function () {
              report('Transcoding…');
              var args = [];
              if (trimStart > 0) args.push('-ss', String(trimStart));
              args.push('-i', inName);
              if (duration > 0) args.push('-t', String(duration));
              var vfilters = [];
              if (targetW > 0 && targetH > 0) {
                /* Explicit dimensions: scale + pad to exact size (legacy) */
                vfilters.push(
                  'scale=' + targetW + ':' + targetH + ':force_original_aspect_ratio=decrease',
                  'pad=' + targetW + ':' + targetH + ':(ow-iw)/2:(oh-ih)/2:color=black'
                );
              } else {
                /* Auto mode (width:0/height:0): preserve aspect ratio,
                   but cap the long edge at 1080px to keep Pixi render
                   performance high during browser video capture.
                   scale=-2:N ensures width stays even (h264 requirement). */
                vfilters.push(
                  'scale=\'if(gte(iw,ih),min(1080,iw),-2)\':\'if(gte(iw,ih),-2,min(1080,ih))\''
                );
              }
              if (speed > 0 && speed !== 1) vfilters.push('setpts=PTS/' + speed);
              if (vfilters.length) args.push('-vf', vfilters.join(','));
              args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps));
              if (speed > 0 && speed !== 1) args.push('-af', 'atempo=' + Math.max(0.5, Math.min(2, speed)));
              args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outName);
              return ff.exec(args);
            })
            .then(function () {
              report('Reading output…');
              return ff.readFile(outName);
            })
            .then(function (data) {
              var mp4Blob = new Blob([data], { type: 'video/mp4' });
              ff.deleteFile(inName).catch(function () {});
              ff.deleteFile(outName).catch(function () {});
              report('Transcode complete.');
              return { ok: true, blob: mp4Blob };
            });
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        return { ok: false, error: msg };
      });
  }

  function processWithFFmpeg(blob, opts, onProgress) {
    onProgress('Transcoding to MP4…');
    return ffmpegPreprocessClip(blob, opts, onProgress)
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.error || 'FFmpeg transcode failed');
        }
        return { blob: result.blob, tier: 'ffmpeg' };
      });
  }

  /* ── Tier 2: WebCodecs + MP4Box stream copy ─────────────────────────── */

  function processWithWebCodecs(blob, opts, onProgress) {
    onProgress('Clipping video (stream copy)…');
    /* WebCodecs stream-copy implementation.
       For now, falls through to FFmpeg if available as a safety net.
       Full WebCodecs stream-copy will be implemented in Phase 2. */
    if (hasFFmpeg()) {
      onProgress('Falling back to FFmpeg…');
      return processWithFFmpeg(blob, opts, onProgress);
    }
    return Promise.reject(new Error('WebCodecs stream-copy not yet implemented'));
  }

  /* ── Upload to persistent storage ───────────────────────────────────── */

  /**
   * Upload a processed blob to persistent storage.
   * Prefers presigned URL flow (direct-to-Supabase) when available,
   * falling back to legacy FormData upload through the serverless function.
   *
   * @param {Blob} blob - Processed MP4 blob
   * @param {string} uploadUrl - Legacy server endpoint URL (or null)
   * @param {object} fields - Extra form fields (e.g. { experienceId })
   * @param {function} onProgress
   * @param {object} [presignedConfig] - { presignedUploadUrl, confirmUploadUrl, template_id }
   * @returns {Promise<{ url: string, persisted: boolean }>}
   */
  function upload(blob, uploadUrl, fields, onProgress, presignedConfig) {
    if (!uploadUrl && (!presignedConfig || !presignedConfig.presignedUploadUrl)) {
      console.warn('[CFS Preprocessor] No upload URL configured — blob not persisted');
      return Promise.resolve({ url: URL.createObjectURL(blob), persisted: false });
    }

    /* ── Presigned URL flow: browser → Supabase directly ── */
    if (presignedConfig && presignedConfig.presignedUploadUrl && presignedConfig.confirmUploadUrl) {
      onProgress('Preparing upload…');
      var filename = 'processed-clip-' + Date.now() + '.mp4';
      var presignBody = {
        filename: filename,
        content_type: 'video/mp4',
        size_bytes: blob.size,
        template_id: presignedConfig.template_id || ''
      };
      if (fields) {
        Object.keys(fields).forEach(function (k) {
          presignBody[k] = fields[k];
        });
      }

      return fetch(presignedConfig.presignedUploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(presignBody)
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error('Presign failed (' + res.status + '): ' + t);
          });
        }
        return res.json();
      }).then(function (presign) {
        if (!presign.upload_url) throw new Error('Presign response missing upload_url');

        onProgress('Uploading (' + (blob.size / 1e6).toFixed(1) + ' MB)…');
        return fetch(presign.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4' },
          body: blob
        }).then(function (putRes) {
          if (!putRes.ok) {
            return putRes.text().then(function (t) {
              throw new Error('Direct upload failed (' + putRes.status + '): ' + t);
            });
          }
          onProgress('Finalizing…');
          var confirmBody = {
            file_url: presign.file_url,
            file_path: presign.file_path,
            render_id: presign.render_id,
            template_id: presignedConfig.template_id || '',
            content_type: 'video/mp4',
            size_bytes: blob.size,
            source: 'editor'
          };
          if (fields) {
            Object.keys(fields).forEach(function (k) {
              confirmBody[k] = fields[k];
            });
          }
          return fetch(presignedConfig.confirmUploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(confirmBody)
          });
        }).then(function (confirmRes) {
          if (!confirmRes.ok) {
            return confirmRes.text().then(function (t) {
              throw new Error('Confirm failed (' + confirmRes.status + '): ' + t);
            });
          }
          return confirmRes.json();
        }).then(function (confirmJson) {
          var url = confirmJson.file_url || presign.file_url || '';
          if (!url) throw new Error('Confirm response missing URL');
          onProgress('Upload complete ✓');
          return { url: url, persisted: true };
        });
      });
    }

    /* ── Legacy FormData upload (fallback for older deployments) ── */
    onProgress('Uploading processed clip…');
    var fd = new FormData();
    if (fields) {
      Object.keys(fields).forEach(function (k) {
        fd.append(k, fields[k]);
      });
    }
    fd.append('file', blob, 'processed-clip-' + Date.now() + '.mp4');
    fd.append('content_type', 'video/mp4');

    return fetch(uploadUrl, {
      method: 'POST',
      body: fd,
      credentials: 'include'
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Upload failed (' + res.status + '): ' + t);
        });
      }
      return res.json();
    }).then(function (json) {
      var url = json.url || json.file_url || '';
      if (!url) throw new Error('Upload response missing URL');
      onProgress('Upload complete ✓');
      return { url: url, persisted: true };
    });
  }

  /* ── Main processing pipeline ───────────────────────────────────────── */

  /**
   * Process a video source for editor preview.
   * Auto-selects tier, handles retries and fallback cascade.
   *
   * @param {string} src - Source video URL
   * @param {object} opts
   *   .trimStart   {number} - seconds to skip from start (default 0)
   *   .duration    {number} - seconds to keep (default: full)
   *   .speed       {number} - playback speed (default 1)
   *   .width       {number} - target width (from output profile)
   *   .height      {number} - target height (from output profile)
   *   .fps         {number} - target framerate (default 30)
   *   .crf         {number} - quality factor (default 23)
   * @param {function} onProgress - (message: string) => void
   * @returns {Promise<{ blobUrl: string, blob?: Blob, metadata: object, tier: string }>}
   */
  function process(src, opts, onProgress) {
    opts = opts || {};
    var report = typeof onProgress === 'function' ? onProgress : function () {};

    /* Step 1: Quick probe via <video> element */
    return quickProbe(src, report).then(function (quickMeta) {

      /* Step 2: Fetch source file with progress */
      report('Downloading video…');
      return fetchWithProgress(src, report).then(function (blob) {
        quickMeta.fileSize = blob.size;

        /* Carry content type / name for FFmpeg input detection */
        if (!blob.type && src) {
          var ext = src.split('?')[0].split('.').pop();
          if (ext === 'mov') blob = new Blob([blob], { type: 'video/quicktime' });
          else if (ext === 'mp4') blob = new Blob([blob], { type: 'video/mp4' });
          else if (ext === 'mkv') blob = new Blob([blob], { type: 'video/x-matroska' });
          else if (ext === 'avi') blob = new Blob([blob], { type: 'video/x-msvideo' });
        }

        /* Step 3: Select processing tier */
        var tier = selectTier(quickMeta, opts);
        report('Processing with ' + tier + '…');
        console.log('[CFS Preprocessor] Selected tier:', tier, quickMeta);

        /* Step 4: Process */
        var processPromise;
        if (tier === 'ffmpeg') {
          processPromise = processWithFFmpeg(blob, opts, report)
            .catch(function (err) {
              console.warn('[CFS Preprocessor] FFmpeg failed, trying lower quality:', err);
              report('Retrying with lower quality…');
              var retryOpts = Object.assign({}, opts, { crf: 35 });
              return processWithFFmpeg(blob, retryOpts, report);
            })
            .catch(function (err) {
              /* FFmpeg failed twice — try WebCodecs */
              if (hasWebCodecs() && hasMP4Box()) {
                console.warn('[CFS Preprocessor] FFmpeg failed, cascading to WebCodecs:', err);
                report('Switching to stream-copy mode…');
                return processWithWebCodecs(blob, opts, report);
              }
              throw err;
            });
        } else if (tier === 'webcodecs') {
          processPromise = processWithWebCodecs(blob, opts, report)
            .catch(function (err) {
              /* WebCodecs failed — try FFmpeg */
              if (hasFFmpeg()) {
                console.warn('[CFS Preprocessor] WebCodecs failed, cascading to FFmpeg:', err);
                report('Switching to transcode mode…');
                return processWithFFmpeg(blob, opts, report);
              }
              throw err;
            });
        } else {
          /* Direct — no processing, use source URL */
          return {
            blobUrl: src,
            blob: null,
            metadata: quickMeta,
            tier: 'direct'
          };
        }

        return processPromise.then(function (result) {
          var blobUrl = URL.createObjectURL(result.blob);
          return {
            blobUrl: blobUrl,
            blob: result.blob,
            metadata: quickMeta,
            tier: result.tier
          };
        });
      });
    }).catch(function (err) {
      console.error('[CFS Preprocessor] Pipeline failed:', err);
      /* Final fallback: return source URL directly */
      report('⚠ Processing failed — loading directly');
      return {
        blobUrl: src,
        blob: null,
        metadata: { width: 0, height: 0, duration: 0, fileSize: 0 },
        tier: 'direct',
        error: err.message || String(err)
      };
    });
  }

  /**
   * Full pipeline: probe → process → upload → return persistent URL.
   * @param {string} src
   * @param {object} opts
   * @param {string} uploadUrl - Legacy upload URL (can be null if presignedConfig provided)
   * @param {object} fields
   * @param {function} onProgress
   * @param {object} [presignedConfig] - { presignedUploadUrl, confirmUploadUrl, template_id }
   */
  function processAndPersist(src, opts, uploadUrl, fields, onProgress, presignedConfig) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    return process(src, opts, report).then(function (result) {
      if (!result.blob) {
        /* Direct tier or processing failed — can't upload */
        return {
          url: result.blobUrl,
          blobUrl: result.blobUrl,
          metadata: result.metadata,
          tier: result.tier,
          persisted: false,
          error: result.error
        };
      }
      /* Upload to persistent storage */
      return upload(result.blob, uploadUrl, fields, report, presignedConfig)
        .then(function (uploadResult) {
          /* Revoke the temporary blob URL now that we have a persistent one */
          try { URL.revokeObjectURL(result.blobUrl); } catch (_) {}
          return {
            url: uploadResult.url,
            blobUrl: uploadResult.url,
            metadata: result.metadata,
            tier: result.tier,
            persisted: uploadResult.persisted
          };
        })
        .catch(function (uploadErr) {
          console.warn('[CFS Preprocessor] Upload failed:', uploadErr);
          report('⚠ Video not saved — changes may be lost');
          /* Keep blob URL as fallback */
          return {
            url: result.blobUrl,
            blobUrl: result.blobUrl,
            metadata: result.metadata,
            tier: result.tier,
            persisted: false,
            error: uploadErr.message
          };
        });
    });
  }

  /**
   * Release a previously created blob URL.
   */
  function revoke(blobUrl) {
    if (blobUrl && blobUrl.indexOf('blob:') === 0) {
      try { URL.revokeObjectURL(blobUrl); } catch (_) {}
    }
  }

  /* ── Live Video Preview System ──────────────────────────────────────── */

  var _liveGroups = [];       /* Groups with active live previews */
  var _rafId = null;          /* Single shared RAF for all previews */

  /**
   * Create a live video preview inside a Fabric group.
   *
   * Replaces the group's children with a Fabric.Image whose source is
   * an intermediary canvas that receives video frames via RAF.
   *
   * @param {fabric.Group} group - The video group on the Fabric canvas
   * @param {string}       videoUrl - URL to play (should be processed MP4)
   * @param {fabric.Canvas} fabricCanvas - The Fabric canvas instance
   * @param {object}       [opts] - Optional { width, height, muted }
   * @returns {Promise<{video: HTMLVideoElement}>}
   */
  function createLivePreview(group, videoUrl, fabricCanvas, opts) {
    opts = opts || {};
    if (!group || !videoUrl || !fabricCanvas) return Promise.resolve(null);

    /* Skip template placeholders */
    if (typeof videoUrl === 'string' && /^\s*\{\{/.test(videoUrl)) return Promise.resolve(null);

    return new Promise(function (resolve) {
      var video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = opts.muted !== false;
      video.playsInline = true;
      video.loop = true;
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);

      var resolved = false;
      var timeout = setTimeout(function () { finish(false); }, 15000);

      function finish(ok) {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        if (!ok) {
          try { video.pause(); video.removeAttribute('src'); video.load(); } catch (_) {}
          try { document.body.removeChild(video); } catch (_) {}
          resolve(null);
          return;
        }

        var vw = video.videoWidth || 640;
        var vh = video.videoHeight || 360;

        /* Size to fit group, respecting aspect ratio */
        var gw = group.width || 320;
        var gh = group.height || 180;
        var scale = Math.min(gw / vw, gh / vh, 1);
        var drawW = Math.round(vw * scale);
        var drawH = Math.round(vh * scale);

        /* Intermediary canvas for drawing video frames */
        var interCanvas = document.createElement('canvas');
        interCanvas.width = drawW;
        interCanvas.height = drawH;
        var ctx = interCanvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, drawW, drawH);

        /* Draw first frame */
        try { ctx.drawImage(video, 0, 0, drawW, drawH); } catch (_) {}

        /* Create Fabric.Image from the intermediary canvas */
        var fabricImg = new fabric.Image(interCanvas, {
          left: -drawW / 2,
          top: -drawH / 2,
          selectable: false,
          evented: false,
          objectCaching: false
        });

        /* Exclude from JSON serialization — the preview is rebuilt on load */
        fabricImg.toObject = function () { return {}; };
        fabricImg.toJSON = fabricImg.toObject;

        /* Remove old children and add the video image */
        var oldObjs = group.getObjects ? group.getObjects() : [];
        for (var i = oldObjs.length - 1; i >= 0; i--) {
          group.remove(oldObjs[i]);
        }

        /* Add a dark background rect */
        var bg = new fabric.Rect({
          width: drawW, height: drawH,
          left: -drawW / 2, top: -drawH / 2,
          fill: '#000', selectable: false, evented: false
        });
        group.addWithUpdate(bg);
        group.addWithUpdate(fabricImg);

        /* Update group dimensions */
        group.set({ width: drawW, height: drawH });
        if (group.setCoords) group.setCoords();
        if (group.dirty != null) group.dirty = true;

        /* Store references on the group for the render loop */
        group._cfsLiveVideoEl = video;
        group._cfsLiveVideoImg = fabricImg;
        group._cfsIntermediaryCanvas = interCanvas;
        group._cfsIntermediaryCtx = ctx;
        group._cfsDrawW = drawW;
        group._cfsDrawH = drawH;

        /* Track this group for the shared RAF loop */
        if (_liveGroups.indexOf(group) === -1) _liveGroups.push(group);
        _startRenderLoop(fabricCanvas);

        fabricCanvas.renderAll();
        resolve({ video: video });
      }

      /* CORS retry: if crossOrigin fails, try without */
      var corsRetried = false;
      video.addEventListener('error', function () {
        if (!corsRetried && video.crossOrigin) {
          corsRetried = true;
          video.crossOrigin = '';
          video.src = videoUrl;
          video.load();
          return;
        }
        finish(false);
      });

      video.addEventListener('loadeddata', function () {
        /* Seek to 0.1s for a good first frame (some videos have black frame 0) */
        try { video.currentTime = 0.1; } catch (_) {}
      });

      video.addEventListener('seeked', function () {
        finish(true);
      });

      video.addEventListener('canplay', function () {
        if (!resolved) {
          /* Fallback if seeked never fires */
          setTimeout(function () { finish(true); }, 200);
        }
      });

      video.src = videoUrl;
      video.load();
    });
  }

  /**
   * Shared RAF render loop — draws video frames to all live groups.
   */
  function _startRenderLoop(fabricCanvas) {
    if (_rafId) return; /* Already running */

    function tick() {
      var needsRender = false;
      for (var i = _liveGroups.length - 1; i >= 0; i--) {
        var g = _liveGroups[i];
        if (!g._cfsLiveVideoEl || !g._cfsIntermediaryCtx || !g.canvas) {
          _liveGroups.splice(i, 1);
          continue;
        }
        var v = g._cfsLiveVideoEl;
        if (v.readyState >= 2 && !v.paused) {
          try {
            g._cfsIntermediaryCtx.drawImage(v, 0, 0, g._cfsDrawW, g._cfsDrawH);
          } catch (_) {}
          if (g._cfsLiveVideoImg) {
            g._cfsLiveVideoImg.dirty = true;
          }
          needsRender = true;
        }
      }
      if (needsRender && fabricCanvas) {
        fabricCanvas.renderAll();
      }
      if (_liveGroups.length > 0) {
        _rafId = requestAnimationFrame(tick);
      } else {
        _rafId = null;
      }
    }

    _rafId = requestAnimationFrame(tick);
  }

  /**
   * Sync a video group's playback to a specific time (for timeline scrubbing).
   *
   * @param {fabric.Group} group
   * @param {number} timeSec - Playhead time in seconds
   */
  function syncToTime(group, timeSec) {
    if (!group || !group._cfsLiveVideoEl) return;
    var video = group._cfsLiveVideoEl;
    var trim = typeof group.cfsTrim === 'number' ? group.cfsTrim : 0;
    var target = trim + timeSec;
    if (video.duration && target > video.duration) target = video.duration - 0.01;
    if (target < 0) target = 0;
    if (Math.abs(video.currentTime - target) > 0.05) {
      video.currentTime = target;
    }
  }

  /**
   * Sync ALL live video groups to a playhead time.
   *
   * @param {fabric.Canvas} fabricCanvas
   * @param {number} timeSec
   */
  function syncAllToTime(fabricCanvas, timeSec) {
    if (!fabricCanvas || !fabricCanvas.getObjects) return;
    fabricCanvas.getObjects().forEach(function (obj) {
      if (obj._cfsLiveVideoEl) syncToTime(obj, timeSec);
    });
  }

  /**
   * Start playback of all live video groups.
   */
  function playAll(fabricCanvas) {
    if (!fabricCanvas || !fabricCanvas.getObjects) return;
    fabricCanvas.getObjects().forEach(function (obj) {
      if (obj._cfsLiveVideoEl && obj._cfsLiveVideoEl.paused) {
        obj._cfsLiveVideoEl.play().catch(function () {});
      }
    });
    _startRenderLoop(fabricCanvas);
  }

  /**
   * Pause playback of all live video groups.
   */
  function pauseAll(fabricCanvas) {
    if (!fabricCanvas || !fabricCanvas.getObjects) return;
    fabricCanvas.getObjects().forEach(function (obj) {
      if (obj._cfsLiveVideoEl && !obj._cfsLiveVideoEl.paused) {
        obj._cfsLiveVideoEl.pause();
      }
    });
  }

  /**
   * Clean up a video group's live preview (video element, RAF tracking).
   * Call this when removing a video group from the canvas.
   *
   * @param {fabric.Group} group
   */
  function destroyPreview(group) {
    if (!group) return;
    if (group._cfsLiveVideoEl) {
      try {
        group._cfsLiveVideoEl.pause();
        group._cfsLiveVideoEl.removeAttribute('src');
        group._cfsLiveVideoEl.load();
        if (group._cfsLiveVideoEl.parentNode) {
          group._cfsLiveVideoEl.parentNode.removeChild(group._cfsLiveVideoEl);
        }
      } catch (_) {}
      group._cfsLiveVideoEl = null;
    }
    group._cfsLiveVideoImg = null;
    group._cfsIntermediaryCanvas = null;
    group._cfsIntermediaryCtx = null;
    /* Remove from RAF tracking */
    var idx = _liveGroups.indexOf(group);
    if (idx >= 0) _liveGroups.splice(idx, 1);
  }

  /**
   * Report available processing capabilities.
   */
  function capabilities() {
    return {
      ffmpeg: hasFFmpeg(),
      webcodecs: hasWebCodecs(),
      mp4box: hasMP4Box(),
      preferredTier: hasFFmpeg() ? 'ffmpeg' : (hasWebCodecs() && hasMP4Box()) ? 'webcodecs' : 'direct'
    };
  }

  /* ── Export ─────────────────────────────────────────────────────────── */

  global.CfsVideoPreprocessor = {
    probe: quickProbe,
    process: process,
    upload: upload,
    processAndPersist: processAndPersist,
    selectTier: selectTier,
    capabilities: capabilities,
    revoke: revoke,
    /* Live preview system */
    createLivePreview: createLivePreview,
    syncToTime: syncToTime,
    syncAllToTime: syncAllToTime,
    playAll: playAll,
    pauseAll: pauseAll,
    destroyPreview: destroyPreview,
  };

})(typeof window !== 'undefined' ? window : self);
