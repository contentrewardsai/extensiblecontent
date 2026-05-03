/* pixi-timeline-player v2.1 — media-proxy CORS fallback */
/**
 * PixiJS timeline player.
 * Loads template.json (timeline Edit API), builds a PixiJS stage per clip, applies
 * transitions/effects, and exposes seek(time) + captureFrame() for local video export.
 * Requires: PIXI global (e.g. from lib/pixi.min.js or CDN).
 * @see docs/PIXI_TIMELINE_PLAYER.md
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  if (!PIXI) {
    console.warn('PixiJS (PIXI) not loaded; pixi-timeline-player will not run. Add script tag for pixi.min.js to enable.');
    global.__CFS_pixiShotstackPlayer = function () {
      return {
        load: function () { return Promise.reject(new Error('PixiJS (PIXI) not loaded')); },
        seek: function () {},
        getDuration: function () { return 0; },
        captureFrame: function () { return Promise.resolve(null); },
        captureFrameSequence: function () { return Promise.resolve([]); },
        setMerge: function () {},
        destroy: function () {},
        getCanvas: function () { return null; }
      };
    };
    global.__CFS_PixiShotstackPlayer = null;
    return;
  }

  var TRANSITION_DURATION = {
    fade: 0.3, fadeSlow: 0.6, fadeFast: 0.15,
    reveal: 0.5, revealSlow: 0.8, revealFast: 0.25,
    wipeLeft: 0.35, wipeRight: 0.35, wipeUp: 0.35, wipeDown: 0.35,
    slideLeft: 0.4, slideRight: 0.4, slideUp: 0.4, slideDown: 0.4,
    slideLeftSlow: 0.7, slideRightSlow: 0.7, slideUpSlow: 0.7, slideDownSlow: 0.7,
    zoomIn: 0.35, zoomOut: 0.35, zoomInSlow: 0.6, zoomOutSlow: 0.6,
    carouselLeft: 0.5, carouselRight: 0.5, carouselUp: 0.5, carouselDown: 0.5,
    carouselLeftSlow: 0.8, carouselRightSlow: 0.8, carouselUpSlow: 0.8, carouselDownSlow: 0.8,
    shuffle: 0.5,
    shuffleTopRight: 0.5, shuffleRightTop: 0.5, shuffleRightBottom: 0.5, shuffleBottomRight: 0.5,
    shuffleBottomLeft: 0.5, shuffleLeftBottom: 0.5, shuffleLeftTop: 0.5, shuffleTopLeft: 0.5
  };

  function parseColor(hex) {
    if (!hex || typeof hex !== 'string') return 0xffffff;
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return isNaN(n) ? 0xffffff : n;
  }

  /**
   * Build a PIXI filter for ShotStack clip.filter values.
   * Returns an array of PIXI.Filter instances or empty array.
   */
  function buildClipFilters(filterName) {
    if (!filterName || filterName === 'none') return [];
    var F = PIXI.filters || {};
    var out = [];
    switch (filterName) {
      case 'blur':
        if (typeof PIXI.BlurFilter !== 'undefined') out.push(new PIXI.BlurFilter(8));
        else if (F.BlurFilter) out.push(new F.BlurFilter(8));
        break;
      case 'greyscale':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.greyscale(0.5, false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.greyscale(0.5, false); out.push(cm2); }
        break;
      case 'contrast':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.contrast(0.4, false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.contrast(0.4, false); out.push(cm2); }
        break;
      case 'darken':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.brightness(0.6, false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.brightness(0.6, false); out.push(cm2); }
        break;
      case 'lighten':
      case 'boost':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.brightness(1.4, false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.brightness(1.4, false); out.push(cm2); }
        break;
      case 'negative':
      case 'invert':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.negative(false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.negative(false); out.push(cm2); }
        break;
      case 'sepia':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.sepia(false); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.sepia(false); out.push(cm2); }
        break;
      case 'muted':
        if (typeof PIXI.ColorMatrixFilter !== 'undefined') { var cm = new PIXI.ColorMatrixFilter(); cm.desaturate(); out.push(cm); }
        else if (F.ColorMatrixFilter) { var cm2 = new F.ColorMatrixFilter(); cm2.desaturate(); out.push(cm2); }
        break;
      default: break;
    }
    return out;
  }

  function createPixiText(text, styleOpts) {
    var str = String(text != null ? text : '');
    try {
      var t = new PIXI.Text({ text: str, style: styleOpts });
      if (t.text !== str) t.text = str;
      return t;
    } catch (_) {
      try {
        var style = PIXI.TextStyle ? new PIXI.TextStyle(styleOpts) : styleOpts;
        return new PIXI.Text(str, style);
      } catch (e2) {
        console.warn('[CFS] PIXI.Text creation failed', e2);
        return new PIXI.Text(str);
      }
    }
  }

  function applyTextTransform(text, transform) {
    if (!transform || !text) return text;
    if (transform === 'uppercase') return text.toUpperCase();
    if (transform === 'lowercase') return text.toLowerCase();
    if (transform === 'capitalize') return text.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return text;
  }

  /**
   * Load custom fonts from timeline.fonts array via FontFace API.
   * For entries without a family, fetches the font file and parses the name table.
   * Returns a promise that resolves when all fonts are loaded (or fail gracefully).
   */
  function loadTimelineFonts(template) {
    var fonts = template && template.timeline && template.timeline.fonts;
    if (!Array.isArray(fonts) || !fonts.length) return Promise.resolve();
    if (typeof FontFace === 'undefined') return Promise.resolve();
    var parseFn = (typeof global !== 'undefined' && global.__CFS_parseFontFamilyFromBuffer) || null;
    var promises = [];
    function addFontFace(name, src, weight, style) {
      try {
        var face = new FontFace(name, 'url(' + src + ')', { weight: weight || 'normal', style: style || 'normal' });
        return face.load().then(function (loaded) { document.fonts.add(loaded); });
      } catch (e) { console.warn('[CFS] FontFace creation failed for', name, e); return Promise.resolve(); }
    }
    fonts.forEach(function (f) {
      if (!f || !f.src) return;
      if (f.family) {
        promises.push(addFontFace(f.family, f.src, f.weight, f.style).catch(function (err) { console.warn('[CFS] Font load failed for', f.family, err); }));
        return;
      }
      if (parseFn) {
        var p = fetch(f.src).then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.arrayBuffer();
        }).then(function (buf) {
          var name = parseFn(buf);
          if (!name) return;
          var loads = [addFontFace(name, f.src, f.weight, f.style)];
          var parseNames = (typeof global !== 'undefined' && global.__CFS_parseFontNamesFromBuffer);
          if (typeof parseNames === 'function') {
            var names = parseNames(buf);
            if (names.familyName && names.familyName !== name) {
              loads.push(addFontFace(names.familyName, f.src, f.weight, f.style));
            }
          }
          return Promise.all(loads);
        }).catch(function (err) { console.warn('[CFS] Font auto-detect failed for', f.src, err); });
        promises.push(p);
      }
    });
    return Promise.all(promises);
  }

  function applyMerge(textOrUrl, merge) {
    if (!merge || typeof textOrUrl !== 'string') return textOrUrl;
    var s = textOrUrl;
    Object.keys(merge).forEach(function (key) {
      var val = merge[key];
      if (val === undefined || val === null) val = '';
      s = s.replace(new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}', 'gi'), String(val));
    });
    return s.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, '').trim();
  }

  /**
   * Download media URLs (video, image, svg, audio) to blob URLs so they are same-origin for canvas/CORS.
   * Returns { map: { originalUrl: blobUrl }, toRevoke: [blobUrl, ...] }.
   */
  function resolveMediaToBlobUrls(template, merge) {
    var map = {};
    var toRevoke = [];
    var mergeObj = merge || {};
    function addUrl(url) {
      if (!url || typeof url !== 'string' || url.indexOf('{{') !== -1) return;
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!url.startsWith('http://') && !url.startsWith('https://')) return;
      if (map[url]) return;
      map[url] = url;
    }
    var tracks = (template && template.timeline && template.timeline.tracks) || [];
    var soundtrackSrc = template && template.timeline && template.timeline.soundtrack && template.timeline.soundtrack.src
      ? applyMerge(template.timeline.soundtrack.src, mergeObj)
      : '';
    addUrl(soundtrackSrc);
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        var asset = clip.asset || {};
        var type = (asset.type || '').toLowerCase();
        var src = asset.src != null ? applyMerge(asset.src, mergeObj) : '';
        if (type === 'video' || type === 'image' || type === 'svg' || type === 'audio' || type === 'luma') addUrl(src);
      });
    });
    var urls = Object.keys(map);
    if (urls.length === 0) return Promise.resolve({ map: {}, toRevoke: [] });
    var resolved = {};
    var revokeList = [];
    function imageToBlobUrl(url, useCors) {
      return new Promise(function (resolve) {
        var img = new Image();
        if (useCors) img.crossOrigin = 'anonymous';
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(function (blob) {
              if (blob) {
                var blobUrl = URL.createObjectURL(blob);
                resolved[url] = blobUrl;
                revokeList.push(blobUrl);
              }
              resolve();
            });
          } catch (e2) { resolve(); }
        };
        img.onerror = function () { resolve(); };
        img.src = url;
      });
    }
    function fetchOne(url) {
      return fetch(url, { mode: 'cors' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      }).then(function (blob) {
        if (!blob) return;
        var blobUrl = URL.createObjectURL(blob);
        resolved[url] = blobUrl;
        revokeList.push(blobUrl);
      }).catch(function (err) {
        /* CORS fetch failed — try server-side media proxy */
        var proxyBase = (typeof location !== 'undefined' && location.origin) || '';
        if (proxyBase) {
          var proxyUrl = proxyBase + '/api/media-proxy?url=' + encodeURIComponent(url);
          return fetch(proxyUrl).then(function (proxyRes) {
            if (!proxyRes.ok) throw new Error('Proxy HTTP ' + proxyRes.status);
            return proxyRes.blob();
          }).then(function (blob) {
            if (!blob) return;
            var blobUrl = URL.createObjectURL(blob);
            resolved[url] = blobUrl;
            revokeList.push(blobUrl);
          }).catch(function () {
            /* Proxy also failed — try image canvas fallback */
            return imageToBlobUrl(url, true).then(function () {
              if (resolved[url]) return;
              return imageToBlobUrl(url, false);
            }).then(function () {
              if (!resolved[url]) {
                console.warn('[CFS] Could not resolve media to blob URL:', url);
                if (typeof global.__CFS_onMediaLoadFailed === 'function') global.__CFS_onMediaLoadFailed(url, err);
                if (typeof global.window !== 'undefined' && global.window.__CFS_onMediaLoadFailed) global.window.__CFS_onMediaLoadFailed(url, err);
              }
            });
          });
        }
        return imageToBlobUrl(url, true).then(function () {
          if (resolved[url]) return;
          return imageToBlobUrl(url, false);
        }).then(function () {
          if (!resolved[url]) {
            console.warn('[CFS] Could not resolve media to blob URL:', url);
            if (typeof global.__CFS_onMediaLoadFailed === 'function') global.__CFS_onMediaLoadFailed(url, err);
            if (typeof global.window !== 'undefined' && global.window.__CFS_onMediaLoadFailed) global.window.__CFS_onMediaLoadFailed(url, err);
          }
        });
      });
    }
    return Promise.all(urls.map(fetchOne)).then(function () {
      return { map: resolved, toRevoke: revokeList };
    });
  }

  function normalizeVolume(raw, fallback) {
    var base = fallback != null ? Number(fallback) : 1;
    if (isNaN(base)) base = 1;
    var n = Number(raw);
    if (isNaN(n)) return Math.max(0, Math.min(4, base));
    if (n > 1 && n <= 100) n = n / 100;
    return Math.max(0, Math.min(4, n));
  }

  function resolveClipLengthForAudio(clip, totalDuration) {
    var start = typeof clip.start === 'number' ? clip.start : 0;
    if (clip.length === 'end' || clip.length === 'auto') return Math.max(0, totalDuration - start);
    return typeof clip.length === 'number' ? clip.length : 5;
  }

  function collectAudioEntries(template, merge, blobUrlMap, totalDuration, preGeneratedTts) {
    var entries = [];
    if (!template || !template.timeline) return entries;
    var timeline = template.timeline || {};
    var mergeObj = merge || {};
    var map = blobUrlMap || {};
    var ttsMap = preGeneratedTts || {};
    var soundtrack = timeline.soundtrack || null;
    if (soundtrack && soundtrack.src) {
      var soundtrackSrc = applyMerge(soundtrack.src, mergeObj);
      if (map[soundtrackSrc]) soundtrackSrc = map[soundtrackSrc];
      if (soundtrackSrc && soundtrackSrc.indexOf('{{') === -1) {
        var soundtrackLength = typeof soundtrack.duration === 'number' ? soundtrack.duration : totalDuration;
        entries.push({
          src: soundtrackSrc,
          timelineStart: 0,
          timelineLength: Math.max(0, soundtrackLength),
          sourceOffset: soundtrack.start != null ? Math.max(0, Number(soundtrack.start) || 0) : 0,
          volume: normalizeVolume(soundtrack.volume, 1),
          fadeIn: soundtrack.fadeIn != null ? Math.max(0, Number(soundtrack.fadeIn) || 0) : 0,
          fadeOut: soundtrack.fadeOut != null ? Math.max(0, Number(soundtrack.fadeOut) || 0) : 0,
        });
      }
    }
    (timeline.tracks || []).forEach(function (track, trackIdx) {
      (track.clips || []).forEach(function (clip, clipIdx) {
        var asset = clip.asset || {};
        var type = (asset.type || '').toLowerCase();
        if (type !== 'audio' && type !== 'video' && type !== 'text-to-speech') return;
        var src = applyMerge(asset.src || asset.url || '', mergeObj);
        if (type === 'text-to-speech' && (!src || src.indexOf('{{') !== -1)) {
          var ttsKey = trackIdx + '_' + clipIdx;
          if (ttsMap[ttsKey]) src = ttsMap[ttsKey];
        }
        if (map[src]) src = map[src];
        if (!src || src.indexOf('{{') !== -1) return;
        var timelineStart = typeof clip.start === 'number' ? clip.start : 0;
        var timelineLength = resolveClipLengthForAudio(clip, totalDuration);
        var sourceOffset = clip.trim != null ? Number(clip.trim) : (asset.trim != null ? Number(asset.trim) : 0);
        var audioEffect = (asset.effect || '').toLowerCase();
        var fadeInDur = clip.fadeIn != null ? Math.max(0, Number(clip.fadeIn) || 0) : 0;
        var fadeOutDur = clip.fadeOut != null ? Math.max(0, Number(clip.fadeOut) || 0) : 0;
        if (!fadeInDur && (audioEffect === 'fadein' || audioEffect === 'fadeinfadeout')) fadeInDur = Math.min(timelineLength * 0.5, 2);
        if (!fadeOutDur && (audioEffect === 'fadeout' || audioEffect === 'fadeinfadeout')) fadeOutDur = Math.min(timelineLength * 0.5, 2);
        entries.push({
          src: src,
          timelineStart: Math.max(0, timelineStart),
          timelineLength: Math.max(0, timelineLength),
          sourceOffset: Math.max(0, sourceOffset || 0),
          volume: normalizeVolume(asset.volume, 1),
          fadeIn: fadeInDur,
          fadeOut: fadeOutDur,
        });
      });
    });
    return entries;
  }

  function decodeAudio(offlineCtx, src) {
    var proxyBase = (typeof location !== 'undefined' && location.origin) || '';
    return fetch(src).catch(function () {
      /* CORS fetch failed — try media proxy */
      if (proxyBase && !src.startsWith('blob:') && !src.startsWith('data:')) {
        return fetch(proxyBase + '/api/media-proxy?url=' + encodeURIComponent(src));
      }
      return Promise.reject(new Error('CORS blocked'));
    }).then(function (res) {
      if (!res.ok) throw new Error('Audio fetch failed');
      return res.arrayBuffer();
    }).then(function (ab) {
      return offlineCtx.decodeAudioData(ab);
    }).catch(function () {
      return null;
    });
  }

  function renderMixedAudioBuffer(template, merge, blobUrlMap, durationSec, preGeneratedTts, rangeStart) {
    durationSec = Math.max(0.05, Number(durationSec) || 0);
    rangeStart = Math.max(0, Number(rangeStart) || 0);
    if (typeof global.OfflineAudioContext === 'undefined' && typeof global.webkitOfflineAudioContext === 'undefined') {
      return Promise.resolve(null);
    }
    var OfflineCtx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    var sampleRate = 48000;
    var frameCount = Math.max(1, Math.ceil(durationSec * sampleRate));
    var totalTimelineDuration = rangeStart + durationSec;
    var entries = collectAudioEntries(template, merge, blobUrlMap, totalTimelineDuration, preGeneratedTts).filter(function (e) {
      return e.src && e.timelineLength > 0 && e.volume > 0;
    });
    if (!entries.length) return Promise.resolve(null);
    var offline = new OfflineCtx(2, frameCount, sampleRate);
    var masterGain = offline.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(offline.destination);
    return Promise.all(entries.map(function (entry) {
      return decodeAudio(offline, entry.src).then(function (buffer) {
        if (!buffer) return;
        var rawStart = Math.max(0, entry.timelineStart);
        var start = Math.max(0, rawStart - rangeStart);
        var offset = Math.max(0, entry.sourceOffset || 0);
        if (rawStart < rangeStart) offset += (rangeStart - rawStart);
        var maxPlayable = Math.max(0, buffer.duration - offset);
        var playLen = Math.min(entry.timelineLength, durationSec - start, maxPlayable);
        if (!(playLen > 0)) return;
        var source = offline.createBufferSource();
        source.buffer = buffer;
        var gain = offline.createGain();
        var vol = Math.max(0, entry.volume);
        gain.gain.setValueAtTime(vol, start);
        var fadeIn = Math.min(playLen, Math.max(0, entry.fadeIn || 0));
        var fadeOut = Math.min(playLen, Math.max(0, entry.fadeOut || 0));
        if (fadeIn > 0) {
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(vol, start + fadeIn);
        }
        if (fadeOut > 0) {
          var fadeOutStart = Math.max(start, start + playLen - fadeOut);
          gain.gain.setValueAtTime(vol, fadeOutStart);
          gain.gain.linearRampToValueAtTime(0, start + playLen);
        }
        source.connect(gain);
        gain.connect(masterGain);
        source.start(start, offset, playLen);
      });
    })).then(function () {
      return offline.startRendering().catch(function () { return null; });
    }).catch(function () {
      return null;
    });
  }

  function createMixedAudioPlaybackForPlayer(player, durationSec, rangeStart) {
    durationSec = Math.max(0.05, Number(durationSec) || (player && player._duration) || 10);
    rangeStart = Math.max(0, Number(rangeStart) || 0);
    if (!player || !player._template) return Promise.resolve(null);
    var AudioCtx = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtx) return Promise.resolve(null);
    return renderMixedAudioBuffer(player._template, player._merge, player._blobUrlMap, durationSec, player._preGeneratedTts || null, rangeStart).then(function (buffer) {
      if (!buffer) return null;
      var ctx = new AudioCtx();
      var dest = ctx.createMediaStreamDestination();
      var master = ctx.createGain();
      master.gain.value = 1;
      master.connect(dest);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      var started = false;
      var startAt = 0;
      var stopped = false;
      source.onended = function () {
        stopped = true;
      };
      return {
        stream: dest.stream,
        start: function () {
          if (started) return Promise.resolve();
          started = true;
          return Promise.resolve(ctx.resume()).then(function () {
            startAt = ctx.currentTime + 0.05;
            source.start(startAt);
          }).catch(function () {
            startAt = ctx.currentTime;
            try { source.start(startAt); } catch (e) {}
          });
        },
        getCurrentTimeSec: function () {
          if (!started) return 0;
          return Math.max(0, ctx.currentTime - startAt);
        },
        isEnded: function () {
          return !!stopped;
        },
        stop: function () {
          stopped = true;
          try { source.stop(0); } catch (e) {}
          try { ctx.close(); } catch (e) {}
        }
      };
    });
  }

  var positionFromClip = global.__CFS_positionFromClip || function (canvasW, canvasH, clip, elemW, elemH) {
    var offset = clip.offset || {};
    var ox = offset.x != null ? Number(offset.x) : 0;
    var oy = offset.y != null ? Number(offset.y) : 0;
    var dx = Math.abs(ox) <= 1 ? ox * canvasW : ox;
    var dy = Math.abs(oy) <= 1 ? -oy * canvasH : -oy;
    var pos = (clip.position || '').toLowerCase();
    if (!pos) pos = 'center';
    var x, y;
    if (pos === 'center') { x = (canvasW - elemW) / 2 + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'top') { x = (canvasW - elemW) / 2 + dx; y = 0 + dy; }
    else if (pos === 'bottom') { x = (canvasW - elemW) / 2 + dx; y = canvasH - elemH + dy; }
    else if (pos === 'left') { x = 0 + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'right') { x = canvasW - elemW + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'topleft') { x = 0 + dx; y = 0 + dy; }
    else if (pos === 'topright') { x = canvasW - elemW + dx; y = 0 + dy; }
    else if (pos === 'bottomleft') { x = 0 + dx; y = canvasH - elemH + dy; }
    else if (pos === 'bottomright') { x = canvasW - elemW + dx; y = canvasH - elemH + dy; }
    else { x = (canvasW - elemW) / 2 + dx; y = (canvasH - elemH) / 2 + dy; }
    return { x: x, y: y, left: x, top: y };
  };

  function transitionProgress(t, clipStart, clipLength, transitionIn, transitionOut, transitionDurations) {
    var inDur = (transitionIn && transitionDurations[transitionIn]) ? transitionDurations[transitionIn] : 0.3;
    var outDur = (transitionOut && transitionDurations[transitionOut]) ? transitionDurations[transitionOut] : 0.3;
    var clipEnd = clipStart + clipLength;
    var inProgress = t <= clipStart ? 0 : (t >= clipStart + inDur ? 1 : (t - clipStart) / inDur);
    var outProgress = t >= clipEnd ? 1 : (t < clipEnd - outDur ? 0 : (t - (clipEnd - outDur)) / outDur);
    return { inProgress: inProgress, outProgress: outProgress, inDur: inDur, outDur: outDur };
  }

  /**
   * Evaluate a ShotStack tween array at a given relative time within a clip.
   * Each tween: { from, to, start, length, interpolation?, easing? }
   * start/length are relative to clip start (seconds).
   * Returns interpolated value or defaultValue if no tweens are active.
   */
  function evaluateTweenArray(tweenArr, relTime, defaultValue) {
    if (!Array.isArray(tweenArr) || tweenArr.length === 0) return defaultValue;
    var lastCompleted = null;
    for (var i = 0; i < tweenArr.length; i++) {
      var tw = tweenArr[i];
      if (!tw || tw.from == null || tw.to == null) continue;
      var twStart = typeof tw.start === 'number' ? tw.start : 0;
      var twLen = typeof tw.length === 'number' ? tw.length : 1;
      if (twLen <= 0) twLen = 0.001;
      var twEnd = twStart + twLen;
      if (relTime < twStart) continue;
      if (relTime >= twEnd) {
        lastCompleted = tw.to;
        continue;
      }
      var progress = (relTime - twStart) / twLen;
      progress = Math.max(0, Math.min(1, progress));
      var easing = (tw.easing || '').toLowerCase();
      if (easing === 'easein' || easing === 'ease-in') progress = progress * progress;
      else if (easing === 'easeout' || easing === 'ease-out') progress = 1 - (1 - progress) * (1 - progress);
      else if (easing === 'easeinout' || easing === 'ease-in-out') progress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      return tw.from + (tw.to - tw.from) * progress;
    }
    if (lastCompleted != null) return lastCompleted;
    return tweenArr[0] && tweenArr[0].from != null ? tweenArr[0].from : defaultValue;
  }

  /**
   * Apply tween animations to a display object during seek().
   * Modifies disp.alpha, disp.x, disp.y, disp.angle based on clip tween data.
   */
  function applyTweensToObject(disp, t, canvasW, canvasH) {
    var meta = disp.cfsClipMeta;
    if (!meta) return;
    var clip = meta.clip || {};
    var relTime = t - meta.start;

    if (Array.isArray(clip.opacity)) {
      var opVal = evaluateTweenArray(clip.opacity, relTime, 1);
      disp.alpha = Math.max(0, Math.min(1, opVal));
    } else if (typeof clip.opacity === 'number') {
      disp.alpha = Math.max(0, Math.min(1, clip.opacity));
    }

    var offset = clip.offset || {};
    var oxTween = Array.isArray(offset.x);
    var oyTween = Array.isArray(offset.y);
    if (oxTween || oyTween) {
      var baseOx = oxTween ? evaluateTweenArray(offset.x, relTime, 0) : (typeof offset.x === 'number' ? offset.x : 0);
      var baseOy = oyTween ? evaluateTweenArray(offset.y, relTime, 0) : (typeof offset.y === 'number' ? offset.y : 0);
      var bounds = getDisplayBounds(disp);
      var tweenPos = positionFromClip(canvasW, canvasH, { position: clip.position, offset: { x: baseOx, y: baseOy } }, bounds.w, bounds.h);
      disp.x = tweenPos.x;
      disp.y = tweenPos.y;
    }

    if (Array.isArray(clip.scale)) {
      var scaleVal = evaluateTweenArray(clip.scale, relTime, 1);
      var _tbsx = disp._cfsBaseScaleX || 1;
      var _tbsy = disp._cfsBaseScaleY || 1;
      disp.scale.set(Math.max(0.01, scaleVal) * _tbsx, Math.max(0.01, scaleVal) * _tbsy);
    }

    var transform = clip.transform || {};
    var rotate = transform.rotate || {};
    var needsPivot = false;
    if (Array.isArray(rotate.angle)) {
      var angleVal = evaluateTweenArray(rotate.angle, relTime, 0);
      needsPivot = true;
      disp.angle = angleVal;
    }
    if (transform.flip) {
      if (transform.flip.horizontal) disp.scale.x *= -1;
      if (transform.flip.vertical) disp.scale.y *= -1;
      needsPivot = true;
    }
    if (transform.skew) {
      var skewX = typeof transform.skew.x === 'number' ? transform.skew.x : 0;
      var skewY = typeof transform.skew.y === 'number' ? transform.skew.y : 0;
      if (skewX !== 0 || skewY !== 0) {
        if (disp.skew && typeof disp.skew.set === 'function') disp.skew.set(skewX * Math.PI / 180, skewY * Math.PI / 180);
        needsPivot = true;
      }
    }
    if (needsPivot) {
      var bounds = getDisplayBounds(disp);
      disp.pivot.set(bounds.w / 2, bounds.h / 2);
      disp.x = (disp.x || 0) + bounds.w / 2;
      disp.y = (disp.y || 0) + bounds.h / 2;
    }
  }

  function effectProgress(t, clipStart, clipLength, effect) {
    if (!effect) return { progress: 1, active: false };
    var clipEnd = clipStart + clipLength;
    if (t < clipStart || t >= clipEnd) return { progress: 0, active: false };
    var elapsed = t - clipStart;
    var progress = Math.min(1, elapsed / Math.max(0.001, clipLength));
    return { progress: progress, active: true };
  }

  /**
   * Compute sprite size and position from clip fit/scale. Target = display box; source = media natural size.
   * Per Shotstack docs, fit is applied first, then clip.scale as a final multiplier.
   * Returns { width, height, x, y } for the sprite (top-left positioning).
   */
  function applyFitAndScale(clip, targetW, targetH, sourceW, sourceH) {
    var fit = (clip.fit || 'crop').toLowerCase();
    var scaleMult = typeof clip.scale === 'number' && clip.scale > 0 ? clip.scale : 1;
    if (sourceW <= 0 || sourceH <= 0) return { width: targetW * scaleMult, height: targetH * scaleMult, x: 0, y: 0 };
    var scaledTargetW = targetW * scaleMult;
    var scaledTargetH = targetH * scaleMult;
    var w, h, x, y;
    if (fit === 'contain') {
      var s = Math.min(scaledTargetW / sourceW, scaledTargetH / sourceH);
      w = sourceW * s;
      h = sourceH * s;
      x = (scaledTargetW - w) / 2;
      y = (scaledTargetH - h) / 2;
    } else if (fit === 'cover' || fit === 'crop') {
      var s = Math.max(scaledTargetW / sourceW, scaledTargetH / sourceH);
      w = sourceW * s;
      h = sourceH * s;
      x = (scaledTargetW - w) / 2;
      y = (scaledTargetH - h) / 2;
    } else if (fit === 'fill') {
      w = scaledTargetW;
      h = scaledTargetH;
      x = 0;
      y = 0;
    } else if (fit === 'none') {
      w = sourceW * scaleMult;
      h = sourceH * scaleMult;
      x = (scaledTargetW - w) / 2;
      y = (scaledTargetH - h) / 2;
    } else {
      var sCrop = Math.max(scaledTargetW / sourceW, scaledTargetH / sourceH);
      w = sourceW * sCrop;
      h = sourceH * sCrop;
      x = (scaledTargetW - w) / 2;
      y = (scaledTargetH - h) / 2;
    }
    return { width: w, height: h, x: x, y: y };
  }

  var parseHtmlClipCss = global.__CFS_parseHtmlClipCss || function (cssStr) {
    var result = { color: '#000000', fontSize: 16, fontFamily: 'sans-serif', textAlign: 'left' };
    if (!cssStr || typeof cssStr !== 'string') return result;
    var colorMatch = cssStr.match(/(?:^|[;\s{])color:\s*([^;}\s]+)/);
    if (colorMatch) result.color = colorMatch[1].trim();
    var sizeMatch = cssStr.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
    if (sizeMatch) result.fontSize = Number(sizeMatch[1]);
    var familyMatch = cssStr.match(/font-family:\s*'([^']+)'/);
    if (!familyMatch) familyMatch = cssStr.match(/font-family:\s*([^;}"]+)/);
    if (familyMatch) result.fontFamily = familyMatch[1].trim().replace(/^["']|["']$/g, '');
    var alignMatch = cssStr.match(/text-align:\s*([^;}\s]+)/);
    if (alignMatch) result.textAlign = alignMatch[1].trim();
    var bgMatch = cssStr.match(/background(?:-color)?:\s*([^;}\s]+)/);
    if (bgMatch) result.backgroundColor = bgMatch[1].trim();
    var weightMatch = cssStr.match(/font-weight:\s*([^;}\s]+)/);
    if (weightMatch) result.fontWeight = weightMatch[1].trim();
    return result;
  };
  var extractTextFromHtml = global.__CFS_extractTextFromHtml || function (htmlStr) {
    if (!htmlStr || typeof htmlStr !== 'string') return '';
    return htmlStr.replace(/<[^>]+>/g, '').trim();
  };

  function createHtml(clipMeta, asset, merge, canvasW, canvasH) {
    var htmlW = asset.width != null ? Number(asset.width) : 400;
    var htmlH = asset.height != null ? Number(asset.height) : 300;
    var parsedCss = parseHtmlClipCss(asset.css);
    var rawText = extractTextFromHtml(asset.html);
    var text = applyMerge(rawText, merge);
    var isHtmlRect = !!asset.background || parsedCss.fontSize <= 1;
    if (isHtmlRect) {
      var fillColor = parseColor(asset.background || parsedCss.color || '#cccccc');
      var g = new PIXI.Graphics();
      if (typeof g.rect === 'function') g.rect(0, 0, htmlW, htmlH);
      if (typeof g.fill === 'function') {
        if (g.fill.length > 0) g.fill(fillColor); else g.fill({ color: fillColor });
      }
      g.x = clipMeta.x || 0;
      g.y = clipMeta.y || 0;
      if (g.eventMode !== undefined) g.eventMode = 'none';
      return g;
    }
    var styleOpts = {
      fontFamily: parsedCss.fontFamily || 'Arial, sans-serif',
      fontSize: parsedCss.fontSize || 16,
      fill: parsedCss.color || '#000000',
      wordWrap: true,
      wordWrapWidth: htmlW,
    };
    if (parsedCss.fontWeight) styleOpts.fontWeight = parsedCss.fontWeight;
    if (parsedCss.textAlign && parsedCss.textAlign !== 'left') styleOpts.align = parsedCss.textAlign;
    var pixiText = createPixiText(text, styleOpts);

    if (parsedCss.backgroundColor) {
      var container = new PIXI.Container();
      var bgG = new PIXI.Graphics();
      bgG.rect(0, 0, htmlW, htmlH);
      var _bgC = parseColor(parsedCss.backgroundColor);
      if (typeof bgG.fill === 'function') {
        if (bgG.fill.length > 0) bgG.fill(_bgC); else bgG.fill({ color: _bgC });
      }
      bgG.x = clipMeta.x || 0;
      bgG.y = clipMeta.y || 0;
      container.addChild(bgG);
      var textYPad = Math.max(0, (htmlH - (parsedCss.fontSize || 16)) / 2);
      pixiText.x = (clipMeta.x || 0);
      pixiText.y = (clipMeta.y || 0) + textYPad;
      container.addChild(pixiText);
      container._cfsTextChild = pixiText;
      if (container.eventMode !== undefined) container.eventMode = 'none';
      return container;
    }

    pixiText.x = clipMeta.x || 0;
    pixiText.y = clipMeta.y || 0;
    if (pixiText.eventMode !== undefined) pixiText.eventMode = 'none';
    return pixiText;
  }

  function createRect(clipMeta, asset, canvasW, canvasH) {
    var w = asset.width != null ? Number(asset.width) : 400;
    var h = asset.height != null ? Number(asset.height) : 300;
    if (asset.right != null) w = Math.max(0, canvasW - (clipMeta.x || 0) - Number(asset.right));
    if (asset.bottom != null) h = Math.max(0, canvasH - (clipMeta.y || 0) - Number(asset.bottom));
    var g = new PIXI.Graphics();
    var fill = parseColor(asset.fill || '#eeeeee');
    var rx = asset.rx != null ? Number(asset.rx) : 0;
    var ry = asset.ry != null ? Number(asset.ry) : 0;
    if ((rx > 0 || ry > 0) && typeof g.roundRect === 'function') {
      g.roundRect(0, 0, w, h, Math.max(rx, ry));
    } else {
      g.rect(0, 0, w, h);
    }
    if (typeof g.fill === 'function') {
      if (g.fill.length > 0) g.fill(fill); else g.fill({ color: fill });
    }
    if (asset.stroke && asset.strokeWidth) {
      var strokeColor = parseColor(asset.stroke);
      if (g.stroke) g.stroke(strokeColor);
      if (g.lineStyle) g.lineStyle(Number(asset.strokeWidth), strokeColor);
    }
    g.x = clipMeta.x;
    g.y = clipMeta.y;
    if (g.eventMode !== undefined) g.eventMode = 'none';
    return g;
  }

  function createCircle(clipMeta, asset) {
    var r = asset.radius != null ? Number(asset.radius) : 20;
    var g = new PIXI.Graphics();
    g.circle(r, r, r);
    var fill = parseColor(asset.fill || '#cccccc');
    if (typeof g.fill === 'function') {
      if (g.fill.length > 0) g.fill(fill); else g.fill({ color: fill });
    }
    g.x = (clipMeta.x || 0);
    g.y = (clipMeta.y || 0);
    if (g.eventMode !== undefined) g.eventMode = 'none';
    return g;
  }

  /** Shape line: Shotstack type "shape", shape "line" – fill and stroke, length × thickness. */
  function createShapeLine(clipMeta, asset, canvasW, canvasH) {
    var line = asset.line || {};
    var len = Number(asset.width) || Number(line.length) || 100;
    var thick = Number(asset.height) || Number(line.thickness) || 4;
    var g = new PIXI.Graphics();
    if (typeof g.rect === 'function') g.rect(0, 0, len, thick);
    else if (g.rect) g.rect(0, 0, len, thick);
    var fillObj = asset.fill && typeof asset.fill === 'object' ? asset.fill : { color: asset.fill || '#ffffff', opacity: 1 };
    var fillColor = parseColor(fillObj.color || '#ffffff');
    var fillAlpha = fillObj.opacity != null ? Number(fillObj.opacity) : 1;
    if (typeof g.fill === 'function') {
      if (g.fill.length > 0) g.fill(fillColor);
      else g.fill({ color: fillColor, alpha: fillAlpha });
    }
    var strokeObj = asset.stroke && typeof asset.stroke === 'object' ? asset.stroke : null;
    var strokeW = strokeObj && strokeObj.width != null ? Number(strokeObj.width) : 0;
    if (strokeW > 0 && strokeObj && strokeObj.color) {
      var sc = parseColor(strokeObj.color);
      if (g.stroke) g.stroke({ color: sc, width: strokeW });
      else if (g.lineStyle) g.lineStyle(strokeW, sc);
    }
    g.x = clipMeta.x || 0;
    g.y = clipMeta.y || 0;
    var clip = clipMeta.clip || {};
    var rot = clip.transform && clip.transform.rotate && typeof clip.transform.rotate.angle === 'number' ? clip.transform.rotate.angle : 0;
    if (rot !== 0) {
      g.pivot.set(len / 2, thick / 2);
      g.x = (clipMeta.x || 0) + len / 2;
      g.y = (clipMeta.y || 0) + thick / 2;
      g.angle = rot;
    }
    if (g.eventMode !== undefined) g.eventMode = 'none';
    return g;
  }

  function buildTextStyleOpts(asset) {
    var font = asset.font || {};
    var style = asset.style || {};
    var fillColor = asset.fill != null ? asset.fill : (font.color != null ? font.color : '#000000');
    var fillStr = typeof fillColor === 'string' ? fillColor : '#' + ('000000' + (Number(fillColor) || 0).toString(16)).slice(-6);
    var fontSize = asset.fontSize != null ? Number(asset.fontSize) : (font.size != null ? Number(font.size) : 48);
    var opts = {
      fontFamily: asset.fontFamily || font.family || 'Arial, sans-serif',
      fontSize: fontSize,
      fill: fillStr,
      fontWeight: asset.fontWeight || font.weight || 'normal'
    };
    var rawLineHeight = style.lineHeight != null ? style.lineHeight : (font.lineHeight != null ? font.lineHeight : null);
    if (rawLineHeight != null) {
      var lh = Number(rawLineHeight);
      if (lh > 0 && lh <= 10) opts.lineHeight = Math.round(fontSize * lh);
      else if (lh > 10) opts.lineHeight = lh;
    }
    if (style.letterSpacing != null) opts.letterSpacing = Number(style.letterSpacing);
    else if (font.letterSpacing != null) opts.letterSpacing = Number(font.letterSpacing);
    if (font.style && font.style !== 'normal') opts.fontStyle = String(font.style);
    var strokeColor = asset.stroke || (style.stroke && style.stroke.color) || (style.stroke && typeof style.stroke === 'string' && style.stroke) || null;
    var strokeW = asset.strokeWidth != null ? Number(asset.strokeWidth) : (style.stroke && style.stroke.width != null ? Number(style.stroke.width) : 0);
    if (strokeColor && strokeW > 0) {
      opts.stroke = typeof strokeColor === 'string' ? strokeColor : '#' + ('000000' + (Number(strokeColor) || 0).toString(16)).slice(-6);
      opts.strokeThickness = strokeW;
    }
    var sh = asset.shadow || style.shadow;
    if (sh) {
      opts.dropShadow = true;
      opts.dropShadowColor = typeof sh.color === 'string' ? sh.color : '#' + ('000000' + (Number(sh.color) || 0).toString(16)).slice(-6);
      opts.dropShadowBlur = sh.blur != null ? Number(sh.blur) : 4;
      opts.dropShadowDistance = sh.offsetX != null || sh.offsetY != null ? Math.hypot(sh.offsetX != null ? Number(sh.offsetX) : 0, sh.offsetY != null ? Number(sh.offsetY) : 0) : 2;
      if (sh.offsetX != null && sh.offsetY != null) opts.dropShadowAngle = Math.atan2(Number(sh.offsetY), Number(sh.offsetX));
    }
    return { opts: opts, fontSize: fontSize };
  }

  function resolveWrapWidth(clipMeta, asset, canvasW) {
    var wrapW = clipMeta.clip && clipMeta.clip.width != null ? Number(clipMeta.clip.width) : (asset.width != null ? Number(asset.width) : 0);
    if (!(wrapW > 0) && asset.padding != null) {
      var _pw = asset.padding;
      var _pl = 0, _pr = 0;
      if (typeof _pw === 'number') { _pl = _pr = _pw; }
      else if (typeof _pw === 'object') {
        _pl = _pw.left != null ? Number(_pw.left) : 0;
        _pr = _pw.right != null ? Number(_pw.right) : 0;
      }
      wrapW = Math.max(0, canvasW - _pl - _pr);
    }
    if (!(wrapW > 0) && asset.right != null && canvasW > 0) {
      var rightPx = Number(asset.right);
      if (!Number.isNaN(rightPx)) wrapW = Math.max(0, Number(canvasW) - Number(clipMeta.x || 0) - rightPx);
    }
    if (!(wrapW > 0) && canvasW > 0) {
      wrapW = Math.max(0, canvasW - Number(clipMeta.x || 0));
    }
    return wrapW;
  }

  function resolveAlignment(asset) {
    var style = asset.style || {};
    var alignRaw = asset.alignment || asset.align || style.align || '';
    var hAlign = 'left';
    var vAlign = 'top';
    if (typeof alignRaw === 'object' && alignRaw !== null) {
      if (alignRaw.horizontal) hAlign = String(alignRaw.horizontal).toLowerCase();
      if (alignRaw.vertical) vAlign = String(alignRaw.vertical).toLowerCase();
    } else {
      hAlign = String(alignRaw).toLowerCase();
    }
    return { h: hAlign, v: vAlign };
  }

  function setTextAnchorH(pixiText, hAlign) {
    if (hAlign === 'center' || hAlign === 'middle') {
      if (pixiText.anchor && typeof pixiText.anchor.set === 'function') pixiText.anchor.set(0.5, pixiText.anchor.y || 0);
      else if (pixiText.anchor) pixiText.anchor.x = 0.5;
    } else if (hAlign === 'right') {
      if (pixiText.anchor && typeof pixiText.anchor.set === 'function') pixiText.anchor.set(1, pixiText.anchor.y || 0);
      else if (pixiText.anchor) pixiText.anchor.x = 1;
    }
  }

  function createTitle(clipMeta, asset, merge, canvasW, canvasH) {
    var rawText = applyMerge(asset.text || '', merge);
    var style = asset.style || {};
    var text = applyTextTransform(rawText, style.textTransform || asset.textTransform);
    var built = buildTextStyleOpts(asset);
    var styleOpts = built.opts;
    var fontSize = built.fontSize;
    var wrapW = resolveWrapWidth(clipMeta, asset, canvasW);
    if (wrapW > 0 && asset.wrap !== false) {
      var preWrap = global.__CFS_wrapTextToWidth;
      if (typeof preWrap === 'function') {
        text = preWrap(text, styleOpts.fontFamily, fontSize, styleOpts.fontWeight, wrapW);
      }
      styleOpts.wordWrap = true;
      styleOpts.wordWrapWidth = wrapW;
    }
    var pixiText = createPixiText(text, styleOpts);
    pixiText._cfsRawText = rawText;
    pixiText._cfsTextTransform = style.textTransform || asset.textTransform || '';
    var alignment = resolveAlignment(asset);
    if (alignment.h && alignment.h !== 'left') {
      var ts = pixiText.style || pixiText;
      ts.align = alignment.h === 'middle' ? 'center' : alignment.h;
    }
    var gradient = style.gradient;
    if (gradient && gradient.stops && Array.isArray(gradient.stops) && gradient.stops.length >= 2) {
      try {
        var gCanvas = document.createElement('canvas');
        gCanvas.width = wrapW > 0 ? wrapW : 512;
        gCanvas.height = Math.ceil(fontSize * 2);
        var gCtx = gCanvas.getContext('2d');
        var angle = (gradient.angle != null ? Number(gradient.angle) : 0) * Math.PI / 180;
        var cx = gCanvas.width / 2;
        var cy = gCanvas.height / 2;
        var len = Math.max(gCanvas.width, gCanvas.height);
        var dx = Math.cos(angle) * len / 2;
        var dy = Math.sin(angle) * len / 2;
        var lg = gCtx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        gradient.stops.forEach(function (s) {
          var offset = s.offset != null ? Number(s.offset) : (s.position != null ? Number(s.position) / 100 : 0);
          lg.addColorStop(Math.max(0, Math.min(1, offset)), s.color || '#ffffff');
        });
        gCtx.fillStyle = lg;
        gCtx.fillRect(0, 0, gCanvas.width, gCanvas.height);
        var gradTex = PIXI.Texture.from ? PIXI.Texture.from(gCanvas) : null;
        if (gradTex && pixiText.style) pixiText.style.fill = gradTex;
      } catch (e) { console.warn('[CFS] Gradient fill failed', e); }
    }
    var animation = asset.animation || style.animation;
    if (animation && animation.preset) {
      pixiText._cfsAnimation = animation;
    }
    var bgColorVal = asset.background || style.background;
    var bgColor = typeof bgColorVal === 'object' && bgColorVal !== null ? bgColorVal.color : bgColorVal;
    if (bgColor) {
      var container = new PIXI.Container();
      var g = new PIXI.Graphics();
      var pad = 4;
      var _bgClip = clipMeta.clip || {};
      var assetW = asset.width != null ? Number(asset.width) : (_bgClip.width != null ? Number(_bgClip.width) : 0);
      var assetH = asset.height != null ? Number(asset.height) : (_bgClip.height != null ? Number(_bgClip.height) : 0);
      var tw = assetW > 0 ? assetW : (wrapW > 0 ? wrapW : (pixiText.width || 200));
      var th = assetH > 0 ? assetH : ((pixiText.height || fontSize * 1.2) + pad * 2);
      g.rect(0, 0, tw, th);
      if (typeof g.fill === 'function') {
        var _bgFill = parseColor(bgColor);
        if (g.fill.length > 0) g.fill(_bgFill); else g.fill({ color: _bgFill });
      }
      g.x = clipMeta.x || 0;
      g.y = clipMeta.y || 0;
      container.addChild(g);
      if (assetH > 0 && (alignment.v === 'center' || alignment.v === 'middle')) {
        pixiText.y = (clipMeta.y || 0) + (assetH - (pixiText.height || fontSize)) / 2;
      } else if (assetH > 0 && alignment.v === 'bottom') {
        pixiText.y = (clipMeta.y || 0) + assetH - (pixiText.height || fontSize) - pad;
      } else {
        pixiText.y = (clipMeta.y || 0) + pad;
      }
      if (alignment.h === 'center' || alignment.h === 'middle') {
        pixiText.x = (clipMeta.x || 0) + tw / 2;
        if (pixiText.anchor) pixiText.anchor.x = 0.5;
      } else if (alignment.h === 'right') {
        pixiText.x = (clipMeta.x || 0) + tw - pad;
        if (pixiText.anchor) pixiText.anchor.x = 1;
      } else {
        pixiText.x = (clipMeta.x || 0) + pad;
      }
      container.addChild(pixiText);
      container._cfsTextChild = pixiText;
      if (container.eventMode !== undefined) container.eventMode = 'none';
      return container;
    }
    var _noClip = clipMeta.clip || {};
    var _noBgElemW = asset.width != null ? Number(asset.width) : (_noClip.width != null ? Number(_noClip.width) : 0);
    if ((alignment.h === 'center' || alignment.h === 'middle') && _noBgElemW > 0) {
      pixiText.x = (clipMeta.x || 0) + _noBgElemW / 2;
      if (pixiText.anchor) pixiText.anchor.x = 0.5;
    } else {
      pixiText.x = clipMeta.x || 0;
    }
    var clip = clipMeta.clip || {};
    var elemH = asset.height != null ? Number(asset.height) : (clip.height != null ? Number(clip.height) : 0);
    if (elemH > 0 && (alignment.v === 'center' || alignment.v === 'middle')) {
      pixiText.y = (clipMeta.y || 0) + (elemH - (pixiText.height || fontSize)) / 2;
    } else if (elemH > 0 && alignment.v === 'bottom') {
      pixiText.y = (clipMeta.y || 0) + elemH - (pixiText.height || fontSize);
    } else {
      pixiText.y = clipMeta.y || 0;
    }
    if (pixiText.eventMode !== undefined) pixiText.eventMode = 'none';
    return pixiText;
  }

  function setSpriteFitScale(sprite, clipMeta, targetW, targetH, sourceW, sourceH) {
    var clip = clipMeta.clip || {};
    var applied = applyFitAndScale(clip, targetW, targetH, sourceW, sourceH);
    sprite.width = applied.width;
    sprite.height = applied.height;
    sprite.x = (clipMeta.x || 0) + applied.x;
    sprite.y = (clipMeta.y || 0) + applied.y;
    sprite._cfsBaseX = sprite.x;
    sprite._cfsBaseY = sprite.y;
    sprite._cfsBaseScaleX = sprite.scale.x;
    sprite._cfsBaseScaleY = sprite.scale.y;
  }

  function createImage(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH) {
    var clip = clipMeta.clip || {};
    var src = applyMerge(asset.src || '', merge);
    if (blobUrlMap && blobUrlMap[src]) src = blobUrlMap[src];
    if (!src || src.indexOf('{{') !== -1) {
      var place = new PIXI.Graphics();
      place.rect(0, 0, clip.width || asset.width || canvasW || 400, clip.height || asset.height || canvasH || 300);
      if (typeof place.fill === 'function') place.fill(0xe0e0e0);
      place.x = clipMeta.x || 0;
      place.y = clipMeta.y || 0;
      return place;
    }
    var w = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : (canvasW || 400));
    var h = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : (canvasH || 300));

    function loadViaImage(imgSrc) {
      return new Promise(function (resolve) {
        function tryLoad(useCors) {
          var img = new Image();
          if (useCors) img.crossOrigin = 'anonymous';
          img.onload = function () {
            try {
              var tex = PIXI.Texture.from(img);
              var sprite = new PIXI.Sprite(tex);
              var srcW = img.naturalWidth || w;
              var srcH = img.naturalHeight || h;
              setSpriteFitScale(sprite, clipMeta, w, h, srcW, srcH);
              resolve(sprite);
            } catch (e) {
              console.warn('[CFS] Texture.from failed for', imgSrc, e);
              if (useCors) { tryLoad(false); return; }
              resolve(makePlaceholder());
            }
          };
          img.onerror = function () {
            if (useCors) {
              tryLoad(false);
            } else {
              console.warn('[CFS] Image load failed:', imgSrc);
              resolve(makePlaceholder());
            }
          };
          img.src = imgSrc;
        }
        tryLoad(true);
      });
    }

    function makePlaceholder() {
      var g = new PIXI.Graphics();
      g.rect(0, 0, w, h);
      if (typeof g.fill === 'function') g.fill(0xe0e0e0);
      g.x = clipMeta.x || 0;
      g.y = clipMeta.y || 0;
      return g;
    }

    try {
      return loadViaImage(src);
    } catch (e) {
      return makePlaceholder();
    }
  }

  /**
   * Build a chroma key filter for video (ShotStack asset.chromaKey: { color, threshold, halo }).
   * Returns a PIXI Filter or null if unsupported. Normalizes threshold/halo from 0–255 to 0–1.
   */
  function createChromaKeyFilter(chromaKey) {
    if (!chromaKey || !chromaKey.color || typeof PIXI.Filter === 'undefined') return null;
    var hex = (chromaKey.color || '').toString().replace(/^#/, '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    if (isNaN(n)) return null;
    var r = ((n >> 16) & 255) / 255;
    var g = ((n >> 8) & 255) / 255;
    var b = (n & 255) / 255;
    var threshold = (chromaKey.threshold != null ? Number(chromaKey.threshold) : 150) / 255;
    var halo = (chromaKey.halo != null ? Number(chromaKey.halo) : 100) / 255;
    var fragmentSrc = [
      'precision mediump float;',
      'varying vec2 vTextureCoord;',
      'uniform sampler2D uSampler;',
      'uniform vec3 keyColor;',
      'uniform float threshold;',
      'uniform float halo;',
      'void main(void) {',
      '  vec4 c = texture2D(uSampler, vTextureCoord);',
      '  float d = distance(c.rgb, keyColor);',
      '  float a = 1.0;',
      '  if (d < threshold) a = 0.0;',
      '  else if (halo > 0.0 && d < threshold + halo) a = (d - threshold) / halo;',
      '  gl_FragColor = vec4(c.rgb, c.a * a);',
      '}'
    ].join('\n');
    try {
      var filter = new PIXI.Filter(undefined, fragmentSrc, {
        keyColor: [r, g, b],
        threshold: threshold,
        halo: halo
      });
      return filter;
    } catch (e) {
      return null;
    }
  }

  /**
   * Filter that sets fragment alpha to luminance of the texture (0.299*R + 0.587*G + 0.114*B).
   * Used so a sprite can act as a luma mask: bright areas reveal, dark areas conceal.
   */
  function createLuminanceToAlphaFilter() {
    if (typeof PIXI.Filter === 'undefined') return null;
    var fragmentSrc = [
      'precision mediump float;',
      'varying vec2 vTextureCoord;',
      'uniform sampler2D uSampler;',
      'void main(void) {',
      '  vec4 c = texture2D(uSampler, vTextureCoord);',
      '  float lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;',
      '  gl_FragColor = vec4(1.0, 1.0, 1.0, lum);',
      '}'
    ].join('\n');
    try {
      return new PIXI.Filter(undefined, fragmentSrc, {});
    } catch (e) {
      return null;
    }
  }

  /**
   * Luma clip: create a sprite from the luma mask video with luminance-as-alpha so it can mask the content below.
   * Returns Promise<PIXI.Sprite> with _videoEl and _videoDuration for seek(). Same positioning/sizing as createVideo.
   */
  function createLumaMaskSprite(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH) {
    var src = applyMerge(asset.src || '', merge);
    if (blobUrlMap && blobUrlMap[src]) src = blobUrlMap[src];
    if (!src || src.indexOf('{{') !== -1) {
      return Promise.resolve(null);
    }
    var w = asset.width != null ? Number(asset.width) : (canvasW || 400);
    var h = asset.height != null ? Number(asset.height) : (canvasH || 300);
    var video = document.createElement('video');
    video.src = src;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.crossOrigin = video.crossOrigin || 'anonymous';
    var tex = null;
    try {
      tex = PIXI.Texture.from && PIXI.Texture.from(video);
    } catch (e) { console.warn('[CFS] Texture.from failed for luma video', e); }
    if (!tex) return Promise.resolve(null);
    var sprite = new PIXI.Sprite(tex);
    if (sprite.eventMode !== undefined) sprite.eventMode = 'none';
    var lumFilter = createLuminanceToAlphaFilter();
    if (lumFilter) {
      /* Pixi v8: sprite.filters getter returns a frozen array — must create new one */
      var existing = sprite.filters ? Array.from(sprite.filters) : [];
      existing.push(lumFilter);
      sprite.filters = existing;
    }
    var clip = clipMeta.clip || {};
    var applied = applyFitAndScale(clip, w, h, w, h);
    sprite.width = applied.width;
    sprite.height = applied.height;
    sprite.x = (clipMeta.x || 0) + applied.x;
    sprite.y = (clipMeta.y || 0) + applied.y;
    return new Promise(function (resolve) {
      function done() {
        sprite._videoEl = video;
        sprite._videoDuration = typeof video.duration === 'number' && video.duration > 0 ? video.duration : (clipMeta.length || 5);
        var vw = video.videoWidth || w;
        var vh = video.videoHeight || h;
        var appliedFit = applyFitAndScale(clip, w, h, vw, vh);
        sprite.width = appliedFit.width;
        sprite.height = appliedFit.height;
        sprite.x = (clipMeta.x || 0) + appliedFit.x;
        sprite.y = (clipMeta.y || 0) + appliedFit.y;
        resolve(sprite);
      }
      video.addEventListener('loadedmetadata', done, { once: true });
      video.addEventListener('error', function () { resolve(sprite); }, { once: true });
      video.load();
    });
  }

  /** Video assets: HTML video element, texture from video, seek on timeline seek. Applies chroma key when asset.chromaKey is set. */
  function createVideo(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH) {
    var clip = clipMeta.clip || {};
    var src = applyMerge(asset.src || '', merge);
    if (blobUrlMap && blobUrlMap[src]) src = blobUrlMap[src];
    if (!src || src.indexOf('{{') !== -1) {
      var place = new PIXI.Graphics();
      place.rect(0, 0, clip.width || asset.width || canvasW || 400, clip.height || asset.height || canvasH || 300);
      if (typeof place.fill === 'function') place.fill(0x808080);
      place.x = clipMeta.x || 0;
      place.y = clipMeta.y || 0;
      return place;
    }
    var w = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : (canvasW || 400));
    var h = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : (canvasH || 300));
    var video = document.createElement('video');
    video.src = src;
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.crossOrigin = video.crossOrigin || 'anonymous';
    var promise = new Promise(function (resolve) {
      function makePlaceholder() {
        var g = new PIXI.Graphics();
        g.rect(0, 0, w, h);
        if (typeof g.fill === 'function') g.fill(0x808080);
        g.x = clipMeta.x || 0;
        g.y = clipMeta.y || 0;
        g._cfsBaseX = g.x;
        g._cfsBaseY = g.y;
        return g;
      }
      video.addEventListener('loadedmetadata', function () {
        var vw = video.videoWidth || w;
        var vh = video.videoHeight || h;
        var tex = null;
        try {
          /* WebM VP9 videos may have alpha channels — they need premultiplied alpha
             for correct compositing. Other video formats keep no-premultiply. */
          var isWebm = (src || '').toLowerCase().indexOf('.webm') !== -1 ||
                       ((asset._originalFormat || '').toLowerCase() === 'webm');
          var vidAlphaMode = isWebm ? 'premultiply-alpha-on-upload' : 'no-premultiply-alpha';
          if (typeof PIXI.VideoSource === 'function') {
            var vidSource = new PIXI.VideoSource({
              resource: video,
              width: vw,
              height: vh,
              autoPlay: false,
              autoLoad: false,
              alphaMode: vidAlphaMode
            });
            tex = new PIXI.Texture({ source: vidSource });
          } else {
            tex = PIXI.Texture.from && PIXI.Texture.from(video);
            if (tex && tex.source) {
              tex.source.alphaMode = vidAlphaMode;
            }
          }
          if (tex && tex.frame && (tex.frame.width !== vw || tex.frame.height !== vh)) {
            tex.frame.width = vw;
            tex.frame.height = vh;
          }
          if (tex && tex.orig && (tex.orig.width !== vw || tex.orig.height !== vh)) {
            tex.orig.width = vw;
            tex.orig.height = vh;
          }
          if (tex && typeof tex.updateUvs === 'function') tex.updateUvs();
        } catch (e) { console.warn('[CFS] Video texture creation failed', e); }
        if (!tex) { resolve(makePlaceholder()); return; }
        var sprite = new PIXI.Sprite(tex);
        if (sprite.eventMode !== undefined) sprite.eventMode = 'none';
        if (asset.chromaKey && typeof PIXI.Filter !== 'undefined') {
          var ckFilter = createChromaKeyFilter(asset.chromaKey);
          if (ckFilter) { sprite.filters = [ckFilter]; }
        }
        sprite._videoEl = video;
        sprite._videoDuration = typeof video.duration === 'number' && video.duration > 0 ? video.duration : (clipMeta.length || 5);
        setSpriteFitScale(sprite, clipMeta, w, h, vw, vh);
        if (asset.crop) {
          var cropTop = Number(asset.crop.top) || 0;
          var cropBottom = Number(asset.crop.bottom) || 0;
          var cropLeft = Number(asset.crop.left) || 0;
          var cropRight = Number(asset.crop.right) || 0;
          if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) {
            var c = { top: cropTop, bottom: cropBottom, left: cropLeft, right: cropRight };
            sprite._cfsCrop = c;
            var maskG = new PIXI.Graphics();
            var mx = sprite.x + c.left;
            var my = sprite.y + c.top;
            var mw = Math.max(1, sprite.width - c.left - c.right);
            var mh = Math.max(1, sprite.height - c.top - c.bottom);
            maskG.rect(mx, my, mw, mh);
            if (typeof maskG.fill === 'function') maskG.fill(0xffffff);
            sprite.mask = maskG;
          }
        }
        /* WebM VP9 alpha: Chrome's <video> element decodes VP9 alpha correctly,
           but WebGL's texImage2D may lose the alpha channel.  We route WebM video
           frames through a 2D canvas intermediary that preserves alpha, and use
           that canvas as the Pixi texture source instead of the video element. */
        var isWebm = (src || '').toLowerCase().indexOf('.webm') !== -1 ||
                     ((asset._originalFormat || '').toLowerCase() === 'webm');
        /* Route ALL video through canvas intermediary to avoid glCopySubTextureCHROMIUM errors */
        if (true) {
          var alphaCanvas = document.createElement('canvas');
          alphaCanvas.width = vw;
          alphaCanvas.height = vh;
          sprite._cfsAlphaCanvas = alphaCanvas;
          sprite._cfsAlphaCtx = alphaCanvas.getContext('2d');
          /* Draw initial frame to canvas (preserves VP9 alpha) */
          try { sprite._cfsAlphaCtx.drawImage(video, 0, 0, vw, vh); } catch(_){}
          /* Replace the sprite's texture source with the canvas */
          try {
            var canvasTex = PIXI.Texture.from(alphaCanvas, { alphaMode: vidAlphaMode });
            sprite.texture = canvasTex;
          } catch(_){}
        }
        resolve(sprite);
      }, { once: true });
      video.addEventListener('error', function () {
        console.warn('[CFS] Video load failed:', src);
        resolve(makePlaceholder());
      }, { once: true });
      video.load();
    });
    return promise;
  }

  /** SVG assets: render via Sprite from src (data URL or URL); browser rasterizes SVG. */
  function createSvg(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH) {
    var src = applyMerge(asset.src || '', merge);
    if (blobUrlMap && blobUrlMap[src]) src = blobUrlMap[src];
    if (!src || src.indexOf('{{') !== -1) {
      var place = new PIXI.Graphics();
      place.rect(0, 0, asset.width || canvasW || 400, asset.height || canvasH || 300);
      if (typeof place.fill === 'function') place.fill(0xe8e8e8);
      place.x = clipMeta.x || 0;
      place.y = clipMeta.y || 0;
      return place;
    }
    var w = asset.width != null ? Number(asset.width) : (canvasW || 400);
    var h = asset.height != null ? Number(asset.height) : (canvasH || 300);
    if (typeof src === 'string' && src.trim().startsWith('<') && !src.startsWith('data:') && !src.startsWith('http')) {
      src = 'data:image/svg+xml;base64,' + (typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(src))) : '');
    }
    try {
      var sprite = PIXI.Sprite.from(src);
      if (sprite && sprite.then) {
        return sprite.then(function (s) {
          var tex = s.texture || {};
          var srcW = (tex.width != null ? tex.width : (tex.source && tex.source.width)) || w;
          var srcH = (tex.height != null ? tex.height : (tex.source && tex.source.height)) || h;
          setSpriteFitScale(s, clipMeta, w, h, srcW, srcH);
          return s;
        });
      }
      var tex = sprite.texture || {};
      var srcW = (tex.width != null ? tex.width : (tex.source && tex.source.width)) || w;
      var srcH = (tex.height != null ? tex.height : (tex.source && tex.source.height)) || h;
      setSpriteFitScale(sprite, clipMeta, w, h, srcW, srcH);
      return sprite;
    } catch (e) {
      var g = new PIXI.Graphics();
      g.rect(0, 0, w, h);
      if (typeof g.fill === 'function') g.fill(0xe8e8e8);
      g.x = clipMeta.x || 0;
      g.y = clipMeta.y || 0;
      return g;
    }
  }

  /** Caption clips: render using offscreen canvas for per-word styled rendering with animation support. */
  function createCaption(clipMeta, asset, merge, canvasW, mainCanvasH) {
    function parseWordTime(raw) {
      if (raw == null || raw === '') return null;
      var n = Number(raw);
      if (!isFinite(n)) return null;
      if (n > 1000) return n / 1000;
      return n;
    }
    function parseCaptionWords(words) {
      if (!Array.isArray(words)) return [];
      var out = [];
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!w) continue;
        var text = w.text != null ? String(w.text) : '';
        if (!text) continue;
        var start = parseWordTime(w.start);
        if (start == null) start = parseWordTime(w.from);
        if (start == null) start = parseWordTime(w.time);
        var end = parseWordTime(w.end);
        if (end == null) end = parseWordTime(w.to);
        if (end == null && start != null) end = start + 0.35;
        out.push({ text: text, start: start, end: end });
      }
      for (var j = 0; j < out.length; j++) {
        if (out[j].start == null) out[j].start = j > 0 ? (out[j - 1].end != null ? out[j - 1].end : out[j - 1].start + 0.35) : 0;
        if (out[j].end == null || out[j].end < out[j].start) out[j].end = out[j].start + 0.35;
      }
      return out;
    }

    var parsedWords = parseCaptionWords(asset.words);
    var rawText = asset.text || '';
    if (!rawText && parsedWords.length) {
      rawText = parsedWords.map(function (w) { return w && w.text != null ? w.text : ''; }).join(' ');
    }
    if (!rawText && asset.src) rawText = String(asset.src);
    rawText = applyMerge(String(rawText || ''), merge);
    if (!rawText.trim()) return null;

    /* ── Parse styling from asset ── */
    var font = asset.font || {};
    var fontSize = Number(font.size) || 32;
    var fontFamily = font.family || 'Open Sans, Arial, sans-serif';
    var fontWeight = font.weight || 'bold';
    var baseFillStr = font.color || '#ffffff';
    var activeStyle = asset.active || {};
    var activeFont = activeStyle.font || {};
    var activeFillStr = activeFont.color || '#efbf04';
    var animStyle = (asset.animation && asset.animation.style) || 'karaoke';
    var animDir = (asset.animation && asset.animation.direction) || 'up';

    /* Background */
    var bgObj = asset.background || {};
    var bgColor = typeof bgObj === 'string' ? bgObj : (bgObj.color || null);
    var bgOpacity = typeof bgObj === 'object' ? (bgObj.opacity != null ? Number(bgObj.opacity) : 1) : 1;
    if (bgColor && bgOpacity <= 0) {
      bgColor = null; /* Fully transparent — skip background drawing */
    } else if (bgColor && bgOpacity < 1) {
      /* Convert hex to rgba */
      var _br = parseInt(bgColor.slice(1, 3), 16) || 0;
      var _bg = parseInt(bgColor.slice(3, 5), 16) || 0;
      var _bb = parseInt(bgColor.slice(5, 7), 16) || 0;
      bgColor = 'rgba(' + _br + ',' + _bg + ',' + _bb + ',' + bgOpacity.toFixed(2) + ')';
    }
    var bgPad = typeof bgObj === 'object' ? (Number(bgObj.padding) || 8) : 8;
    var bgRadius = typeof bgObj === 'object' ? (Number(bgObj.borderRadius) || 4) : 4;

    /* Wrap width */
    var wrapW = canvasW ? canvasW - 40 : 900;
    if (asset.width) wrapW = Number(asset.width);
    if (clipMeta.clip && clipMeta.clip.width) wrapW = Number(clipMeta.clip.width);

    /* ── If no words, fall back to static text ── */
    if (!parsedWords.length) {
      var built = buildTextStyleOpts(asset);
      var styleOpts = built.opts;
      if (!styleOpts.fill && styleOpts.fill !== 0) styleOpts.fill = 0xffffff;
      if (!styleOpts.fontSize) styleOpts.fontSize = fontSize;
      if (wrapW > 0) { styleOpts.wordWrap = true; styleOpts.wordWrapWidth = wrapW; }
      var pixiText = createPixiText(rawText, styleOpts);
      pixiText.x = clipMeta.x || 0;
      pixiText.y = clipMeta.y || 0;
      if (pixiText.eventMode !== undefined) pixiText.eventMode = 'none';
      return pixiText;
    }

    /* ── Create offscreen canvas for per-word rendering ── */
    var offCanvas = document.createElement('canvas');
    var canvasH = Math.ceil(fontSize * 2.4 + bgPad * 2);
    offCanvas.width = wrapW + bgPad * 2;
    offCanvas.height = canvasH;
    var ctx = offCanvas.getContext('2d');

    /* Helper: measure text with current font */
    function setFont(size, weight) {
      ctx.font = (weight || fontWeight) + ' ' + Math.round(size) + 'px ' + fontFamily;
    }

    /* ── Display settings ── */
    var displayObj = asset.display || {};
    var WORDS_PER_LINE = displayObj.wordsPerLine || 4;
    var NUM_LINES = displayObj.lines || 2;
    var CHUNK_SIZE = WORDS_PER_LINE * NUM_LINES;

    /* Helper: compute word window (SRT-style fixed chunks) */
    function getWordWindow(activeIdx, relTimeSec) {
      var numChunks = Math.ceil(parsedWords.length / CHUNK_SIZE);
      /* Always determine chunk by TIME to prevent boundary flicker */
      var activeChunk = 0;
      for (var ci = numChunks - 1; ci >= 0; ci--) {
        var firstWord = parsedWords[ci * CHUNK_SIZE];
        if (firstWord && relTimeSec >= firstWord.start) { activeChunk = ci; break; }
      }
      /* If we're past the last word's end in this chunk but before the next
         chunk's first word starts, stay on the current chunk to prevent flicker */
      var windowStart = activeChunk * CHUNK_SIZE;
      var windowEnd = Math.min(windowStart + CHUNK_SIZE - 1, parsedWords.length - 1);
      var lastWordEnd = parsedWords[windowEnd].end || 0;
      if (relTimeSec >= lastWordEnd && activeChunk < numChunks - 1) {
        var nextChunkStart = parsedWords[(activeChunk + 1) * CHUNK_SIZE];
        if (nextChunkStart && relTimeSec < nextChunkStart.start) {
          /* In the gap — stay on current chunk */
        } else if (nextChunkStart && relTimeSec >= nextChunkStart.start) {
          /* Move to next chunk */
          windowStart = (activeChunk + 1) * CHUNK_SIZE;
          windowEnd = Math.min(windowStart + CHUNK_SIZE - 1, parsedWords.length - 1);
        }
      }
      return { start: windowStart, end: windowEnd };
    }

    /* Helper: draw rounded rect */
    function roundRect(cx, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      cx.beginPath();
      cx.moveTo(x + r, y);
      cx.lineTo(x + w - r, y);
      cx.quadraticCurveTo(x + w, y, x + w, y + r);
      cx.lineTo(x + w, y + h - r);
      cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      cx.lineTo(x + r, y + h);
      cx.quadraticCurveTo(x, y + h, x, y + h - r);
      cx.lineTo(x, y + r);
      cx.quadraticCurveTo(x, y, x + r, y);
      cx.closePath();
    }

    /* ── Main render function called each frame ── */
    var lineHeight = Math.ceil(fontSize * 1.4);
    offCanvas.height = Math.ceil(lineHeight * NUM_LINES + bgPad * 2 + fontSize * 0.5);
    var canvasH = offCanvas.height;
    ctx = offCanvas.getContext('2d');

    function renderFrame(relTimeSec) {
      var cw = offCanvas.width, ch = offCanvas.height;
      ctx.clearRect(0, 0, cw, ch);

      /* Find active word */
      var activeIdx = -1;
      for (var i = 0; i < parsedWords.length; i++) {
        if (relTimeSec >= parsedWords[i].start && relTimeSec < parsedWords[i].end) { activeIdx = i; break; }
      }
      if (activeIdx < 0) {
        for (var i2 = parsedWords.length - 1; i2 >= 0; i2--) {
          if (relTimeSec >= parsedWords[i2].end) { activeIdx = i2; break; }
        }
      }

      /* Word window (SRT chunks) */
      var win = getWordWindow(activeIdx, relTimeSec);

      /* Measure each word width */
      setFont(fontSize, fontWeight);
      var spaceW = ctx.measureText(' ').width;

      /* Layout words into lines based on WORDS_PER_LINE */
      var lines = [];
      var currentLine = [];
      for (var w = win.start; w <= win.end; w++) {
        currentLine.push({ wordIdx: w, width: ctx.measureText(parsedWords[w].text).width });
        if (currentLine.length >= WORDS_PER_LINE || w === win.end) {
          lines.push(currentLine);
          currentLine = [];
        }
      }

      /* Background — measure total block size */
      var maxLineW = 0;
      for (var li = 0; li < lines.length; li++) {
        var lw = 0;
        for (var lj = 0; lj < lines[li].length; lj++) {
          lw += lines[li][lj].width;
          if (lj < lines[li].length - 1) lw += spaceW;
        }
        lines[li]._totalW = lw;
        if (lw > maxLineW) maxLineW = lw;
      }
      var textBlockW = Math.min(maxLineW, cw - bgPad * 2);
      var textBlockH = lines.length * lineHeight;

      /* Center the background block horizontally */
      var bgX = Math.max(0, (cw - textBlockW - bgPad * 2) / 2);
      if (bgColor) {
        ctx.fillStyle = bgColor;
        roundRect(ctx, bgX, 0, textBlockW + bgPad * 2, textBlockH + bgPad * 2, bgRadius);
        ctx.fill();
      }

      /* ── Draw words with animation-specific styling ── */
      for (var lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        var lineWords = lines[lineIdx];
        var lineW = lineWords._totalW || 0;
        /* Center each line horizontally within the canvas */
        var curX = Math.max(bgPad, (cw - lineW) / 2);
        var textY = bgPad + fontSize + lineIdx * lineHeight;

        for (var wi = 0; wi < lineWords.length; wi++) {
          var wordIdx = lineWords[wi].wordIdx;
          var wWidth = lineWords[wi].width;
          var isActive = wordIdx === activeIdx;
          var word = parsedWords[wordIdx];

          /* Defaults */
          var drawColor = baseFillStr;
          var drawSize = fontSize;
          var drawWeight = fontWeight;
          var drawAlpha = 1;
          var drawOffsetY = 0;

          switch (animStyle) {
            case 'karaoke':
              if (isActive) { drawColor = activeFillStr; }
              break;

            case 'highlight':
              if (isActive) {
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = activeFillStr;
                roundRect(ctx, curX - 3, textY - fontSize + 2, wWidth + 6, fontSize + 6, 3);
                ctx.fill();
                ctx.globalAlpha = 1;
                drawColor = bgColor || '#000000';
              }
              break;

            case 'pop':
              if (isActive) {
                var popProgress = 0;
                if (word.end > word.start) popProgress = Math.min(1, (relTimeSec - word.start) / ((word.end - word.start) * 0.3));
                var popScale = popProgress < 1 ? (1 + 0.3 * Math.sin(popProgress * Math.PI)) : 1;
                drawSize = fontSize * popScale;
                drawColor = activeFillStr;
                drawOffsetY = -(drawSize - fontSize) / 2;
              }
              break;

            case 'fade':
              if (wordIdx < activeIdx) {
                drawAlpha = 1;
              } else if (isActive) {
                var fadeIn = 0;
                if (word.end > word.start) fadeIn = Math.min(1, (relTimeSec - word.start) / ((word.end - word.start) * 0.5));
                drawAlpha = fadeIn;
                drawColor = activeFillStr;
              } else {
                drawAlpha = 0.15;
              }
              break;

            case 'slide':
              if (isActive) {
                var slideProgress = 0;
                if (word.end > word.start) slideProgress = Math.min(1, (relTimeSec - word.start) / ((word.end - word.start) * 0.3));
                var ease = 1 - Math.pow(1 - slideProgress, 3);
                var dist = fontSize * 0.8;
                if (animDir === 'up') drawOffsetY = (1 - ease) * dist;
                else if (animDir === 'down') drawOffsetY = -(1 - ease) * dist;
                else if (animDir === 'left') curX -= (1 - ease) * dist;
                else if (animDir === 'right') curX += (1 - ease) * dist;
                drawColor = activeFillStr;
                drawAlpha = ease;
              } else if (wordIdx > activeIdx) {
                drawAlpha = 0.3;
              }
              break;

            case 'bounce':
              if (isActive) {
                var bounceT = 0;
                if (word.end > word.start) bounceT = Math.min(1, (relTimeSec - word.start) / (word.end - word.start));
                var bounceH = fontSize * 0.4 * Math.abs(Math.sin(bounceT * Math.PI * 2.5)) * (1 - bounceT);
                drawOffsetY = -bounceH;
                drawColor = activeFillStr;
              }
              break;

            case 'typewriter':
              var totalChars = 0;
              for (var tc = win.start; tc <= win.end; tc++) {
                totalChars += parsedWords[tc].text.length;
                if (tc < win.end) totalChars += 1;
              }
              var firstWordStart = parsedWords[win.start].start;
              var lastWordEnd = parsedWords[win.end].end;
              var span = Math.max(0.1, lastWordEnd - firstWordStart);
              var charProgress = Math.min(1, Math.max(0, (relTimeSec - firstWordStart) / span));
              var visibleChars = Math.floor(charProgress * totalChars);
              var charsBefore = 0;
              for (var cb = win.start; cb < wordIdx; cb++) {
                charsBefore += parsedWords[cb].text.length + 1;
              }
              var charsInWord = parsedWords[wordIdx].text.length;
              if (charsBefore >= visibleChars) {
                drawAlpha = 0;
              } else if (charsBefore + charsInWord > visibleChars) {
                var visCount = visibleChars - charsBefore;
                var partialText = parsedWords[wordIdx].text.substring(0, visCount);
                setFont(drawSize, drawWeight);
                ctx.globalAlpha = 1;
                ctx.fillStyle = activeFillStr;
                ctx.fillText(partialText, curX, textY + drawOffsetY);
                curX += wWidth + spaceW;
                continue;
              } else {
                drawAlpha = 1;
              }
              break;

            case 'none':
            default:
              break;
          }

          /* Draw the word */
          setFont(drawSize, drawWeight);
          ctx.globalAlpha = drawAlpha;
          ctx.fillStyle = drawColor;
          ctx.fillText(parsedWords[wordIdx].text, curX, textY + drawOffsetY);
          ctx.globalAlpha = 1;
          curX += wWidth + spaceW;
        }
      }
    }

    /* Initial render */
    renderFrame(0);

    /* Create Pixi sprite from the canvas */
    var tex = PIXI.Texture.from(offCanvas, { scaleMode: 'linear' });
    var sprite = new PIXI.Sprite(tex);
    sprite.x = clipMeta.x || 0;
    sprite.y = clipMeta.y || 0;
    /* Clamp Y so caption doesn't extend below the main canvas edge */
    var mainH = mainCanvasH || 1080;
    if (sprite.y + offCanvas.height > mainH) {
      sprite.y = Math.max(0, mainH - offCanvas.height);
    }
    if (sprite.eventMode !== undefined) sprite.eventMode = 'none';

    /* Update function called by seek() */
    sprite._cfsUpdateTextAtTime = function (relTimeSec) {
      renderFrame(relTimeSec);
      /* Force texture update */
      if (tex.source && typeof tex.source.update === 'function') {
        tex.source.update();
      } else if (tex.update) {
        tex.update();
      } else if (typeof tex.updateUvs === 'function') {
        tex.updateUvs();
      }
      /* For PIXI v7/v8: mark base texture dirty */
      if (tex.baseTexture && tex.baseTexture.resource) {
        if (typeof tex.baseTexture.resource.update === 'function') tex.baseTexture.resource.update();
        tex.baseTexture.update();
      }
    };

    return sprite;
  }

  /** Luma clips: not rendered in Pixi; show a placeholder so the track is visible. Round-trip preserved in JSON. Used when luma mask cannot be applied (no src or no renderer). */
  function createLumaPlaceholder(clipMeta, asset) {
    var w = asset.width != null ? Number(asset.width) : 400;
    var h = asset.height != null ? Number(asset.height) : 300;
    var container = new PIXI.Container();
    var g = new PIXI.Graphics();
    g.rect(0, 0, w, h);
    if (typeof g.fill === 'function') g.fill(0x404040);
    g.x = clipMeta.x || 0;
    g.y = clipMeta.y || 0;
    container.addChild(g);
    var label = createPixiText('Luma', { fontFamily: 'Arial', fontSize: 14, fill: '#888888' });
    if (label) {
      label.anchor = label.anchor || {};
      label.anchor.x = 0.5;
      label.anchor.y = 0.5;
      label.x = (clipMeta.x || 0) + w / 2;
      label.y = (clipMeta.y || 0) + h / 2;
      container.addChild(label);
    }
    if (container.eventMode !== undefined) container.eventMode = 'none';
    return container;
  }

  /**
   * Apply luma mask: render current stage to a texture, then show that texture masked by the luma video (luminance = reveal).
   * Returns Promise<displayObject> (a sprite with cfsClipMeta and _lumaMaskSprite for seek).
   */
  function processLumaClip(player, stage, clip, trackIdx, canvasW, canvasH, merge, blobUrlMap, resolvedLength) {
    var asset = clip.asset || {};
    var clipStart = typeof clip.start === 'number' ? clip.start : 0;
    var clipLength = (resolvedLength != null && typeof resolvedLength === 'number') ? resolvedLength : (typeof clip.length === 'number' ? clip.length : 5);
    var elemW = asset.width != null ? Number(asset.width) : canvasW;
    var elemH = asset.height != null ? Number(asset.height) : canvasH;
    var left = asset.left != null ? Number(asset.left) : null;
    var top = asset.top != null ? Number(asset.top) : null;
    var x = left != null ? left : 0;
    var y = top != null ? top : 0;
    if (left == null || top == null) {
      var posResult = positionFromClip(canvasW, canvasH, clip, elemW, elemH);
      x = posResult.x;
      y = posResult.y;
    }
    var clipMeta = {
      clip: clip,
      trackIndex: trackIdx,
      start: clipStart,
      length: clipLength,
      x: x,
      y: y,
      transition: clip.transition && typeof clip.transition === 'object' ? clip.transition : {},
      effect: clip.effect != null ? clip.effect : ''
    };

    var renderer = player._app && player._app.renderer;
    if (!renderer) return Promise.resolve(createLumaPlaceholder(clipMeta, asset));

    var RT = PIXI && PIXI.RenderTexture;
    if (!RT) return Promise.resolve(createLumaPlaceholder(clipMeta, asset));

    var rt;
    try {
      if (typeof RT.create === 'function') rt = RT.create({ width: canvasW, height: canvasH });
      else if (typeof RT.from === 'function') rt = RT.from(canvasW, canvasH);
      else rt = new RT({ width: canvasW, height: canvasH });
    } catch (e) {
      return Promise.resolve(createLumaPlaceholder(clipMeta, asset));
    }
    if (!rt) return Promise.resolve(createLumaPlaceholder(clipMeta, asset));

    try {
      if (typeof renderer.render === 'function') {
        if (renderer.render.length >= 2) {
          renderer.render(stage, rt);
        } else {
          var renderOpts = { container: stage, target: rt, renderTexture: rt };
          renderer.render(renderOpts);
        }
      }
    } catch (e) {
      return Promise.resolve(createLumaPlaceholder(clipMeta, asset));
    }

    var contentSprite = new PIXI.Sprite(rt);
    contentSprite.x = 0;
    contentSprite.y = 0;
    contentSprite.width = canvasW;
    contentSprite.height = canvasH;
    if (contentSprite.eventMode !== undefined) contentSprite.eventMode = 'none';

    return createLumaMaskSprite(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH).then(function (lumaMaskSprite) {
      if (!lumaMaskSprite) {
        var place = createLumaPlaceholder(clipMeta, asset);
        place.cfsClipMeta = clipMeta;
        place.cfsVisible = true;
        stage.addChild(place);
        return place;
      }
      contentSprite.mask = lumaMaskSprite;
      contentSprite._lumaMaskSprite = lumaMaskSprite;
      contentSprite.cfsClipMeta = clipMeta;
      contentSprite.cfsVisible = true;
      stage.removeChildren();
      stage.addChild(player._background);
      stage.addChild(contentSprite);
      return contentSprite;
    });
  }

  function buildClipDisplayObject(clip, trackIndex, canvasW, canvasH, merge, blobUrlMap, resolvedLength) {
    var asset = clip.asset || {};
    var clipStart = typeof clip.start === 'number' ? clip.start : 0;
    var clipLength = (resolvedLength != null && typeof resolvedLength === 'number')
      ? resolvedLength
      : (typeof clip.length === 'number' ? clip.length : 5);
    var pos = clip.position || '';
    var left = asset.left != null ? Number(asset.left) : null;
    var top = asset.top != null ? Number(asset.top) : null;

    var isMedia = (asset.type === 'image' || asset.type === 'video' || asset.type === 'svg');
    var defaultW = isMedia ? canvasW : (asset.type === 'circle' ? (Number(asset.radius) || 20) * 2 : 400);
    var defaultH = isMedia ? canvasH : (asset.type === 'circle' ? (Number(asset.radius) || 20) * 2 : 300);
    var elemW = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : defaultW);
    var elemH = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : defaultH);
    if (asset.type === 'circle') {
      var r = asset.radius != null ? Number(asset.radius) : 20;
      elemW = elemH = r * 2;
    }
    if (asset.type === 'shape' && ((asset.shape || '').toLowerCase() === 'line')) {
      var lineInfo = asset.line || {};
      elemW = Number(asset.width) || Number(lineInfo.length) || 100;
      elemH = Number(asset.height) || Number(lineInfo.thickness) || 4;
    }
    if (asset.type === 'shape' && ((asset.shape || '').toLowerCase() === 'rectangle') && asset.rectangle) {
      elemW = Number(asset.rectangle.width) || Number(asset.width) || 400;
      elemH = Number(asset.rectangle.height) || Number(asset.height) || 300;
    }
    if (asset.type === 'shape' && ((asset.shape || '').toLowerCase() === 'circle') && asset.circle) {
      var scr = Number(asset.circle.radius) || 50;
      elemW = elemH = scr * 2;
    }
    if (asset.type === 'caption' || asset.type === 'rich-caption') {
      elemW = clip.width != null ? Number(clip.width) : canvasW;
      elemH = clip.height != null ? Number(clip.height) : 80;
    }

    var clipScale = (isMedia && typeof clip.scale === 'number' && clip.scale > 0) ? clip.scale : 1;
    var posElemW = elemW * clipScale;
    var posElemH = elemH * clipScale;

    var x = left != null ? left : 0;
    var y = top != null ? top : 0;
    if (left == null || top == null) {
      var posResult = positionFromClip(canvasW, canvasH, clip, posElemW, posElemH);
      x = posResult.x;
      y = posResult.y;
    }
    if (asset.padding != null && (asset.type === 'rich-text' || asset.type === 'text')) {
      var _pad = asset.padding;
      if (typeof _pad === 'number') { x = _pad; y = _pad; }
      else if (typeof _pad === 'object') {
        if (_pad.left != null) x = Number(_pad.left);
        if (_pad.top != null) y = Number(_pad.top);
      }
    }

    var clipMeta = {
      clip: clip,
      trackIndex: trackIndex,
      start: clipStart,
      length: clipLength,
      x: x,
      y: y,
      transition: clip.transition && typeof clip.transition === 'object' ? clip.transition : {},
      effect: clip.effect != null ? clip.effect : ''
    };

    var type = (asset.type || '').toLowerCase();
    if (type === 'text') type = 'title';
    if (type === 'rich-text') type = 'title';
    if (type === 'rich-caption') type = 'caption';

    var shapeKind = (asset.shape || '').toLowerCase();
    var obj = null;
    if (type === 'rect') obj = createRect(clipMeta, asset, canvasW, canvasH);
    else if (type === 'circle') obj = createCircle(clipMeta, asset);
    else if (type === 'shape' && shapeKind === 'line') obj = createShapeLine(clipMeta, asset, canvasW, canvasH);
    else if (type === 'shape' && shapeKind === 'rectangle') {
      var sr = asset.rectangle || {};
      var rectAsset = {
        width: sr.width || asset.width || 200, height: sr.height || asset.height || 100,
        fill: (asset.fill && typeof asset.fill === 'object' ? asset.fill.color : asset.fill) || '#eeeeee',
        rx: sr.cornerRadius || 0, ry: sr.cornerRadius || 0,
        left: asset.left, top: asset.top, right: asset.right, bottom: asset.bottom
      };
      var shapeStroke = asset.stroke && typeof asset.stroke === 'object' ? asset.stroke : {};
      if (shapeStroke.color) rectAsset.stroke = shapeStroke.color;
      if (shapeStroke.width) rectAsset.strokeWidth = Number(shapeStroke.width);
      obj = createRect(clipMeta, rectAsset, canvasW, canvasH);
      if (asset.fill && typeof asset.fill === 'object' && asset.fill.opacity != null) obj.alpha = Number(asset.fill.opacity);
    }
    else if (type === 'shape' && shapeKind === 'circle') {
      var sc = asset.circle || {};
      var circAsset = {
        radius: sc.radius || asset.radius || 50,
        fill: (asset.fill && typeof asset.fill === 'object' ? asset.fill.color : asset.fill) || '#cccccc',
        left: asset.left, top: asset.top
      };
      obj = createCircle(clipMeta, circAsset);
      if (asset.fill && typeof asset.fill === 'object' && asset.fill.opacity != null) obj.alpha = Number(asset.fill.opacity);
    }
    else if (type === 'title' && (asset.text != null)) obj = createTitle(clipMeta, asset, merge, canvasW, canvasH);
    else if (type === 'image' && asset.src) obj = createImage(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH);
    else if (type === 'video' && asset.src) obj = createVideo(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH);
    else if (type === 'svg' && asset.src) obj = createSvg(clipMeta, asset, merge, blobUrlMap, canvasW, canvasH);
    else if (type === 'caption') obj = createCaption(clipMeta, asset, merge, canvasW, canvasH);
    else if (type === 'luma') obj = createLumaPlaceholder(clipMeta, asset);
    else if (type === 'text-to-image') {
      var ttiAsset = { width: asset.width || canvasW, height: asset.height || canvasH, fill: '#2a2a3a' };
      obj = createRect(clipMeta, ttiAsset, canvasW, canvasH);
    }
    else if (type === 'html') {
      obj = createHtml(clipMeta, asset, merge, canvasW, canvasH);
    }

    if (obj) {
      obj.cfsClipMeta = clipMeta;
      obj.cfsVisible = true;
      if (obj._cfsBaseX == null && obj.x != null) obj._cfsBaseX = obj.x;
      if (obj._cfsBaseY == null && obj.y != null) obj._cfsBaseY = obj.y;
      var clipFilters = buildClipFilters(clip.filter);
      if (clipFilters.length) {
        if (typeof obj.then === 'function') {
          obj.then(function (resolved) { if (resolved) resolved.filters = (resolved.filters || []).concat(clipFilters); });
        } else {
          obj.filters = (obj.filters || []).concat(clipFilters);
        }
      }
    }
    return obj;
  }

  function getDisplayBounds(disp) {
    if (disp.width != null && disp.height != null) return { w: disp.width, h: disp.height };
    try {
      var b = disp.getBounds && disp.getBounds();
      if (b && b.width && b.height) return { w: b.width, h: b.height };
    } catch (e) { console.warn('[CFS] getBounds failed', e); }
    return { w: 200, h: 100 };
  }

  function applyTransitionToObject(disp, t) {
    var meta = disp.cfsClipMeta;
    if (!meta) return;
    var start = meta.start;
    var len = meta.length;
    var tr = meta.transition || {};
    var inName = (tr.in || '').toString();
    var outName = (tr.out || '').toString();
    if (!inName && !outName) return;
    var prog = transitionProgress(t, start, len, inName || 'fade', outName, TRANSITION_DURATION);
    var baseX = disp._cfsBaseX != null ? disp._cfsBaseX : (meta.x || 0);
    var baseY = disp._cfsBaseY != null ? disp._cfsBaseY : (meta.y || 0);
    var bsx = disp._cfsBaseScaleX || 1;
    var bsy = disp._cfsBaseScaleY || 1;
    var bounds = getDisplayBounds(disp);
    var slideDist = Math.max(bounds.w, bounds.h, 200);
    var centerX = baseX + bounds.w / 2;
    var centerY = baseY + bounds.h / 2;

    if (prog.inProgress < 1 && inName) {
      var inFadesAlpha = inName.indexOf('fade') !== -1 || inName.indexOf('reveal') !== -1 || inName.indexOf('zoom') !== -1;
      if (inFadesAlpha) disp.alpha = disp.alpha * prog.inProgress;
      if (inName.indexOf('slide') === 0 || inName.indexOf('wipe') === 0) {
        var dir = inName.indexOf('Left') !== -1 ? -1 : (inName.indexOf('Right') !== -1 ? 1 : (inName.indexOf('Up') !== -1 ? -1 : 1));
        var axis = (inName.indexOf('Left') !== -1 || inName.indexOf('Right') !== -1) ? 'x' : 'y';
        var offset = (1 - prog.inProgress) * slideDist * dir;
        if (axis === 'x') disp.x = baseX + offset; else disp.y = baseY + offset;
      } else if (inName.indexOf('zoom') !== -1) {
        var zs = prog.inProgress;
        disp.scale.set(zs * bsx, zs * bsy);
        disp.x = centerX - (bounds.w * zs) / 2;
        disp.y = centerY - (bounds.h * zs) / 2;
      } else if (inName.indexOf('reveal') !== -1) {
        var rs = 0.9 + 0.1 * prog.inProgress;
        disp.scale.set(rs * bsx, rs * bsy);
        disp.x = centerX - (bounds.w * rs) / 2;
        disp.y = centerY - (bounds.h * rs) / 2;
      } else if (inName.indexOf('carousel') !== -1) {
        var carDir = inName.indexOf('Left') !== -1 ? 1 : (inName.indexOf('Right') !== -1 ? -1 : (inName.indexOf('Up') !== -1 ? 1 : -1));
        var carAxis = (inName.indexOf('Left') !== -1 || inName.indexOf('Right') !== -1) ? 'x' : 'y';
        var carOff = (1 - prog.inProgress) * slideDist * 0.5 * carDir;
        if (carAxis === 'x') disp.x = baseX + carOff; else disp.y = baseY + carOff;
      }
    }
    if (prog.outProgress > 0 && outName) {
      var outFadesAlpha = outName.indexOf('fade') !== -1 || outName.indexOf('reveal') !== -1 || outName.indexOf('zoom') !== -1;
      if (outFadesAlpha) disp.alpha = disp.alpha * (1 - prog.outProgress);
      if (outName.indexOf('slide') === 0 || outName.indexOf('wipe') === 0) {
        var dirOut = outName.indexOf('Left') !== -1 ? -1 : (outName.indexOf('Right') !== -1 ? 1 : (outName.indexOf('Up') !== -1 ? -1 : 1));
        var axisOut = (outName.indexOf('Left') !== -1 || outName.indexOf('Right') !== -1) ? 'x' : 'y';
        var offsetOut = prog.outProgress * slideDist * dirOut;
        if (axisOut === 'x') disp.x = baseX + offsetOut; else disp.y = baseY + offsetOut;
      } else if (outName.indexOf('zoom') !== -1) {
        var zso = 1 - prog.outProgress;
        disp.scale.set(zso * bsx, zso * bsy);
        disp.x = centerX - (bounds.w * zso) / 2;
        disp.y = centerY - (bounds.h * zso) / 2;
      } else if (outName.indexOf('reveal') !== -1) {
        var rso = 1 - prog.outProgress * 0.1;
        disp.scale.set(rso * bsx, rso * bsy);
        disp.x = centerX - (bounds.w * rso) / 2;
        disp.y = centerY - (bounds.h * rso) / 2;
      } else if (outName.indexOf('carousel') !== -1) {
        var carDirOut = outName.indexOf('Left') !== -1 ? -1 : (outName.indexOf('Right') !== -1 ? 1 : (outName.indexOf('Up') !== -1 ? -1 : 1));
        var carAxisOut = (outName.indexOf('Left') !== -1 || outName.indexOf('Right') !== -1) ? 'x' : 'y';
        var carOffOut = prog.outProgress * slideDist * 0.5 * carDirOut;
        if (carAxisOut === 'x') disp.x = baseX + carOffOut; else disp.y = baseY + carOffOut;
      }
    }
  }

  function applyEffectToObject(disp, t) {
    var meta = disp.cfsClipMeta;
    if (!meta || !meta.effect) return;
    var ep = effectProgress(t, meta.start, meta.length, meta.effect);
    if (!ep.active) return;
    var p = ep.progress;
    var effect = (meta.effect || '').toLowerCase();
    var bounds = getDisplayBounds(disp);
    var baseX = disp._cfsBaseX != null ? disp._cfsBaseX : (meta.x || 0);
    var baseY = disp._cfsBaseY != null ? disp._cfsBaseY : (meta.y || 0);
    var bsx = disp._cfsBaseScaleX || 1;
    var bsy = disp._cfsBaseScaleY || 1;
    var centerX = baseX + bounds.w / 2;
    var centerY = baseY + bounds.h / 2;
    if (effect.indexOf('zoomin') !== -1) {
      var zoomScale = effect.indexOf('slow') !== -1 ? (1 + p * 0.15) : (1 + p * 0.3);
      disp.scale.set(zoomScale * bsx, zoomScale * bsy);
      disp.x = centerX - (bounds.w * zoomScale) / 2;
      disp.y = centerY - (bounds.h * zoomScale) / 2;
    } else if (effect.indexOf('zoomout') !== -1) {
      var zoomOutScale = effect.indexOf('slow') !== -1 ? (1.15 - p * 0.15) : (1.3 - p * 0.3);
      disp.scale.set(zoomOutScale * bsx, zoomOutScale * bsy);
      disp.x = centerX - (bounds.w * zoomOutScale) / 2;
      disp.y = centerY - (bounds.h * zoomOutScale) / 2;
    } else if (effect.indexOf('slideleft') !== -1) {
      disp.x = baseX - p * 80;
    } else if (effect.indexOf('slideright') !== -1) {
      disp.x = baseX + p * 80;
    } else if (effect.indexOf('slideup') !== -1) {
      disp.y = baseY - p * 80;
    } else if (effect.indexOf('slidedown') !== -1) {
      disp.y = baseY + p * 80;
    }
  }

  function PixiShotstackPlayer(options) {
    options = options || {};
    this._template = null;
    this._merge = options.merge || {};
    this._preGeneratedTts = options.preGeneratedTts || null;
    this._width = options.width || 1920;
    this._height = options.height || 1080;
    this._app = null;
    this._stage = null;
    this._clipDisplays = [];
    this._background = null;
    this._currentTime = 0;
    this._duration = 0;
    this._blobUrlMap = {};
    this._blobUrlsToRevoke = [];
  }

  function revokeBlobUrls(player) {
    if (player._blobUrlsToRevoke && player._blobUrlsToRevoke.length) {
      player._blobUrlsToRevoke.forEach(function (url) {
        try { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); } catch (e) {}
      });
      player._blobUrlsToRevoke = [];
    }
    player._blobUrlMap = {};
  }

  PixiShotstackPlayer.prototype.load = function (templateJson) {
    var self = this;
    var template = typeof templateJson === 'string' ? (function () { try { return JSON.parse(templateJson); } catch (e) { return null; } })() : templateJson;
    if (!template || !template.timeline) return Promise.reject(new Error('Invalid template: missing timeline'));

    if (typeof global.__CFS_loadTimelineFonts === 'function') global.__CFS_loadTimelineFonts(template);
    this._template = template;
    var out = template.output || {};
    if (out.size && Number(out.size.width) > 0 && Number(out.size.height) > 0) {
      this._width = Number(out.size.width);
      this._height = Number(out.size.height);
    } else if (out.resolution) {
      var res = String(out.resolution).toLowerCase();
      var resMap = { preview: [640, 360], mobile: [640, 360], sd: [640, 360], hd: [1920, 1080], '1080p': [1920, 1080], '720p': [1280, 720], '4k': [3840, 2160], uhd: [3840, 2160] };
      if (resMap[res]) { this._width = resMap[res][0]; this._height = resMap[res][1]; }
    }

    var tracks = template.timeline.tracks || [];

    var aliasMap = {};
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        var asset = clip.asset || {};
        if (asset.alias) aliasMap['alias://' + asset.alias] = clip;
      });
    });
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        if (typeof clip.start === 'string' && clip.start.indexOf('alias://') === 0) {
          var ref = aliasMap[clip.start];
          if (ref && typeof ref.start === 'number') clip.start = ref.start;
        }
        if (typeof clip.length === 'string' && clip.length.indexOf('alias://') === 0) {
          var ref2 = aliasMap[clip.length];
          if (ref2 && typeof ref2.length === 'number') clip.length = ref2.length;
          else if (ref2 && (ref2.length === 'end' || ref2.length === 'auto')) clip.length = ref2.length;
        }
      });
    });

    this._duration = 0;
    var timelineEndFromNumerics = 0;
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        var start = typeof clip.start === 'number' ? clip.start : 0;
        var len = typeof clip.length === 'number' ? clip.length : 5;
        if (clip.length !== 'end' && clip.length !== 'auto') {
          timelineEndFromNumerics = Math.max(timelineEndFromNumerics, start + len);
        }
      });
    });
    if (timelineEndFromNumerics <= 0) timelineEndFromNumerics = 10;
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        var start = typeof clip.start === 'number' ? clip.start : 0;
        var len = (clip.length === 'end' || clip.length === 'auto')
          ? Math.max(0, timelineEndFromNumerics - start)
          : (typeof clip.length === 'number' ? clip.length : 5);
        self._duration = Math.max(self._duration, start + len);
      });
    });
    if (this._duration <= 0) this._duration = 10;

    revokeBlobUrls(self);
    return resolveMediaToBlobUrls(this._template, this._merge).then(function (resolved) {
      self._blobUrlMap = resolved.map || {};
      self._blobUrlsToRevoke = resolved.toRevoke || [];
      return loadTimelineFonts(self._template);
    }).then(function () {
      if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready === 'object') {
        return document.fonts.ready;
      }
    }).then(function () {
      return self._initPixi();
    }).then(function () {
      return self._buildStage();
    }).then(function () {
      return self;
    });
  };

  PixiShotstackPlayer.prototype._initPixi = function () {
    var self = this;
    var w = this._width;
    var h = this._height;

    if (this._app) {
      try { this._app.destroy(true, { children: true }); } catch (e) {}
      this._app = null;
    }

    var appOptions = {
      width: w,
      height: h,
      background: parseColor(this._template && this._template.timeline && this._template.timeline.background ? this._template.timeline.background : '#ffffff'),
      backgroundAlpha: 1,
      antialias: true,
      resolution: 1,
      autoStart: false,
      preserveDrawingBuffer: true
    };

    var app = new PIXI.Application();
    if (app.init && typeof app.init === 'function') {
      return app.init(appOptions).then(function () {
        self._app = app;
        self._stage = app.stage;
        return self;
      });
    }
    app = new PIXI.Application(appOptions);
    self._app = app;
    self._stage = app.stage;
    return Promise.resolve(self);
  };

  PixiShotstackPlayer.prototype._buildStage = function () {
    var self = this;
    if (!this._app || !this._stage) return Promise.resolve();
    var stage = this._stage;
    stage.removeChildren();

    var bgColor = parseColor(this._template.timeline && this._template.timeline.background ? this._template.timeline.background : '#ffffff');
    var bg = new PIXI.Graphics();
    bg.rect(0, 0, this._width, this._height);
    if (typeof bg.fill === 'function') bg.fill(bgColor);
    if (bg.eventMode !== undefined) bg.eventMode = 'none';
    stage.addChild(bg);
    this._background = bg;

    var merge = this._merge;
    var canvasW = this._width;
    var canvasH = this._height;
    var clipDisplays = [];
    var blobUrlMap = this._blobUrlMap || {};
    var tracks = this._template.timeline.tracks || [];
    var totalDuration = this._duration || 10;

    /* ShotStack tracks are front-to-back: track[0] = topmost, track[last] = bottom.
       Pixi children added later render on top, so iterate in reverse (back layers first). */
    var flatList = [];
    for (var _ri = tracks.length - 1; _ri >= 0; _ri--) {
      (function (track, trackIdx) {
        (track.clips || []).forEach(function (clip) {
          var start = typeof clip.start === 'number' ? clip.start : 0;
          var resolvedLen = (clip.length === 'end' || clip.length === 'auto')
            ? Math.max(0, totalDuration - start)
            : (typeof clip.length === 'number' ? clip.length : 5);
          var type = ((clip.asset || {}).type || '').toLowerCase();
          flatList.push({ clip: clip, trackIdx: trackIdx, resolvedLen: resolvedLen, isLuma: type === 'luma' });
        });
      })(tracks[_ri], _ri);
    }

    function addNext(idx) {
      if (idx >= flatList.length) {
        self._clipDisplays = clipDisplays;
        self.seek(self._currentTime);
        return Promise.resolve();
      }
      var item = flatList[idx];
      if (item.isLuma) {
        return processLumaClip(self, stage, item.clip, item.trackIdx, canvasW, canvasH, merge, blobUrlMap, item.resolvedLen).then(function (disp) {
          if (disp) clipDisplays.push(disp);
          return addNext(idx + 1);
        }).catch(function () { return addNext(idx + 1); });
      }
      var disp = buildClipDisplayObject(item.clip, item.trackIdx, canvasW, canvasH, merge, blobUrlMap, item.resolvedLen);
      if (disp && typeof disp.then === 'function') {
        var _promiseMeta = disp.cfsClipMeta;
        var _promiseVisible = disp.cfsVisible;
        return disp.then(function (d) {
          if (d && stage) {
            if (_promiseMeta && !d.cfsClipMeta) d.cfsClipMeta = _promiseMeta;
            if (_promiseVisible && !d.cfsVisible) d.cfsVisible = true;
            stage.addChild(d);
            clipDisplays.push(d);
          }
          return addNext(idx + 1);
        }).catch(function () { return addNext(idx + 1); });
      }
      if (disp) {
        stage.addChild(disp);
        clipDisplays.push(disp);
      }
      return addNext(idx + 1);
    }

    this._clipDisplays = clipDisplays;
    return addNext(0).then(function () {
      return self._forceTextRewrap();
    });
  };

  PixiShotstackPlayer.prototype._forceTextRewrap = function () {
    var self = this;
    (self._clipDisplays || []).forEach(function (disp) {
      var textObj = (disp && disp._cfsTextChild) || disp;
      if (!textObj || !(textObj instanceof PIXI.Text)) return;
      try {
        var _curText = textObj.text;
        textObj.text = _curText + ' ';
        textObj.text = _curText;
      } catch (_) {}
      var st = textObj.style;
      if (!st || !st.wordWrap || !(st.wordWrapWidth > 0)) return;
      textObj._cfsOrigWrapW = st.wordWrapWidth;
      st.wordWrapWidth = st.wordWrapWidth - 1;
    });
    self.seek(self._currentTime);
    return new Promise(function (resolve) {
      setTimeout(function () {
        (self._clipDisplays || []).forEach(function (disp) {
          var textObj = (disp && disp._cfsTextChild) || disp;
          if (!textObj || !(textObj instanceof PIXI.Text)) return;
          if (textObj._cfsOrigWrapW != null) {
            textObj.style.wordWrapWidth = textObj._cfsOrigWrapW;
            delete textObj._cfsOrigWrapW;
          }
          try {
            var _t = textObj.text;
            textObj.text = _t + ' ';
            textObj.text = _t;
          } catch (_) {}
        });
        self.seek(self._currentTime);
        resolve();
      }, 50);
    });
  };

  PixiShotstackPlayer.prototype.setMerge = function (merge) {
    var self = this;
    this._merge = merge || {};
    if (!this._template) return;
    revokeBlobUrls(self);
    resolveMediaToBlobUrls(this._template, this._merge).then(function (resolved) {
      self._blobUrlMap = resolved.map || {};
      self._blobUrlsToRevoke = resolved.toRevoke || [];
      self._buildStage();
    }).catch(function (err) { console.warn('[CFS] setMerge media resolve failed', err); self._buildStage(); });
  };

  PixiShotstackPlayer.prototype.seek = function (timeSec) {
    this._currentTime = Math.max(0, Number(timeSec));

    this._clipDisplays.forEach(function (disp) {
      var meta = disp.cfsClipMeta;
      if (!meta) return;
      var start = meta.start;
      var end = meta.start + meta.length;
      var visible = this._currentTime >= start && this._currentTime < end;
      disp.visible = visible;
      if (!visible) return;
      disp.alpha = 1;
      disp.x = disp._cfsBaseX != null ? disp._cfsBaseX : (meta.x || 0);
      disp.y = disp._cfsBaseY != null ? disp._cfsBaseY : (meta.y || 0);
      if (disp._cfsBaseScaleX != null) {
        disp.scale.set(disp._cfsBaseScaleX, disp._cfsBaseScaleY);
      } else {
        disp.scale.set(1);
      }
      disp.pivot.set(0, 0);
      disp.angle = 0;
      applyTweensToObject(disp, this._currentTime, this._width, this._height);
      applyTransitionToObject(disp, this._currentTime);
      applyEffectToObject(disp, this._currentTime);
      if (typeof disp._cfsUpdateTextAtTime === 'function') {
        try { disp._cfsUpdateTextAtTime(Math.max(0, this._currentTime - start), this._currentTime); } catch (_) {}
      }
      var textChild = disp._cfsTextChild || disp;
      var anim = textChild._cfsAnimation;
      if (anim && anim.preset) {
        var relTime = this._currentTime - start;
        var animDur = typeof anim.duration === 'number' ? anim.duration : Math.min(meta.length, 2);
        var preset = (anim.preset || '').toLowerCase();
        if (preset === 'typewriter') {
          var fullText = textChild._cfsRawText || textChild.text || '';
          var charCount = fullText.length;
          var progress = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          var charsToShow = Math.floor(charCount * progress);
          var transformed = applyTextTransform(fullText.slice(0, charsToShow), textChild._cfsTextTransform);
          if (textChild.text !== transformed) textChild.text = transformed;
        } else if (preset === 'fadein' || preset === 'fade-in') {
          var fadeP = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          disp.alpha = Math.max(0, Math.min(1, disp.alpha * fadeP));
        } else if (preset === 'slidein' || preset === 'slide-in') {
          var slideP = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          disp.x = meta.x + (1 - slideP) * 100;
        } else if (preset === 'ascend') {
          var ascP = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          disp.y = meta.y + (1 - ascP) * 60;
          disp.alpha = Math.max(0, Math.min(1, disp.alpha * ascP));
        } else if (preset === 'shift') {
          var shiftP = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          disp.x = meta.x - (1 - shiftP) * 80;
        } else if (preset === 'movingletters' || preset === 'moving-letters') {
          var mlP = animDur > 0 ? Math.min(1, relTime / animDur) : 1;
          disp.alpha = Math.max(0, Math.min(1, disp.alpha * mlP));
          var sc = 0.6 + 0.4 * mlP;
          disp.scale.set(sc * (disp.scale.x > 0 ? 1 : -1), sc * (disp.scale.y > 0 ? 1 : -1));
        }
      }
      if (disp._videoEl && visible) {
        var rel = this._currentTime - start;
        var clip = meta.clip || {};
        var videoAsset = clip.asset || {};
        var trimOffset = videoAsset.trim != null ? Math.max(0, Number(videoAsset.trim)) : (clip.trim != null ? Math.max(0, Number(clip.trim)) : 0);
        var speed = videoAsset.speed != null ? Math.max(0.1, Number(videoAsset.speed)) : 1;
        var dur = disp._videoDuration != null ? disp._videoDuration : meta.length;
        var targetTime = Math.max(0, Math.min(trimOffset + rel * speed, dur));
        if (disp._videoEl.playbackRate !== speed) disp._videoEl.playbackRate = speed;
        if (disp._cfsNativePlayback) {
          var drift = Math.abs(disp._videoEl.currentTime - targetTime);
          if (drift > 0.15) { disp._videoEl.currentTime = targetTime; }
        } else {
          disp._videoEl.currentTime = targetTime;
        }
        /* WebM VP9 alpha: redraw video frame to canvas intermediary to preserve alpha */
        if (disp._cfsAlphaCanvas && disp._cfsAlphaCtx) {
          try {
            disp._cfsAlphaCtx.clearRect(0, 0, disp._cfsAlphaCanvas.width, disp._cfsAlphaCanvas.height);
            disp._cfsAlphaCtx.drawImage(disp._videoEl, 0, 0, disp._cfsAlphaCanvas.width, disp._cfsAlphaCanvas.height);
          } catch(_){}
        }
        if (disp.texture && disp.texture.source && typeof disp.texture.source.update === 'function') {
          disp.texture.source.update();
        }
      }
      if (disp._lumaMaskSprite && disp._lumaMaskSprite._videoEl && visible) {
        var relLuma = this._currentTime - start;
        var durLuma = disp._lumaMaskSprite._videoDuration != null ? disp._lumaMaskSprite._videoDuration : meta.length;
        disp._lumaMaskSprite._videoEl.currentTime = Math.max(0, Math.min(relLuma, durLuma));
        /* Force Pixi to re-read the luma video frame */
        var mTex = disp._lumaMaskSprite.texture;
        if (mTex && mTex.source && typeof mTex.source.update === 'function') {
          mTex.source.update();
        } else if (mTex && mTex.baseTexture && mTex.baseTexture.resource) {
          if (typeof mTex.baseTexture.resource.update === 'function') mTex.baseTexture.resource.update();
          mTex.baseTexture.update();
        }
      }
    }, this);

    if (this._app && this._app.renderer) this._app.renderer.render(this._stage);
  };

  PixiShotstackPlayer.prototype.getDuration = function () {
    return this._duration;
  };

  PixiShotstackPlayer.prototype.startVideoPlayback = function (timelineStart) {
    this._clipDisplays.forEach(function (disp, i) {
      if (!disp._videoEl) return;
      var meta = disp.cfsClipMeta || {};
      var clip = meta.clip || {};
      var videoAsset = clip.asset || {};
      var start = meta.start || 0;
      var trimOffset = videoAsset.trim != null ? Math.max(0, Number(videoAsset.trim)) : (clip.trim != null ? Math.max(0, Number(clip.trim)) : 0);
      var speed = videoAsset.speed != null ? Math.max(0.1, Number(videoAsset.speed)) : 1;
      var rel = Math.max(0, (timelineStart || 0) - start);
      disp._videoEl.currentTime = trimOffset + rel * speed;
      disp._videoEl.playbackRate = speed;
      disp._videoEl.muted = true;
      disp._cfsNativePlayback = true;
      try { disp._videoEl.play().catch(function(){}); } catch(_){}
    }.bind(this));
  };

  PixiShotstackPlayer.prototype.captureFrame = function (options) {
    options = options || {};
    var format = options.format || 'png';
    var quality = options.quality != null ? options.quality : 1;
    if (!this._app || !this._app.renderer) return Promise.resolve(null);

    this.seek(this._currentTime);
    var renderer = this._app.renderer;
    var extract = renderer.extract;
    if (!extract) {
      var canvas = renderer.canvas;
      if (canvas && canvas.toDataURL) return Promise.resolve(canvas.toDataURL('image/' + format, quality));
      return Promise.resolve(null);
    }
    var opts = { format: format };
    if (format === 'jpeg' || format === 'jpg') opts.quality = quality;
    if (extract.base64) {
      return Promise.resolve(extract.base64(this._stage, opts)).then(function (b64) {
        return b64 ? 'data:image/' + (format === 'jpg' ? 'jpeg' : format) + ';base64,' + b64 : null;
      });
    }
    if (extract.canvas) {
      var c = extract.canvas(this._stage);
      return Promise.resolve(c && c.toDataURL ? c.toDataURL('image/' + (format === 'jpg' ? 'jpeg' : format), quality) : null);
    }
    var canvas = renderer.canvas;
    return Promise.resolve(canvas && canvas.toDataURL ? canvas.toDataURL('image/' + (format === 'jpg' ? 'jpeg' : format), quality) : null);
  };

  PixiShotstackPlayer.prototype._waitForVideoSeeks = function () {
    var promises = [];
    this._clipDisplays.forEach(function (disp) {
      if (!disp._videoEl || !disp.visible) return;
      var video = disp._videoEl;
      if (video.seeking) {
        promises.push(new Promise(function (resolve) {
          var timer = setTimeout(resolve, 200);
          video.addEventListener('seeked', function () {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        }));
      }
    });
    if (promises.length === 0) return Promise.resolve();
    return Promise.all(promises);
  };

  PixiShotstackPlayer.prototype.captureFrameSequence = function (options) {
    var self = this;
    options = options || {};
    var fps = Math.max(1, options.fps || 25);
    var durationSec = options.durationSec != null ? options.durationSec : this.getDuration();
    var format = options.format || 'png';
    var quality = options.quality != null ? options.quality : 1;
    var onFrame = options.onFrame;

    var frameCount = Math.ceil(durationSec * fps);
    var results = [];
    var index = 0;

    function next() {
      if (index >= frameCount) return Promise.resolve(results);
      var t = index / fps;
      self.seek(t);
      return self._waitForVideoSeeks().then(function () {
        self._clipDisplays.forEach(function (disp) {
          if (disp._videoEl && disp.visible && disp.texture && disp.texture.source &&
              typeof disp.texture.source.update === 'function') {
            disp.texture.source.update();
          }
        });
        if (self._app && self._app.renderer) {
          self._app.renderer.render(self._stage);
        }
        return self.captureFrame({ format: format, quality: quality });
      }).then(function (dataUrl) {
        if (dataUrl) {
          results.push(dataUrl);
          if (onFrame) onFrame(dataUrl, index, t);
        }
        index++;
        return next();
      });
    }
    return next();
  };

  PixiShotstackPlayer.prototype.getCanvas = function () {
    return this._app && this._app.renderer ? this._app.renderer.canvas : null;
  };

  PixiShotstackPlayer.prototype.createMixedAudioPlayback = function (options) {
    options = options || {};
    return createMixedAudioPlaybackForPlayer(this, options.durationSec != null ? options.durationSec : this._duration, options.rangeStart || 0);
  };

  PixiShotstackPlayer.prototype.renderMixedAudioBuffer = function (durationSec, rangeStart) {
    return renderMixedAudioBuffer(this._template, this._merge, this._blobUrlMap, durationSec, this._preGeneratedTts || null, rangeStart || 0);
  };

  PixiShotstackPlayer.prototype.destroy = function () {
    if (typeof global.__CFS_unloadAllFonts === 'function') global.__CFS_unloadAllFonts();
    (this._clipDisplays || []).forEach(function (disp) {
      if (!disp) return;
      if (disp._videoEl) {
        disp._videoEl.pause();
        disp._videoEl.removeAttribute('src');
        disp._videoEl.load();
        disp._videoEl = null;
      }
      if (disp._lumaMaskSprite && disp._lumaMaskSprite._videoEl) {
        disp._lumaMaskSprite._videoEl.pause();
        disp._lumaMaskSprite._videoEl.removeAttribute('src');
        disp._lumaMaskSprite._videoEl.load();
        disp._lumaMaskSprite._videoEl = null;
      }
    });
    revokeBlobUrls(this);
    if (this._app) {
      try { this._app.destroy(true, { children: true }); } catch (e) {}
      this._app = null;
    }
    this._stage = null;
    this._clipDisplays = [];
    this._background = null;
  };

  global.__CFS_pixiShotstackPlayer = function (options) {
    return new PixiShotstackPlayer(options);
  };
  global.__CFS_PixiShotstackPlayer = PixiShotstackPlayer;
  global.__CFS_pixiTimelinePlayer = {
    _testCreateImage: createImage,
    _testApplyFitAndScale: applyFitAndScale,
  };
})(typeof window !== 'undefined' ? window : globalThis);
