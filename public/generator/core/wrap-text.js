/**
 * Shared word-wrapping utility: measure text on a canvas 2d context and
 * insert newlines so no line exceeds maxWidth pixels.
 * Exposed as global.__CFS_wrapTextToWidth for use by scene.js,
 * template-engine.js, and unified-editor.js.
 */
(function (global) {
  'use strict';

  function wrapTextToWidth(rawText, fontFamily, fontSize, fontWeight, maxWidth, maxLines) {
    if (rawText == null) return '';
    var text = String(rawText);
    var width = Number(maxWidth);
    if (!(width > 0)) return text;
    var lineCap = (maxLines != null && Number(maxLines) > 0) ? Math.floor(Number(maxLines)) : null;
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    if (!ctx) return text;
    var size = Number(fontSize);
    if (!(size > 0)) size = 15;
    var family = fontFamily || 'sans-serif';
    if (typeof family === 'string' && family.indexOf('{{') >= 0) family = 'sans-serif';
    var weight = fontWeight || 'normal';
    ctx.font = String(weight) + ' ' + String(size) + 'px ' + String(family);
    var paragraphs = text.split(/\r?\n/);
    var out = [];
    for (var pi = 0; pi < paragraphs.length; pi++) {
      if (lineCap != null && out.length >= lineCap) break;
      var p = paragraphs[pi];
      if (!p) {
        out.push('');
        if (lineCap != null && out.length >= lineCap) break;
        continue;
      }
      var words = p.split(/\s+/).filter(Boolean);
      var line = '';
      for (var wi = 0; wi < words.length; wi++) {
        var word = words[wi];
        var test = line ? (line + ' ' + word) : word;
        if (ctx.measureText(test).width > width && line) {
          out.push(line);
          if (lineCap != null && out.length >= lineCap) {
            line = '';
            break;
          }
          line = word;
        } else {
          line = test;
        }
        while (line && ctx.measureText(line).width > width) {
          var splitAt = line.length - 1;
          while (splitAt > 1 && ctx.measureText(line.slice(0, splitAt)).width > width) splitAt--;
          var chunk = line.slice(0, splitAt);
          if (!chunk) break;
          out.push(chunk);
          if (lineCap != null && out.length >= lineCap) {
            line = '';
            break;
          }
          line = line.slice(splitAt);
        }
        if (lineCap != null && out.length >= lineCap) break;
      }
      if (line && (lineCap == null || out.length < lineCap)) out.push(line);
    }
    if (lineCap != null && out.length > lineCap) out = out.slice(0, lineCap);
    return out.join('\n');
  }

  global.__CFS_wrapTextToWidth = wrapTextToWidth;
})(typeof window !== 'undefined' ? window : globalThis);
