/**
 * Load timeline.fonts into the page so custom fonts are available for Pixi/canvas.
 * Injects @font-face for each timeline.fonts[].src; family is entry.family or extracted
 * from the font file's name table (nameID 4 = full name, fallback nameID 1 = family).
 * Call when loading a template for preview or export (e.g. from unified-editor or pixi-timeline-player).
 * MIT-compatible; no external deps.
 */
(function (global) {
  'use strict';

  var injected = {};
  var injectedStyleEls = [];

  function familyFromUrl(src) {
    if (!src || typeof src !== 'string') return 'CFSFont';
    try {
      var path = src.split('?')[0];
      var name = path.split('/').pop() || 'font';
      return name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ') || 'CFSFont';
    } catch (e) {
      return 'CFSFont';
    }
  }

  function isGenericFilename(src) {
    if (!src || typeof src !== 'string') return true;
    var name = src.split('?')[0].split('/').pop() || '';
    var base = name.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase().replace(/[-_]/g, '');
    return base === 'source' || base === 'font' || base === 'cfsfont' || base.length < 3;
  }

  /**
   * Parse TrueType/OpenType name table to extract the font's full name (nameID 4)
   * and family name (nameID 1). Returns { fullName, familyName } with either potentially null.
   */
  function parseFontNamesFromBuffer(buffer) {
    try {
      var view = new DataView(buffer);
      if (buffer.byteLength < 12) return { fullName: null, familyName: null };
      var numTables = view.getUint16(4);
      var nameOffset = 0;
      for (var i = 0; i < numTables; i++) {
        var off = 12 + i * 16;
        if (off + 16 > buffer.byteLength) break;
        var tag = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
        if (tag === 'name') {
          nameOffset = view.getUint32(off + 8);
          break;
        }
      }
      if (!nameOffset || nameOffset + 6 > buffer.byteLength) return { fullName: null, familyName: null };
      var nameCount = view.getUint16(nameOffset + 2);
      var storageOffset = nameOffset + view.getUint16(nameOffset + 4);
      var fullName = null;
      var familyName = null;
      for (var j = 0; j < nameCount; j++) {
        var rec = nameOffset + 6 + j * 12;
        if (rec + 12 > buffer.byteLength) break;
        var platformID = view.getUint16(rec);
        var nameID = view.getUint16(rec + 6);
        var len = view.getUint16(rec + 8);
        var strOff = storageOffset + view.getUint16(rec + 10);
        if (strOff + len > buffer.byteLength) continue;
        if (nameID !== 4 && nameID !== 1) continue;
        var str = '';
        if (platformID === 3 || platformID === 0) {
          for (var k = 0; k < len; k += 2) str += String.fromCharCode(view.getUint16(strOff + k));
        } else if (platformID === 1) {
          for (var k = 0; k < len; k++) str += String.fromCharCode(view.getUint8(strOff + k));
        }
        if (!str.trim()) continue;
        if (nameID === 4 && !fullName) fullName = str.trim();
        if (nameID === 1 && !familyName) familyName = str.trim();
        if (fullName && familyName) break;
      }
      return { fullName: fullName, familyName: familyName };
    } catch (e) {
      return { fullName: null, familyName: null };
    }
  }

  function parseFontFamilyFromBuffer(buffer) {
    var names = parseFontNamesFromBuffer(buffer);
    return names.fullName || names.familyName || null;
  }

  function injectFontFace(family, src) {
    var key = family + '|' + src;
    if (injected[key]) return;
    var head = typeof document !== 'undefined' && document.head;
    if (!head) return;
    var style = document.createElement('style');
    style.textContent = '@font-face { font-family: "' + family.replace(/"/g, '\\"') + '"; src: url("' + src.replace(/"/g, '\\"') + '") format("truetype"), url("' + src.replace(/"/g, '\\"') + '") format("opentype"); }';
    head.appendChild(style);
    injectedStyleEls.push(style);
    injected[key] = true;
  }

  var SYSTEM_FONTS = {
    'serif': 1, 'sans-serif': 1, 'monospace': 1, 'cursive': 1, 'fantasy': 1,
    'arial': 1, 'helvetica': 1, 'helvetica neue': 1, 'times new roman': 1,
    'times': 1, 'courier': 1, 'courier new': 1, 'georgia': 1, 'verdana': 1,
    'impact': 1, 'comic sans ms': 1, 'trebuchet ms': 1, 'tahoma': 1,
    'lucida console': 1, 'palatino': 1, 'garamond': 1, 'system-ui': 1,
    'arial black': 1,
  };
  var googleFontsInjected = {};

  function isSystemFont(family) {
    if (!family) return true;
    var lower = family.toLowerCase().trim();
    return !!SYSTEM_FONTS[lower];
  }

  function loadGoogleFont(family) {
    if (!family || googleFontsInjected[family]) return Promise.resolve();
    var head = typeof document !== 'undefined' && document.head;
    if (!head) return Promise.resolve();
    googleFontsInjected[family] = true;
    var encoded = encodeURIComponent(family).replace(/%20/g, '+');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encoded + ':wght@100;200;300;400;500;600;700;800;900&display=swap';
    head.appendChild(link);
    injectedStyleEls.push(link);
    var resolved = false;
    return new Promise(function (resolve) {
      function done() { if (!resolved) { resolved = true; resolve(); } }
      link.onload = function () {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
          document.fonts.load('400 16px "' + family + '"').then(done).catch(done);
        } else {
          done();
        }
      };
      link.onerror = done;
      setTimeout(done, 5000);
    });
  }

  function extractFontsFromTemplate(template) {
    var families = {};
    if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return families;
    template.timeline.tracks.forEach(function (track) {
      if (!track || !Array.isArray(track.clips)) return;
      track.clips.forEach(function (clip) {
        if (!clip || !clip.asset) return;
        var asset = clip.asset;
        if (asset.font && asset.font.family && typeof asset.font.family === 'string') {
          var raw = asset.font.family.split(',')[0].trim().replace(/['"]/g, '');
          if (raw && !isSystemFont(raw)) families[raw] = true;
        }
        if (asset.fontFamily && typeof asset.fontFamily === 'string') {
          var raw2 = asset.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
          if (raw2 && !isSystemFont(raw2)) families[raw2] = true;
        }
      });
    });
    return families;
  }

  /**
   * Inject @font-face for each timeline.fonts entry so the font is available to canvas/Pixi.
   * Also auto-detects font families used in text assets and loads them from Google Fonts.
   * Returns a Promise that resolves when all fonts (including fetched ones) are injected.
   * @param {{ timeline?: { fonts?: Array<{ src: string, family?: string }> } }} template
   * @returns {Promise<void>}
   */
  function loadTimelineFonts(template) {
    var head = typeof document !== 'undefined' && document.head;
    if (!head) return Promise.resolve();

    var autoFonts = extractFontsFromTemplate(template);
    var explicitFamilies = {};

    if (!template || !template.timeline || !Array.isArray(template.timeline.fonts)) {
      var googlePromises = [];
      Object.keys(autoFonts).forEach(function (f) { googlePromises.push(loadGoogleFont(f)); });
      return googlePromises.length ? Promise.all(googlePromises) : Promise.resolve();
    }
    var fonts = template.timeline.fonts;

    var fetchPromises = [];

    fonts.forEach(function (entry) {
      var src = entry.src || entry.url;
      if (!src || typeof src !== 'string' || src.indexOf('{{') !== -1) return;

      if (entry.family && String(entry.family).trim()) {
        injectFontFace(String(entry.family).trim(), src);
        return;
      }

      if (!isGenericFilename(src)) {
        injectFontFace(familyFromUrl(src), src);
        return;
      }

      var p = fetch(src).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.arrayBuffer();
      }).then(function (buf) {
        var names = parseFontNamesFromBuffer(buf);
        var primary = names.fullName || names.familyName || familyFromUrl(src);
        injectFontFace(primary, src);
        if (names.familyName && names.familyName !== primary) {
          injectFontFace(names.familyName, src);
        }
      }).catch(function () {
        injectFontFace(familyFromUrl(src), src);
      });
      fetchPromises.push(p);
    });

    fonts.forEach(function (entry) {
      if (entry.family) explicitFamilies[entry.family] = true;
    });
    Object.keys(autoFonts).forEach(function (f) {
      if (!explicitFamilies[f]) fetchPromises.push(loadGoogleFont(f));
    });

    return fetchPromises.length ? Promise.all(fetchPromises) : Promise.resolve();
  }

  function unloadAllFonts() {
    injectedStyleEls.forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    injectedStyleEls.length = 0;
    for (var k in injected) { if (injected.hasOwnProperty(k)) delete injected[k]; }
  }

  if (typeof global !== 'undefined') {
    global.__CFS_loadTimelineFonts = loadTimelineFonts;
    global.__CFS_unloadAllFonts = unloadAllFonts;
    global.__CFS_parseFontFamilyFromBuffer = parseFontFamilyFromBuffer;
    global.__CFS_parseFontNamesFromBuffer = parseFontNamesFromBuffer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
