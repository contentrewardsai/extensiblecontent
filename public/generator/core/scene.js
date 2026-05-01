/**
 * Fabric.js scene: load from JSON or from ShotStack timeline, inject merge data.
 * Pipeline: timeline (get/seek), audio (from ShotStack), capture (frame at time, frame sequence), export (frame sequence for video).
 */
(function (global) {
  'use strict';

  const fabric = global.fabric;

  /**
   * Load Fabric JSON into canvas. Object names can be used for merge (e.g. obj.name === 'headline' → set text).
   */
  function loadFromJSON(canvas, json, callback) {
    if (!canvas || !canvas.loadFromJSON) {
      if (callback) callback(new Error('Canvas or loadFromJSON missing'));
      return Promise.reject(new Error('Canvas or loadFromJSON missing'));
    }
    return new Promise(function (resolve, reject) {
      try {
        canvas.loadFromJSON(json, function () {
          canvas.renderAll();
          if (callback) callback(null);
          resolve();
        }, function (o, obj, _cb) {
          /* Reviver: accept every object as-is. Fabric v5 calls _cb(obj) or _cb(null) to continue. */
          if (typeof _cb === 'function') _cb(obj);
        });
      } catch (e) {
        if (callback) callback(e);
        reject(e);
      }
    });
  }

  /**
   * Inject merge values into canvas objects by name.
   * values: { headline: '...', image1: 'url', boxColor1: '#...' }
   * Objects with matching .name get text/source/fill updated.
   */
  function injectMergeData(canvas, values) {
    if (!canvas || !values) return;
    var wrapTextToWidth = global.__CFS_wrapTextToWidth || function (rawText) { return rawText == null ? '' : String(rawText); };
    function parseOptionalNum(raw, min) {
      if (raw == null) return NaN;
      var s = String(raw).trim();
      if (s === '') return NaN;
      var n = Number(s);
      if (isNaN(n)) return NaN;
      if (min != null && n < min) return NaN;
      return n;
    }
    function resolveMergeValue(key) {
      if (!key) return undefined;
      if (values[key] !== undefined) return values[key];
      var upper = String(key).toUpperCase().replace(/\s+/g, '_');
      if (values[upper] !== undefined) return values[upper];
      var utils = global.__CFS_mergeUtils;
      if (utils && utils.isValidMergeValue) {
        var urlKey = 'CFS_' + upper + '_URL';
        var urlVal = values[urlKey];
        if (utils.isValidMergeValue(urlVal)) return urlVal;
      }
      return undefined;
    }
    function applyPlaceholders(raw) {
      if (typeof raw !== 'string') return raw;
      var s = raw;
      if (/^alias:\/\//i.test(s)) {
        var aliasKey = s.replace(/^alias:\/\//i, '').trim();
        var aliasVal = resolveMergeValue(aliasKey);
        return aliasVal !== undefined ? String(aliasVal) : s;
      }
      s = s.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (m, k) {
        var mv = resolveMergeValue(k);
        return mv !== undefined && mv !== null ? String(mv) : m;
      });
      return s;
    }
    const bgVal = values.backgroundColor !== undefined ? values.backgroundColor : (values.background !== undefined ? values.background : undefined);
    const insetRaw = (values.AD_APPLE_NOTES_TEXT_INSET_X !== undefined ? values.AD_APPLE_NOTES_TEXT_INSET_X : values.textInsetX);
    const insetVal = parseOptionalNum(insetRaw, 0);
    const hasInset = !isNaN(insetVal) && insetVal >= 0;
    const titleSizeRaw = (values.AD_APPLE_NOTES_TITLE_SIZE !== undefined ? values.AD_APPLE_NOTES_TITLE_SIZE : values.nameFontSize);
    const bodySizeRaw = (values.AD_APPLE_NOTES_BODY_SIZE !== undefined ? values.AD_APPLE_NOTES_BODY_SIZE : values.textFontSize);
    const titleBase = parseOptionalNum(titleSizeRaw, 1);
    const bodyBase = parseOptionalNum(bodySizeRaw, 1);
    const hasTitleSize = !isNaN(titleBase) && titleBase > 0;
    const hasBodySize = !isNaN(bodyBase) && bodyBase > 0;
    const noteTextNames = { AD_APPLE_NOTES_NAME_1: true, AD_APPLE_NOTES_TEXT_1: true };
    if (bgVal != null && typeof bgVal === 'string' && canvas.set) {
      canvas.set('backgroundColor', bgVal);
    }
    const objects = canvas.getObjects ? canvas.getObjects() : [];
    const isText = function (o) { return o.type === 'text' || o.type === 'i-text' || o.type === 'textbox'; };
    var cwCanvas = canvas.getWidth ? canvas.getWidth() : (canvas.width || 1080);
    objects.forEach(function (obj) {
      const name = obj.name || obj.id;
      if (name === 'background' && bgVal != null && typeof bgVal === 'string') {
        if (obj.set) obj.set('fill', bgVal);
        return;
      }
      if (!name) return;
      if (obj.set && isText(obj)) {
        if (name === 'AD_APPLE_NOTES_NAME_1' && hasTitleSize) {
          obj.set('fontSize', Math.max(1, Math.round(titleBase)));
        } else if (name === 'AD_APPLE_NOTES_TEXT_1' && hasBodySize) {
          obj.set('fontSize', Math.max(1, Math.round(bodyBase)));
        }
        /* Resolve fontFamily from merge placeholders (e.g. "{{ BODY_FONT_FAMILY }}" → "Helvetica Neue").
           Without this, ctx.font assignment fails due to invalid CSS characters in {{ }},
           causing text measurement to fall back to default 10px and breaking word-wrap. */
        var curFamily = typeof obj.get === 'function' ? obj.get('fontFamily') : obj.fontFamily;
        if (curFamily && typeof curFamily === 'string' && curFamily.indexOf('{{') >= 0) {
          var resolvedFamily = applyPlaceholders(curFamily);
          if (resolvedFamily !== curFamily) obj.set('fontFamily', resolvedFamily);
        }
        /* Resolve fontSize from original clip when it's NaN (placeholder was parsed to NaN during scene load) */
        var curSize = typeof obj.get === 'function' ? obj.get('fontSize') : obj.fontSize;
        if (curSize == null || isNaN(Number(curSize)) || Number(curSize) <= 0) {
          var origClip = typeof obj.get === 'function' ? obj.get('cfsOriginalClip') : obj.cfsOriginalClip;
          if (origClip && origClip.asset && origClip.asset.font && origClip.asset.font.size != null) {
            var resolvedSizeStr = applyPlaceholders(String(origClip.asset.font.size));
            var resolvedSizeNum = Number(resolvedSizeStr);
            if (resolvedSizeNum > 0) obj.set('fontSize', Math.max(1, Math.round(resolvedSizeNum)));
          }
        }
        /* Resolve fill/color from placeholders */
        var curFill = typeof obj.get === 'function' ? obj.get('fill') : obj.fill;
        if (curFill && typeof curFill === 'string' && curFill.indexOf('{{') >= 0) {
          var resolvedFill = applyPlaceholders(curFill);
          if (resolvedFill !== curFill) obj.set('fill', resolvedFill);
        }
      }
      var val = values[name] !== undefined ? values[name] : (typeof name === 'string' ? values[name.toUpperCase().replace(/\s+/g, '_')] : undefined);
      if (val === undefined) {
        var mergeKey = obj.cfsMergeKey || (typeof obj.get === 'function' ? obj.get('cfsMergeKey') : null);
        if (mergeKey) {
          val = values[mergeKey] !== undefined ? values[mergeKey] : values[String(mergeKey).toUpperCase().replace(/\s+/g, '_')];
        }
      }
      /* Also resolve direct placeholders/aliases on object properties even if no name match. */
      if (obj.set) {
        if ((obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') && typeof obj.get('text') === 'string') {
          var mergedText = applyPlaceholders(obj.get('text'));
          if (mergedText !== obj.get('text')) obj.set('text', mergedText);
        }
        if (obj.type === 'image' && typeof obj.get('src') === 'string') {
          var mergedSrc = applyPlaceholders(obj.get('src'));
          if (mergedSrc !== obj.get('src')) {
            if (typeof obj.setSrc === 'function') {
              var _cv = canvas;
              var _imgObj = obj;
              var _onImgLoad = function () {
                var cW = _cv && _cv.getWidth ? _cv.getWidth() : 1024;
                var cH = _cv && _cv.getHeight ? _cv.getHeight() : 576;
                applyFitToSingleImage(_imgObj, cW, cH);
                if (_cv && _cv.renderAll) _cv.renderAll();
              };
              var _res = obj.setSrc(mergedSrc, _onImgLoad, { crossOrigin: 'anonymous' });
              if (_res && typeof _res.then === 'function') {
                _res.then(_onImgLoad).catch(function (err) { console.warn('[CFS] Image load failed', err); });
              }
            } else {
              obj.set('src', mergedSrc);
            }
          }
        }
        if (obj.type === 'group' && typeof obj.get('cfsVideoSrc') === 'string') {
          var mergedVideoSrc = applyPlaceholders(obj.get('cfsVideoSrc'));
          if (mergedVideoSrc !== obj.get('cfsVideoSrc')) obj.set('cfsVideoSrc', mergedVideoSrc);
        }
        if (typeof obj.get('cfsSvgSrc') === 'string') {
          var mergedSvg = applyPlaceholders(obj.get('cfsSvgSrc'));
          if (mergedSvg !== obj.get('cfsSvgSrc')) {
            obj.set('cfsSvgSrc', mergedSvg);
            if (obj.type === 'image') obj.set('src', mergedSvg);
          }
        }
        if (typeof obj.get('backgroundColor') === 'string') {
          var mergedBg = applyPlaceholders(obj.get('backgroundColor'));
          if (mergedBg !== obj.get('backgroundColor')) obj.set('backgroundColor', mergedBg);
        }
        if ((obj.type === 'rect' || obj.type === 'path' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') && typeof obj.get('fill') === 'string') {
          var mergedFill = applyPlaceholders(obj.get('fill'));
          if (mergedFill !== obj.get('fill')) obj.set('fill', mergedFill);
        }
      }
      if (val === undefined) return;
      if (obj.set) {
        if (isText(obj)) {
          var origClipForText = obj.get ? obj.get('cfsOriginalClip') : obj.cfsOriginalClip;
          var origTemplateText = origClipForText && origClipForText.asset ? (origClipForText.asset.text || '') : '';
          /* Use cfsRawText (live user edits) if available, otherwise fall back to original clip text */
          var liveRawText = (typeof obj.get === 'function' ? obj.get('cfsRawText') : obj.cfsRawText);
          var templateSource = (liveRawText != null && String(liveRawText) !== '') ? String(liveRawText) : origTemplateText;
          var isEmbeddedPlaceholder = templateSource && !(/^\s*\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*$/.test(templateSource));
          var nextText;
          if (isEmbeddedPlaceholder) {
            nextText = applyPlaceholders(templateSource);
          } else {
            nextText = String(val != null ? val : '');
          }
          /* Only update cfsRawText if it wasn't already set by the user (preserve user edits) */
          if (liveRawText == null || liveRawText === '') obj.set('cfsRawText', nextText);
          if (obj.type === 'textbox' && obj.cfsWrapText !== false) {
            var boxW = Number(obj.width);
            var maxLines = null;
            if (!(boxW > 0)) {
              var cw0 = canvas.getWidth ? canvas.getWidth() : (canvas.width || 1080);
              var left0 = Number(obj.left) || 0;
              var right0 = (obj.cfsRightPx != null && !isNaN(Number(obj.cfsRightPx))) ? Number(obj.cfsRightPx) : 20;
              boxW = Math.max(50, cw0 - left0 - right0);
            }
            var nameForCap = name;
            if (nameForCap === 'AD_APPLE_NOTES_TEXT_1') {
              var ch0 = canvas.getHeight ? canvas.getHeight() : (canvas.height || 1080);
              var lineH0 = Math.ceil((Number(obj.fontSize) > 0 ? Number(obj.fontSize) : 15) * 1.4);
              var availH0 = Math.max(lineH0, ch0 - (Number(obj.top) || 0) - 40);
              maxLines = Math.max(1, Math.floor(availH0 / lineH0));
            } else if (nameForCap === 'AD_APPLE_NOTES_NAME_1') {
              var lineH1 = Math.ceil((Number(obj.fontSize) > 0 ? Number(obj.fontSize) : 18) * 1.4);
              maxLines = Math.max(1, Math.floor(30 / lineH1));
            }
            nextText = wrapTextToWidth(nextText, obj.fontFamily, obj.fontSize, obj.fontWeight, Math.max(1, boxW - 2), maxLines);
          }
          obj.set('text', nextText);
          obj.set('selectable', true);
          obj.set('evented', true);
        } else if (obj.type === 'image' && val && typeof val === 'string') {
          obj.set('selectable', true);
          obj.set('evented', true);
          if (typeof obj.setSrc === 'function') {
            var _canvas = canvas;
            var _imgRef = obj;
            var _onLoad = function () {
              var cW = _canvas && _canvas.getWidth ? _canvas.getWidth() : 1024;
              var cH = _canvas && _canvas.getHeight ? _canvas.getHeight() : 576;
              applyFitToSingleImage(_imgRef, cW, cH);
              if (_canvas && _canvas.renderAll) _canvas.renderAll();
            };
            var result = obj.setSrc(val, _onLoad, { crossOrigin: 'anonymous' });
            if (result && typeof result.then === 'function') {
              result.then(_onLoad).catch(function (err) { console.warn('[CFS] Image load failed for', val, err); });
            }
          } else {
            obj.set('src', val);
          }
        } else if (obj.type === 'group' && obj.cfsVideoSrc && val && typeof val === 'string') {
          obj.set('cfsVideoSrc', val);
        } else if ((obj.type === 'rect' || obj.type === 'path') && val && typeof val === 'string' && /^#([0-9a-fA-F]{3}){1,2}$/.test(val)) {
          obj.set('fill', val);
        }
      }
    });
    if (hasInset) {
      var cw = cwCanvas;
      objects.forEach(function (obj) {
        var name = obj && (obj.name || obj.id);
        if (!name || !noteTextNames[name] || !obj.set || !isText(obj)) return;
        var newLeft = insetVal;
        var newW = Math.max(50, cw - newLeft - insetVal);
        obj.set('left', newLeft);
        obj.set('width', newW);
        obj.set('cfsRightPx', insetVal);
        if (obj.type === 'textbox') {
          obj.set('minWidth', newW);
          obj.set('maxWidth', newW);
          if (typeof obj.initDimensions === 'function') obj.initDimensions();
        }
      });
    }
    objects.forEach(function (obj) {
      if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') {
        obj.initDimensions();
      }
    });
    canvas.renderAll();
  }

  /**
   * Extract merge field name from "{{ MERGE_FIELD }}" placeholder for use as Fabric object name.
   * Enables injectMergeData to match sidebar values (e.g. HEADLINE, SUBHEAD) to canvas objects.
   */
  function mergePlaceholderToName(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/);
    return m ? m[1] : null;
  }

  /** 1x1 transparent PNG data URL – used as image src when template has {{ IMAGE1 }} so Fabric does not request the placeholder as a URL. */
  var PLACEHOLDER_IMAGE_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  /** Parse inline CSS from ShotStack HTML clip (e.g. "p { color: #fff; font-size: 22px; ... }"). */
  function parseHtmlClipCss(cssStr) {
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
  }
  global.__CFS_parseHtmlClipCss = parseHtmlClipCss;

  /** Extract plain text from ShotStack HTML clip content (strip tags). */
  function extractTextFromHtml(htmlStr) {
    if (!htmlStr || typeof htmlStr !== 'string') return '';
    return htmlStr.replace(/<[^>]+>/g, '').trim();
  }
  global.__CFS_extractTextFromHtml = extractTextFromHtml;

  /**
   * Resolve output dimensions from template.output (size or resolution).
   * Used so import uses the same resolution as the original template.
   * @param {{ size?: { width?: number, height?: number }, resolution?: string }} output - template.output
   * @returns {{ width: number, height: number } | null} dimensions or null if unresolvable
   */
  function getOutputDimensions(output) {
    if (!output) return null;
    if (output.size && Number(output.size.width) > 0 && Number(output.size.height) > 0) {
      return { width: Number(output.size.width), height: Number(output.size.height) };
    }
    var res = (output.resolution || '').toLowerCase();
    var map = {
      preview: { width: 640, height: 360 },
      mobile: { width: 640, height: 360 },
      sd: { width: 640, height: 360 },
      hd: { width: 1920, height: 1080 },
      '1080p': { width: 1920, height: 1080 },
      '720p': { width: 1280, height: 720 },
      '4k': { width: 3840, height: 2160 },
      uhd: { width: 3840, height: 2160 },
    };
    var dims = map[res];
    if (dims) return dims;
    return null;
  }

  var positionFromClip = global.__CFS_positionFromClip = global.__CFS_positionFromClip || function (canvasW, canvasH, clip, elemW, elemH) {
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

  /**
   * Build a minimal Fabric-friendly structure from ShotStack timeline (single track, image/title clips).
   * Objects are named from {{ MERGE_FIELD }} when present so sidebar values (Headline, Subhead, etc.) sync.
   * Canvas dimensions match the template output (output.size or output.resolution) so elements stay in the right place.
   */
  function shotstackToFabricStructure(shotstackEdit) {
    if (!shotstackEdit || !shotstackEdit.timeline || !Array.isArray(shotstackEdit.timeline.tracks)) {
      return { width: 1920, height: 1080, objects: [] };
    }
    const output = shotstackEdit.output || {};
    var dims = getOutputDimensions(output);
    const width = dims ? dims.width : 1920;
    const height = dims ? dims.height : 1080;
    const objects = [];
    const timelineBg = shotstackEdit.timeline.background;
    const bgFill = (timelineBg && typeof timelineBg === 'string' && !/^\s*\{\{\s*/.test(timelineBg)) ? timelineBg : '#ffffff';
    objects.push({
      type: 'rect',
      name: 'background',
      left: 0,
      top: 0,
      width: width,
      height: height,
      fill: bgFill,
      selectable: true,
      evented: true,
    });
    function addTweenToObject(obj, clip) {
      if (!obj || !clip) return;
      if (Array.isArray(clip.opacity)) obj.cfsOpacityTween = clip.opacity;
      else if (clip.opacity != null && typeof clip.opacity === 'number') {
        obj.cfsClipOpacity = clip.opacity;
        obj.opacity = Math.max(0, Math.min(1, clip.opacity));
      }
      const offset = clip.offset || {};
      if (Array.isArray(offset.x) || Array.isArray(offset.y)) {
        obj.cfsOffsetTween = { x: offset.x, y: offset.y };
      }
      const transform = clip.transform || {};
      const rotate = transform.rotate || {};
      if (Array.isArray(rotate.angle)) obj.cfsRotateTween = rotate.angle;
      else if (typeof rotate.angle === 'number' && rotate.angle !== 0) obj.angle = rotate.angle;
      const skew = transform.skew || {};
      if (skew.x != null || skew.y != null) {
        obj.skewX = Number(skew.x) || 0;
        obj.skewY = Number(skew.y) || 0;
      }
      const flip = transform.flip || {};
      if (flip.horizontal || flip.vertical) {
        obj.flipX = !!flip.horizontal;
        obj.flipY = !!flip.vertical;
        obj.cfsFlip = { horizontal: !!flip.horizontal, vertical: !!flip.vertical };
      }
      if (clip.transition && typeof clip.transition === 'object') obj.cfsTransition = clip.transition;
      if (clip.effect != null && clip.effect !== '') obj.cfsEffect = clip.effect;
      if (clip.filter != null && clip.filter !== '' && clip.filter !== 'none') obj.cfsFilter = clip.filter;
      if (clip.fit != null && clip.fit !== '') obj.cfsFit = clip.fit;
      if (clip.scale != null && typeof clip.scale === 'number') obj.cfsScale = clip.scale;
      if (clip._cfsHideOnImage) obj.cfsHideOnImage = true;
    }

    let clipIndex = 0;
    const tracks = shotstackEdit.timeline.tracks;
    /* Compute timeline end so clips with length "end" get a numeric cfsLength. */
    let timelineEndSec = 0;
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (c) {
        const s = typeof c.start === 'number' ? c.start : 0;
        const len = c.length;
        if (typeof len === 'number') timelineEndSec = Math.max(timelineEndSec, s + len);
        else if (len === 'end' || len === 'auto') timelineEndSec = Math.max(timelineEndSec, s + 15);
      });
    });
    if (timelineEndSec <= 0) timelineEndSec = 10;
    function resolveClipLength(clip) {
      const len = clip.length;
      if (typeof len === 'number') return len;
      if (len === 'end' || len === 'auto') return Math.max(0.1, timelineEndSec - (typeof clip.start === 'number' ? clip.start : 0));
      return 5;
    }
    function applyClipScale(baseW, baseH, clip) {
      var w = Number(baseW) || 0;
      var h = Number(baseH) || 0;
      var s = (clip && clip.scale != null && !isNaN(Number(clip.scale))) ? Number(clip.scale) : 1;
      if (!(s > 0)) s = 1;
      return { w: w * s, h: h * s };
    }
    /* ShotStack tracks are front-to-back: track[0] = topmost, track[last] = bottom.
       Fabric objects render bottom-to-top (first object = bottom layer).
       Iterate tracks in reverse so the last ShotStack track (background) is pushed first (bottom in Fabric). */
    for (var _ti = tracks.length - 1; _ti >= 0; _ti--) { (function (track, trackIdx) {
      (track.clips || []).forEach(function (clip) {
        const asset = clip.asset || {};
        /* Store original clip for round-trip export (preserve alignment, lineHeight, background, type "text", etc.). */
        const originalClip = JSON.parse(JSON.stringify(clip));
        /* Upgrade legacy ShotStack "text" to "rich-text" so one code path handles both. */
        if (asset.type === 'text') {
          asset.type = 'rich-text';
          if (asset.alignment && !asset.align) asset.align = asset.alignment;
          if (asset.font && asset.font.lineHeight != null) {
            asset.style = asset.style || {};
            if (asset.style.lineHeight == null) asset.style.lineHeight = asset.font.lineHeight;
          }
        }
        const clipLength = resolveClipLength(clip);
        if (asset.type === 'title' && asset.text) {
          const mergeName = mergePlaceholderToName(asset.text);
          let textWidth = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : Math.max(400, width - 200)));
          var titleH = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : 40));
          let titleLeft, titleTop;
          if (asset.left != null && asset.top != null) {
            titleLeft = Number(asset.left);
            titleTop = Number(asset.top);
          } else {
            const pos = positionFromClip(width, height, clip, textWidth, titleH);
            titleLeft = pos.left;
            titleTop = pos.top;
          }
          if (asset.right != null) {
            textWidth = Math.max(0, width - titleLeft - Number(asset.right));
          }
          var wrap = asset.wrap !== false;
          var titleObj = {
            type: wrap ? 'textbox' : 'text',
            name: asset.alias || mergeName || 'title_' + clipIndex,
            left: titleLeft,
            top: titleTop,
            text: asset.text,
            fontSize: asset.fontSize != null ? Number(asset.fontSize) : 48,
            fontFamily: (asset.fontFamily != null && typeof asset.fontFamily === 'string') ? asset.fontFamily : 'sans-serif',
            fill: (asset.fill != null && typeof asset.fill === 'string') ? asset.fill : '#000000',
            textBaseline: 'alphabetic',
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsWrapText: wrap,
          };
          if (wrap) {
            titleObj.width = textWidth;
          if (asset.right != null) {
            titleObj.cfsRightPx = Number(asset.right);
          }
          titleObj.cfsResponsive = true;
          titleObj.cfsLeftPct = titleLeft / width;
          titleObj.cfsTopPct = titleTop / height;
          titleObj.cfsWidthPct = textWidth / width;
          titleObj.minWidth = 50;
          titleObj.maxWidth = Math.max(textWidth, width - titleLeft - 20);
          }
          if (asset.fontWeight === 'bold' || asset.fontWeight === 700) titleObj.fontWeight = 'bold';
          if (asset.textAlign) titleObj.textAlign = asset.textAlign;
          if (mergeName) titleObj.cfsMergeKey = mergeName;
          if (asset.animation) {
            titleObj.cfsAnimation = {
              preset: asset.animation.preset || 'fadeIn',
              duration: asset.animation.duration != null ? Number(asset.animation.duration) : undefined,
              style: asset.animation.style,
              direction: asset.animation.direction,
            };
          }
          titleObj.cfsOriginalClip = originalClip;
          addTweenToObject(titleObj, clip);
          objects.push(titleObj);
        }
        if (asset.type === 'rich-text' && asset.text != null) {
          if (asset.alignment && !asset.align) asset.align = asset.alignment;
          const mergeName = mergePlaceholderToName(asset.text);
          const font = asset.font || {};
          let clipW = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : 800);
          let clipH = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : 400);
          /* ShotStack treats empty-text clips with backgrounds as full-canvas overlays
             when their dimensions exceed the canvas in either axis. */
          var isFullCanvasBg = asset.background && typeof asset.background.color === 'string'
            && (!asset.text || asset.text.trim() === '')
            && (clipW > width || clipH > height);
          if (isFullCanvasBg) {
            clipW = width;
            clipH = height;
          }
          let rleft, rtop;
          if (isFullCanvasBg) {
            rleft = 0;
            rtop = 0;
          } else if (asset.left != null && asset.top != null) {
            rleft = Number(asset.left);
            rtop = Number(asset.top);
          } else {
            const pos = positionFromClip(width, height, clip, clipW, clipH);
            rleft = pos.left;
            rtop = pos.top;
          }
          /* Clamp text box to canvas width so text isn't clipped when
             asset.width > canvas (e.g. 1160px box on 1080px canvas). */
          if (clipW > width && !isFullCanvasBg) {
            clipW = width;
            rleft = 0;
          }
          if (asset.padding != null) {
            var pad = asset.padding;
            var padLeft = 0, padTop = 0, padRight = 0;
            if (typeof pad === 'number') { padLeft = padTop = padRight = pad; }
            else if (typeof pad === 'object') {
              padLeft = pad.left != null ? Number(pad.left) : 0;
              padTop = pad.top != null ? Number(pad.top) : 0;
              padRight = pad.right != null ? Number(pad.right) : 0;
            }
            rleft = padLeft;
            rtop = padTop;
            clipW = Math.max(50, width - padLeft - padRight);
          }
          if (asset.right != null) {
            clipW = Math.max(50, width - rleft - Number(asset.right));
          }
          const richMaxW = (asset.right != null || asset.padding != null) ? clipW : Math.max(clipW, width - rleft - 20);
          const richObj = {
            type: 'textbox',
            name: asset.alias || mergeName || 'rich_' + clipIndex,
            left: rleft,
            top: rtop,
            text: asset.text,
            fontSize: (font.size != null ? Number(font.size) : 48),
            fontFamily: (font.family != null && typeof font.family === 'string') ? font.family : 'sans-serif',
            fill: (font.color != null && typeof font.color === 'string') ? font.color : '#000000',
            textBaseline: 'alphabetic',
            selectable: true,
            evented: true,
            width: clipW,
            minWidth: 50,
            maxWidth: richMaxW,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsWrapText: true,
            cfsRichText: true,
          };
          if (mergeName) richObj.cfsMergeKey = mergeName;
          if (asset.right != null) richObj.cfsRightPx = Number(asset.right);
          richObj.cfsResponsive = true;
          richObj.cfsLeftPct = rleft / width;
          richObj.cfsTopPct = rtop / height;
          richObj.cfsWidthPct = clipW / width;
          if (font.weight != null) richObj.fontWeight = (font.weight === 'bold' || font.weight === 800) ? 'bold' : String(font.weight);
          if (font.opacity != null) richObj.opacity = Math.max(0, Math.min(1, Number(font.opacity)));
          /* Clip-level opacity overrides font opacity if set */
          if (clip.opacity != null && !isNaN(Number(clip.opacity))) richObj.opacity = Math.max(0, Math.min(1, Number(clip.opacity)));
          const style = asset.style || {};
          if (style.letterSpacing != null) {
            richObj.cfsLetterSpacing = Number(style.letterSpacing);
            /* Fabric charSpacing is in 1/1000 em; ShotStack letterSpacing is in px */
            var csFontSize = richObj.fontSize || 48;
            richObj.charSpacing = (Number(style.letterSpacing) / csFontSize) * 1000;
          }
          if (style.lineHeight != null) {
            richObj.cfsLineHeight = Number(style.lineHeight);
            richObj.lineHeight = Number(style.lineHeight);
          }
          if (style.textTransform) {
            richObj.cfsTextTransform = style.textTransform;
            /* Apply transform directly to text content */
            if (style.textTransform === 'uppercase' && richObj.text) richObj.text = richObj.text.toUpperCase();
            else if (style.textTransform === 'lowercase' && richObj.text) richObj.text = richObj.text.toLowerCase();
            else if (style.textTransform === 'capitalize' && richObj.text) richObj.text = richObj.text.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          }
          if (style.textDecoration) {
            richObj.cfsTextDecoration = style.textDecoration;
            if (style.textDecoration === 'underline') richObj.underline = true;
            else if (style.textDecoration === 'line-through' || style.textDecoration === 'strikethrough') richObj.linethrough = true;
          }
          if (style.gradient) richObj.cfsGradient = style.gradient;
          if (asset.stroke && (asset.stroke.width || asset.stroke.color)) {
            richObj.cfsStroke = { width: Number(asset.stroke.width) || 0, color: asset.stroke.color || '#000000', opacity: asset.stroke.opacity != null ? Number(asset.stroke.opacity) : 1 };
            /* Apply to Fabric native stroke */
            richObj.stroke = asset.stroke.color || '#000000';
            richObj.strokeWidth = Number(asset.stroke.width) || 0;
          }
          if (asset.shadow && (asset.shadow.offsetX != null || asset.shadow.offsetY != null)) {
            richObj.cfsShadow = {
              offsetX: Number(asset.shadow.offsetX) || 0,
              offsetY: Number(asset.shadow.offsetY) || 0,
              blur: Number(asset.shadow.blur) || 0,
              color: asset.shadow.color || '#000000',
              opacity: asset.shadow.opacity != null ? Number(asset.shadow.opacity) : 0.5,
            };
            /* Apply to Fabric native shadow */
            var _ShadowCtor = (typeof fabric !== 'undefined' && fabric.Shadow) || null;
            var _shadowOpts = {
              offsetX: Number(asset.shadow.offsetX) || 0,
              offsetY: Number(asset.shadow.offsetY) || 0,
              blur: Number(asset.shadow.blur) || 0,
              color: asset.shadow.color || 'rgba(0,0,0,0.5)',
            };
            richObj.shadow = _ShadowCtor ? new _ShadowCtor(_shadowOpts) : _shadowOpts;
          }
          if (asset.align) {
            var hAlign = asset.align.horizontal || 'left';
            var vAlign = asset.align.vertical || 'top';
            richObj.cfsAlignHorizontal = hAlign;
            richObj.cfsAlignVertical = vAlign;
            richObj.textAlign = (hAlign === 'center' ? 'center' : hAlign === 'right' ? 'right' : 'left');
            /* Apply vertical alignment offset to match Pixi's centering logic.
               Estimate text height from fontSize * lineHeight * lineCount. */
            var hasExplicitH = (clip.height != null) || (asset.height != null);
            if (hasExplicitH && clipH > 0 && (vAlign === 'center' || vAlign === 'middle')) {
              var vFontSize = richObj.fontSize || 48;
              var vLineHeight = richObj.lineHeight || 1.16;
              var vLineCount = (richObj.text || '').split('\n').length;
              var vEstTextH = vFontSize * vLineHeight * vLineCount;
              richObj.top = rtop + Math.max(0, (clipH - vEstTextH) / 2);
              richObj.cfsTopPct = richObj.top / height;
            } else if (hasExplicitH && clipH > 0 && vAlign === 'bottom') {
              var vFontSize = richObj.fontSize || 48;
              var vLineHeight = richObj.lineHeight || 1.16;
              var vLineCount = (richObj.text || '').split('\n').length;
              var vEstTextH = vFontSize * vLineHeight * vLineCount;
              richObj.top = rtop + Math.max(0, clipH - vEstTextH);
              richObj.cfsTopPct = richObj.top / height;
            }
          }
          richObj.originX = 'left';
          richObj.originY = 'top';
          if (asset.animation) {
            richObj.cfsAnimation = {
              preset: asset.animation.preset || 'fadeIn',
              duration: asset.animation.duration != null ? Number(asset.animation.duration) : undefined,
              style: asset.animation.style,
              direction: asset.animation.direction,
            };
          }
          if (asset.background && typeof asset.background.color === 'string') {
            richObj.cfsTextBackground = asset.background.color;
            var bgHasExplicitH = (clip.height != null) || (asset.height != null);
            if (bgHasExplicitH && clipH > 0) {
              var bgRect = {
                type: 'rect',
                name: (richObj.name || 'rich_' + clipIndex) + '_bg',
                left: rleft,
                top: rtop,
                width: clipW,
                height: clipH,
                fill: asset.background.color,
                selectable: false,
                evented: false,
                cfsStart: clip.start,
                cfsLength: clipLength,
                cfsLengthWasEnd: clip.length === 'end',
                cfsTrackIndex: trackIdx,
                cfsResponsive: true,
                cfsLeftPct: rleft / width,
                cfsTopPct: rtop / height,
                cfsWidthPct: clipW / width,
                cfsHeightPct: clipH / height,
                cfsTextBgFor: richObj.name,
                cfsOriginalClip: originalClip,
              };
              if (asset.background.borderRadius != null && Number(asset.background.borderRadius) > 0) {
                bgRect.rx = Number(asset.background.borderRadius);
                bgRect.ry = Number(asset.background.borderRadius);
              }
              if (clip._cfsHideOnImage) bgRect.cfsHideOnImage = true;
              if (clip.opacity != null && !isNaN(Number(clip.opacity))) bgRect.opacity = Math.max(0, Math.min(1, Number(clip.opacity)));
              objects.push(bgRect);
            } else {
              richObj.backgroundColor = asset.background.color;
            }
          }
          /* Only set height when template explicitly specifies it. Default clipH (400) clips text tops. */
          const hasExplicitHeight = (clip.height != null) || (asset.height != null);
          if (hasExplicitHeight && clipH > 0) richObj.height = clipH;
          richObj.cfsOriginalClip = originalClip;
          addTweenToObject(richObj, clip);
          objects.push(richObj);
        }
        if (asset.type === 'image' && asset.src) {
          const mergeName = mergePlaceholderToName(asset.src);
          var imgSrc = asset.src;
          if (mergeName && /^\s*\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*$/.test(String(asset.src))) {
            imgSrc = PLACEHOLDER_IMAGE_DATAURL;
          }
          /* ShotStack image/video clips without explicit size are effectively full-frame. */
          var baseImgW = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : width));
          var baseImgH = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : height));
          var imgScale = (clip.scale != null && !isNaN(Number(clip.scale)) && Number(clip.scale) > 0) ? Number(clip.scale) : 1;
          var scaledVisW = baseImgW * imgScale;
          var scaledVisH = baseImgH * imgScale;
          var imgLeft, imgTop;
          if (asset.left != null && asset.top != null) {
            imgLeft = Number(asset.left);
            imgTop = Number(asset.top);
          } else {
            var imgPos = positionFromClip(width, height, clip, scaledVisW, scaledVisH);
            imgLeft = imgPos.left;
            imgTop = imgPos.top;
          }
          var imgW = baseImgW;
          var imgH = baseImgH;
          if (asset.right != null) imgW = Math.max(0, width - imgLeft - Number(asset.right));
          if (asset.bottom != null) imgH = Math.max(0, height - imgTop - Number(asset.bottom));
          var imgObj = {
            type: 'image',
            name: asset.alias || clip.alias || mergeName || 'image_' + clipIndex,
            left: imgLeft,
            top: imgTop,
            src: imgSrc,
            crossOrigin: 'anonymous',
            width: imgW,
            height: imgH,
            scaleX: imgScale,
            scaleY: imgScale,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
          };
          if (mergeName) imgObj.cfsMergeKey = mergeName;
          if (asset.right != null) imgObj.cfsRightPx = Number(asset.right);
          if (asset.bottom != null) imgObj.cfsBottomPx = Number(asset.bottom);
          imgObj.cfsResponsive = true;
          imgObj.cfsLeftPct = imgLeft / width;
          imgObj.cfsTopPct = imgTop / height;
          imgObj.cfsWidthPct = imgW / width;
          imgObj.cfsHeightPct = imgH / height;
          imgObj.cfsOriginalClip = originalClip;
          addTweenToObject(imgObj, clip);
          objects.push(imgObj);
        }
        if (asset.type === 'image-to-video' && asset.src) {
          const itvMergeName = mergePlaceholderToName(asset.src);
          var itvSrc = asset.src;
          if (itvMergeName && /^\s*\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*$/.test(String(asset.src))) {
            itvSrc = PLACEHOLDER_IMAGE_DATAURL;
          }
          var itvW = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : width));
          var itvH = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : height));
          var itvScale = (clip.scale != null && !isNaN(Number(clip.scale)) && Number(clip.scale) > 0) ? Number(clip.scale) : 1;
          var scaledItvW = itvW * itvScale;
          var scaledItvH = itvH * itvScale;
          var itvLeft, itvTop;
          if (asset.left != null && asset.top != null) {
            itvLeft = Number(asset.left);
            itvTop = Number(asset.top);
          } else {
            var itvPos = positionFromClip(width, height, clip, scaledItvW, scaledItvH);
            itvLeft = itvPos.left;
            itvTop = itvPos.top;
          }
          if (asset.right != null) itvW = Math.max(0, width - itvLeft - Number(asset.right));
          if (asset.bottom != null) itvH = Math.max(0, height - itvTop - Number(asset.bottom));
          var itvObj = {
            type: 'image',
            name: asset.alias || clip.alias || itvMergeName || 'itv_' + clipIndex,
            left: itvLeft,
            top: itvTop,
            src: itvSrc,
            crossOrigin: 'anonymous',
            width: itvW,
            height: itvH,
            scaleX: itvScale,
            scaleY: itvScale,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsLengthAuto: clip.length === 'auto',
            cfsTrackIndex: trackIdx,
            cfsImageToVideo: true,
          };
          if (itvMergeName) itvObj.cfsMergeKey = itvMergeName;
          if (asset.prompt) itvObj.cfsItvPrompt = asset.prompt;
          if (asset.aspectRatio) itvObj.cfsItvAspectRatio = asset.aspectRatio;
          if (asset.right != null) itvObj.cfsRightPx = Number(asset.right);
          if (asset.bottom != null) itvObj.cfsBottomPx = Number(asset.bottom);
          itvObj.cfsResponsive = true;
          itvObj.cfsLeftPct = itvLeft / width;
          itvObj.cfsTopPct = itvTop / height;
          itvObj.cfsWidthPct = itvW / width;
          itvObj.cfsHeightPct = itvH / height;
          itvObj.cfsOriginalClip = originalClip;
          addTweenToObject(itvObj, clip);
          objects.push(itvObj);
        }
        if (asset.type === 'video' && (asset.src || asset.url)) {
          const videoSrc = asset.src || asset.url;
          const videoMergeName = mergePlaceholderToName(videoSrc);
          var baseVw = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : width));
          var baseVh = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : height));
          var vidScale = (clip.scale != null && !isNaN(Number(clip.scale)) && Number(clip.scale) > 0) ? Number(clip.scale) : 1;
          var scaledVisVw = baseVw * vidScale;
          var scaledVisVh = baseVh * vidScale;
          let vleft, vtop;
          if (asset.left != null && asset.top != null) {
            vleft = Number(asset.left);
            vtop = Number(asset.top);
          } else {
            var vpos = positionFromClip(width, height, clip, scaledVisVw, scaledVisVh);
            vleft = vpos.left;
            vtop = vpos.top;
          }
          const videoGroup = {
            type: 'group',
            left: vleft,
            top: vtop,
            name: asset.alias || (videoMergeName || 'video_' + clipIndex),
            scaleX: vidScale,
            scaleY: vidScale,
            opacity: (clip.opacity != null && !isNaN(Number(clip.opacity))) ? Number(clip.opacity) : 1,
            selectable: true,
            evented: true,
            cfsVideoSrc: videoSrc,
            cfsStart: (clip.start === 'auto' || clip.start === 'end') ? clip.start : (typeof clip.start === 'number' ? clip.start : 0),
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsLengthAuto: clip.length === 'auto',
            cfsTrackIndex: trackIdx,
            objects: [
              { type: 'rect', width: baseVw, height: baseVh, fill: '#2d3748', opacity: 0, left: 0, top: 0 },
              { type: 'text', text: 'Video', fontSize: 18, fill: '#e2e8f0', opacity: 0.05, originX: 'center', originY: 'center', left: baseVw / 2, top: baseVh / 2 },
            ],
          };
          videoGroup.cfsVideoWidth = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : baseVw);
          videoGroup.cfsVideoHeight = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : baseVh);
          if (asset.volume != null && !isNaN(Number(asset.volume))) videoGroup.cfsVideoVolume = Number(asset.volume);
          if (clip.fadeIn != null && !isNaN(Number(clip.fadeIn))) videoGroup.cfsFadeIn = Math.max(0, Number(clip.fadeIn));
          if (clip.fadeOut != null && !isNaN(Number(clip.fadeOut))) videoGroup.cfsFadeOut = Math.max(0, Number(clip.fadeOut));
          if (asset.chromaKey && typeof asset.chromaKey === 'object') {
            videoGroup.cfsChromaKey = { color: asset.chromaKey.color, threshold: asset.chromaKey.threshold, halo: asset.chromaKey.halo };
          }
          if (videoMergeName) videoGroup.cfsMergeKey = videoMergeName;
          videoGroup.cfsOriginalClip = originalClip;
          addTweenToObject(videoGroup, clip);
          objects.push(videoGroup);
        }
        if (asset.type === 'rect') {
          let rw = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : 400));
          let rh = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : 300));
          const rfill = (asset.fill != null && typeof asset.fill === 'string') ? asset.fill : '#eeeeee';
          let rleft, rtop;
          if (asset.left != null && asset.top != null) {
            rleft = Number(asset.left);
            rtop = Number(asset.top);
          } else {
            var rpos = positionFromClip(width, height, clip, rw, rh);
            rleft = rpos.left;
            rtop = rpos.top;
          }
          if (asset.right != null) rw = Math.max(0, width - rleft - Number(asset.right));
          if (asset.bottom != null) rh = Math.max(0, height - rtop - Number(asset.bottom));
          var rectObj = {
            type: 'rect',
            name: asset.alias || 'rect_' + clipIndex,
            left: rleft,
            top: rtop,
            width: rw,
            height: rh,
            fill: rfill,
            rx: asset.rx != null ? Number(asset.rx) : 0,
            ry: asset.ry != null ? Number(asset.ry) : 0,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
          };
          if (asset.stroke != null && typeof asset.stroke === 'string') rectObj.stroke = asset.stroke;
          if (asset.strokeWidth != null) rectObj.strokeWidth = Number(asset.strokeWidth);
          if (asset.right != null) rectObj.cfsRightPx = Number(asset.right);
          if (asset.bottom != null) rectObj.cfsBottomPx = Number(asset.bottom);
          rectObj.cfsResponsive = true;
          rectObj.cfsLeftPct = rleft / width;
          rectObj.cfsTopPct = rtop / height;
          rectObj.cfsWidthPct = rw / width;
          rectObj.cfsHeightPct = rh / height;
          rectObj.cfsOriginalClip = originalClip;
          addTweenToObject(rectObj, clip);
          objects.push(rectObj);
        }
        if (asset.type === 'circle') {
          const radius = asset.radius != null ? Number(asset.radius) : 20;
          const cfill = (asset.fill != null && typeof asset.fill === 'string') ? asset.fill : '#cccccc';
          const cw = radius * 2;
          const ch = radius * 2;
          let cleft, ctop;
          if (asset.left != null && asset.top != null) {
            cleft = Number(asset.left);
            ctop = Number(asset.top);
          } else {
            var cpos = positionFromClip(width, height, clip, cw, ch);
            cleft = cpos.left;
            ctop = cpos.top;
          }
          const circleObj = {
            type: 'circle',
            name: asset.alias || 'circle_' + clipIndex,
            left: cleft,
            top: ctop,
            radius: radius,
            fill: cfill,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
          };
          circleObj.cfsResponsive = true;
          circleObj.cfsLeftPct = cleft / width;
          circleObj.cfsTopPct = ctop / height;
          circleObj.cfsRadiusPct = radius / Math.min(width, height);
          circleObj.cfsOriginalClip = originalClip;
          addTweenToObject(circleObj, clip);
          objects.push(circleObj);
        }
        if (asset.type === 'svg' && asset.src && typeof asset.src === 'string') {
          var svgW = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : 400));
          var svgH = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : 300));
          var svgLeft, svgTop;
          if (asset.left != null && asset.top != null) {
            svgLeft = Number(asset.left);
            svgTop = Number(asset.top);
          } else {
            var svgPos = positionFromClip(width, height, clip, svgW, svgH);
            svgLeft = svgPos.left;
            svgTop = svgPos.top;
          }
          var svgDataUrl = '';
          try {
            if (typeof btoa !== 'undefined') {
              svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(asset.src)));
            }
          } catch (e) { console.warn('SVG base64 encoding failed for clip', asset.alias || clipIndex, e); }
          var svgObj = {
            type: 'image',
            name: asset.alias || 'svg_' + clipIndex,
            left: svgLeft,
            top: svgTop,
            crossOrigin: 'anonymous',
            width: svgW,
            height: svgH,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsSvgSrc: asset.src,
          };
          if (svgDataUrl) svgObj.src = svgDataUrl;
          svgObj.cfsOriginalClip = originalClip;
          addTweenToObject(svgObj, clip);
          objects.push(svgObj);
        }
        if (asset.type === 'shape' && asset.shape === 'rectangle' && asset.rectangle) {
          let shapeRW = Number(asset.rectangle.width) || 400;
          let shapeRH = Number(asset.rectangle.height) || 300;
          const shapeRCorner = Number(asset.rectangle.cornerRadius) || 0;
          const shapeFill = asset.fill && typeof asset.fill === 'object' ? asset.fill : {};
          const shapeFillColor = typeof shapeFill.color === 'string' ? shapeFill.color : (typeof asset.fill === 'string' ? asset.fill : '#eeeeee');
          const shapeStroke = asset.stroke && typeof asset.stroke === 'object' ? asset.stroke : {};
          let shapeRLeft, shapeRTop;
          if (asset.left != null && asset.top != null) { shapeRLeft = Number(asset.left); shapeRTop = Number(asset.top); }
          else { var srpos = positionFromClip(width, height, clip, shapeRW, shapeRH); shapeRLeft = srpos.left; shapeRTop = srpos.top; }
          if (asset.right != null) shapeRW = Math.max(0, width - shapeRLeft - Number(asset.right));
          if (asset.bottom != null) shapeRH = Math.max(0, height - shapeRTop - Number(asset.bottom));
          var shapeRectObj = {
            type: 'rect', name: asset.alias || clip.alias || 'shape_rect_' + clipIndex,
            left: shapeRLeft, top: shapeRTop, width: shapeRW, height: shapeRH,
            fill: shapeFillColor, rx: shapeRCorner, ry: shapeRCorner,
            selectable: true, evented: true,
            cfsStart: clip.start, cfsLength: clipLength, cfsLengthWasEnd: clip.length === 'end', cfsTrackIndex: trackIdx,
          };
          if (shapeFill.opacity != null) shapeRectObj.opacity = Math.max(0, Math.min(1, Number(shapeFill.opacity)));
          if (shapeStroke.color) shapeRectObj.stroke = shapeStroke.color;
          if (shapeStroke.width != null) shapeRectObj.strokeWidth = Number(shapeStroke.width);
          if (asset.right != null) shapeRectObj.cfsRightPx = Number(asset.right);
          if (asset.bottom != null) shapeRectObj.cfsBottomPx = Number(asset.bottom);
          shapeRectObj.cfsResponsive = true;
          shapeRectObj.cfsLeftPct = shapeRLeft / width;
          shapeRectObj.cfsTopPct = shapeRTop / height;
          shapeRectObj.cfsWidthPct = shapeRW / width;
          shapeRectObj.cfsHeightPct = shapeRH / height;
          shapeRectObj.cfsOriginalClip = originalClip;
          addTweenToObject(shapeRectObj, clip);
          objects.push(shapeRectObj);
        }
        if (asset.type === 'shape' && asset.shape === 'circle' && asset.circle) {
          const shapeCR = Number(asset.circle.radius) || 50;
          const shapeCFill = asset.fill && typeof asset.fill === 'object' ? asset.fill : {};
          const shapeCFillColor = typeof shapeCFill.color === 'string' ? shapeCFill.color : (typeof asset.fill === 'string' ? asset.fill : '#cccccc');
          const shapeCStroke = asset.stroke && typeof asset.stroke === 'object' ? asset.stroke : {};
          let shapeCLeft, shapeCTop;
          if (asset.left != null && asset.top != null) { shapeCLeft = Number(asset.left); shapeCTop = Number(asset.top); }
          else { var scpos = positionFromClip(width, height, clip, shapeCR * 2, shapeCR * 2); shapeCLeft = scpos.left; shapeCTop = scpos.top; }
          var shapeCirObj = {
            type: 'circle', name: asset.alias || clip.alias || 'shape_circle_' + clipIndex,
            left: shapeCLeft, top: shapeCTop, radius: shapeCR, fill: shapeCFillColor,
            selectable: true, evented: true,
            cfsStart: clip.start, cfsLength: clipLength, cfsLengthWasEnd: clip.length === 'end', cfsTrackIndex: trackIdx,
          };
          if (shapeCFill.opacity != null) shapeCirObj.opacity = Math.max(0, Math.min(1, Number(shapeCFill.opacity)));
          if (shapeCStroke.color) shapeCirObj.stroke = shapeCStroke.color;
          if (shapeCStroke.width != null) shapeCirObj.strokeWidth = Number(shapeCStroke.width);
          shapeCirObj.cfsResponsive = true;
          shapeCirObj.cfsLeftPct = shapeCLeft / width;
          shapeCirObj.cfsTopPct = shapeCTop / height;
          shapeCirObj.cfsRadiusPct = shapeCR / Math.min(width, height);
          shapeCirObj.cfsOriginalClip = originalClip;
          addTweenToObject(shapeCirObj, clip);
          objects.push(shapeCirObj);
        }
        if (asset.type === 'shape' && asset.shape === 'line' && asset.line) {
          const lineLen = Number(asset.line.length) || 100;
          const lineThick = Number(asset.line.thickness) || 4;
          const fillObj = asset.fill && typeof asset.fill === 'object' ? asset.fill : { color: '#ffffff', opacity: 1 };
          const fillColor = (fillObj && typeof fillObj.color === 'string') ? fillObj.color : (typeof asset.fill === 'string' ? asset.fill : '#ffffff');
          const strokeObj = asset.stroke && typeof asset.stroke === 'object' ? asset.stroke : {};
          const strokeColor = (strokeObj && typeof strokeObj.color === 'string') ? strokeObj.color : (typeof asset.stroke === 'string' ? asset.stroke : '');
          const strokeW = strokeObj && (strokeObj.width != null) ? Number(strokeObj.width) : 0;
          const transform = clip.transform || {};
          const rotate = transform.rotate && transform.rotate.angle != null ? Number(transform.rotate.angle) : 0;
          let lineLeft, lineTop;
          if (asset.left != null && asset.top != null) {
            lineLeft = Number(asset.left);
            lineTop = Number(asset.top);
          } else {
            const linePos = positionFromClip(width, height, clip, lineLen, lineThick);
            lineLeft = linePos.left;
            lineTop = linePos.top;
          }
          const lineRect = {
            type: 'rect',
            name: asset.alias || 'line_' + clipIndex,
            left: lineLeft + lineLen / 2,
            top: lineTop + lineThick / 2,
            originX: 'center',
            originY: 'center',
            width: lineLen,
            height: lineThick,
            fill: fillColor,
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsShapeLine: true,
            cfsLineLength: lineLen,
            cfsLineThickness: lineThick,
          };
          if (fillObj && fillObj.opacity != null) lineRect.opacity = Math.max(0, Math.min(1, Number(fillObj.opacity)));
          if (strokeColor && strokeW > 0) {
            lineRect.stroke = strokeColor;
            lineRect.strokeWidth = strokeW;
          }
          if (rotate !== 0) lineRect.angle = rotate;
          var isVerticalLine = (rotate === 90 || rotate === 270 || rotate === -90 || rotate === -270);
          lineRect.cfsResponsive = true;
          lineRect.cfsLeftPct = (lineLeft + lineLen / 2) / width;
          lineRect.cfsTopPct = (lineTop + lineThick / 2) / height;
          if (isVerticalLine) {
            lineRect.cfsWidthPct = lineLen / height;
            lineRect.cfsHeightPct = lineThick / width;
          } else {
            lineRect.cfsWidthPct = lineLen / width;
            lineRect.cfsHeightPct = lineThick / height;
          }
          lineRect.cfsOriginalClip = originalClip;
          addTweenToObject(lineRect, clip);
          objects.push(lineRect);
        }
        if (asset.type === 'text-to-image') {
          var ttiW = (clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : width));
          var ttiH = (clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : height));
          var scaledTti = applyClipScale(ttiW, ttiH, clip);
          ttiW = scaledTti.w;
          ttiH = scaledTti.h;
          var ttiPos = positionFromClip(width, height, clip, ttiW, ttiH);
          var ttiMergeName = asset.prompt ? mergePlaceholderToName(asset.prompt) : null;
          var ttiLabel = ttiMergeName || (asset.prompt ? String(asset.prompt).slice(0, 40) : 'AI Image');
          var ttiObj = {
            type: 'rect',
            name: asset.alias || clip.alias || ttiMergeName || 'tti_' + clipIndex,
            left: ttiPos.left,
            top: ttiPos.top,
            width: ttiW,
            height: ttiH,
            fill: '#2a2a3a',
            selectable: true,
            evented: true,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
          };
          ttiObj.cfsResponsive = true;
          ttiObj.cfsLeftPct = ttiPos.left / width;
          ttiObj.cfsTopPct = ttiPos.top / height;
          ttiObj.cfsWidthPct = ttiW / width;
          ttiObj.cfsHeightPct = ttiH / height;
          ttiObj.cfsOriginalClip = originalClip;
          if (ttiMergeName) ttiObj.cfsMergeKey = ttiMergeName;
          addTweenToObject(ttiObj, clip);
          objects.push(ttiObj);
        }
        if (asset.type === 'text-to-speech') {
          /* Non-visual: store as metadata for the timeline and audio pipeline. */
          var ttsAlias = asset.alias || clip.alias || 'tts_' + clipIndex;
          var ttsMergeName = asset.text ? mergePlaceholderToName(asset.text) : null;
          var ttsObj = {
            type: 'rect',
            name: ttsAlias,
            left: 0, top: 0, width: 0, height: 0,
            fill: 'transparent',
            opacity: 0,
            selectable: false,
            evented: false,
            visible: false,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsAudioType: 'text-to-speech',
            cfsTtsVoice: asset.voice || 'Amy',
            cfsTtsLocalVoice: asset.localVoice || '',
            cfsTtsText: asset.text || '',
          };
          if (ttsMergeName) ttsObj.cfsMergeKey = ttsMergeName;
          ttsObj.cfsOriginalClip = originalClip;
          objects.push(ttsObj);
        }
        if (asset.type === 'caption' || asset.type === 'rich-caption') {
          var capFont = asset.font || {};
          var capBg = asset.background || {};
          var capW = clip.width != null ? Number(clip.width) : (asset.width != null ? Number(asset.width) : Math.round(width * 0.85));
          var capH = clip.height != null ? Number(clip.height) : (asset.height != null ? Number(asset.height) : 80);
          var capPos = positionFromClip(width, height, clip, capW, capH);
          if (!clip.position && !clip.offset) {
            capPos.top = height - capH - 40;
            capPos.left = (width - capW) / 2;
          }
          var capObj = {
            type: 'textbox',
            name: asset.alias || clip.alias || 'caption_' + clipIndex,
            left: capPos.left,
            top: capPos.top,
            text: '[caption]',
            width: capW,
            fontSize: capFont.size != null ? Number(capFont.size) : 36,
            fontFamily: (capFont.family && typeof capFont.family === 'string') ? capFont.family : 'sans-serif',
            fill: (capFont.color && typeof capFont.color === 'string') ? capFont.color : '#ffffff',
            textAlign: 'center',
            textBaseline: 'alphabetic',
            selectable: true,
            evented: true,
            minWidth: 50,
            maxWidth: capW,
            cfsStart: clip.start,
            cfsLength: clipLength,
            cfsLengthWasEnd: clip.length === 'end',
            cfsTrackIndex: trackIdx,
            cfsWrapText: true,
            cfsIsCaption: true,
          };
          if (capBg.color && typeof capBg.color === 'string') {
            var capBgOpacity = capBg.opacity != null ? Number(capBg.opacity) : 1;
            if (capBgOpacity <= 0) {
              /* Fully transparent — don't set backgroundColor at all */
            } else if (capBgOpacity < 1) {
              /* Convert hex to rgba */
              var _r = parseInt(capBg.color.slice(1, 3), 16) || 0;
              var _g = parseInt(capBg.color.slice(3, 5), 16) || 0;
              var _b = parseInt(capBg.color.slice(5, 7), 16) || 0;
              capObj.backgroundColor = 'rgba(' + _r + ',' + _g + ',' + _b + ',' + capBgOpacity.toFixed(2) + ')';
              capObj.cfsTextBackground = capBg.color;
            } else {
              capObj.backgroundColor = capBg.color;
              capObj.cfsTextBackground = capBg.color;
            }
            capObj.cfsCaptionBgOpacity = capBgOpacity;
          }
          if (capBg.padding != null) capObj.cfsCaptionPadding = Number(capBg.padding);
          if (capBg.borderRadius != null) capObj.cfsCaptionBorderRadius = Number(capBg.borderRadius);
          if (asset.src) capObj.cfsCaptionSrc = asset.src;
          capObj.cfsResponsive = true;
          capObj.cfsLeftPct = capPos.left / width;
          capObj.cfsTopPct = capPos.top / height;
          capObj.cfsWidthPct = capW / width;
          capObj.cfsOriginalClip = originalClip;
          /* Store word timing + active styling for live-seek karaoke rendering */
          if (Array.isArray(asset.words) && asset.words.length) {
            capObj.cfsCaptionWords = asset.words;
          }
          if (asset.active) capObj.cfsCaptionActive = asset.active;
          if (asset.font) capObj.cfsCaptionFont = asset.font;
          if (asset.animation) capObj.cfsCaptionAnimation = asset.animation;
          if (asset.display) capObj.cfsCaptionDisplay = asset.display;
          addTweenToObject(capObj, clip);
          objects.push(capObj);
        }
        if (asset.type === 'html') {
          var htmlW = asset.width != null ? Number(asset.width) : 400;
          var htmlH = asset.height != null ? Number(asset.height) : 300;
          var parsedCss = parseHtmlClipCss(asset.css);
          var htmlText = extractTextFromHtml(asset.html);
          var htmlPos = positionFromClip(width, height, clip, htmlW, htmlH);
          var htmlLeft = htmlPos.left;
          var htmlTop = htmlPos.top;
          var isHtmlRect = !!asset.background || parsedCss.fontSize <= 1;
          if (isHtmlRect) {
            var htmlFill = asset.background || parsedCss.color || '#cccccc';
            var htmlRectObj = {
              type: 'rect',
              name: asset.alias || clip.alias || 'html_' + clipIndex,
              left: htmlLeft,
              top: htmlTop,
              width: htmlW,
              height: htmlH,
              fill: htmlFill,
              selectable: true,
              evented: true,
              cfsStart: clip.start,
              cfsLength: clipLength,
              cfsLengthWasEnd: clip.length === 'end',
              cfsTrackIndex: trackIdx,
              cfsHtmlType: 'rect',
            };
            if (clip.opacity != null && typeof clip.opacity === 'number') {
              htmlRectObj.opacity = Math.max(0, Math.min(1, clip.opacity));
            }
            htmlRectObj.cfsResponsive = true;
            htmlRectObj.cfsLeftPct = htmlLeft / width;
            htmlRectObj.cfsTopPct = htmlTop / height;
            htmlRectObj.cfsWidthPct = htmlW / width;
            htmlRectObj.cfsHeightPct = htmlH / height;
            htmlRectObj.cfsOriginalClip = originalClip;
            addTweenToObject(htmlRectObj, clip);
            objects.push(htmlRectObj);
          } else {
            var htmlMergeName = mergePlaceholderToName(htmlText);
            var htmlTextObj = {
              type: 'textbox',
              name: asset.alias || clip.alias || htmlMergeName || 'html_text_' + clipIndex,
              left: htmlLeft,
              top: htmlTop,
              text: htmlText,
              fontSize: parsedCss.fontSize,
              fontFamily: parsedCss.fontFamily,
              fontWeight: parsedCss.fontWeight || 'normal',
              fill: parsedCss.color,
              textAlign: parsedCss.textAlign,
              textBaseline: 'alphabetic',
              selectable: true,
              evented: true,
              width: htmlW,
              minWidth: 50,
              maxWidth: Math.max(htmlW, width - htmlLeft - 20),
              cfsStart: clip.start,
              cfsLength: clipLength,
              cfsLengthWasEnd: clip.length === 'end',
              cfsTrackIndex: trackIdx,
              cfsWrapText: true,
              cfsHtmlType: 'text',
            };
            if (parsedCss.backgroundColor) {
              var htmlBgRect = {
                type: 'rect',
                name: (asset.alias || clip.alias || 'html_bg_' + clipIndex),
                left: htmlLeft,
                top: htmlTop,
                width: htmlW,
                height: htmlH,
                fill: parsedCss.backgroundColor,
                selectable: false,
                evented: false,
                cfsStart: clip.start,
                cfsLength: clipLength,
                cfsLengthWasEnd: clip.length === 'end',
                cfsTrackIndex: trackIdx,
                cfsHtmlType: 'rect',
              };
              htmlBgRect.cfsResponsive = true;
              htmlBgRect.cfsLeftPct = htmlLeft / width;
              htmlBgRect.cfsTopPct = htmlTop / height;
              htmlBgRect.cfsWidthPct = htmlW / width;
              htmlBgRect.cfsHeightPct = htmlH / height;
              htmlBgRect.cfsOriginalClip = originalClip;
              addTweenToObject(htmlBgRect, clip);
              objects.push(htmlBgRect);
              var textYCenter = Math.max(0, (htmlH - parsedCss.fontSize) / 2);
              htmlTextObj.top = htmlTop + textYCenter;
            }
            if (htmlMergeName) htmlTextObj.cfsMergeKey = htmlMergeName;
            htmlTextObj.cfsResponsive = true;
            htmlTextObj.cfsLeftPct = htmlLeft / width;
            htmlTextObj.cfsTopPct = htmlTop / height;
            htmlTextObj.cfsWidthPct = htmlW / width;
            htmlTextObj.cfsOriginalClip = originalClip;
            addTweenToObject(htmlTextObj, clip);
            objects.push(htmlTextObj);
          }
        }
        clipIndex += 1;
      });
    })(tracks[_ti], _ti); }
    var bgObj = objects[0];
    if (bgObj && bgObj.name === 'background') {
      bgObj.cfsTrackIndex = tracks.length;
      bgObj.cfsStart = 0;
      bgObj.cfsLength = timelineEndSec;
      bgObj.cfsLengthWasEnd = true;
    }
    return { width, height, objects };
  }

  // --- Timeline pipeline ---

  /**
   * Get timeline (duration and clips) from canvas objects with cfsStart/cfsLength.
   * Returns { durationSec: number, clips: Array<{ start, length, name, objectIndex }> }.
   */
  function getTimelineFromCanvas(canvas) {
    if (!canvas || !canvas.getObjects) return { durationSec: 0, clips: [] };
    const objects = canvas.getObjects();
    const defaultDuration = 5;
    let end = 0;
    const clips = [];
    objects.forEach(function (obj, i) {
      const start = obj.cfsStart != null ? obj.cfsStart : end;
      const length = obj.cfsLength != null ? obj.cfsLength : defaultDuration;
      end = Math.max(end, start + length);
      clips.push({
        start: start,
        length: length,
        name: obj.name || obj.id || ('obj_' + i),
        objectIndex: i,
      });
    });
    return { durationSec: end || defaultDuration, clips };
  }

  /**
   * Seek canvas to a time (seconds). Objects with cfsStart/cfsLength are shown only when
   * timeSec is in [start, start+length); objects without timing are always visible.
   * Also applies cfsAnimation effects (typewriter, fadeIn, slideIn, etc.) to Fabric objects.
   */
  function seekToTime(canvas, timeSec, opts) {
    if (!canvas || !canvas.getObjects) return;
    opts = opts || {};
    var ignoreClipTiming = !!opts.ignoreClipTiming;
    const objects = canvas.getObjects();
    objects.forEach(function (obj) {
      const hasTiming = obj.cfsStart != null && obj.cfsLength != null;
      const start = obj.cfsStart != null ? obj.cfsStart : 0;
      const length = obj.cfsLength != null ? obj.cfsLength : 0;
      const visible = ignoreClipTiming ? true : (!hasTiming || (timeSec >= start && timeSec < start + length));
      if (obj.set && obj.visible !== visible) obj.set('visible', visible);
      if (visible) {
        captureBaseState(obj);
        applyTransitionAtTime(obj, timeSec, start, length);
        applyEffectAtTime(obj, timeSec, start, length);
        applyAnimationAtTime(obj, timeSec, start, length);
      } else {
        restoreBaseState(obj);
      }
    });
    /* ── Active-word caption highlighting ── */
    objects.forEach(function (obj) {
      /* Promote caption data from cfsOriginalClip.asset if top-level props are missing
         (loadFromJSON doesn't persist custom properties not in Fabric's class definition,
          but cfsOriginalClip survives because it's a serialized deep object) */
      if (!obj.cfsIsCaption && obj.cfsOriginalClip && obj.cfsOriginalClip.asset) {
        var origAsset = obj.cfsOriginalClip.asset;
        if (origAsset.type === 'caption' || origAsset.type === 'rich-caption') {
          obj.cfsIsCaption = true;
          if (Array.isArray(origAsset.words) && origAsset.words.length) obj.cfsCaptionWords = origAsset.words;
          if (origAsset.active) obj.cfsCaptionActive = origAsset.active;
          if (origAsset.font) obj.cfsCaptionFont = origAsset.font;
          if (origAsset.animation) obj.cfsCaptionAnimation = origAsset.animation;
          if (origAsset.display) obj.cfsCaptionDisplay = origAsset.display;
        }
      }
      if (!obj.cfsIsCaption || !obj.cfsCaptionWords || !obj.cfsCaptionWords.length) return;
      if (!obj.visible) return;
      var clipStart = obj.cfsStart != null ? obj.cfsStart : 0;
      var localTime = timeSec - clipStart;
      var words = obj.cfsCaptionWords;
      var anim = (obj.cfsCaptionAnimation && obj.cfsCaptionAnimation.style) || 'karaoke';
      var activeStyle = obj.cfsCaptionActive || {};
      var activeFontColor = (activeStyle.font && activeStyle.font.color) ? activeStyle.font.color : '#efbf04';
      var activeBgColor = (activeStyle.font && activeStyle.font.background) ? activeStyle.font.background : null;
      var activeBgOpacity = (activeStyle.font && activeStyle.font.backgroundOpacity != null) ? activeStyle.font.backgroundOpacity : 1;
      var baseFontColor = (obj.cfsCaptionFont && obj.cfsCaptionFont.color) ? obj.cfsCaptionFont.color : (obj.fill || '#ffffff');
      var baseFontBg = (obj.cfsCaptionFont && obj.cfsCaptionFont.background) ? obj.cfsCaptionFont.background : null;
      var baseFontBgOpacity = (obj.cfsCaptionFont && obj.cfsCaptionFont.backgroundOpacity != null) ? obj.cfsCaptionFont.backgroundOpacity : 1;

      /* Helper to convert hex + opacity to rgba string */
      function hexToRgba(hex, opacity) {
        if (!hex) return null;
        if (opacity >= 1) return hex;
        var r = 0, g = 0, b = 0;
        if (hex.length === 7) {
          r = parseInt(hex.slice(1, 3), 16);
          g = parseInt(hex.slice(3, 5), 16);
          b = parseInt(hex.slice(5, 7), 16);
        } else if (hex.length === 4) {
          r = parseInt(hex[1] + hex[1], 16);
          g = parseInt(hex[2] + hex[2], 16);
          b = parseInt(hex[3] + hex[3], 16);
        }
        return 'rgba(' + r + ',' + g + ',' + b + ',' + opacity.toFixed(2) + ')';
      }

      /* Find active word at current time */
      var activeIdx = -1;
      for (var wi = 0; wi < words.length; wi++) {
        if (localTime >= words[wi].start && localTime < words[wi].end) { activeIdx = wi; break; }
      }
      if (activeIdx < 0) {
        for (var wi2 = words.length - 1; wi2 >= 0; wi2--) {
          if (localTime >= words[wi2].end) { activeIdx = wi2; break; }
        }
      }

      /* Display window: SRT-style fixed chunks.
         Each chunk stays visible until its last word finishes,
         then advances to the next chunk.
         Configurable via cfsCaptionDisplay: { wordsPerLine, lines } */
      var capDisplay = obj.cfsCaptionDisplay || {};
      var WORDS_PER_LINE = capDisplay.wordsPerLine || 4;
      var NUM_LINES = capDisplay.lines || 2;
      var CHUNK_SIZE = WORDS_PER_LINE * NUM_LINES;
      var numChunks = Math.ceil(words.length / CHUNK_SIZE);
      /* Always determine chunk by TIME, not word index.
         This prevents flicker at chunk boundaries when the fallback activeIdx
         points to the last word of a previous chunk. */
      var activeChunk = 0;
      for (var ci = numChunks - 1; ci >= 0; ci--) {
        var chunkFirstWord = words[ci * CHUNK_SIZE];
        if (chunkFirstWord && localTime >= chunkFirstWord.start) { activeChunk = ci; break; }
      }
      var windowStart = activeChunk * CHUNK_SIZE;
      var windowEnd = Math.min(windowStart + CHUNK_SIZE - 1, words.length - 1);
      /* Gap handling: if time is past current chunk's last word but before
         next chunk's first word, stay on current chunk to prevent flicker */
      var lastWordInChunk = words[windowEnd];
      if (lastWordInChunk && localTime >= lastWordInChunk.end && activeChunk < numChunks - 1) {
        var nextFirst = words[(activeChunk + 1) * CHUNK_SIZE];
        if (nextFirst && localTime >= nextFirst.start) {
          /* Advance to next chunk */
          windowStart = (activeChunk + 1) * CHUNK_SIZE;
          windowEnd = Math.min(windowStart + CHUNK_SIZE - 1, words.length - 1);
        }
        /* else: stay on current chunk (in the gap) */
      }

      /* Build display text with line breaks at wordsPerLine boundary */
      var displayParts = [];
      for (var d = windowStart; d <= windowEnd; d++) {
        displayParts.push(words[d].text);
        /* Insert newline after every WORDS_PER_LINE words (except after the last word) */
        if ((d - windowStart + 1) % WORDS_PER_LINE === 0 && d < windowEnd) {
          displayParts.push('\n');
        }
      }
      var displayText = displayParts.join(' ').replace(/ \n /g, '\n');
      if (obj.set && obj.text !== displayText) {
        /* Save original width/center before any shrinking */
        if (obj._cfsOrigWidth == null) obj._cfsOrigWidth = obj.width;
        if (obj._cfsOrigCenterX == null) obj._cfsOrigCenterX = (obj.left || 0) + (obj.width || 0) / 2;
        /* Restore full width before setting text so words don't get clipped by previous shrink */
        if (obj._cfsOrigWidth && obj.width < obj._cfsOrigWidth) {
          obj.set('width', obj._cfsOrigWidth);
          obj.set('left', obj._cfsOrigCenterX - obj._cfsOrigWidth / 2);
        }
        obj.set('text', displayText);
        if (typeof obj.initDimensions === 'function') obj.initDimensions();
        /* Auto-shrink width to fit text so background doesn't extend beyond words.
           Re-center horizontally so the caption stays centered on the canvas. */
        var padding = (obj.cfsCaptionPadding || 0) * 2;
        var calcWidth = (obj.calcTextWidth ? obj.calcTextWidth() : obj.width) + padding + 8;
        var newWidth = Math.min(obj._cfsOrigWidth, Math.max(50, calcWidth));
        if (Math.abs(obj.width - newWidth) > 2) {
          obj.set('width', newWidth);
          obj.set('left', obj._cfsOrigCenterX - newWidth / 2);
          if (typeof obj.initDimensions === 'function') obj.initDimensions();
        }
      }

      /* Apply character-level styles via obj.styles (Fabric.js rendering API) */
      if (anim !== 'none') {
        /* Compute active word character range in the flat display text */
        var activeCharStart = -1, activeCharEnd = -1;
        if (activeIdx >= windowStart && activeIdx <= windowEnd) {
          var charOffset = 0;
          for (var ci = windowStart; ci < activeIdx; ci++) charOffset += words[ci].text.length + 1;
          activeCharStart = charOffset;
          activeCharEnd = charOffset + words[activeIdx].text.length;
        }

        /* Compute per-word char ranges for styles that need them */
        var wordCharRanges = [];
        var wco = 0;
        for (var wr = windowStart; wr <= windowEnd; wr++) {
          wordCharRanges.push({ start: wco, end: wco + words[wr].text.length, wordIdx: wr });
          wco += words[wr].text.length + 1; /* +1 for space */
        }

        /* Typewriter: compute how many chars should be visible */
        var twVisibleChars = -1;
        if (anim === 'typewriter') {
          var totalDisplayChars = displayText.length;
          var twFirstStart = words[windowStart].start;
          var twLastEnd = words[windowEnd].end;
          var twSpan = Math.max(0.1, twLastEnd - twFirstStart);
          var twProgress = Math.min(1, Math.max(0, (localTime - twFirstStart) / twSpan));
          twVisibleChars = Math.floor(twProgress * totalDisplayChars);
        }

        /* Use Fabric's internal wrapped lines to build correctly-indexed styles */
        var wrappedLines = obj._textLines || [displayText];
        var charStyles = {};
        var flatIdx = 0;
        for (var li = 0; li < wrappedLines.length; li++) {
          var lineLen = Array.isArray(wrappedLines[li]) ? wrappedLines[li].length : (typeof wrappedLines[li] === 'string' ? wrappedLines[li].length : 0);
          var lineChars = {};
          for (var ch = 0; ch < lineLen; ch++) {
            var isActiveChar = (flatIdx >= activeCharStart && flatIdx < activeCharEnd);
            var charStyle = {};

            switch (anim) {
              case 'karaoke':
                if (isActiveChar) {
                  charStyle.fill = activeFontColor;
                } else {
                  charStyle.fill = baseFontColor;
                }
                break;

              case 'highlight':
                charStyle.fill = baseFontColor;
                if (isActiveChar) {
                  charStyle.textBackgroundColor = activeBgColor ? hexToRgba(activeBgColor, activeBgOpacity) : activeFontColor;
                  charStyle.fill = activeFontColor;
                } else if (baseFontBg) {
                  charStyle.textBackgroundColor = hexToRgba(baseFontBg, baseFontBgOpacity);
                }
                break;

              case 'pop':
                if (isActiveChar) {
                  /* Simulate pop with larger font size */
                  var popWord = words[activeIdx];
                  var popT = 0;
                  if (popWord.end > popWord.start) popT = Math.min(1, (localTime - popWord.start) / ((popWord.end - popWord.start) * 0.3));
                  var popScale = popT < 1 ? (1 + 0.25 * Math.sin(popT * Math.PI)) : 1;
                  var baseFontSize = obj.fontSize || 34;
                  charStyle.fontSize = Math.round(baseFontSize * popScale);
                  charStyle.fill = activeFontColor;
                } else {
                  charStyle.fill = baseFontColor;
                }
                break;

              case 'fade':
                /* Words before active: full opacity; active: fading in; future: dim */
                var fadeWordIdx = -1;
                for (var fw = 0; fw < wordCharRanges.length; fw++) {
                  if (flatIdx >= wordCharRanges[fw].start && flatIdx < wordCharRanges[fw].end) { fadeWordIdx = wordCharRanges[fw].wordIdx; break; }
                }
                if (fadeWordIdx >= 0 && fadeWordIdx < activeIdx) {
                  charStyle.fill = baseFontColor;
                } else if (isActiveChar) {
                  charStyle.fill = activeFontColor;
                } else {
                  /* Future words: dim */
                  charStyle.fill = baseFontColor;
                  charStyle.opacity = 0.15;
                  /* Fabric doesn't have per-char opacity, use a dimmed color */
                  var bc = baseFontColor || '#ffffff';
                  if (bc === '#ffffff' || bc === 'white') charStyle.fill = '#333333';
                  else charStyle.fill = '#444444';
                }
                break;

              case 'slide':
                if (isActiveChar) {
                  charStyle.fill = activeFontColor;
                  /* Fabric doesn't support per-char offset natively, use color to indicate */
                  var slideWord = words[activeIdx];
                  var slideT = 0;
                  if (slideWord.end > slideWord.start) slideT = Math.min(1, (localTime - slideWord.start) / ((slideWord.end - slideWord.start) * 0.3));
                  if (slideT < 1) {
                    /* Show word as fading in during slide (Fabric can't actually slide individual chars) */
                    var dimLevel = Math.round(51 + 204 * slideT);
                    var hex = dimLevel.toString(16).padStart(2, '0');
                    charStyle.fill = activeFontColor;
                  }
                } else if (flatIdx >= activeCharEnd) {
                  /* Future words dim */
                  var bc2 = baseFontColor || '#ffffff';
                  if (bc2 === '#ffffff' || bc2 === 'white') charStyle.fill = '#666666';
                  else charStyle.fill = '#555555';
                } else {
                  charStyle.fill = baseFontColor;
                }
                break;

              case 'bounce':
                if (isActiveChar) {
                  charStyle.fill = activeFontColor;
                  /* Simulate bounce with font size oscillation */
                  var bWord = words[activeIdx];
                  var bT = 0;
                  if (bWord.end > bWord.start) bT = Math.min(1, (localTime - bWord.start) / (bWord.end - bWord.start));
                  var bounceScale = 1 + 0.2 * Math.abs(Math.sin(bT * Math.PI * 2.5)) * (1 - bT);
                  var bBaseFontSize = obj.fontSize || 34;
                  charStyle.fontSize = Math.round(bBaseFontSize * bounceScale);
                } else {
                  charStyle.fill = baseFontColor;
                }
                break;

              case 'typewriter':
                if (flatIdx < twVisibleChars) {
                  /* Visible */
                  if (flatIdx >= twVisibleChars - 1) {
                    charStyle.fill = activeFontColor; /* cursor char */
                  } else {
                    charStyle.fill = baseFontColor;
                  }
                } else {
                  /* Hidden — use transparent-ish color */
                  charStyle.fill = 'rgba(0,0,0,0)';
                }
                break;

              default:
                /* Includes 'karaoke' fallback */
                if (isActiveChar) {
                  charStyle.fill = activeFontColor;
                } else {
                  charStyle.fill = baseFontColor;
                }
                break;
            }

            lineChars[ch] = charStyle;
            flatIdx++;
          }
          /* Account for the space/newline between wrapped lines */
          flatIdx++;
          charStyles[li] = lineChars;
        }
        obj.styles = charStyles;
        obj.dirty = true;
      } else {
        /* anim === 'none': clear any previously-applied per-character styles */
        if (obj.styles && Object.keys(obj.styles).length) {
          obj.styles = {};
          obj.dirty = true;
        }
      }
    });
    canvas.renderAll();
  }

  function captureBaseState(obj) {
    if (obj._cfsBaseStateCaptured) return;
    obj._cfsBaseLeft = obj.left || 0;
    obj._cfsBaseTop = obj.top || 0;
    obj._cfsBaseOpacity = obj.opacity != null ? obj.opacity : 1;
    obj._cfsBaseScaleX = obj.scaleX != null ? obj.scaleX : 1;
    obj._cfsBaseScaleY = obj.scaleY != null ? obj.scaleY : 1;
    obj._cfsBaseStateCaptured = true;
  }

  function restoreBaseState(obj) {
    if (!obj._cfsBaseStateCaptured) return;
    if (obj.set) {
      obj.set('left', obj._cfsBaseLeft);
      obj.set('top', obj._cfsBaseTop);
      obj.set('opacity', obj._cfsBaseOpacity);
      obj.set('scaleX', obj._cfsBaseScaleX);
      obj.set('scaleY', obj._cfsBaseScaleY);
    }
    obj._cfsBaseStateCaptured = false;
  }

  function restoreAllBaseStates(canvas) {
    if (!canvas || !canvas.getObjects) return;
    canvas.getObjects().forEach(function (obj) {
      restoreBaseState(obj);
    });
  }

  var TRANSITION_DURATIONS = {
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
    shuffleBottomLeft: 0.5, shuffleLeftBottom: 0.5, shuffleLeftTop: 0.5, shuffleTopLeft: 0.5,
  };

  function transitionProgress(t, clipStart, clipLength, transIn, transOut) {
    var inDur = (transIn && TRANSITION_DURATIONS[transIn]) ? TRANSITION_DURATIONS[transIn] : 0.3;
    var outDur = (transOut && TRANSITION_DURATIONS[transOut]) ? TRANSITION_DURATIONS[transOut] : 0.3;
    var clipEnd = clipStart + clipLength;
    var inP = t <= clipStart ? 0 : (t >= clipStart + inDur ? 1 : (t - clipStart) / inDur);
    var outP = t >= clipEnd ? 1 : (t < clipEnd - outDur ? 0 : (t - (clipEnd - outDur)) / outDur);
    return { inProgress: inP, outProgress: outP };
  }

  function applyTransitionAtTime(obj, timeSec, clipStart, clipLength) {
    var trans = (obj.get ? obj.get('cfsTransition') : null) || obj.cfsTransition;
    if (!trans || typeof trans !== 'object') return;

    var baseLeft = obj._cfsBaseLeft;
    var baseTop = obj._cfsBaseTop;
    var baseOpacity = obj._cfsBaseOpacity;
    var baseScaleX = obj._cfsBaseScaleX;
    var baseScaleY = obj._cfsBaseScaleY;
    var inName = (trans['in'] || trans.in || '').toString();
    var outName = (trans.out || '').toString();
    if (!inName && !outName) return;

    var prog = transitionProgress(timeSec, clipStart, clipLength, inName, outName);
    var objW = (obj.width || 200) * (baseScaleX || 1);
    var objH = (obj.height || 200) * (baseScaleY || 1);
    var slideDist = Math.max(objW, objH, 200);
    var newLeft = baseLeft;
    var newTop = baseTop;
    var newOpacity = baseOpacity;
    var newScaleX = baseScaleX;
    var newScaleY = baseScaleY;

    var fadeAlphaIn = false;
    var fadeAlphaOut = false;
    if (inName) {
      var inLower = inName.toLowerCase();
      if (inLower.indexOf('fade') !== -1) {
        fadeAlphaIn = true;
      } else if (inLower.indexOf('slide') === 0 || inLower.indexOf('wipe') === 0) {
        var dir = inLower.indexOf('left') !== -1 ? -1 : (inLower.indexOf('right') !== -1 ? 1 : (inLower.indexOf('up') !== -1 ? -1 : 1));
        var axis = (inLower.indexOf('left') !== -1 || inLower.indexOf('right') !== -1) ? 'x' : 'y';
        var offset = (1 - prog.inProgress) * slideDist * dir;
        if (axis === 'x') newLeft = baseLeft + offset; else newTop = baseTop + offset;
      } else if (inLower.indexOf('carousel') === 0) {
        /* carouselUp = content enters from below (positive Y offset → base position).
           Match Pixi direction: Up → +1, Down → -1 (inverted from slide convention). */
        var cDir = inLower.indexOf('left') !== -1 ? 1 : (inLower.indexOf('right') !== -1 ? -1 : (inLower.indexOf('up') !== -1 ? 1 : -1));
        var cAxis = (inLower.indexOf('left') !== -1 || inLower.indexOf('right') !== -1) ? 'x' : 'y';
        var cOff = (1 - prog.inProgress) * slideDist * 0.5 * cDir;
        if (cAxis === 'x') newLeft = baseLeft + cOff; else newTop = baseTop + cOff;
      } else if (inLower.indexOf('zoom') !== -1) {
        fadeAlphaIn = true;
        var zs = prog.inProgress;
        newScaleX = baseScaleX * zs;
        newScaleY = baseScaleY * zs;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        newLeft = centerX - (objW * zs) / 2;
        newTop = centerY - (objH * zs) / 2;
      } else if (inLower.indexOf('reveal') !== -1) {
        fadeAlphaIn = true;
        var rs = 0.9 + 0.1 * prog.inProgress;
        newScaleX = baseScaleX * rs;
        newScaleY = baseScaleY * rs;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        newLeft = centerX - (objW * rs) / 2;
        newTop = centerY - (objH * rs) / 2;
      }
    }
    if (outName) {
      var outLower = outName.toLowerCase();
      if (outLower.indexOf('fade') !== -1) {
        fadeAlphaOut = true;
      } else if (outLower.indexOf('slide') === 0 || outLower.indexOf('wipe') === 0) {
        var oDir = outLower.indexOf('left') !== -1 ? -1 : (outLower.indexOf('right') !== -1 ? 1 : (outLower.indexOf('up') !== -1 ? -1 : 1));
        var oAxis = (outLower.indexOf('left') !== -1 || outLower.indexOf('right') !== -1) ? 'x' : 'y';
        var oOff = prog.outProgress * slideDist * oDir;
        if (oAxis === 'x') newLeft = newLeft + oOff; else newTop = newTop + oOff;
      } else if (outLower.indexOf('carousel') === 0) {
        /* Match Pixi: carouselUp out = content exits upward (negative Y). */
        var cODir = outLower.indexOf('left') !== -1 ? -1 : (outLower.indexOf('right') !== -1 ? 1 : (outLower.indexOf('up') !== -1 ? -1 : 1));
        var cOAxis = (outLower.indexOf('left') !== -1 || outLower.indexOf('right') !== -1) ? 'x' : 'y';
        var cOOff = prog.outProgress * slideDist * 0.5 * cODir;
        if (cOAxis === 'x') newLeft = newLeft + cOOff; else newTop = newTop + cOOff;
      } else if (outLower.indexOf('zoom') !== -1) {
        fadeAlphaOut = true;
        var zso = 1 - prog.outProgress;
        newScaleX = baseScaleX * zso;
        newScaleY = baseScaleY * zso;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        newLeft = centerX - (objW * zso) / 2;
        newTop = centerY - (objH * zso) / 2;
      } else if (outLower.indexOf('reveal') !== -1) {
        fadeAlphaOut = true;
        var rso = 1 - prog.outProgress * 0.1;
        newScaleX = baseScaleX * rso;
        newScaleY = baseScaleY * rso;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        newLeft = centerX - (objW * rso) / 2;
        newTop = centerY - (objH * rso) / 2;
      }
    }
    if (fadeAlphaIn) newOpacity = newOpacity * prog.inProgress;
    if (fadeAlphaOut) newOpacity = newOpacity * (1 - prog.outProgress);

    if (obj.set) {
      obj.set('left', newLeft);
      obj.set('top', newTop);
      obj.set('opacity', Math.max(0, Math.min(1, newOpacity)));
      if (newScaleX !== baseScaleX || newScaleY !== baseScaleY) {
        obj.set('scaleX', newScaleX);
        obj.set('scaleY', newScaleY);
      }
    }
  }

  function applyEffectAtTime(obj, timeSec, clipStart, clipLength) {
    var effect = (obj.get ? obj.get('cfsEffect') : null) || obj.cfsEffect;
    if (!effect || typeof effect !== 'string') return;

    var baseLeft = obj._cfsBaseLeft;
    var baseTop = obj._cfsBaseTop;
    var baseScaleX = obj._cfsBaseScaleX;
    var baseScaleY = obj._cfsBaseScaleY;

    var clipEnd = clipStart + clipLength;
    if (timeSec < clipStart || timeSec >= clipEnd) return;
    var elapsed = timeSec - clipStart;
    var p = Math.min(1, elapsed / Math.max(0.001, clipLength));
    var eff = effect.toLowerCase();

    if (eff.indexOf('zoomin') !== -1) {
      var zs = eff.indexOf('slow') !== -1 ? (1 + p * 0.15) : (1 + p * 0.3);
      if (obj.set) {
        var objW = (obj.width || 0) * baseScaleX;
        var objH = (obj.height || 0) * baseScaleY;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        obj.set('scaleX', baseScaleX * zs);
        obj.set('scaleY', baseScaleY * zs);
        obj.set('left', centerX - (objW * zs) / 2);
        obj.set('top', centerY - (objH * zs) / 2);
      }
    } else if (eff.indexOf('zoomout') !== -1) {
      var zos = eff.indexOf('slow') !== -1 ? (1.15 - p * 0.15) : (1.3 - p * 0.3);
      if (obj.set) {
        var objW = (obj.width || 0) * baseScaleX;
        var objH = (obj.height || 0) * baseScaleY;
        var centerX = baseLeft + objW / 2;
        var centerY = baseTop + objH / 2;
        obj.set('scaleX', baseScaleX * zos);
        obj.set('scaleY', baseScaleY * zos);
        obj.set('left', centerX - (objW * zos) / 2);
        obj.set('top', centerY - (objH * zos) / 2);
      }
    } else if (eff.indexOf('slideleft') !== -1) {
      if (obj.set) obj.set('left', baseLeft - p * 80);
    } else if (eff.indexOf('slideright') !== -1) {
      if (obj.set) obj.set('left', baseLeft + p * 80);
    } else if (eff.indexOf('slideup') !== -1) {
      if (obj.set) obj.set('top', baseTop - p * 80);
    } else if (eff.indexOf('slidedown') !== -1) {
      if (obj.set) obj.set('top', baseTop + p * 80);
    }
  }

  /**
   * Apply cfsAnimation effect to a Fabric object at the given seek time.
   * Mirrors the animation presets from pixi-timeline-player for the editor canvas.
   */
  function applyAnimationAtTime(obj, timeSec, clipStart, clipLength) {
    var anim = (obj.get ? obj.get('cfsAnimation') : null) || obj.cfsAnimation;
    if (!anim || !anim.preset || anim.preset === 'none') {
      if (obj._cfsAnimOrigText != null && obj.set) {
        obj.set('text', obj._cfsAnimOrigText);
        obj._cfsAnimOrigText = undefined;
      }
      if (obj._cfsAnimOrigOpacity != null && obj.set) {
        obj.set('opacity', obj._cfsAnimOrigOpacity);
        obj._cfsAnimOrigOpacity = undefined;
      }
      return;
    }
    var relTime = timeSec - clipStart;
    var animDur = (typeof anim.duration === 'number' || typeof anim.duration === 'string')
      ? Number(anim.duration) || Math.min(clipLength || 2, 2)
      : Math.min(clipLength || 2, 2);
    var preset = (anim.preset || '').toLowerCase();
    var progress = animDur > 0 ? Math.min(1, Math.max(0, relTime / animDur)) : 1;

    if (preset === 'typewriter') {
      /* Resolve full text from multiple sources (priority order):
         1. cfsRawText — resolved merge-field text, always up-to-date
         2. _cfsAnimOrigText — cached from a prior pass
         3. cfsOriginalClip.asset.text — the original template clip text
         4. obj.text — may already be truncated by a prior typewriter pass */
      var sourceText = '';
      if (obj.cfsRawText != null && String(obj.cfsRawText) !== '') {
        sourceText = String(obj.cfsRawText);
      } else if (obj._cfsAnimOrigText && obj._cfsAnimOrigText.length > 0) {
        sourceText = obj._cfsAnimOrigText;
      } else if (obj.cfsOriginalClip && obj.cfsOriginalClip.asset && obj.cfsOriginalClip.asset.text) {
        sourceText = String(obj.cfsOriginalClip.asset.text);
      } else {
        sourceText = (obj.text != null ? obj.text : '');
      }
      obj._cfsAnimOrigText = sourceText;
      var rawText = sourceText;
      var charsToShow = Math.floor(rawText.length * progress);
      var newText = rawText.slice(0, charsToShow);
      /* Debug: log typewriter state — remove after fixing */
      if (typeof console !== 'undefined' && !obj._cfsAnimLogThrottle) {
        obj._cfsAnimLogThrottle = true;
        console.log('[CFS typewriter]', {
          name: obj.name,
          rawTextLen: rawText.length,
          rawTextFirst50: rawText.slice(0, 50),
          cfsRawText: (obj.cfsRawText || '').toString().slice(0, 50),
          origClipText: (obj.cfsOriginalClip && obj.cfsOriginalClip.asset ? (obj.cfsOriginalClip.asset.text || '') : '').slice(0, 50),
          progress: progress,
          animDur: animDur,
          relTime: relTime,
          charsToShow: charsToShow,
          newText: newText.slice(0, 50)
        });
        setTimeout(function () { obj._cfsAnimLogThrottle = false; }, 2000);
      }
      if (obj.set && obj.text !== newText) obj.set('text', newText);
    } else if (preset === 'fadein' || preset === 'fade-in') {
      if (obj._cfsAnimOrigOpacity == null) obj._cfsAnimOrigOpacity = obj.opacity != null ? obj.opacity : 1;
      if (obj.set) obj.set('opacity', obj._cfsAnimOrigOpacity * progress);
    } else if (preset === 'slidein' || preset === 'slide-in') {
      if (obj._cfsAnimOrigLeft == null) obj._cfsAnimOrigLeft = obj.left || 0;
      if (obj.set) obj.set('left', obj._cfsAnimOrigLeft + (1 - progress) * 100);
    } else if (preset === 'ascend') {
      if (obj._cfsAnimOrigTop == null) obj._cfsAnimOrigTop = obj.top || 0;
      if (obj._cfsAnimOrigOpacity == null) obj._cfsAnimOrigOpacity = obj.opacity != null ? obj.opacity : 1;
      if (obj.set) {
        obj.set('top', obj._cfsAnimOrigTop + (1 - progress) * 60);
        obj.set('opacity', obj._cfsAnimOrigOpacity * progress);
      }
    } else if (preset === 'shift') {
      if (obj._cfsAnimOrigLeft == null) obj._cfsAnimOrigLeft = obj.left || 0;
      if (obj.set) obj.set('left', obj._cfsAnimOrigLeft - (1 - progress) * 80);
    }
  }

  // --- Capture pipeline ---

  /**
   * Capture a single frame at timeSec: seek, render, return data URL.
   * options: { format: 'png'|'jpeg', quality?: number, ignoreClipTiming?: boolean }.
   */
  function captureFrameAt(canvas, timeSec, options) {
    if (!canvas) return null;
    options = options || {};
    var seekOpts = options.ignoreClipTiming ? { ignoreClipTiming: true } : undefined;
    seekToTime(canvas, timeSec, seekOpts);
    if (!canvas.toDataURL) return null;
    var savedVpt = canvas.viewportTransform ? canvas.viewportTransform.slice() : null;
    if (typeof canvas.setViewportTransform === 'function') {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    }
    const format = options.format || 'png';
    const quality = options.quality != null ? options.quality : 1;
    var result = canvas.toDataURL({ format: format, quality: quality });
    if (savedVpt && typeof canvas.setViewportTransform === 'function') {
      canvas.setViewportTransform(savedVpt);
    }
    return result;
  }

  /**
   * Capture a sequence of frames from 0 to durationSec at given fps.
   * options: { fps: number, durationSec: number, format?: 'png'|'jpeg', quality?: number, onFrame?: (dataUrl, index, timeSec) => void }.
   * Returns Promise<string[]> of data URLs. If onFrame is provided, frames are streamed and array may be empty (caller can encode incrementally).
   */
  function captureFrameSequence(canvas, options) {
    if (!canvas) return Promise.resolve([]);
    options = options || {};
    const fps = Math.max(1, options.fps || 25);
    const durationSec = Math.max(0, options.durationSec != null ? options.durationSec : 10);
    const format = options.format || 'png';
    const quality = options.quality != null ? options.quality : 1;
    const onFrame = options.onFrame;

    const timeline = getTimelineFromCanvas(canvas);
    const totalSec = durationSec > 0 ? durationSec : timeline.durationSec;

    const frameCount = Math.ceil(totalSec * fps);
    const results = [];

    function captureNext(index) {
      if (index >= frameCount) return Promise.resolve(results);
      const timeSec = index / fps;
      const dataUrl = captureFrameAt(canvas, timeSec, { format: format, quality: quality });
      if (dataUrl) {
        results.push(dataUrl);
        if (onFrame) onFrame(dataUrl, index, timeSec);
      }
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          resolve(captureNext(index + 1));
        });
      });
    }

    return captureNext(0);
  }

  /**
   * After loadFromJSON, adjust image dimensions based on cfsFit so the Fabric.js
   * preview matches Shotstack's fit behaviour (crop, contain, none, cover).
   * Shotstack applies fit first (scales asset into clip), then clip.scale as a
   * final multiplier.
   */
  function applyFitToSingleImage(obj, canvasW, canvasH) {
    if (!obj || obj.type !== 'image' || obj.cfsSvgSrc) return;
    var el = obj.getElement ? obj.getElement() : (obj._element || null);
    if (!el) return;
    var fit = (obj.cfsFit || 'crop').toLowerCase();
    var clipScale = (obj.cfsScale != null && Number(obj.cfsScale) > 0) ? Number(obj.cfsScale) : 1;
    var origClip = obj.cfsOriginalClip || {};
    var origAsset = origClip.asset || {};
    var hasExplicitPos = origAsset.left != null && origAsset.top != null;
    var hasResponsiveDims = obj.cfsResponsive && obj.cfsWidthPct > 0 && obj.cfsHeightPct > 0;
    var clipW, clipH;
    if (hasResponsiveDims) {
      clipW = canvasW * obj.cfsWidthPct;
      clipH = canvasH * obj.cfsHeightPct;
    } else {
      clipW = origClip.width != null ? Number(origClip.width) :
              origAsset.width != null ? Number(origAsset.width) : canvasW;
      clipH = origClip.height != null ? Number(origClip.height) :
              origAsset.height != null ? Number(origAsset.height) : canvasH;
    }
    var naturalW = el.naturalWidth || el.width || clipW;
    var naturalH = el.naturalHeight || el.height || clipH;
    if (naturalW <= 1 || naturalH <= 1) return;
    function resolvePos(scaledVisW, scaledVisH) {
      if (hasResponsiveDims && obj.cfsLeftPct != null && obj.cfsTopPct != null) {
        return { left: canvasW * obj.cfsLeftPct, top: canvasH * obj.cfsTopPct };
      }
      if (hasExplicitPos) return { left: Number(origAsset.left), top: Number(origAsset.top) };
      var p = positionFromClip(canvasW, canvasH, origClip, scaledVisW, scaledVisH);
      return { left: p.left, top: p.top };
    }
    if (fit === 'none') {
      var scaledVisW = naturalW * clipScale;
      var scaledVisH = naturalH * clipScale;
      var pos = resolvePos(scaledVisW, scaledVisH);
      obj.set('cropX', 0);
      obj.set('cropY', 0);
      obj.set('width', naturalW);
      obj.set('height', naturalH);
      obj.set('scaleX', clipScale);
      obj.set('scaleY', clipScale);
      obj.set('left', pos.left);
      obj.set('top', pos.top);
    } else if (fit === 'contain') {
      var sFit = Math.min(clipW / naturalW, clipH / naturalH);
      var scaledVisW = naturalW * sFit * clipScale;
      var scaledVisH = naturalH * sFit * clipScale;
      var pos = resolvePos(scaledVisW, scaledVisH);
      obj.set('cropX', 0);
      obj.set('cropY', 0);
      obj.set('width', naturalW);
      obj.set('height', naturalH);
      obj.set('scaleX', sFit * clipScale);
      obj.set('scaleY', sFit * clipScale);
      obj.set('left', pos.left);
      obj.set('top', pos.top);
    } else if (fit === 'crop' || fit === 'cover') {
      var sFit = Math.max(clipW / naturalW, clipH / naturalH);
      var cropW = Math.min(naturalW, Math.round(clipW / sFit));
      var cropH = Math.min(naturalH, Math.round(clipH / sFit));
      var cropX = Math.max(0, (naturalW - cropW) / 2);
      var cropY = Math.max(0, (naturalH - cropH) / 2);
      var scaledVisW = clipW * clipScale;
      var scaledVisH = clipH * clipScale;
      var pos = resolvePos(scaledVisW, scaledVisH);
      obj.set('cropX', cropX);
      obj.set('cropY', cropY);
      obj.set('width', cropW);
      obj.set('height', cropH);
      obj.set('scaleX', sFit * clipScale);
      obj.set('scaleY', sFit * clipScale);
      obj.set('left', pos.left);
      obj.set('top', pos.top);
    }
    if (obj.cfsResponsive) {
      var visW = (obj.width || 0) * (obj.scaleX || 1);
      var visH = (obj.height || 0) * (obj.scaleY || 1);
      obj.cfsLeftPct = (obj.left || 0) / canvasW;
      obj.cfsTopPct = (obj.top || 0) / canvasH;
      obj.cfsWidthPct = visW / canvasW;
      obj.cfsHeightPct = visH / canvasH;
    }
    if (obj._cfsBaseStateCaptured) {
      obj._cfsBaseScaleX = obj.scaleX != null ? obj.scaleX : 1;
      obj._cfsBaseScaleY = obj.scaleY != null ? obj.scaleY : 1;
      obj._cfsBaseLeft = obj.left || 0;
      obj._cfsBaseTop = obj.top || 0;
    }
    obj.setCoords();
  }

  function applyFitToImages(canvas, canvasW, canvasH) {
    if (!canvas || !canvas.getObjects || !fabric) return;
    canvasW = canvasW || (canvas.getWidth ? canvas.getWidth() : 1920);
    canvasH = canvasH || (canvas.getHeight ? canvas.getHeight() : 1080);
    canvas.getObjects().forEach(function (obj) {
      applyFitToSingleImage(obj, canvasW, canvasH);
    });
    canvas.renderAll();
  }

  global.__CFS_coreScene = {
    loadFromJSON,
    injectMergeData,
    getOutputDimensions,
    shotstackToFabricStructure,
    getTimelineFromCanvas,
    seekToTime,
    restoreAllBaseStates,
    captureFrameAt,
    captureFrameSequence,
    applyFitToImages,
    applyFitToSingleImage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
