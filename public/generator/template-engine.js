/**
 * Single template engine: loads templates (template.json with embedded __CFS_ editor metadata),
 * builds merge data, and runs generate (template-only logic, shared modules, or COMBINE_VIDEOS).
 * Preview uses the unified editor; image export uses template timeline render.
 */
(function () {
  'use strict';

  const CFS_PROJECT_FOLDER_DB = 'cfs_project_folder';
  const CFS_PROJECT_FOLDER_KEY = 'projectRoot';
  let baseUrl = '';
  let projectRootHandle = null;

  function getBaseUrl() {
    if (baseUrl) return baseUrl;
    baseUrl = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('') : (typeof location !== 'undefined' && location.origin ? location.origin + '/' : '');
    return baseUrl;
  }

  function getProjectFolderHandle() {
    return new Promise(function (resolve) {
      try {
        const r = indexedDB.open(CFS_PROJECT_FOLDER_DB, 1);
        r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('handles')) r.result.createObjectStore('handles'); };
        r.onsuccess = function () {
          const tx = r.result.transaction('handles', 'readonly');
          const getReq = tx.objectStore('handles').get(CFS_PROJECT_FOLDER_KEY);
          getReq.onsuccess = function () { resolve(getReq.result || null); };
          getReq.onerror = function () { resolve(null); };
        };
        r.onerror = function () { resolve(null); }
      } catch (_) { resolve(null); }
    });
  }

  async function readFileFromProjectFolder(projectRoot, relativePath) {
    if (!projectRoot || typeof relativePath !== 'string') return null;
    try {
      const perm = await projectRoot.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
      const parts = relativePath.replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length === 0) return null;
      let dir = projectRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (_) {
      return null;
    }
  }

  /** Read image from project folder by path; return data URL or null. */
  async function readImageAsDataUrlFromProjectFolder(projectRoot, relativePath) {
    if (!projectRoot || typeof relativePath !== 'string') return null;
    try {
      const perm = await projectRoot.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
      const parts = relativePath.replace(/^\/+|\/+$/g, '').split('/');
      if (parts.length === 0) return null;
      let dir = projectRoot;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
      const file = await fileHandle.getFile();
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      const ext = (parts[parts.length - 1].split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      return 'data:' + mime + ';base64,' + b64;
    } catch (_) {
      return null;
    }
  }

  /**
   * Parse select value: builtin:id vs project:id (bare id treated as builtin for back-compat).
   */
  function parseTemplateKey(templateKey) {
    const k = String(templateKey || '');
    if (k.indexOf('project:') === 0) return { source: 'project', id: k.slice(8) };
    if (k.indexOf('builtin:') === 0) return { source: 'builtin', id: k.slice(8) };
    return { source: 'builtin', id: k };
  }

  /**
   * Load system templates from bundled manifest + project templates from uploads/{projectId}/templates/*.json.
   * @returns {Promise<{ builtIn: Array<{key:string,id:string}>, project: Array<{key:string,id:string}> }>}
   */
  var _builtInIds = new Set();

  async function loadTemplateList() {
    const url = getBaseUrl() + 'generator/templates/manifest.json';
    let ids = [];
    try {
      const res = await fetch(url);
      const data = res.ok ? await res.json() : {};
      ids = data.templates || [];
    } catch (e) {
      console.warn('Load template manifest via fetch failed (expected on file:// protocol):', e.message || e);
      /* ── Inline fallback for file:// testing ── */
      if (window.__CFS_inlineTemplateIds && window.__CFS_inlineTemplateIds.length) {
        ids = window.__CFS_inlineTemplateIds;
        console.log('[template-engine] Using inline template fallback (' + ids.length + ' templates)');
      }
    }
    /* When inline fallback is active (file:// mode), do NOT mark these as built-in
       so they bypass the copy-to-project gate and load directly into the editor. */
    const isInlineFallback = !!(window.__CFS_inlineTemplates && Object.keys(window.__CFS_inlineTemplates).length);
    if (!isInlineFallback) {
      _builtInIds = new Set(ids);
    } else {
      _builtInIds = new Set(); // empty → none are "built-in" → all bypass copy dialog
    }
    const builtIn = isInlineFallback ? [] : ids.map(function (id) {
      return { key: 'builtin:' + id, id: id };
    });
    builtIn.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });

    const project = [];
    projectRootHandle = await getProjectFolderHandle();
    const projectId =
      typeof window !== 'undefined' && window.__CFS_generatorProjectId
        ? String(window.__CFS_generatorProjectId).trim()
        : '';
    if (projectRootHandle && projectId) {
      try {
        const perm = await projectRootHandle.requestPermission({ mode: 'read' });
        if (perm === 'granted') {
          try {
            const uploadsDir = await projectRootHandle.getDirectoryHandle('uploads', { create: false });
            const projDir = await uploadsDir.getDirectoryHandle(projectId, { create: false });
            const templatesDir = await projDir.getDirectoryHandle('templates', { create: false });
            for await (const entry of templatesDir.values()) {
              if (!entry || entry.kind !== 'file') continue;
              const name = entry.name || '';
              if (!/\.json$/i.test(name)) continue;
              const base = name.replace(/\.json$/i, '');
              if (!base) continue;
              project.push({ key: 'project:' + base, id: base });
            }
          } catch (_) {}
        }
      } catch (_) {}
    }
    /* In inline-fallback mode (file://), add inline templates as project templates
       so they appear in the dropdown and bypass the built-in copy gate. */
    if (isInlineFallback) {
      const existingProjectIds = new Set(project.map(function (p) { return p.id; }));
      ids.forEach(function (id) {
        if (!existingProjectIds.has(id)) {
          project.push({ key: 'project:' + id, id: id });
        }
      });
    }
    project.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    return { builtIn: builtIn, project: project };
  }

  var CFS_META_PREFIX = '__CFS_';
  var CFS_META_KEYS = {
    TEMPLATE_ID: 'id',
    TEMPLATE_NAME: 'name',
    DESCRIPTION: 'description',
    OUTPUT_TYPE: 'outputType',
    PRESET_ID: 'outputPresetId',
    DEFAULT_WORKFLOW_ID: 'defaultWorkflowId',
  };

  function extensionFromMerge(mergeArray) {
    if (!Array.isArray(mergeArray)) return {};
    var ext = {};
    mergeArray.forEach(function (m) {
      if (!m) return;
      var key = m.find != null ? String(m.find) : '';
      if (key.indexOf(CFS_META_PREFIX) !== 0) return;
      var suffix = key.slice(CFS_META_PREFIX.length);
      if (suffix === 'INPUT_SCHEMA') {
        try { ext.inputSchema = JSON.parse(m.replace); } catch (_) {}
        return;
      }
      var extKey = CFS_META_KEYS[suffix];
      if (extKey) ext[extKey] = m.replace != null ? m.replace : '';
    });
    return ext;
  }

  /**
   * Load template: project from uploads/{projectId}/templates/{id}.json; builtin from linked generator/templates or extension package.
   */
  async function loadTemplate(templateKey, options) {
    options = options || {};
    const parsed = parseTemplateKey(templateKey);
    const source = parsed.source;
    const bareId = parsed.id;
    const projectId =
      options.projectId != null && String(options.projectId).trim() !== ''
        ? String(options.projectId).trim()
        : typeof window !== 'undefined' && window.__CFS_generatorProjectId
          ? String(window.__CFS_generatorProjectId).trim()
          : '';

    let template = null;
    projectRootHandle = projectRootHandle || (await getProjectFolderHandle());

    if (source === 'project') {
      if (projectId && projectRootHandle) {
        const path = 'uploads/' + projectId + '/templates/' + bareId + '.json';
        const text = await readFileFromProjectFolder(projectRootHandle, path);
        if (text) {
          try {
            template = JSON.parse(text);
          } catch (_) {}
        }
      }
      /* ── Inline fallback for file:// testing (project-keyed but inline-sourced) ── */
      if (!template && window.__CFS_inlineTemplates && window.__CFS_inlineTemplates[bareId]) {
        template = JSON.parse(JSON.stringify(window.__CFS_inlineTemplates[bareId]));
        console.log('[template-engine] Loaded project template from inline fallback:', bareId);
      }
    } else {
      const templateFileName = 'template.json';
      const templatePath = 'generator/templates/' + bareId + '/' + templateFileName;
      if (projectRootHandle) {
        const text = await readFileFromProjectFolder(projectRootHandle, templatePath);
        if (text) {
          try {
            template = JSON.parse(text);
          } catch (_) {}
        }
      }
      if (!template) {
        try {
          const res = await fetch(
            getBaseUrl() + 'generator/templates/' + encodeURIComponent(bareId) + '/' + encodeURIComponent(templateFileName)
          );
          if (res.ok) template = await res.json();
        } catch (_) {}
      }
      /* ── Inline fallback for file:// testing ── */
      if (!template && window.__CFS_inlineTemplates && window.__CFS_inlineTemplates[bareId]) {
        template = JSON.parse(JSON.stringify(window.__CFS_inlineTemplates[bareId]));
        console.log('[template-engine] Loaded template from inline fallback:', bareId);
      }
    }

    const extension = template ? extensionFromMerge(template.merge) : {};

    return { extension: extension, template: template };
  }

  /**
   * Extract merge variable names (e.g. HEADLINE, SUBHEAD) from template JSON.
   * Used to only require variables that exist in the template (ignore excess; reflect add/delete of layers).
   */
  function getMergeKeysFromTemplate(template) {
    if (!template) return null;
    const str = typeof template === 'string' ? template : JSON.stringify(template);
    const keys = [];
    const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const key = m[1].toUpperCase().replace(/\s+/g, '_');
      if (keys.indexOf(key) === -1) keys.push(key);
    }
    return keys.length ? keys : null;
  }

  function isValidMergeValue(val) {
    if (val == null || val === '') return false;
    if (typeof val === 'string' && /^\s*\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*$/.test(val)) return false;
    return true;
  }

  function isValidMediaValue(val) {
    if (!isValidMergeValue(val)) return false;
    return typeof val === 'string' && /^(https?:|blob:|data:)/i.test(val.trim());
  }

  function isMediaFieldType(type) {
    return type === 'file' || type === 'file-video' || type === 'file-audio';
  }

  function resolveMergeWithFallbacks(field, allValues, mergeDefaults) {
    var key = (field.mergeField || field.id || '').toString().toUpperCase().replace(/\s+/g, '_');
    var isMedia = isMediaFieldType(field.type);
    var validate = isMedia ? isValidMediaValue : isValidMergeValue;

    var primary = allValues[field.id];
    if (primary === undefined || primary === null) primary = allValues[key];
    if (validate(primary)) return primary;

    if (Array.isArray(field.fallbacks)) {
      for (var i = 0; i < field.fallbacks.length; i++) {
        var fb = field.fallbacks[i];
        var fbUpper = String(fb).toUpperCase().replace(/\s+/g, '_');
        var fbVal = allValues[fb] !== undefined ? allValues[fb] : allValues[fbUpper];
        if (fbVal === undefined && mergeDefaults) fbVal = mergeDefaults[fb] || mergeDefaults[fbUpper];
        if (validate(fbVal)) return fbVal;
        if (!fbVal && /^(https?:|blob:|data:)/i.test(fb)) {
          if (validate(fb)) return fb;
        }
      }
    }

    var urlKey = 'CFS_' + key + '_URL';
    var urlVal = allValues[urlKey] || (mergeDefaults && mergeDefaults[urlKey]);
    if (validate(urlVal)) return urlVal;

    if (validate(field.default)) return field.default;
    var mergeDefault = mergeDefaults && (mergeDefaults[key] || mergeDefaults[field.id]);
    if (validate(mergeDefault)) return mergeDefault;

    return primary != null ? primary : (field.default != null ? field.default : '');
  }

  if (typeof window !== 'undefined') {
    window.__CFS_mergeUtils = {
      isValidMergeValue: isValidMergeValue,
      isValidMediaValue: isValidMediaValue,
      isMediaFieldType: isMediaFieldType,
      resolveMergeWithFallbacks: resolveMergeWithFallbacks,
    };
  }

  /**
   * Build merge array from extension.inputSchema (mergeField) and current values.
   * If template is provided, only include merge entries for variables that appear in the template ({{ VAR }}).
   * Excess variables in values are ignored. Missing values use field.default. Template-only variables (e.g. user-added layers) use values[key] or ''.
   */
  function buildMerge(extension, values, template) {
    const neededKeys = template ? getMergeKeysFromTemplate(template) : null;
    const merge = [];
    const added = {};
    var mergeDefaults = {};
    if (template && Array.isArray(template.merge)) {
      template.merge.forEach(function (m) {
        if (!m || !m.find) return;
        mergeDefaults[String(m.find).trim()] = m.replace != null ? m.replace : '';
      });
    }
    (extension.inputSchema || []).forEach(function (field) {
      const key = (field.mergeField || field.id || '').toString().toUpperCase().replace(/\s+/g, '_');
      if (!key) return;
      if (neededKeys && neededKeys.indexOf(key) === -1) return;
      let val = resolveMergeWithFallbacks(field, values, mergeDefaults);
      if (Array.isArray(val)) val = (field.type === 'list' ? val.join('\n') : JSON.stringify(val));
      let replace = val != null ? String(val) : '';
      if (replace.indexOf('\n') !== -1 && (field.mergeField || '').toUpperCase() === 'VIDEO_URL') replace = replace.split('\n')[0].trim();
      merge.push({ find: key, replace: replace });
      added[key] = true;
    });
    if (neededKeys) {
      neededKeys.forEach(function (key) {
        if (added[key]) return;
        const keyLower = key.toLowerCase().replace(/_/g, '');
        let replace = (values[key] != null ? values[key] : values[keyLower] != null ? values[keyLower] : '');
        if (typeof replace !== 'string') replace = String(replace != null ? replace : '');
        merge.push({ find: key, replace: replace });
      });
    }
    return merge;
  }

  /**
   * Apply merge to a copy of template (replace {{ VAR }} in timeline assets).
   */
  function applyMergeToTemplate(template, merge) {
    if (!template || !merge || !merge.length) return template;
    let json = JSON.stringify(template);
    merge.forEach(function (m) {
      const needle = '{{ ' + m.find + ' }}';
      json = json.split(needle).join(m.replace || '');
    });
    try {
      let parsed = JSON.parse(json);
      /* Resolve alias://KEY in any string (e.g. caption src "alias://VOICEOVER" → merge value for VOICEOVER). */
      var mergeByFind = {};
      merge.forEach(function (m) {
        if (m && m.find) mergeByFind[String(m.find).toUpperCase().replace(/\s+/g, '_')] = m.replace != null ? m.replace : '';
      });
      function replaceAliasInValue(val) {
        if (typeof val !== 'string') return val;
        var m = val.match(/^alias:\/\/(.+)$/i);
        if (!m) return val;
        var key = String(m[1]).trim().toUpperCase().replace(/\s+/g, '_');
        return mergeByFind[key] !== undefined ? mergeByFind[key] : val;
      }
      function replaceAliasInObject(obj) {
        if (typeof obj === 'string') return replaceAliasInValue(obj);
        if (Array.isArray(obj)) return obj.map(replaceAliasInObject);
        if (obj && typeof obj === 'object') {
          var out = {};
          for (var key in obj) if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = replaceAliasInObject(obj[key]);
          return out;
        }
        return obj;
      }
      parsed = replaceAliasInObject(parsed);
      /* Keep geometry numeric and responsive for apple-notes text clips. */
      function parseNumericMergeVal(raw, min) {
        if (raw == null) return null;
        var s = String(raw).trim();
        if (s === '') return null;
        var n = Number(s);
        if (isNaN(n)) return null;
        if (min != null && n < min) return null;
        return n;
      }
      var inset = null;
      var titleSize = null;
      var bodySize = null;
      for (var i = 0; i < merge.length; i++) {
        var k = (merge[i] && merge[i].find) ? String(merge[i].find).toUpperCase() : '';
        if (k === 'AD_APPLE_NOTES_TEXT_INSET_X') {
          var n = parseNumericMergeVal(merge[i].replace, 0);
          if (n != null) inset = n;
        } else if (k === 'AD_APPLE_NOTES_TITLE_SIZE') {
          var ts = parseNumericMergeVal(merge[i].replace, 1);
          if (ts != null) titleSize = ts;
        } else if (k === 'AD_APPLE_NOTES_BODY_SIZE') {
          var bs = parseNumericMergeVal(merge[i].replace, 1);
          if (bs != null) bodySize = bs;
        }
      }
      if ((inset != null || titleSize != null || bodySize != null) && parsed && parsed.timeline && Array.isArray(parsed.timeline.tracks)) {
        var outW = parsed && parsed.output && parsed.output.size && Number(parsed.output.size.width) > 0 ? Number(parsed.output.size.width) : 1080;
        var outH = parsed && parsed.output && parsed.output.size && Number(parsed.output.size.height) > 0 ? Number(parsed.output.size.height) : 1080;
        var mergeMap = {};
        merge.forEach(function (m) {
          var key = (m && m.find) ? String(m.find).toUpperCase() : '';
          if (!key) return;
          mergeMap[key] = m.replace != null ? String(m.replace) : '';
        });
        parsed.timeline.tracks.forEach(function (track) {
          (track.clips || []).forEach(function (clip) {
            var asset = clip && clip.asset;
            if (!asset || !asset.alias) return;
            if (asset.alias === 'AD_APPLE_NOTES_NAME_1') {
              if (inset != null) {
                asset.left = inset;
                asset.right = inset;
              }
              if (asset.font && titleSize != null) asset.font.size = Math.max(1, Math.round(titleSize));
              if (mergeMap.AD_APPLE_NOTES_NAME_1 != null) {
                var titleFontSize = asset.font && Number(asset.font.size) > 0 ? Number(asset.font.size) : 18;
                var titleLeft = Number(asset.left) || 60;
                var titleRight = Number(asset.right) || 60;
                var titleMaxW = Math.max(1, outW - titleLeft - titleRight);
                var titleLineH = Math.ceil(titleFontSize * 1.4);
                var titleMaxLines = Math.max(1, Math.floor(30 / titleLineH));
                asset.text = wrapTextByWidth(mergeMap.AD_APPLE_NOTES_NAME_1, (asset.font && asset.font.family) || 'sans-serif', titleFontSize, (asset.font && asset.font.weight) || 'bold', titleMaxW, titleMaxLines);
              }
            }
            if (asset.alias === 'AD_APPLE_NOTES_TEXT_1') {
              if (inset != null) {
                asset.left = inset;
                asset.right = inset;
              }
              if (asset.font && bodySize != null) asset.font.size = Math.max(1, Math.round(bodySize));
              if (mergeMap.AD_APPLE_NOTES_TEXT_1 != null) {
                var bodyFontSize = asset.font && Number(asset.font.size) > 0 ? Number(asset.font.size) : 15;
                var bodyLeft = Number(asset.left) || 60;
                var bodyRight = Number(asset.right) || 60;
                var bodyTop = Number(asset.top) || 130;
                var bodyMaxW = Math.max(1, outW - bodyLeft - bodyRight);
                var bodyLineH = Math.ceil(bodyFontSize * 1.4);
                var bodyAvailH = Math.max(bodyLineH, outH - bodyTop - 40);
                var bodyMaxLines = Math.max(1, Math.floor(bodyAvailH / bodyLineH));
                asset.text = wrapTextByWidth(mergeMap.AD_APPLE_NOTES_TEXT_1, (asset.font && asset.font.family) || 'sans-serif', bodyFontSize, (asset.font && asset.font.weight) || 'normal', bodyMaxW, bodyMaxLines);
              }
            }
          });
        });
      }
      /* Harden apple-notes chrome: if stale template version is loaded, inject missing header/buttons. */
      if (parsed && parsed.timeline && Array.isArray(parsed.timeline.tracks) && parsed.timeline.tracks.length) {
        var firstTrack = parsed.timeline.tracks[0];
        var clips = Array.isArray(firstTrack.clips) ? firstTrack.clips : [];
        var hasNameAlias = false;
        var hasBodyAlias = false;
        var hasHeader = false;
        var hasRed = false;
        var hasYellow = false;
        var hasGreen = false;
        clips.forEach(function (c) {
          var a = c && c.asset;
          if (!a || !a.alias) return;
          if (a.alias === 'AD_APPLE_NOTES_NAME_1') hasNameAlias = true;
          if (a.alias === 'AD_APPLE_NOTES_TEXT_1') hasBodyAlias = true;
          if (a.alias === 'note_header') hasHeader = true;
          if (a.alias === 'btn_red') hasRed = true;
          if (a.alias === 'btn_yellow') hasYellow = true;
          if (a.alias === 'btn_green') hasGreen = true;
        });
        if (hasNameAlias && hasBodyAlias) {
          var injected = [];
          if (!hasHeader) {
            injected.push({
              asset: {
                type: 'rect',
                fill: '#f9f9f9',
                height: 40,
                rx: 12,
                ry: 12,
                left: 40,
                top: 40,
                right: 40,
                alias: 'note_header'
              },
              start: 0,
              length: 10
            });
          }
          if (!hasRed) {
            injected.push({ asset: { type: 'circle', fill: '#ff5f57', radius: 10, left: 54, top: 50, alias: 'btn_red' }, start: 0, length: 10 });
          }
          if (!hasYellow) {
            injected.push({ asset: { type: 'circle', fill: '#febc2e', radius: 10, left: 78, top: 50, alias: 'btn_yellow' }, start: 0, length: 10 });
          }
          if (!hasGreen) {
            injected.push({ asset: { type: 'circle', fill: '#28c840', radius: 10, left: 102, top: 50, alias: 'btn_green' }, start: 0, length: 10 });
          }
          if (injected.length) {
            var noteCardIdx = clips.findIndex(function (c) { return c && c.asset && c.asset.alias === 'note_card'; });
            var insertAt = noteCardIdx >= 0 ? noteCardIdx + 1 : 0;
            firstTrack.clips = clips.slice(0, insertAt).concat(injected, clips.slice(insertAt));
          }
        }
      }
      return parsed;
    } catch (_) {
      return template;
    }
  }

  /**
   * Seek time for a single still frame so progressive animation presets (typewriter, fade-in, etc.)
   * match their completed state. Mirrors defaults in pixi-timeline-player seek (anim duration vs clip length).
   */
  function computeStillImageSeekTimeSec(mergedTemplate, timelineDurationSec) {
    var tracks = (mergedTemplate && mergedTemplate.timeline && mergedTemplate.timeline.tracks) || [];
    var maxEnd = 0;
    var progressivePresets = {
      typewriter: true,
      fadein: true,
      'fade-in': true,
      slidein: true,
      'slide-in': true,
      ascend: true,
      shift: true,
      movingletters: true,
      'moving-letters': true,
    };
    tracks.forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        var asset = clip.asset || {};
        var anim = asset.animation;
        if (!anim || anim.preset == null || anim.preset === 'none') return;
        var preset = String(anim.preset).toLowerCase();
        if (!progressivePresets[preset]) return;
        var start = Number(clip.start);
        if (!isFinite(start)) start = 0;
        var clipLen = Number(clip.length);
        if (!isFinite(clipLen) || clipLen <= 0) clipLen = 2;
        var animDur = (typeof anim.duration === 'number' && isFinite(anim.duration)) ? anim.duration : Math.min(clipLen, 2);
        maxEnd = Math.max(maxEnd, start + animDur);
      });
    });
    var cap = (typeof timelineDurationSec === 'number' && isFinite(timelineDurationSec) && timelineDurationSec > 0)
      ? timelineDurationSec - 0.001
      : maxEnd;
    return Math.min(Math.max(maxEnd, 0), cap);
  }

  /**
   * Deep-clone template and remove clips marked _cfsHideOnImage (still-image export only).
   */
  function omitHideOnImageClipsFromTemplate(tmpl) {
    var copy = JSON.parse(JSON.stringify(tmpl));
    if (!copy.timeline || !Array.isArray(copy.timeline.tracks)) return copy;
    copy.timeline.tracks = copy.timeline.tracks.map(function (track) {
      if (!track) return track;
      var clips = (track.clips || []).filter(function (c) { return !c || !c._cfsHideOnImage; });
      return Object.assign({}, track, { clips: clips });
    });
    return copy;
  }

  /**
   * Render timeline to a 2d canvas (one frame). Used when template has timeline.
   * Seeks past progressive text/animation so PNG/JPEG stills show final content; video export still plays from 0.
   * Returns Promise<dataURL>.
   */
  function renderTemplateToImageWithPixi(mergedTemplate) {
    if (!mergedTemplate || !mergedTemplate.timeline) return Promise.reject(new Error('No timeline'));
    const createPlayer = typeof window !== 'undefined' && window.__CFS_pixiShotstackPlayer;
    const hasPixi = typeof window !== 'undefined' && window.PIXI;
    if (!createPlayer || !hasPixi) {
      return Promise.reject(new Error('Pixi image rendering is required. Ensure pixi.min.js and pixi-timeline-player.js are loaded.'));
    }
    let player = null;
    try {
      player = createPlayer({ merge: [] });
    } catch (e) {
      return Promise.reject(new Error('Failed to initialize Pixi renderer: ' + (e && e.message ? e.message : String(e))));
    }
    if (!player || typeof player.load !== 'function') {
      return Promise.reject(new Error('Pixi renderer unavailable: invalid player instance.'));
    }
    var templateForStill = omitHideOnImageClipsFromTemplate(mergedTemplate);
    return player.load(templateForStill)
      .then(function () {
        var durationSec = typeof player.getDuration === 'function' ? player.getDuration() : 0;
        var seekT = computeStillImageSeekTimeSec(templateForStill, durationSec);
        player.seek(seekT);
        return player.captureFrame({ format: 'png', quality: 1 });
      })
      .then(function (dataUrl) {
        if (player && typeof player.destroy === 'function') {
          try { player.destroy(); } catch (_) {}
        }
        if (!dataUrl) throw new Error('Pixi capture returned empty frame. Template may use unsupported assets/effects.');
        return dataUrl;
      })
      .catch(function (e) {
        if (player && typeof player.destroy === 'function') {
          try { player.destroy(); } catch (_) {}
        }
        throw new Error('Pixi image rendering failed: ' + (e && e.message ? e.message : String(e)));
      });
  }

  function renderTemplateToImage(mergedTemplate) {
    if (!mergedTemplate || !mergedTemplate.timeline) return Promise.reject(new Error('No timeline'));
    return renderTemplateToImageWithPixi(mergedTemplate);
  }

  /**
   * Pre-generate TTS audio for all text-to-speech clips in the template.
   * Checks disk cache (uploads/{pid}/generations/{tid}/audio/) first; only
   * calls the TTS engine for uncached chunks. Newly generated blobs are
   * saved to disk so subsequent renders (and Fabric.js preview) reuse them.
   * Returns Promise<{ map: Object, revoke: string[] }>.
   */
  function preGenerateTtsForTemplate(mergedTemplate) {
    const ttsGenerate = typeof window !== 'undefined' && window.__CFS_ttsGenerate;
    const ttsCache = typeof window !== 'undefined' && window.__CFS_ttsAudioCache;
    const map = {};
    const revoke = [];
    if (!ttsGenerate || !mergedTemplate || !mergedTemplate.timeline || !Array.isArray(mergedTemplate.timeline.tracks)) {
      return Promise.resolve({ map: map, revoke: revoke });
    }

    /* Resolve project context for disk cache */
    const projId = (typeof window !== 'undefined' && window.__CFS_generatorProjectId || '').toString().trim();
    const templateId = (function () {
      var merge = mergedTemplate.merge || [];
      for (var i = 0; i < merge.length; i++) {
        if (merge[i] && merge[i].find === '__CFS_TEMPLATE_ID' && merge[i].replace) return merge[i].replace;
      }
      return '';
    })();
    const cacheEnabled = !!(ttsCache && projId && templateId);
    const rootPromise = cacheEnabled ? getProjectFolderHandle() : Promise.resolve(null);

    return rootPromise.then(function (projRoot) {
      const tracks = mergedTemplate.timeline.tracks;
      const promises = [];

      /* Find caption display settings (matching Fabric.js chunking) */
      var captionDisplay = {};
      var captionWords = null;
      for (var fti = 0; fti < tracks.length; fti++) {
        var fClips = tracks[fti].clips || [];
        for (var fci = 0; fci < fClips.length; fci++) {
          var fAsset = fClips[fci].asset || {};
          if ((fAsset.type === 'caption' || fAsset.type === 'rich-caption') && Array.isArray(fAsset.words) && fAsset.words.length) {
            captionDisplay = fAsset.display || {};
            captionWords = fAsset.words;
            break;
          }
        }
        if (captionWords) break;
      }
      var wpl = (captionDisplay.wordsPerLine || 4);
      var numLines = (captionDisplay.lines || 2);
      var chunkSize = wpl * numLines;

      tracks.forEach(function (track, trackIdx) {
        (track.clips || []).forEach(function (clip, clipIdx) {
          const asset = clip.asset || {};
          const type = (asset.type || '').toLowerCase();
          if (type !== 'text-to-speech') return;
          const fullText = (asset.text != null ? String(asset.text) : '').trim();
          if (!fullText) return;
          var voice = (asset.localVoice || asset.voice || '').toString();
          /* Match Fabric.js voice resolution: non-Kokoro voices fall back to af_heart */
          if (!/^[a-z]{2}_[a-z]/i.test(voice)) voice = 'af_heart';
          const mapKey = trackIdx + '_' + clipIdx;

          /* Build per-chunk text list matching Fabric.js chunking */
          var textWords = fullText.split(/\s+/).filter(Boolean);
          var chunkTexts = [];
          for (var ci = 0; ci < textWords.length; ci += chunkSize) {
            chunkTexts.push(textWords.slice(ci, ci + chunkSize).join(' '));
          }

          /* Generate or load each chunk, then concatenate into one WAV */
          function loadChunkSequential(idx, chunkBlobs) {
            if (idx >= chunkTexts.length) return Promise.resolve(chunkBlobs);
            var chunkText = chunkTexts[idx];
            var ck = ttsCache ? ttsCache.getChunkKey(voice, chunkText) : '';
            var diskP = (ttsCache && projRoot && ck)
              ? ttsCache.loadTtsChunk(projRoot, projId, templateId, ck).catch(function () { return null; })
              : Promise.resolve(null);

            return diskP.then(function (hit) {
              if (hit && hit.blob) {
                console.log('[TTS cache/pixi] Chunk ' + idx + ' from disk: ' + ck + (hit.words ? ' (with words)' : ''));
                chunkBlobs.push({ blob: hit.blob, duration: hit.duration || 0 });
                return loadChunkSequential(idx + 1, chunkBlobs);
              }
              /* Generate fresh */
              return Promise.resolve(ttsGenerate(chunkText, { voice: voice })).then(function (blob) {
                if (!blob || blob.size < 100) {
                  chunkBlobs.push({ blob: blob || new Blob(), duration: 0 });
                  return loadChunkSequential(idx + 1, chunkBlobs);
                }
                /* Trim silence */
                var trimP = (ttsCache && ttsCache.trimSilence)
                  ? ttsCache.trimSilence(blob)
                  : Promise.resolve({ blob: blob, duration: 0 });
                return trimP.then(function (trimResult) {
                  var tb = trimResult.blob;
                  chunkBlobs.push({ blob: tb, duration: trimResult.duration || 0 });
                  /* Save to disk */
                  if (ttsCache && projRoot && ck) {
                    return ttsCache.saveTtsChunk(projRoot, projId, templateId, voice, chunkText, tb, trimResult.duration || 0)
                      .then(function () { console.log('[TTS cache/pixi] Saved chunk to disk: ' + ck); })
                      .catch(function () {});
                  }
                }).then(function () {
                  return loadChunkSequential(idx + 1, chunkBlobs);
                });
              });
            });
          }

          promises.push(
            loadChunkSequential(0, []).then(function (chunkBlobs) {
              if (!chunkBlobs.length) return;
              /* Concatenate WAV blobs into one */
              return concatenateWavBlobs(chunkBlobs.map(function (c) { return c.blob; })).then(function (combined) {
                if (!combined || combined.size < 100) return;
                if (typeof URL !== 'undefined' && URL.createObjectURL) {
                  var url = URL.createObjectURL(combined);
                  map[mapKey] = url;
                  revoke.push(url);
                }
              });
            }).catch(function (err) { console.warn('[CFS] TTS generation failed for clip', mapKey, err); })
          );
        });
      });
      return Promise.all(promises).then(function () {
        /* ── Sync caption word timings to actual TTS audio duration ── */
        return syncCaptionTimingsToTts(mergedTemplate, map).then(function () {
          return { map: map, revoke: revoke };
        });
      });
    });
  }

  /**
   * Concatenate multiple WAV blobs into a single WAV blob.
   * Assumes all are 16-bit PCM WAV. Decodes via OfflineAudioContext, concatenates samples, and re-encodes.
   */
  function concatenateWavBlobs(blobs) {
    if (!blobs || !blobs.length) return Promise.resolve(null);
    if (blobs.length === 1) return Promise.resolve(blobs[0]);
    var AudioCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
      : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);
    if (!AudioCtx) return Promise.resolve(blobs[0]);

    return Promise.all(blobs.map(function (b) {
      return b.arrayBuffer().then(function (ab) {
        var ctx = new AudioCtx(1, 24000, 24000);
        return ctx.decodeAudioData(ab).then(function (buf) {
          return buf;
        });
      }).catch(function () { return null; });
    })).then(function (buffers) {
      buffers = buffers.filter(Boolean);
      if (!buffers.length) return null;
      if (buffers.length === 1) {
        /* Re-encode single buffer as WAV */
        return encodeAudioBufferAsWav(buffers[0]);
      }
      var sampleRate = buffers[0].sampleRate;
      var totalFrames = 0;
      buffers.forEach(function (b) { totalFrames += b.length; });
      var ctx2 = new AudioCtx(1, totalFrames, sampleRate);
      var combined = ctx2.createBuffer(1, totalFrames, sampleRate);
      var channel = combined.getChannelData(0);
      var offset = 0;
      buffers.forEach(function (b) {
        channel.set(b.getChannelData(0), offset);
        offset += b.length;
      });
      return encodeAudioBufferAsWav(combined);
    });
  }

  /**
   * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
   */
  function encodeAudioBufferAsWav(audioBuffer) {
    var numChannels = 1;
    var sampleRate = audioBuffer.sampleRate;
    var samples = audioBuffer.getChannelData(0);
    var numFrames = samples.length;
    var bytesPerSample = 2;
    var dataSize = numFrames * bytesPerSample;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);
    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);
    var idx = 44;
    for (var i = 0; i < numFrames; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      idx += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * After TTS audio is loaded, update caption word timings in the template
   * so they match the actual audio duration. This ensures karaoke-style
   * word highlighting stays in sync with the TTS audio during export.
   *
   * Priority:
   *   1. Use cached per-word timings from the manifest (saved by Fabric.js after STT)
   *   2. Fall back to decoding audio + character-proportional distribution
   */
  function syncCaptionTimingsToTts(mergedTemplate, ttsMap) {
    if (!mergedTemplate || !mergedTemplate.timeline || !Array.isArray(mergedTemplate.timeline.tracks)) {
      return Promise.resolve();
    }
    var tracks = mergedTemplate.timeline.tracks;
    var ttsCache = typeof window !== 'undefined' && window.__CFS_ttsAudioCache;

    /* Find caption asset with words */
    var captionAsset = null;
    for (var ti = 0; ti < tracks.length; ti++) {
      var clips = tracks[ti].clips || [];
      for (var ci = 0; ci < clips.length; ci++) {
        var a = clips[ci].asset || {};
        if ((a.type === 'caption' || a.type === 'rich-caption') && Array.isArray(a.words) && a.words.length) {
          captionAsset = a;
          break;
        }
      }
      if (captionAsset) break;
    }
    if (!captionAsset || !captionAsset.words || !captionAsset.words.length) {
      return Promise.resolve();
    }
    var display = captionAsset.display || {};
    var wpl = display.wordsPerLine || 4;
    var numLines = display.lines || 2;
    var chunkSize = wpl * numLines;
    var words = captionAsset.words;

    /* Build text chunks matching caption chunking */
    var textChunks = [];
    for (var i = 0; i < words.length; i += chunkSize) {
      var end = Math.min(i + chunkSize, words.length);
      var chunkWords = words.slice(i, end);
      var chunkText = chunkWords.map(function (w) { return w.text || ''; }).join(' ');
      textChunks.push({ text: chunkText, wordStart: i, wordEnd: end - 1 });
    }

    var ttsKeys = Object.keys(ttsMap);
    if (!ttsKeys.length) return Promise.resolve();

    /* ── Strategy 1: Load cached word timings from manifest ── */
    var projId = (typeof window !== 'undefined' && window.__CFS_generatorProjectId || '').toString().trim();
    var templateId = (function () {
      var merge = mergedTemplate.merge || [];
      for (var mi = 0; mi < merge.length; mi++) {
        if (merge[mi] && merge[mi].find === '__CFS_TEMPLATE_ID' && merge[mi].replace) return merge[mi].replace;
      }
      return '';
    })();

    var manifestPromise = (ttsCache && projId && templateId)
      ? getProjectFolderHandle().then(function (root) {
          if (!root) return null;
          return ttsCache.loadManifest(root, projId, templateId);
        }).catch(function () { return null; })
      : Promise.resolve(null);

    return manifestPromise.then(function (manifest) {
      /* Try to find cached word timings for each chunk */
      if (manifest && manifest.chunks) {
        var ttsVoice = '';
        /* Find TTS voice from the template */
        for (var tvi = 0; tvi < tracks.length; tvi++) {
          var tClips = tracks[tvi].clips || [];
          for (var tci = 0; tci < tClips.length; tci++) {
            var tAsset = tClips[tci].asset || {};
            if (tAsset.type === 'text-to-speech') {
              ttsVoice = (tAsset.localVoice || tAsset.voice || '').toString();
              break;
            }
          }
          if (ttsVoice) break;
        }
        /* Apply same Kokoro voice fallback as generation path */
        if (!/^[a-z]{2}_[a-z]/i.test(ttsVoice)) ttsVoice = 'af_heart';

        var allCached = true;
        var cachedChunkData = [];
        for (var cci = 0; cci < textChunks.length; cci++) {
          var cKey = ttsCache ? ttsCache.getChunkKey(ttsVoice, textChunks[cci].text) : '';
          var entry = cKey && manifest.chunks[cKey];
          if (entry && Array.isArray(entry.words) && entry.words.length) {
            cachedChunkData.push({ chunk: textChunks[cci], words: entry.words, duration: entry.duration || 0 });
          } else {
            allCached = false;
            break;
          }
        }

        if (allCached && cachedChunkData.length) {
          /* Apply cached word timings */
          var runningOffset = 0;
          for (var ai = 0; ai < cachedChunkData.length; ai++) {
            var cd = cachedChunkData[ai];
            var chunkWordCount = cd.chunk.wordEnd - cd.chunk.wordStart + 1;
            var cachedWords = cd.words;
            /* Map cached words (relative to chunk start) to absolute timeline time */
            for (var wi = 0; wi < chunkWordCount && wi < cachedWords.length; wi++) {
              var w = words[cd.chunk.wordStart + wi];
              w.start = Math.round((runningOffset + cachedWords[wi].start) * 1000) / 1000;
              w.end = Math.round((runningOffset + cachedWords[wi].end) * 1000) / 1000;
            }
            runningOffset += cd.duration;
          }
          console.log('[TTS sync] Applied cached word timings from manifest (' + words.length + ' words, ' +
            runningOffset.toFixed(2) + 's)');
          return;
        }
      }

      /* ── Strategy 2: Fall back to audio decode + character-proportional ── */
      var AudioCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
        : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);
      if (!AudioCtx) return;

      return Promise.all(ttsKeys.map(function (key) {
        var url = ttsMap[key];
        return fetch(url).then(function (res) { return res.arrayBuffer(); }).then(function (ab) {
          var ctx = new AudioCtx(1, 24000, 24000);
          return ctx.decodeAudioData(ab).then(function (buf) {
            return { key: key, duration: buf.duration };
          });
        }).catch(function () { return { key: key, duration: 0 }; });
      })).then(function (durations) {
        var totalTtsDuration = 0;
        durations.forEach(function (d) { totalTtsDuration += d.duration; });
        if (totalTtsDuration <= 0) return;

        var runningOffset = 0;
        if (textChunks.length === durations.length) {
          for (var dci = 0; dci < textChunks.length; dci++) {
            var chunk = textChunks[dci];
            var chunkDur = durations[dci].duration || 0;
            if (chunkDur <= 0) { runningOffset += chunkDur; continue; }
            distributeWordTimings(words, chunk.wordStart, chunk.wordEnd - chunk.wordStart + 1, runningOffset, chunkDur);
            runningOffset += chunkDur;
          }
        } else {
          distributeWordTimings(words, 0, words.length, 0, totalTtsDuration);
        }

        console.log('[TTS sync] Distributed word timings proportionally (' + words.length + ' words, ' +
          totalTtsDuration.toFixed(2) + 's TTS audio)');
      });
    });
  }

  /**
   * Distribute word timings proportional to character length within a range.
   */
  function distributeWordTimings(words, startIdx, count, offset, duration) {
    var totalChars = 0;
    for (var i = 0; i < count; i++) {
      totalChars += Math.max(1, (words[startIdx + i].text || '').replace(/[^a-zA-Z0-9]/g, '').length);
    }
    if (totalChars <= 0) totalChars = count;
    var t = offset;
    for (var j = 0; j < count; j++) {
      var w = words[startIdx + j];
      var charLen = Math.max(1, (w.text || '').replace(/[^a-zA-Z0-9]/g, '').length);
      var wordDur = duration * charLen / totalChars;
      w.start = Math.round(t * 1000) / 1000;
      w.end = Math.round((t + wordDur) * 1000) / 1000;
      t += wordDur;
    }
  }

  /**
   * Render timeline to video blob using PixiJS timeline player + MediaRecorder.
   * Used for bulk video and by the editor's Export video when returning a blob is needed.
   * Pre-generates TTS for text-to-speech clips (if __CFS_ttsGenerate is set) before building the audio mix.
   * mergedTemplate: ShotStack-style JSON with timeline (merge already applied).
   * options.onProgress: optional function(seconds, totalSeconds) for bulk status.
   * Returns Promise<Blob> or rejects if Pixi/MediaRecorder unavailable.
   */
  function renderTimelineToVideoBlob(mergedTemplate, options) {
    options = options || {};
    const createPlayer = typeof window !== 'undefined' && window.__CFS_pixiShotstackPlayer;
    const PIXI = typeof window !== 'undefined' && window.PIXI;
    if (!createPlayer || !PIXI) {
      return Promise.reject(new Error('Video export requires PixiJS. Ensure pixi.min.js and pixi-timeline-player.js are loaded.'));
    }
    if (typeof MediaRecorder === 'undefined') {
      return Promise.reject(new Error('Video export requires the MediaRecorder API.'));
    }
    let ttsRevoke = [];
    return preGenerateTtsForTemplate(mergedTemplate).then(function (ttsResult) {
      ttsRevoke = ttsResult.revoke || [];
      const merge = {};
      const player = createPlayer({ merge: merge, preGeneratedTts: ttsResult.map || {} });
      return player.load(mergedTemplate).then(function () {
      var totalDuration = Math.max(1, Math.min(120, player.getDuration() || 10));
      var rangeStart = 0;
      var rangeLength = totalDuration;
      if (mergedTemplate && mergedTemplate.output && mergedTemplate.output.range) {
        var outRange = mergedTemplate.output.range;
        if (outRange.start != null && isFinite(Number(outRange.start))) rangeStart = Math.max(0, Number(outRange.start));
        if (outRange.length != null && isFinite(Number(outRange.length))) rangeLength = Math.max(0.1, Number(outRange.length));
      }
      rangeLength = Math.min(rangeLength, totalDuration - rangeStart);
      const durationSec = Math.max(1, rangeLength);
      const out = (mergedTemplate && mergedTemplate.output) || {};
      const fps = Math.max(1, Math.min(30, (out.fps != null ? Number(out.fps) : 25)) || 25);
      const canvasEl = player.getCanvas();
      if (!canvasEl || typeof canvasEl.captureStream !== 'function') {
        player.destroy();
        return Promise.reject(new Error('PixiJS canvas capture not available.'));
      }
      const mime = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) ? 'video/webm;codecs=vp9' : 'video/webm';
      const mimeFinal = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime)) ? mime : 'video/webm';
      var stream = canvasEl.captureStream(fps);
      return Promise.resolve(player.createMixedAudioPlayback ? player.createMixedAudioPlayback({ durationSec: durationSec, rangeStart: rangeStart }) : null).catch(function () { return null; }).then(function (audioPlayback) {
        try {
          if (audioPlayback && audioPlayback.stream && typeof audioPlayback.stream.getAudioTracks === 'function') {
            var audioTracks = audioPlayback.stream.getAudioTracks() || [];
            if (audioTracks[0]) stream.addTrack(audioTracks[0]);
          }
        } catch (_) {}
        let recorder;
        try {
          recorder = new MediaRecorder(stream, { mimeType: mimeFinal, videoBitsPerSecond: 2500000 });
        } catch (e) {
          if (audioPlayback && audioPlayback.stop) audioPlayback.stop();
          player.destroy();
          return Promise.reject(new Error('MediaRecorder could not be created: ' + (e && e.message ? e.message : String(e))));
        }
      const onProgress = options.onProgress;
      const chunks = [];
      return new Promise(function (resolve, reject) {
        function revokeTts() {
          ttsRevoke.forEach(function (url) {
            try { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); } catch (_) {}
          });
          ttsRevoke = [];
        }
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          if (audioPlayback && audioPlayback.stop) audioPlayback.stop();
          player.destroy();
          revokeTts();
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          resolve(blob);
        };
        recorder.onerror = function (e) {
          if (audioPlayback && audioPlayback.stop) audioPlayback.stop();
          player.destroy();
          revokeTts();
          reject(new Error(e.error ? (e.error.message || String(e.error)) : 'MediaRecorder error'));
        };
        player.seek(rangeStart);
        try {
          recorder.start(100);
        } catch (startErr) {
          if (audioPlayback && audioPlayback.stop) audioPlayback.stop();
          player.destroy();
          revokeTts();
          reject(new Error('Could not start recording: ' + (startErr && startErr.message ? startErr.message : String(startErr))));
          return;
        }
        if (audioPlayback && audioPlayback.start) {
          audioPlayback.start().catch(function (err) { console.warn('[CFS] Audio playback start failed', err); });
        }
        if (player.startVideoPlayback) player.startVideoPlayback(rangeStart);
        const startTime = Date.now();
        let lastReportedSec = -1;
        function driveFrame() {
          const elapsed = (audioPlayback && audioPlayback.getCurrentTimeSec)
            ? audioPlayback.getCurrentTimeSec()
            : ((Date.now() - startTime) / 1000);
          if (onProgress) {
            const sec = Math.floor(elapsed);
            if (sec !== lastReportedSec) { lastReportedSec = sec; onProgress(elapsed, durationSec); }
          }
          if (elapsed >= durationSec || (audioPlayback && audioPlayback.isEnded && audioPlayback.isEnded())) {
            try { recorder.stop(); } catch (_) {}
            return;
          }
          player.seek(rangeStart + elapsed);
          if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(driveFrame);
          else setTimeout(driveFrame, Math.max(16, 1000 / fps));
        }
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(driveFrame);
        else setTimeout(driveFrame, 0);
      });
      });
    }).then(function (blob) { return blob; });
    }).finally(function () {
      ttsRevoke.forEach(function (url) {
        try { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); } catch (_) {}
      });
    });
  }

  const AD_CARD_TEMPLATE_IDS = ['ad-twitter', 'ad-facebook'];

  function getAdCardStyleClass(templateId) {
    if (templateId === 'ad-twitter') return 'twitter-style';
    if (templateId === 'ad-facebook') return 'facebook-style';
    return 'twitter-style';
  }

  /**
   * Build the text ad card DOM (Twitter, Facebook, or Apple Notes style) and append to container.
   */
  function px(v) {
    if (v == null || v === '') return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n + 'px';
  }

  var wrapTextByWidth = window.__CFS_wrapTextToWidth || function (text) { return text == null ? '' : String(text); };

  function buildAdCardDOM(container, templateId, values, options) {
    if (!container) return;
    options = options || {};
    const styleClass = getAdCardStyleClass(templateId);
    const name = (values.nameInput != null ? values.nameInput : 'Best Ad Strategy').toString();
    const handle = (values.handleInput != null ? values.handleInput : '@bestadstrategy').toString();
    const text = (values.textInput != null ? values.textInput : '').toString();
    const profileSrc = (values.profileImage != null && values.profileImage.toString().trim()) ? values.profileImage.toString().trim() : '';

    const nameFont = (values.nameFontFamily != null ? values.nameFontFamily : 'sans-serif').toString();
    const nameSize = px(values.nameFontSize) || '16px';
    const nameColorVal = (values.nameColor != null ? values.nameColor : '#000000').toString();
    const handleFont = (values.handleFontFamily != null ? values.handleFontFamily : 'sans-serif').toString();
    const handleSize = px(values.handleFontSize) || '14px';
    const handleColorVal = (values.handleColor != null ? values.handleColor : '#657786').toString();
    const textFont = (values.textFontFamily != null ? values.textFontFamily : 'sans-serif').toString();
    const textSize = px(values.textFontSize) || '15px';
    const textColorVal = (values.textColor != null ? values.textColor : '#000000').toString();

    const wrap = document.createElement('div');
    wrap.className = 'gen-ad-card-wrap';
    if (options.targetWidth != null && !isNaN(Number(options.targetWidth))) {
      wrap.style.width = Math.max(240, Number(options.targetWidth)) + 'px';
      wrap.style.boxSizing = 'border-box';
    }
    const card = document.createElement('div');
    card.className = 'ad-card ' + styleClass;
    card.setAttribute('id', 'adCard');
    if (styleClass === 'note-style' && options.targetWidth != null && !isNaN(Number(options.targetWidth))) {
      var target = Number(options.targetWidth);
      var noteW = Math.max(220, target - 80);
      card.style.width = noteW + 'px';
      card.style.maxWidth = noteW + 'px';
      card.style.boxSizing = 'border-box';
      card.setAttribute('data-cfs-note-width', String(noteW));
    }

    const noteHeader = document.createElement('div');
    noteHeader.className = 'note-header';
    noteHeader.setAttribute('id', 'noteHeader');
    noteHeader.innerHTML = '<div class="note-buttons"><span class="note-btn btn-red"></span><span class="note-btn btn-yellow"></span><span class="note-btn btn-green"></span></div>';
    card.appendChild(noteHeader);

    const profile = document.createElement('div');
    profile.className = 'profile';
    profile.setAttribute('id', 'profileSection');
    if (styleClass === 'note-style') profile.classList.add('hide-profile');
    const img = document.createElement('img');
    img.setAttribute('id', 'profilePic');
    img.alt = 'Profile';
    if (profileSrc && styleClass === 'facebook-style') {
      img.src = profileSrc;
    } else {
      img.src = 'https://via.placeholder.com/48';
      img.classList.add('hidden');
    }
    profile.appendChild(img);
    const info = document.createElement('div');
    info.className = 'info';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.setAttribute('id', 'namePreview');
    nameSpan.textContent = name;
    nameSpan.style.fontFamily = nameFont;
    nameSpan.style.fontSize = nameSize;
    nameSpan.style.color = nameColorVal;
    const handleSpan = document.createElement('span');
    handleSpan.className = 'handle';
    handleSpan.setAttribute('id', 'handlePreview');
    handleSpan.textContent = handle;
    handleSpan.style.fontFamily = handleFont;
    handleSpan.style.fontSize = handleSize;
    handleSpan.style.color = handleColorVal;
    info.appendChild(nameSpan);
    info.appendChild(handleSpan);
    profile.appendChild(info);
    card.appendChild(profile);

    const noteTitle = document.createElement('div');
    noteTitle.setAttribute('id', 'noteTitle');
    noteTitle.style.fontWeight = 'bold';
    noteTitle.style.fontFamily = nameFont;
    noteTitle.style.fontSize = nameSize;
    noteTitle.style.color = nameColorVal;
    if (styleClass === 'note-style') {
      noteTitle.textContent = name;
      noteTitle.style.display = 'block';
    } else {
      noteTitle.style.display = 'none';
    }
    card.appendChild(noteTitle);

    const textPreview = document.createElement('div');
    textPreview.setAttribute('id', 'textPreview');
    textPreview.style.whiteSpace = 'pre-wrap';
    textPreview.style.overflowWrap = 'anywhere';
    textPreview.style.wordBreak = 'break-word';
    textPreview.style.fontFamily = textFont;
    textPreview.style.fontSize = textSize;
    textPreview.style.color = textColorVal;
    if (styleClass === 'note-style' && options.targetWidth != null && !isNaN(Number(options.targetWidth))) {
      var targetW = Number(options.targetWidth);
      var noteWidthAttr = card.getAttribute('data-cfs-note-width');
      var noteWidth = noteWidthAttr != null ? Number(noteWidthAttr) : Math.max(220, targetW - 80);
      var maxTextW = Math.max(120, noteWidth - 40);
      var bodySizeNum = parseInt(textSize, 10) || 15;
      textPreview.textContent = wrapTextByWidth(text, textFont, bodySizeNum, 'normal', maxTextW);
    } else {
      textPreview.textContent = text;
    }
    card.appendChild(textPreview);

    wrap.appendChild(card);
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  /**
   * Render preview: if template has timeline, render first frame to canvas and show in container.
   * For ad-twitter, ad-facebook, ad-apple-notes: render the ad card DOM.
   */
  function renderPreview(container, templateId, extension, template, values, callback) {
    if (AD_CARD_TEMPLATE_IDS.indexOf(templateId) >= 0 && container) {
      var previewWidth = template && template.output && template.output.size && Number(template.output.size.width) > 0 ? Number(template.output.size.width) : undefined;
      buildAdCardDOM(container, templateId, values || {}, { targetWidth: previewWidth });
      if (callback) callback(null);
      return;
    }
    if (template && template.timeline && container) {
      const merge = buildMerge(extension, values);
      const merged = applyMergeToTemplate(template, merge);
      renderTemplateToImage(merged).then(function (dataUrl) {
        container.innerHTML = '';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'Template preview';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.border = '1px solid var(--gen-border, #2a2a32)';
        container.appendChild(img);
        if (callback) callback(null);
      }).catch(function (e) {
        container.innerHTML = '<p class="gen-muted">Preview: ' + (e && e.message ? e.message : 'Failed') + '</p>';
        if (callback) callback(e);
      });
      return;
    }
    if (container) container.textContent = 'No template.';
    if (callback) callback(null);
  }

  /**
   * Get primary text from values for template-only text/audio output (e.g. transcript, body, headline).
   */
  function getTextFromValues(extension, values) {
    if (values.transcript != null && String(values.transcript).trim() !== '') return String(values.transcript);
    if (values.body != null && String(values.body).trim() !== '') return String(values.body);
    if (values.speakText != null && String(values.speakText).trim() !== '') return String(values.speakText);
    if (values.headline != null && String(values.headline).trim() !== '') return String(values.headline);
    const schema = extension.inputSchema || [];
    for (let i = 0; i < schema.length; i++) {
      const f = schema[i];
      if ((f.type === 'text' || f.type === 'textarea') && values[f.id] != null && String(values[f.id]).trim() !== '') {
        return String(values[f.id]);
      }
    }
    return '';
  }

  /**
   * Generate: template-only (image/video from timeline, text/audio from values).
   */
  function generate(templateId, extension, template, values) {
    if (AD_CARD_TEMPLATE_IDS.indexOf(templateId) >= 0) {
      if (typeof html2canvas !== 'function') {
        return Promise.reject(new Error('html2canvas not available. Add <script src="lib/html2canvas.min.js"></script> before the generator (see index.html).'));
      }
      const output = (template && template.output) || {};
      const size = output.size || {};
      const targetWidth = Number(size.width) > 0 ? Number(size.width) : 1080;
      const off = document.createElement('div');
      off.style.cssText = 'position:absolute;left:-9999px;top:0;';
      off.style.width = Math.max(240, targetWidth) + 'px';
      off.style.boxSizing = 'border-box';
      document.body.appendChild(off);
      buildAdCardDOM(off, templateId, values || {}, { targetWidth: targetWidth });
      const cardEl = off.querySelector && off.querySelector('.gen-ad-card-wrap');
      const target = cardEl || off;
      return html2canvas(target, { scale: 2, useCORS: true, allowTaint: true, logging: false })
        .then(function (canvas) {
          document.body.removeChild(off);
          return { type: 'image', data: canvas.toDataURL('image/png') };
        })
        .catch(function (err) {
          if (off.parentNode) document.body.removeChild(off);
          return Promise.reject(err);
        });
    }
    const outputType = (extension.outputType || 'image').toLowerCase();
    if (outputType === 'audio') {
      return Promise.resolve({ type: 'audio', data: getTextFromValues(extension, values || {}) });
    }
    if (template && template.timeline && (outputType === 'image' || (template.output && (template.output.format === 'png' || template.output.format === 'jpg')))) {
      const merge = buildMerge(extension, values, template);
      const merged = applyMergeToTemplate(template, merge);
      return renderTemplateToImage(merged).then(function (dataUrl) {
        return { type: 'image', data: dataUrl };
      });
    }
    if (template && template.timeline && outputType === 'video') {
      const merge = buildMerge(extension, values, template);
      const merged = applyMergeToTemplate(template, merge);
      return renderTimelineToVideoBlob(merged).then(function (blob) {
        const url = blob ? URL.createObjectURL(blob) : null;
        return { type: 'video', data: url || '' };
      });
    }
    if (template && template.timeline) {
      return Promise.reject(new Error('Template has a timeline but output type is not image or video. Set extension.outputType to "image" or "video" for timeline-based generation.'));
    }
    if (template && !template.timeline && (outputType === 'image' || outputType === 'video')) {
      return Promise.reject(new Error('This template has no timeline. Image or video export requires a template with a timeline (template.json with timeline). Use the editor or choose a different template.'));
    }
    return Promise.reject(new Error('No template or unsupported output type for this template.'));
  }

  /**
   * Apply STT result to the template's caption clip (for workflows).
   * Mutates template in place: finds or creates a caption clip, sets asset.text and asset.words.
   * result: { text: string, words?: Array<{ text, start, end }> }
   */
  function applyCaptionResultToTemplate(template, result) {
    if (!template || !template.timeline || !Array.isArray(template.timeline.tracks) || !result) return;
    const text = result.text != null ? String(result.text) : '';
    const words = Array.isArray(result.words) ? result.words : null;
    let found = null;
    const tracks = template.timeline.tracks;
    for (let ti = 0; ti < tracks.length; ti++) {
      const clips = tracks[ti].clips || [];
      for (let ci = 0; ci < clips.length; ci++) {
        const clip = clips[ci];
        if (clip && clip.asset && (clip.asset.type || '').toLowerCase() === 'caption') {
          found = clip;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      const targetTrack = tracks.length ? tracks.length - 1 : 0;
      while (tracks.length <= targetTrack) tracks.push({ clips: [] });
      if (!Array.isArray(tracks[targetTrack].clips)) tracks[targetTrack].clips = [];
      found = {
        start: 0,
        length: 10,
        position: 'bottom',
        width: 960,
        asset: { type: 'caption', text: '' },
      };
      tracks[targetTrack].clips.push(found);
    }
    if (!found.asset) found.asset = { type: 'caption' };
    found.asset.text = text;
    found.asset.words = words && words.length ? words : undefined;
    if (found.asset.words && found.asset.words.length) {
      found.start = typeof found.start === 'number' ? found.start : 0;
      found.length = Math.max(1, found.asset.words[found.asset.words.length - 1].end);
    }
  }

  function renderTimelineToAudioBlob(mergedTemplate, options) {
    options = options || {};
    const createPlayer = typeof window !== 'undefined' && window.__CFS_pixiShotstackPlayer;
    if (!createPlayer) return Promise.reject(new Error('Audio export requires pixi-timeline-player.js to be loaded.'));
    if (typeof OfflineAudioContext === 'undefined' && typeof webkitOfflineAudioContext === 'undefined') {
      return Promise.reject(new Error('Audio export requires OfflineAudioContext, which is not available.'));
    }
    let ttsRevoke = [];
    return preGenerateTtsForTemplate(mergedTemplate).then(function (ttsResult) {
      ttsRevoke = ttsResult.revoke || [];
      const player = createPlayer({ merge: (options.merge || {}), preGeneratedTts: ttsResult.map || {} });
      return player.load(mergedTemplate).then(function () {
        const durationSec = player.getDuration ? player.getDuration() : 10;
        if (player.renderMixedAudioBuffer) {
          return player.renderMixedAudioBuffer(durationSec, 0);
        }
        return null;
      });
    }).then(function (audioBuffer) {
      ttsRevoke.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (_) {} });
      if (!audioBuffer) return null;
      var numChannels = audioBuffer.numberOfChannels;
      var sampleRate = audioBuffer.sampleRate;
      var length = audioBuffer.length;
      var bytesPerSample = 2;
      var dataSize = length * numChannels * bytesPerSample;
      var buffer = new ArrayBuffer(44 + dataSize);
      var view = new DataView(buffer);
      function writeStr(o, s) { for (var i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
      view.setUint16(32, numChannels * bytesPerSample, true);
      view.setUint16(34, bytesPerSample * 8, true);
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);
      var offset = 44;
      for (var i = 0; i < length; i++) {
        for (var ch = 0; ch < numChannels; ch++) {
          var sample = audioBuffer.getChannelData(ch)[i];
          sample = Math.max(-1, Math.min(1, sample));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
          offset += 2;
        }
      }
      return new Blob([buffer], { type: 'audio/wav' });
    });
  }

  function isBuiltInTemplate(templateKeyOrId) {
    const k = String(templateKeyOrId || '');
    if (k.indexOf('project:') === 0) return false;
    const bare = k.indexOf('builtin:') === 0 ? k.slice(8) : k;
    return _builtInIds.has(bare);
  }

  window.__CFS_templateEngine = {
    getBaseUrl: getBaseUrl,
    getProjectFolderHandle: getProjectFolderHandle,
    readFileFromProjectFolder: readFileFromProjectFolder,
    readImageAsDataUrlFromProjectFolder: readImageAsDataUrlFromProjectFolder,
    parseTemplateKey: parseTemplateKey,
    loadTemplateList: loadTemplateList,
    loadTemplate: loadTemplate,
    isBuiltInTemplate: isBuiltInTemplate,
    buildMerge: buildMerge,
    applyMergeToTemplate: applyMergeToTemplate,
    renderPreview: renderPreview,
    generate: generate,
    renderTimelineToVideoBlob: renderTimelineToVideoBlob,
    renderTimelineToAudioBlob: renderTimelineToAudioBlob,
    preGenerateTtsForTemplate: preGenerateTtsForTemplate,
    applyCaptionResultToTemplate: applyCaptionResultToTemplate,
    computeStillImageSeekTimeSec: computeStillImageSeekTimeSec,
    AD_CARD_TEMPLATE_IDS: AD_CARD_TEMPLATE_IDS,
  };
})();
