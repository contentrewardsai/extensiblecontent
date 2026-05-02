/**
 * Convert Fabric canvas JSON (or scene structure) to ShotStack Edit API template format.
 * Objects become clips (title or image) with start/length from cfsStart/cfsLength or defaults.
 * Shapes (rect, circle, path) are exported as ShotStack SVG assets (beta): https://shotstack.io/docs/guide/architecting-an-application/svg/
 */
(function (global) {
  'use strict';

  function shapeToSvgSrc(obj) {
    var w = Math.max(1, (obj.width != null ? obj.width : 400) * (obj.scaleX != null ? obj.scaleX : 1));
    var h = Math.max(1, (obj.height != null ? obj.height : 300) * (obj.scaleY != null ? obj.scaleY : 1));
    var fill = (obj.fill != null && typeof obj.fill === 'string') ? obj.fill : '#eeeeee';
    var stroke = (obj.stroke != null && typeof obj.stroke === 'string') ? obj.stroke : '';
    var strokeWidth = (obj.strokeWidth != null && obj.strokeWidth !== 0) ? Number(obj.strokeWidth) : 0;
    var xmlns = 'http://www.w3.org/2000/svg';
    var viewBox = '0 0 ' + w + ' ' + h;
    var inner = '';
    if (obj.type === 'rect') {
      var rx = obj.rx != null ? Number(obj.rx) : 0;
      var ry = obj.ry != null ? Number(obj.ry) : 0;
      inner = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + escapeAttr(fill) + '" rx="' + rx + '" ry="' + ry + '"' + (stroke && strokeWidth ? ' stroke="' + escapeAttr(stroke) + '" stroke-width="' + strokeWidth + '"' : '') + '/>';
    } else if (obj.type === 'circle') {
      var r = (obj.radius != null ? Number(obj.radius) : 20) * (obj.scaleX != null ? obj.scaleX : 1);
      var cx = r;
      var cy = r;
      w = r * 2;
      h = r * 2;
      viewBox = '0 0 ' + w + ' ' + h;
      inner = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + escapeAttr(fill) + '"' + (stroke && strokeWidth ? ' stroke="' + escapeAttr(stroke) + '" stroke-width="' + strokeWidth + '"' : '') + '/>';
    } else if (obj.type === 'path' && obj.path) {
      var d = pathToSvgD(obj.path);
      if (d) {
        inner = '<path d="' + escapeAttr(d) + '" fill="' + escapeAttr(fill) + '"' + (stroke && strokeWidth ? ' stroke="' + escapeAttr(stroke) + '" stroke-width="' + strokeWidth + '"' : '') + '/>';
      }
    }
    if (!inner) return null;
    return '<svg xmlns="' + xmlns + '" viewBox="' + viewBox + '" width="' + w + '" height="' + h + '">' + inner + '</svg>';
  }

  function escapeAttr(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function pathToSvgD(pathData) {
    if (typeof pathData === 'string') return pathData.trim();
    if (!Array.isArray(pathData)) return '';
    var parts = [];
    for (var i = 0; i < pathData.length; i++) {
      var cmd = pathData[i];
      if (Array.isArray(cmd)) {
        var letter = (cmd[0] != null ? String(cmd[0]) : '').toUpperCase();
        parts.push(letter);
        if (letter !== 'Z' && letter !== 'z') {
          for (var j = 1; j < cmd.length; j++) {
            if (typeof cmd[j] === 'number') parts.push(cmd[j]);
          }
        }
      }
    }
    if (parts.length === 0 && pathData.length > 0 && !Array.isArray(pathData[0])) {
      for (var k = 0; k < pathData.length; k++) {
        var v = pathData[k];
        if (typeof v === 'string' && /^[MLHVCSQTAZ]$/i.test(v)) parts.push(v.toUpperCase());
        else if (typeof v === 'number') parts.push(v);
      }
    }
    return parts.join(' ');
  }

  function fabricToShotstack(fabricJson, options) {
    options = options || {};
    const width = fabricJson.width || options.width || 1920;
    const height = fabricJson.height || options.height || 1080;
    const objects = fabricJson.objects || [];
    let background = (fabricJson.background && fabricJson.background !== 'transparent') ? fabricJson.background : '#ffffff';
    const backgroundObj = objects.filter(function (o) { return (o.name || o.id) === 'background' && (o.type === 'rect' || o.type === 'path'); })[0];
    if (backgroundObj && backgroundObj.fill) background = backgroundObj.fill;

    const trackMap = {};
    let time = 0;
    const defaultDuration = options.defaultClipDuration != null ? options.defaultClipDuration : 5;

    function pushClip(obj, clipPayload) {
      applyCommonClipProps(obj, clipPayload);
      const trackIndex = obj.cfsTrackIndex != null ? obj.cfsTrackIndex : 0;
      if (!trackMap[trackIndex]) trackMap[trackIndex] = [];
      trackMap[trackIndex].push(clipPayload);
    }

    function applyCommonClipProps(obj, clip) {
      if (!obj || !clip) return;
      if (obj.cfsHideOnImage === true) clip._cfsHideOnImage = true;
      if (obj.cfsFilter && obj.cfsFilter !== 'none') clip.filter = obj.cfsFilter;
      if (obj.cfsChromaKey && typeof obj.cfsChromaKey === 'object' && obj.cfsChromaKey.color) {
        if (!clip.asset) clip.asset = {};
        clip.asset.chromaKey = { color: obj.cfsChromaKey.color };
        if (obj.cfsChromaKey.threshold != null) clip.asset.chromaKey.threshold = obj.cfsChromaKey.threshold;
        if (obj.cfsChromaKey.halo != null) clip.asset.chromaKey.halo = obj.cfsChromaKey.halo;
      }
      var hasFlip = obj.cfsFlip && typeof obj.cfsFlip === 'object' && (obj.cfsFlip.horizontal || obj.cfsFlip.vertical);
      var hasSkew = (obj.skewX != null && obj.skewX !== 0) || (obj.skewY != null && obj.skewY !== 0);
      if (hasFlip || hasSkew) {
        clip.transform = clip.transform || {};
        if (hasFlip) clip.transform.flip = { horizontal: !!obj.cfsFlip.horizontal, vertical: !!obj.cfsFlip.vertical };
        if (hasSkew) clip.transform.skew = { x: obj.skewX || 0, y: obj.skewY || 0 };
      }
    }

    function isPlaceholderContent(content, alias) {
      if (content == null || typeof content !== 'string' || !alias) return false;
      var m = content.match(/^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/);
      if (!m) return false;
      var inner = m[1].toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/gi, '');
      var a = String(alias).toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/gi, '');
      return inner === a;
    }

    function extractMergeKeyFromOriginal(obj) {
      if (!obj || !obj.cfsOriginalClip || !obj.cfsOriginalClip.asset) return null;
      var origText = obj.cfsOriginalClip.asset.text || obj.cfsOriginalClip.asset.src || '';
      var m = origText.match(/^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/);
      return m ? m[1] : null;
    }

    function isLikelyVideoSource(src) {
      if (!src || typeof src !== 'string') return false;
      if (src.indexOf('{{') !== -1) return false;
      var clean = src.split('?')[0].split('#')[0].toLowerCase();
      return /\.mp4$|\.webm$|\.mov$|\.m4v$|\.avi$|\.mkv$/.test(clean) || clean.indexOf('video/') >= 0;
    }

    function getElementSize(obj) {
      var w = obj.width != null ? Number(obj.width) * (obj.scaleX != null ? obj.scaleX : 1) : 0;
      var h = obj.height != null ? Number(obj.height) * (obj.scaleY != null ? obj.scaleY : 1) : 0;
      if (obj.type === 'circle' && obj.radius != null) {
        var r = Number(obj.radius) * (obj.scaleX != null ? obj.scaleX : 1);
        w = r * 2;
        h = r * 2;
      }
      return { w: w, h: h };
    }

    function offsetFromPosition(obj) {
      if (obj.left == null || obj.top == null || width <= 0 || height <= 0) return undefined;
      var size = getElementSize(obj);
      var centerX = obj.left + size.w / 2;
      var centerY = obj.top + size.h / 2;
      var ox = (centerX - width / 2) / width;
      /* Inverse of importer: ShotStack offset.y is positive upward. */
      var oy = -((centerY - height / 2) / height);
      return { x: Math.round(ox * 1e6) / 1e6, y: Math.round(oy * 1e6) / 1e6 };
    }

    function offsetForAnchor(obj, position) {
      if (obj.left == null || obj.top == null || width <= 0 || height <= 0) return undefined;
      var pos = (position || 'center').toLowerCase();
      var l = Number(obj.left) || 0;
      var t = Number(obj.top) || 0;
      var size = getElementSize(obj);
      var ew = size.w;
      var eh = size.h;
      var ox, oy;
      if (pos === 'topleft') { ox = l / width; oy = -(t / height); }
      else if (pos === 'top') { ox = (l + ew / 2 - width / 2) / width; oy = -(t / height); }
      else if (pos === 'topright') { ox = (l - (width - ew)) / width; oy = -(t / height); }
      else if (pos === 'left') { ox = l / width; oy = -((t + eh / 2 - height / 2) / height); }
      else if (pos === 'right') { ox = (l - (width - ew)) / width; oy = -((t + eh / 2 - height / 2) / height); }
      else if (pos === 'bottomleft') { ox = l / width; oy = -((t - (height - eh)) / height); }
      else if (pos === 'bottom') { ox = (l + ew / 2 - width / 2) / width; oy = -((t - (height - eh)) / height); }
      else if (pos === 'bottomright') { ox = (l - (width - ew)) / width; oy = -((t - (height - eh)) / height); }
      else { var cx = l + ew / 2; var cy = t + eh / 2; ox = (cx - width / 2) / width; oy = -((cy - height / 2) / height); }
      return { x: Math.round(ox * 1e6) / 1e6, y: Math.round(oy * 1e6) / 1e6 };
    }

    var mergeEntries = [];

    /* Flatten Fabric Groups so each child becomes a clip; ShotStack has no native group. Exception: video placeholder groups (cfsOriginalClip.asset.type === 'video') are kept as one object so we export a single video clip. */
    var flatObjects = [];
    objects.forEach(function (o) {
      if (o.type === 'group' && o.objects && Array.isArray(o.objects)) {
        if (o.cfsVideoSrc || (o.cfsOriginalClip && o.cfsOriginalClip.asset && o.cfsOriginalClip.asset.type === 'video')) {
          flatObjects.push(o);
          return;
        }
        o.objects.forEach(function (c) {
          var flat = {};
          for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) flat[k] = c[k];
          flat.left = (o.left != null ? o.left : 0) + (c.left != null ? c.left : 0);
          flat.top = (o.top != null ? o.top : 0) + (c.top != null ? c.top : 0);
          if (o.cfsStart != null) flat.cfsStart = o.cfsStart;
          if (o.cfsLength != null) flat.cfsLength = o.cfsLength;
          if (o.cfsTrackIndex != null) flat.cfsTrackIndex = o.cfsTrackIndex;
          flatObjects.push(flat);
        });
      } else {
        flatObjects.push(o);
      }
    });

    flatObjects.forEach(function (obj) {
      const name = obj.name || obj.id || ('obj_' + Object.keys(trackMap).reduce(function (sum, t) { return sum + (trackMap[t].length || 0); }, 0));
      if (name === 'background' && (obj.type === 'rect' || obj.type === 'path')) return;
      if (obj.cfsTextBgFor) return;

      const start = obj.cfsStart != null ? obj.cfsStart : time;
      const length = obj.cfsLength != null ? obj.cfsLength : defaultDuration;
      if (typeof start === 'number' && typeof length === 'number') {
        time = Math.max(time, start + length);
      }

      const alias = name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/gi, '');

      if (obj.cfsVideoSrc) {
        const clipStart = (start === 'auto' || start === 'end') ? start : (typeof start === 'number' ? start : 0);
        const clipLength = (length === 'auto' || length === 'end') ? length : (typeof length === 'number' ? length : 5);
        var videoSrc = obj.cfsVideoSrc;
        var videoMergeKey = obj.cfsMergeKey || (isPlaceholderContent(videoSrc, alias) ? alias : null) || extractMergeKeyFromOriginal(obj);
        var videoIsPlaceholder = !!videoMergeKey;
        var videoAlias = videoMergeKey || alias;
        if (videoIsPlaceholder) mergeEntries.push({ find: videoAlias, replace: obj.cfsVideoSrc });
        if (obj.cfsOriginalClip && obj.cfsOriginalClip.asset && obj.cfsOriginalClip.asset.type === 'video') {
          var videoClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          videoClip.start = clipStart;
          videoClip.length = clipLength;
          var origVideoSrc = obj.cfsOriginalClip.asset.src || '';
          var useOrigVideoUrl = typeof videoSrc === 'string' && videoSrc.indexOf('blob:') === 0
            && typeof origVideoSrc === 'string' && origVideoSrc.indexOf('{{') === -1;
          videoClip.asset.src = videoIsPlaceholder ? ('{{ ' + videoAlias + ' }}')
            : (useOrigVideoUrl ? origVideoSrc : (videoSrc || ''));
          if (obj.cfsVideoVolume != null && !isNaN(Number(obj.cfsVideoVolume))) videoClip.asset.volume = Number(obj.cfsVideoVolume);
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') videoClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) videoClip.effect = obj.cfsEffect;
          if (obj.cfsFadeIn != null && !isNaN(Number(obj.cfsFadeIn))) videoClip.fadeIn = Math.max(0, Number(obj.cfsFadeIn));
          if (obj.cfsFadeOut != null && !isNaN(Number(obj.cfsFadeOut))) videoClip.fadeOut = Math.max(0, Number(obj.cfsFadeOut));
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            videoClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          }
          if (!videoClip.offset && videoClip.position === 'center') videoClip.offset = { x: 0, y: 0 };
          if (obj.cfsClipOpacity != null) videoClip.opacity = obj.cfsClipOpacity;
          else if (obj.opacity != null && obj.opacity !== 1) videoClip.opacity = obj.opacity;
          if (obj.cfsLengthWasEnd) videoClip._preserveEnd = true;
          if (obj.cfsLengthAuto) videoClip._preserveAuto = true;
          if (videoIsPlaceholder) videoClip.alias = videoAlias;
          delete videoClip.asset.left;
          delete videoClip.asset.top;
          pushClip(obj, videoClip);
          return;
        }
        const videoAsset = { type: 'video', src: videoIsPlaceholder ? ('{{ ' + videoAlias + ' }}') : videoSrc };
        if (obj.cfsVideoVolume != null && !isNaN(Number(obj.cfsVideoVolume))) videoAsset.volume = Number(obj.cfsVideoVolume);
        if (obj.cfsTrim != null && Number(obj.cfsTrim) > 0) videoAsset.trim = Number(obj.cfsTrim);
        if (obj.cfsSpeed != null && Number(obj.cfsSpeed) > 0 && Number(obj.cfsSpeed) !== 1) videoAsset.speed = Number(obj.cfsSpeed);
        var videoClip = {
          asset: videoAsset,
          start: clipStart,
          length: clipLength,
          position: 'center',
          fit: obj.cfsFit != null ? obj.cfsFit : 'contain',
        };
        if (videoIsPlaceholder) videoClip.alias = videoAlias;
        if (obj.cfsTransition && typeof obj.cfsTransition === 'object') videoClip.transition = obj.cfsTransition;
        if (obj.cfsEffect != null) videoClip.effect = obj.cfsEffect;
        if (obj.cfsFadeIn != null && !isNaN(Number(obj.cfsFadeIn))) videoClip.fadeIn = Math.max(0, Number(obj.cfsFadeIn));
        if (obj.cfsFadeOut != null && !isNaN(Number(obj.cfsFadeOut))) videoClip.fadeOut = Math.max(0, Number(obj.cfsFadeOut));
        if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
          videoClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
        } else {
          var vo = offsetFromPosition(obj);
          if (vo) videoClip.offset = vo;
        }
        if (obj.cfsClipOpacity != null) videoClip.opacity = obj.cfsClipOpacity;
        else if (obj.opacity != null && obj.opacity !== 1) videoClip.opacity = obj.opacity;
        if (obj.cfsLengthWasEnd) videoClip._preserveEnd = true;
        if (obj.cfsLengthAuto) videoClip._preserveAuto = true;
        /* Use the VISUAL size of the Fabric group (width × scaleX) for the clip
           container, not the original source video dimensions.  The Pixi player
           uses clip.width/height as the target box for fit/crop, and if we pass
           the original 1080×1920 here the video appears too big/zoomed. */
        var visualW = (obj.width != null ? obj.width : 0) * (obj.scaleX != null ? obj.scaleX : 1);
        var visualH = (obj.height != null ? obj.height : 0) * (obj.scaleY != null ? obj.scaleY : 1);
        if (visualW > 0 && visualH > 0) {
          videoClip.asset.width = Math.round(visualW);
          videoClip.asset.height = Math.round(visualH);
        } else {
          var vw = obj.cfsVideoWidth != null ? Number(obj.cfsVideoWidth) : (obj.width != null && obj.width > 0 ? obj.width : null);
          var vh = obj.cfsVideoHeight != null ? Number(obj.cfsVideoHeight) : (obj.height != null && obj.height > 0 ? obj.height : null);
          if (vw != null && vh != null && vw > 0 && vh > 0) {
            videoClip.asset.width = vw;
            videoClip.asset.height = vh;
          }
        }
        if (!videoIsPlaceholder && obj.left != null && (obj.left !== 0 || obj.top !== 0)) {
          videoClip.asset.left = obj.left;
          videoClip.asset.top = obj.top;
        }
        pushClip(obj, videoClip);
        return;
      }

      if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
        /* Pass through caption clips using their original clip data. */
        if (obj.cfsOriginalClip && obj.cfsOriginalClip.asset && (obj.cfsOriginalClip.asset.type === 'caption' || obj.cfsOriginalClip.asset.type === 'rich-caption')) {
          var capClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          capClip.start = start;
          capClip.length = length;
          if (obj.cfsLengthWasEnd) capClip._preserveEnd = true;
          pushClip(obj, capClip);
          return;
        }
        var textContent = obj.cfsRawText != null ? String(obj.cfsRawText) : (obj.text != null ? String(obj.text) : '');
        var textMergeKey = obj.cfsMergeKey || (isPlaceholderContent(textContent, alias) ? alias : null) || extractMergeKeyFromOriginal(obj);
        var textIsPlaceholder = !!textMergeKey;
        var textAlias = textMergeKey || alias;
        if (textIsPlaceholder) {
          var mergeReplace = (options && options.mergeLookup && options.mergeLookup[textAlias] != null)
            ? String(options.mergeLookup[textAlias])
            : textContent;
          mergeEntries.push({ find: textAlias, replace: mergeReplace });
        }
        var orig = obj.cfsOriginalClip;
        var origAsset = orig && orig.asset;
        if (orig && origAsset && origAsset.type === 'html') {
          var htmlClip = JSON.parse(JSON.stringify(orig));
          htmlClip.start = start;
          htmlClip.length = length;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) htmlClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) htmlClip.opacity = obj.cfsClipOpacity;
          else if (obj.opacity != null && obj.opacity !== 1) htmlClip.opacity = obj.opacity;
          if (obj.cfsLengthWasEnd) htmlClip._preserveEnd = true;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            htmlClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          }
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') htmlClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) htmlClip.effect = obj.cfsEffect;
          if (htmlClip.asset && htmlClip.asset.html) {
            var origHtml = (orig && orig.asset && orig.asset.html) || '';
            var htmlHasEmbedded = textIsPlaceholder && origHtml &&
              new RegExp('\\{\\{\\s*' + textAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}').test(origHtml) &&
              origHtml.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, '').replace(/<[^>]*>/g, '').trim().length > 0;
            if (!htmlHasEmbedded) {
              var newContent = textIsPlaceholder ? ('{{ ' + textAlias + ' }}') : textContent;
              htmlClip.asset.html = htmlClip.asset.html.replace(/(>)[^<]*(<\/)/g, '$1' + newContent + '$2');
            }
          }
          pushClip(obj, htmlClip);
          return;
        }
        if (orig && origAsset && (origAsset.type === 'text' || origAsset.type === 'rich-text' || origAsset.type === 'title')) {
          var textClip = JSON.parse(JSON.stringify(orig));
          textClip.start = start;
          textClip.length = length;
          if (textIsPlaceholder) textClip.alias = textAlias;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) textClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) textClip.opacity = obj.cfsClipOpacity;
          else if (obj.opacity != null && obj.opacity !== 1) textClip.opacity = obj.opacity;
          if (obj.cfsLengthWasEnd) textClip._preserveEnd = true;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            textClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          }
          if (!textClip.offset && textClip.position === 'center') textClip.offset = { x: 0, y: 0 };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') textClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) textClip.effect = obj.cfsEffect;
          if (obj.cfsFit != null) textClip.fit = obj.cfsFit;
          if (obj.cfsScale != null && typeof obj.cfsScale === 'number') textClip.scale = obj.cfsScale;
          if (textClip.asset) {
            var origAssetText = (orig && orig.asset && orig.asset.text) || '';
            var hasEmbeddedPlaceholder = textIsPlaceholder && origAssetText &&
              new RegExp('\\{\\{\\s*' + textAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}').test(origAssetText) &&
              !(/^\s*\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*$/.test(origAssetText));
            if (hasEmbeddedPlaceholder) {
              /* Preserve the original text structure (e.g. "Lease starting at {{ PRICE }}/month")
                 so applyMergeToTemplate replaces only the placeholder, not the entire text. */
            } else {
              textClip.asset.text = textIsPlaceholder ? ('{{ ' + textAlias + ' }}') : textContent;
            }
            if (obj.cfsAnimation) textClip.asset.animation = obj.cfsAnimation;
            else if (!obj.cfsAnimation && textClip.asset.animation) delete textClip.asset.animation;
            if (textClip.asset.padding && typeof textClip.asset.padding === 'object') {
              textClip.asset.padding.left = Math.round(obj.left);
              textClip.asset.padding.top = Math.round(obj.top);
              var objVisualW = (obj.width || 800) * (obj.scaleX || 1);
              textClip.asset.padding.right = Math.max(0, Math.round(width - obj.left - objVisualW));
            } else if (origAsset.left != null && origAsset.top != null) {
              if (obj.left != null) textClip.asset.left = obj.left;
              if (obj.top != null) textClip.asset.top = obj.top;
            } else {
              delete textClip.asset.left;
              delete textClip.asset.top;
              var clipDimW = (orig && orig.width != null) ? Number(orig.width) : ((orig && orig.asset && orig.asset.width != null) ? Number(orig.asset.width) : null);
              var clipDimH = (orig && orig.height != null) ? Number(orig.height) : ((orig && orig.asset && orig.asset.height != null) ? Number(orig.asset.height) : null);
              if (clipDimW != null && clipDimH != null) {
                var tcx = (obj.left || 0) + clipDimW / 2;
                var tcy = (obj.top || 0) + clipDimH / 2;
                var tox = (tcx - width / 2) / width;
                var toy = -((tcy - height / 2) / height);
                textClip.offset = { x: Math.round(tox * 1e6) / 1e6, y: Math.round(toy * 1e6) / 1e6 };
              } else {
                var textOffset = offsetFromPosition(obj);
                if (textOffset) textClip.offset = textOffset;
              }
            }
          }
          pushClip(obj, textClip);
          return;
        }
        const clipPayload = { start: start, length: length };
        if (textIsPlaceholder) clipPayload.alias = textAlias;
        if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) clipPayload.opacity = obj.cfsOpacityTween;
        else if (obj.cfsClipOpacity != null) clipPayload.opacity = obj.cfsClipOpacity;
        else if (obj.opacity != null && obj.opacity !== 1) clipPayload.opacity = obj.opacity;
        if (obj.cfsLengthWasEnd) clipPayload._preserveEnd = true;
        if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
          clipPayload.offset = {
            x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0,
            y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0,
          };
        } else {
          var to = offsetFromPosition(obj);
          if (to) clipPayload.offset = to;
        }
        if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) {
          clipPayload.transform = { rotate: { angle: obj.cfsRotateTween } };
        }
        if (obj.cfsTransition && typeof obj.cfsTransition === 'object') clipPayload.transition = obj.cfsTransition;
        if (obj.cfsEffect != null) clipPayload.effect = obj.cfsEffect;
        if (obj.cfsFit != null) clipPayload.fit = obj.cfsFit;
        if (obj.cfsScale != null && typeof obj.cfsScale === 'number') clipPayload.scale = obj.cfsScale;

        const font = {
          family: obj.fontFamily || 'Roboto',
          size: obj.fontSize != null ? obj.fontSize : 48,
          color: obj.fill || '#000000',
        };
        if (obj.fontWeight != null) font.weight = obj.fontWeight;
        if (obj.opacity != null) font.opacity = obj.opacity;
        const asset = {
          type: 'rich-text',
          text: textIsPlaceholder ? ('{{ ' + textAlias + ' }}') : textContent,
          font: font,
        };
        if (obj.cfsLetterSpacing != null) { asset.style = asset.style || {}; asset.style.letterSpacing = obj.cfsLetterSpacing; }
        if (obj.cfsLineHeight != null) { asset.style = asset.style || {}; asset.style.lineHeight = obj.cfsLineHeight; }
        if (obj.cfsTextTransform) { asset.style = asset.style || {}; asset.style.textTransform = obj.cfsTextTransform; }
        if (obj.cfsTextDecoration) { asset.style = asset.style || {}; asset.style.textDecoration = obj.cfsTextDecoration; }
        if (obj.cfsGradient) { asset.style = asset.style || {}; asset.style.gradient = obj.cfsGradient; }
        if (obj.cfsStroke) asset.stroke = obj.cfsStroke;
        if (obj.cfsShadow) asset.shadow = obj.cfsShadow;
        if (obj.cfsAlignHorizontal || obj.cfsAlignVertical) asset.align = { horizontal: obj.cfsAlignHorizontal || 'center', vertical: obj.cfsAlignVertical || 'middle' };
        if (obj.cfsAnimation) asset.animation = obj.cfsAnimation;
        if (obj.cfsTextBackground) asset.background = { color: obj.cfsTextBackground };
        clipPayload.asset = asset;
        clipPayload.width = obj.width != null ? obj.width : 800;
        clipPayload.height = (obj.height != null ? obj.height : null) || 400;
        clipPayload.position = clipPayload.position || 'center';
        pushClip(obj, clipPayload);
        return;
      }

      if (obj.type === 'image') {
        if (obj.cfsImageToVideo && obj.cfsOriginalClip) {
          var itvClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          itvClip.start = start;
          itvClip.length = length;
          if (obj.cfsLengthWasEnd) itvClip._preserveEnd = true;
          pushClip(obj, itvClip);
          return;
        }
        var rawImgSrc = obj.src || '';
        var imgMergeKeyMaybe = obj.cfsMergeKey || (rawImgSrc && isPlaceholderContent(rawImgSrc, alias) ? alias : null) || extractMergeKeyFromOriginal(obj);
        var resolvedImgSrcForType = rawImgSrc;
        if (imgMergeKeyMaybe && options && options.mergeLookup && options.mergeLookup[imgMergeKeyMaybe] != null) {
          resolvedImgSrcForType = String(options.mergeLookup[imgMergeKeyMaybe]);
        }
        /* If an image slot now points to a video URL, export as ShotStack video clip. */
        if (isLikelyVideoSource(resolvedImgSrcForType) || isLikelyVideoSource(rawImgSrc)) {
          var vSrc = isLikelyVideoSource(rawImgSrc) ? rawImgSrc : resolvedImgSrcForType;
          var vAsset = { type: 'video', src: vSrc || '' };
          var vClip = {
            asset: vAsset,
            start: start,
            length: length,
            position: 'center',
            fit: obj.cfsFit != null ? obj.cfsFit : 'contain'
          };
          if (imgMergeKeyMaybe) {
            vClip.alias = imgMergeKeyMaybe;
            /* Keep merge contract so {{ IMAGE_X }} can still be swapped externally. */
            if (!isLikelyVideoSource(rawImgSrc)) vAsset.src = '{{ ' + imgMergeKeyMaybe + ' }}';
          }
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) vClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) vClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            vClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          } else {
            var vio = offsetFromPosition(obj);
            if (vio) vClip.offset = vio;
          }
          if (obj.cfsLengthWasEnd) vClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) vClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') vClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) vClip.effect = obj.cfsEffect;
          if (obj.cfsScale != null && typeof obj.cfsScale === 'number') vClip.scale = obj.cfsScale;
          var vBaseW = obj.width != null ? Number(obj.width) : 0;
          var vBaseH = obj.height != null ? Number(obj.height) : 0;
          if (vBaseW > 0 && vBaseH > 0) {
            vAsset.width = vBaseW;
            vAsset.height = vBaseH;
          }
          pushClip(obj, vClip);
          return;
        }

        if (!obj.cfsSvgSrc && obj.cfsOriginalClip && obj.cfsOriginalClip.asset && obj.cfsOriginalClip.asset.type === 'image') {
          var imgSrc = obj.src || '';
          var imgMergeKey = obj.cfsMergeKey || (imgSrc && isPlaceholderContent(imgSrc, alias) ? alias : null) || extractMergeKeyFromOriginal(obj);
          var imgIsPlaceholder = !!imgMergeKey;
          var imgAlias = imgMergeKey || alias;
          if (imgIsPlaceholder) mergeEntries.push({ find: imgAlias, replace: imgSrc });
          var imgClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          imgClip.start = start;
          imgClip.length = length;
          var origImgSrc = obj.cfsOriginalClip.asset.src || '';
          var useOrigUrl = typeof imgSrc === 'string' && imgSrc.indexOf('blob:') === 0 && typeof origImgSrc === 'string' && origImgSrc.indexOf('{{') === -1;
          imgClip.asset.src = imgIsPlaceholder ? ('{{ ' + imgAlias + ' }}') : (useOrigUrl ? origImgSrc : (imgSrc || ''));
          if (imgIsPlaceholder) imgClip.alias = imgAlias;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) imgClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) imgClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            imgClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          }
          if (!imgClip.offset && imgClip.position === 'center') imgClip.offset = { x: 0, y: 0 };
          if (obj.cfsLengthWasEnd) imgClip._preserveEnd = true;
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') imgClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) imgClip.effect = obj.cfsEffect;
          if (obj.cfsFit != null) imgClip.fit = obj.cfsFit;
          if (obj.cfsScale != null && typeof obj.cfsScale === 'number') imgClip.scale = obj.cfsScale;
          delete imgClip.asset.left;
          delete imgClip.asset.top;
          pushClip(obj, imgClip);
          return;
        }
        if (obj.cfsSvgSrc) {
          var svgAsset = {
            type: 'svg',
            src: obj.cfsSvgSrc,
            left: obj.left,
            top: obj.top,
            width: (obj.width != null ? obj.width : 400) * (obj.scaleX != null ? obj.scaleX : 1),
            height: (obj.height != null ? obj.height : 300) * (obj.scaleY != null ? obj.scaleY : 1),
          };
          var svgClip = { asset: svgAsset, start: start, length: length, position: 'center', fit: 'contain', alias: alias };
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) svgClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) svgClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) svgClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          if (obj.cfsLengthWasEnd) svgClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) svgClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') svgClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) svgClip.effect = obj.cfsEffect;
          pushClip(obj, svgClip);
        } else {
          var imgSrc = obj.src || '';
          var imgMergeKey = obj.cfsMergeKey || (imgSrc && isPlaceholderContent(imgSrc, alias) ? alias : null) || extractMergeKeyFromOriginal(obj);
          var imgIsPlaceholder = !!imgMergeKey;
          var imgAlias = imgMergeKey || alias;
          if (imgIsPlaceholder) mergeEntries.push({ find: imgAlias, replace: imgSrc });
          const imgAsset = {
            type: 'image',
            src: imgIsPlaceholder ? ('{{ ' + imgAlias + ' }}') : (imgSrc || ''),
            left: obj.left,
            top: obj.top,
            width: obj.width,
            height: obj.height,
          };
          if (obj.cfsRightPx != null) imgAsset.right = obj.cfsRightPx;
          if (obj.cfsBottomPx != null) imgAsset.bottom = obj.cfsBottomPx;
          const imgClip = { asset: imgAsset, start: start, length: length, position: 'center', fit: obj.cfsFit != null ? obj.cfsFit : 'contain' };
          if (imgIsPlaceholder) imgClip.alias = imgAlias;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) imgClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) imgClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            imgClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          } else {
            var io = offsetFromPosition(obj);
            if (io) imgClip.offset = io;
          }
          if (obj.cfsLengthWasEnd) imgClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) imgClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') imgClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) imgClip.effect = obj.cfsEffect;
          if (obj.cfsScale != null && typeof obj.cfsScale === 'number') imgClip.scale = obj.cfsScale;
          pushClip(obj, imgClip);
        }
        return;
      }

      if ((obj.type === 'rect' || obj.type === 'circle' || obj.type === 'path') && obj.cfsOriginalClip && obj.cfsOriginalClip.asset) {
        var origShapeType = (obj.cfsOriginalClip.asset || {}).type;
        if (origShapeType === 'html') {
          var htmlRectClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          htmlRectClip.start = start;
          htmlRectClip.length = length;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) htmlRectClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) htmlRectClip.opacity = obj.cfsClipOpacity;
          else if (obj.opacity != null && obj.opacity !== 1) htmlRectClip.opacity = obj.opacity;
          if (obj.cfsLengthWasEnd) htmlRectClip._preserveEnd = true;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            htmlRectClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          }
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') htmlRectClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) htmlRectClip.effect = obj.cfsEffect;
          pushClip(obj, htmlRectClip);
          return;
        }
        /* Pass through text-to-image and text-to-speech clips using their original clip data. */
        if (origShapeType === 'text-to-image' || origShapeType === 'text-to-speech') {
          var passClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          passClip.start = start;
          passClip.length = length;
          if (obj.cfsLengthWasEnd) passClip._preserveEnd = true;
          pushClip(obj, passClip);
          return;
        }
        if (origShapeType === 'rect' || origShapeType === 'circle' || origShapeType === 'svg' || origShapeType === 'shape') {
          var shapeClip = JSON.parse(JSON.stringify(obj.cfsOriginalClip));
          shapeClip.start = start;
          shapeClip.length = length;
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) shapeClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) shapeClip.opacity = obj.cfsClipOpacity;
          var origClipPos = (obj.cfsOriginalClip && obj.cfsOriginalClip.position) || 'center';
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) {
            shapeClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          } else {
            var so = offsetForAnchor(obj, origClipPos);
            if (so) shapeClip.offset = so;
          }
          if (obj.cfsLengthWasEnd) shapeClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) shapeClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (shapeClip.asset) {
            if (origShapeType === 'shape') {
              var origShape = (obj.cfsOriginalClip.asset || {}).shape;
              var shapeSize = getElementSize(obj);
              delete shapeClip.asset.left;
              delete shapeClip.asset.top;
              if (origShape === 'rectangle') {
                if (!shapeClip.asset.rectangle) shapeClip.asset.rectangle = {};
                if (shapeSize.w > 0) { shapeClip.asset.rectangle.width = shapeSize.w; shapeClip.width = shapeSize.w; }
                if (shapeSize.h > 0) { shapeClip.asset.rectangle.height = shapeSize.h; shapeClip.height = shapeSize.h; }
                if (obj.rx != null) shapeClip.asset.rectangle.cornerRadius = obj.rx;
                if (obj.fill != null) shapeClip.asset.fill = { color: obj.fill };
                if (typeof obj.stroke === 'string' && obj.stroke) {
                  shapeClip.asset.stroke = { color: obj.stroke, width: obj.strokeWidth || 0 };
                }
              } else if (origShape === 'circle') {
                if (!shapeClip.asset.circle) shapeClip.asset.circle = {};
                if (obj.radius != null) {
                  shapeClip.asset.circle.radius = obj.radius;
                  shapeClip.width = obj.radius * 2;
                  shapeClip.height = obj.radius * 2;
                }
                if (obj.fill != null) shapeClip.asset.fill = { color: obj.fill };
                if (typeof obj.stroke === 'string' && obj.stroke) {
                  shapeClip.asset.stroke = { color: obj.stroke, width: obj.strokeWidth || 0 };
                }
              }
            } else {
              if (obj.left != null) shapeClip.asset.left = obj.left;
              if (obj.top != null) shapeClip.asset.top = obj.top;
              var shapeSize = getElementSize(obj);
              if (shapeSize.w > 0) shapeClip.asset.width = shapeSize.w;
              if (shapeSize.h > 0) shapeClip.asset.height = shapeSize.h;
              if (obj.type === 'rect') {
                if (obj.fill != null) shapeClip.asset.fill = obj.fill;
                if (obj.rx != null) shapeClip.asset.rx = obj.rx;
                if (obj.ry != null) shapeClip.asset.ry = obj.ry;
                if (obj.stroke != null) shapeClip.asset.stroke = obj.stroke;
                if (obj.strokeWidth != null) shapeClip.asset.strokeWidth = obj.strokeWidth;
              } else if (obj.type === 'circle') {
                if (obj.fill != null) shapeClip.asset.fill = obj.fill;
                if (obj.radius != null) shapeClip.asset.radius = obj.radius;
                if (obj.stroke != null) shapeClip.asset.stroke = obj.stroke;
                if (obj.strokeWidth != null) shapeClip.asset.strokeWidth = obj.strokeWidth;
              } else if (obj.cfsSvgSrc && origShapeType === 'svg') {
                shapeClip.asset.src = obj.cfsSvgSrc;
              }
            }
          }
          pushClip(obj, shapeClip);
          return;
        }
      }

      if (obj.type === 'rect' && obj.cfsShapeLine) {
        var lineLen = obj.cfsLineLength != null ? Number(obj.cfsLineLength) : (obj.width != null ? obj.width : 100);
        var lineThick = obj.cfsLineThickness != null ? Number(obj.cfsLineThickness) : (obj.height != null ? obj.height : 4);
        var lineAsset = {
          type: 'shape',
          shape: 'line',
          fill: { color: obj.fill || '#ffffff', opacity: obj.opacity != null ? obj.opacity : 1 },
          stroke: { color: (obj.stroke != null ? obj.stroke : '#ffffff'), width: (obj.strokeWidth != null ? String(obj.strokeWidth) : '0') },
          width: lineLen,
          height: lineThick,
          line: { length: lineLen, thickness: lineThick },
        };
        var lineOffsetX = (obj.left != null && width > 0) ? (obj.left - width / 2) / width : 0;
        var lineOffsetY = (obj.top != null && height > 0) ? -((obj.top - height / 2) / height) : 0;
        var lineClip = { asset: lineAsset, start: start, length: length, position: 'center', offset: { x: lineOffsetX, y: lineOffsetY } };
        if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) lineClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : lineOffsetX, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : lineOffsetY };
        if (obj.angle != null && obj.angle !== 0) lineClip.transform = { rotate: { angle: obj.angle } };
        else if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) lineClip.transform = { rotate: { angle: obj.cfsRotateTween } };
        if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) lineClip.opacity = obj.cfsOpacityTween;
        else if (obj.cfsClipOpacity != null) lineClip.opacity = obj.cfsClipOpacity;
        if (obj.cfsLengthWasEnd) lineClip._preserveEnd = true;
        pushClip(obj, lineClip);
        return;
      }

      if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'path') {
        var svgSrc = shapeToSvgSrc(obj);
        if (svgSrc) {
          var svgAsset = {
            type: 'svg',
            src: svgSrc,
            left: obj.left,
            top: obj.top,
          };
          var clipW = (obj.width != null ? obj.width : 400) * (obj.scaleX != null ? obj.scaleX : 1);
          var clipH = (obj.height != null ? obj.height : 300) * (obj.scaleY != null ? obj.scaleY : 1);
          if (obj.type === 'circle') {
            var r = (obj.radius != null ? obj.radius : 20) * (obj.scaleX != null ? obj.scaleX : 1);
            clipW = r * 2;
            clipH = r * 2;
          }
          svgAsset.width = clipW;
          svgAsset.height = clipH;
          var svgClip = { asset: svgAsset, start: start, length: length, position: 'center', offset: { x: 0, y: 0 }, alias: alias };
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) svgClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) svgClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) svgClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          if (obj.cfsLengthWasEnd) svgClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) svgClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') svgClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) svgClip.effect = obj.cfsEffect;
          pushClip(obj, svgClip);
        } else if (obj.type === 'rect') {
          var rw = obj.width || 400;
          var rh = obj.height || 300;
          var rectAsset = {
            type: 'shape',
            shape: 'rectangle',
            fill: { color: obj.fill || '#eeeeee' },
            rectangle: {
              width: rw,
              height: rh,
              cornerRadius: obj.rx != null ? obj.rx : 0,
            },
            alias: name,
          };
          if (obj.stroke != null || obj.strokeWidth != null) {
            rectAsset.stroke = { color: obj.stroke || '#000000', width: obj.strokeWidth || 0 };
          }
          var rectOff = offsetFromPosition(obj) || { x: 0, y: 0 };
          var rectClip = { asset: rectAsset, start: start, length: length, width: rw, height: rh, position: 'center', offset: rectOff };
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) rectClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) rectClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) rectClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          if (obj.cfsLengthWasEnd) rectClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) rectClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') rectClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) rectClip.effect = obj.cfsEffect;
          pushClip(obj, rectClip);
        } else if (obj.type === 'circle') {
          var circR = (obj.radius != null ? obj.radius : 20) * (obj.scaleX != null ? obj.scaleX : 1);
          var circAsset = {
            type: 'shape',
            shape: 'circle',
            fill: { color: obj.fill || '#cccccc' },
            circle: { radius: circR },
            alias: name,
          };
          if (obj.stroke != null || obj.strokeWidth != null) {
            circAsset.stroke = { color: obj.stroke || '#000000', width: obj.strokeWidth || 0 };
          }
          var circOff = offsetFromPosition(obj) || { x: 0, y: 0 };
          var circClip = { asset: circAsset, start: start, length: length, width: circR * 2, height: circR * 2, position: 'center', offset: circOff };
          if (obj.cfsOpacityTween && Array.isArray(obj.cfsOpacityTween)) circClip.opacity = obj.cfsOpacityTween;
          else if (obj.cfsClipOpacity != null) circClip.opacity = obj.cfsClipOpacity;
          if (obj.cfsOffsetTween && (obj.cfsOffsetTween.x || obj.cfsOffsetTween.y)) circClip.offset = { x: Array.isArray(obj.cfsOffsetTween.x) ? obj.cfsOffsetTween.x : 0, y: Array.isArray(obj.cfsOffsetTween.y) ? obj.cfsOffsetTween.y : 0 };
          if (obj.cfsLengthWasEnd) circClip._preserveEnd = true;
          if (obj.cfsRotateTween && Array.isArray(obj.cfsRotateTween)) circClip.transform = { rotate: { angle: obj.cfsRotateTween } };
          if (obj.cfsTransition && typeof obj.cfsTransition === 'object') circClip.transition = obj.cfsTransition;
          if (obj.cfsEffect != null) circClip.effect = obj.cfsEffect;
          pushClip(obj, circClip);
        }
        return;
      }
    });

    const duration = time || 10;
    var trackIndices = Object.keys(trackMap).map(Number).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
    var maxTrack = trackIndices.length ? Math.max.apply(null, trackIndices) : 0;
    var tracks = [];
    for (var t = 0; t <= maxTrack; t++) {
      tracks.push({ clips: trackMap[t] || [] });
    }
    if (!tracks.length) tracks.push({ clips: [] });

    /* Restore length: "end" for clips that had it and run to timeline end; "auto" for media-length clips. */
    var timelineEnd = duration;
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        if (clip._preserveAuto) {
          clip.length = 'auto';
          delete clip._preserveAuto;
        }
        if (clip._preserveEnd) {
          var start = typeof clip.start === 'number' ? clip.start : 0;
          var len = typeof clip.length === 'number' ? clip.length : 0;
          if (start + len >= timelineEnd - 0.02) clip.length = 'end';
          delete clip._preserveEnd;
        }
      });
    });

    return {
      timeline: {
        background: background,
        tracks: tracks,
      },
      output: {
        format: options.format || 'mp4',
        resolution: options.resolution || 'hd',
        aspectRatio: options.aspectRatio || '16:9',
        size: { width: width, height: height },
        fps: options.fps || 25,
      },
      merge: mergeEntries.filter(function (m) { return m.find; }),
    };
  }

  global.__CFS_fabricToShotstack = fabricToShotstack;
})(typeof window !== 'undefined' ? window : globalThis);
