/**
 * Unified editor: Fabric canvas + toolbar + timeline (video/audio) + book mode (pages, export HTML/DOC/PDF).
 * Loads template.json (ShotStack) or Fabric JSON; export back to ShotStack JSON, PNG, or book formats.
 */
(function (global) {
  'use strict';

  const fabric = global.fabric;
  const coreScene = global.__CFS_coreScene;
  const fabricToShotstack = global.__CFS_fabricToShotstack;

  /** Fabric.js 5 typo: CanvasTextBaseline must be 'alphabetic', not 'alphabetical'. Patch _setTextStyles so ctx never receives invalid value. */
  if (fabric) {
    [fabric.Text, fabric.IText, fabric.Textbox].forEach(function (C) {
      if (!C || !C.prototype) return;
      if (C.prototype.textBaseline === 'alphabetical') C.prototype.textBaseline = 'alphabetic';
      var orig = C.prototype._setTextStyles;
      if (typeof orig === 'function') {
        C.prototype._setTextStyles = function () {
          if (this.textBaseline === 'alphabetical') this.textBaseline = 'alphabetic';
          /* Must forward all args: _measureChar calls _setTextStyles(ctx, decl, true) for CACHE_FONT_SIZE (400px). */
          return orig.apply(this, arguments);
        };
      }
    });
    /** Register cfs* custom properties so Fabric includes them in toObject/toJSON serialization. */
    var FabricObj = fabric.FabricObject || fabric.Object;
    if (FabricObj) {
      var cfsKeys = ['cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsRadiusPct', 'cfsFontSizePct', 'cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx', 'cfsMergeKey', 'cfsOriginalClip', 'cfsVideoSrc'];
      FabricObj.customProperties = FabricObj.customProperties || [];
      cfsKeys.forEach(function (k) {
        if (FabricObj.customProperties.indexOf(k) === -1) FabricObj.customProperties.push(k);
      });
    }
    /** Fabric uses canvas.contextCache for Text#getMeasuringContext when present; that context is shared with
     * rendering and can keep a non-identity transform, skewing measureText at CACHE_FONT_SIZE and __charBounds. */
    if (fabric.Text && fabric.Text.prototype) {
      fabric.Text.prototype.getMeasuringContext = function () {
        if (!fabric._cfsTextMeasureCtx) {
          var cnv = fabric.util.createCanvasElement();
          cnv.width = 512;
          cnv.height = 256;
          fabric._cfsTextMeasureCtx = cnv.getContext('2d');
        }
        fabric._cfsTextMeasureCtx.setTransform(1, 0, 0, 1, 0, 0);
        return fabric._cfsTextMeasureCtx;
      };
      try {
        fabric.charWidthsCache = {};
      } catch (_) {}
    }
  }

  function getPreset(presetId) {
    const presets = global.__CFS_outputPresets;
    if (!presets || !presets.getPreset) return null;
    return presets.getPreset(presetId);
  }

  /** Insert an object at a specific index. Fabric 5 may not have insertAt; fallback preserves order by splicing into canvas object list. */
  function insertObjectAtCanvas(canvas, obj, index) {
    if (!canvas || !obj) return;
    if (typeof canvas.insertAt === 'function') {
      canvas.insertAt(obj, index);
      return;
    }
    var objs = canvas.getObjects && canvas.getObjects();
    if (!objs || index < 0 || index > objs.length) {
      canvas.add(obj);
      return;
    }
    objs.splice(index, 0, obj);
    if (obj.set) obj.set('canvas', canvas);
    if (canvas.requestRenderAll) canvas.requestRenderAll();
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

  function serializeEditorMeta(ext) {
    if (!ext || typeof ext !== 'object') return [];
    var entries = [];
    Object.keys(CFS_META_KEYS).forEach(function (metaKey) {
      var extKey = CFS_META_KEYS[metaKey];
      var val = ext[extKey];
      if (val != null && val !== '') {
        entries.push({ find: CFS_META_PREFIX + metaKey, replace: String(val) });
      }
    });
    if (Array.isArray(ext.inputSchema) && ext.inputSchema.length) {
      try {
        entries.push({ find: CFS_META_PREFIX + 'INPUT_SCHEMA', replace: JSON.stringify(ext.inputSchema) });
      } catch (e) {}
    }
    if (ext._undoHistory) {
      try {
        entries.push({ find: CFS_META_PREFIX + 'UNDO_HISTORY', replace: JSON.stringify(ext._undoHistory) });
      } catch (e) {}
    }
    return entries;
  }

  function deserializeEditorMeta(mergeArray) {
    if (!Array.isArray(mergeArray)) return null;
    var meta = {};
    var found = false;
    mergeArray.forEach(function (m) {
      if (!m) return;
      var key = m.find != null ? String(m.find) : '';
      if (key.indexOf(CFS_META_PREFIX) !== 0) return;
      found = true;
      var suffix = key.slice(CFS_META_PREFIX.length);
      if (suffix === 'INPUT_SCHEMA') {
        try { meta.inputSchema = JSON.parse(m.replace); } catch (e) {}
        return;
      }
      if (suffix === 'UNDO_HISTORY') {
        try { meta._undoHistory = JSON.parse(m.replace); } catch (e) {}
        return;
      }
      var extKey = CFS_META_KEYS[suffix];
      if (extKey) meta[extKey] = m.replace != null ? m.replace : '';
    });
    return found ? meta : null;
  }

  function stripCfsMetaFromMerge(mergeArray) {
    if (!Array.isArray(mergeArray)) return mergeArray;
    return mergeArray.filter(function (m) {
      if (!m) return false;
      var key = m.find != null ? String(m.find) : '';
      return key.indexOf(CFS_META_PREFIX) !== 0;
    });
  }

  /**
   * Create editor in container. Options: { template, extension, values, presetId }.
   */
  function create(container, options) {
    if (!container) return null;
    options = options || {};
    const extension = options.extension || {};
    const template = options.template || {};
    var embeddedMeta = deserializeEditorMeta(template.merge);
    var _savedUndoHistory = null;
    if (embeddedMeta) {
      if (embeddedMeta._undoHistory) {
        _savedUndoHistory = embeddedMeta._undoHistory;
        delete embeddedMeta._undoHistory;
      }
      Object.keys(embeddedMeta).forEach(function (k) {
        if (extension[k] == null || extension[k] === '') extension[k] = embeddedMeta[k];
      });
    }
    const outputType = (extension.outputType || 'image').toLowerCase();
    const presetId = extension.outputPresetId || options.presetId;
    const preset = presetId ? getPreset(presetId) : null;
    const output = template.output || {};
    /* Use template resolution (output.size or output.resolution) so import matches original template dimensions. */
    var templateDims = coreScene && coreScene.getOutputDimensions && coreScene.getOutputDimensions(output);
    let width = (output.size && output.size.width) || (templateDims && templateDims.width) || (preset && preset.width) || 1920;
    let height = (output.size && output.size.height) || (templateDims && templateDims.height) || (preset && preset.height) || 1080;
    const vals = options.values || {};
    if (Number(vals.outputWidth) > 0 && Number(vals.outputHeight) > 0) {
      width = Number(vals.outputWidth);
      height = Number(vals.outputHeight);
    }

    const root = document.createElement('div');
    root.className = 'cfs-unified-editor';
    root.dataset.outputType = outputType;

    /** Named event bus for edit session (clip:selected, playback:play, edit:undo, etc.). Extensions subscribe via api.events.on(). */
    var editEvents = {
      _listeners: {},
      on: function (name, fn) {
        if (!this._listeners[name]) this._listeners[name] = [];
        this._listeners[name].push(fn);
        var self = this;
        return function unsubscribe() {
          var list = self._listeners[name];
          if (!list) return;
          var i = list.indexOf(fn);
          if (i !== -1) list.splice(i, 1);
        };
      },
      emit: function (name, data) {
        var list = this._listeners[name];
        if (!list || !list.length) return;
        list.forEach(function (fn) {
          try { fn(data); } catch (e) { console.warn('editEvents.' + name, e); }
        });
      },
    };

    /** Refs filled by initSingleCanvas for playback/selection/duration (so API works before first timeline init). */
    var stateRef = {
      getPlaybackTime: function () { return 0; },
      isPlaying: function () { return false; },
      getSelectedObject: function () { return null; },
      getTotalDuration: function () { return lastTotalDuration; },
      getClips: function () { return lastClips || []; },
      getEdit: function () { return null; },
    };
    var lastTotalDuration = 10;
    var lastClips = [];
    var lastRenderedClips = []; /* Clips array as rendered — indices match what user clicks */

    function isCanvasOutputType(type) {
      return ['image', 'video', 'book', 'text'].indexOf(type) >= 0;
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'cfs-editor-toolbar';

    const outputTypeSelect = document.createElement('select');
    outputTypeSelect.id = 'cfs-editor-output-type';
    var visibleOutputTypes = ['image', 'video', 'audio'];
    if (outputType === 'book' || outputType === 'walkthrough') {
      var hiddenOpt = document.createElement('option');
      hiddenOpt.value = outputType;
      hiddenOpt.textContent = outputType.charAt(0).toUpperCase() + outputType.slice(1);
      hiddenOpt.selected = true;
      hiddenOpt.hidden = true;
      outputTypeSelect.appendChild(hiddenOpt);
    }
    visibleOutputTypes.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === outputType) opt.selected = true;
      outputTypeSelect.appendChild(opt);
    });
    toolbar.appendChild(document.createElement('label')).textContent = 'Format Type';
    toolbar.appendChild(outputTypeSelect);

    var _cfgResolutionBases = { sd: 480, hd: 720, fhd: 1080, '4k': 2160 };
    var _cfgAspectRatioMap = { '1:1': [1,1], '16:9': [16,9], '9:16': [9,16], '4:5': [4,5] };

    var cfgResolutionSelect = document.createElement('select');
    cfgResolutionSelect.id = 'cfs-editor-cfg-resolution';
    [
      { value: 'fhd', label: 'Full HD (1080p)' },
      { value: 'sd', label: 'SD (480p)' },
      { value: 'hd', label: 'HD (720p)' },
      { value: '4k', label: '4K (2160p)' },
      { value: 'custom', label: 'Custom' }
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === 'fhd') opt.selected = true;
      cfgResolutionSelect.appendChild(opt);
    });
    var cfgAspectSelect = document.createElement('select');
    cfgAspectSelect.id = 'cfs-editor-cfg-aspect';
    [
      { value: '1:1', label: '1:1 Square' },
      { value: '16:9', label: '16:9 Landscape' },
      { value: '9:16', label: '9:16 Portrait' },
      { value: '4:5', label: '4:5 Portrait' },
      { value: 'custom', label: 'Custom' }
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === '1:1') opt.selected = true;
      cfgAspectSelect.appendChild(opt);
    });
    var resAspRow = document.createElement('div');
    resAspRow.className = 'gen-config-pair';
    var _resGroup = document.createElement('div');
    _resGroup.className = 'gen-prop-group';
    var _cfgResLabel = document.createElement('label');
    _cfgResLabel.textContent = 'Resolution';
    _resGroup.appendChild(_cfgResLabel);
    _resGroup.appendChild(cfgResolutionSelect);
    var _aspGroup = document.createElement('div');
    _aspGroup.className = 'gen-prop-group';
    var _cfgAspLabel = document.createElement('label');
    _cfgAspLabel.textContent = 'Aspect Ratio';
    _aspGroup.appendChild(_cfgAspLabel);
    _aspGroup.appendChild(cfgAspectSelect);
    resAspRow.appendChild(_resGroup);
    resAspRow.appendChild(_aspGroup);
    toolbar.appendChild(resAspRow);

    function _cfgApplyResolutionAspect() {
      var res = cfgResolutionSelect.value;
      var asp = cfgAspectSelect.value;
      if (res === 'custom' || asp === 'custom') return;
      var base = _cfgResolutionBases[res];
      var ratio = _cfgAspectRatioMap[asp];
      if (!base || !ratio) return;
      var rw = ratio[0], rh = ratio[1];
      var w, h;
      if (rw >= rh) { h = base; w = Math.round(base * rw / rh); }
      else { w = base; h = Math.round(base * rh / rw); }
      customWidthInput.value = w;
      customHeightInput.value = h;
      if (presetSelect.value !== 'custom') presetSelect.value = 'custom';
      applyCustomDimensionsFromInputs();
    }
    cfgResolutionSelect.addEventListener('change', _cfgApplyResolutionAspect);
    cfgAspectSelect.addEventListener('change', _cfgApplyResolutionAspect);

    function _cfgSyncResolutionAspect(w, h) {
      if (!w || !h) return;
      for (var resKey in _cfgResolutionBases) {
        for (var aspKey in _cfgAspectRatioMap) {
          var base = _cfgResolutionBases[resKey];
          var r = _cfgAspectRatioMap[aspKey];
          var expW, expH;
          if (r[0] >= r[1]) { expH = base; expW = Math.round(base * r[0] / r[1]); }
          else { expW = base; expH = Math.round(base * r[1] / r[0]); }
          if (expW === w && expH === h) {
            cfgResolutionSelect.value = resKey;
            cfgAspectSelect.value = aspKey;
            return;
          }
        }
      }
      cfgResolutionSelect.value = 'custom';
      cfgAspectSelect.value = 'custom';
    }

    const presetSelect = document.createElement('select');
    presetSelect.id = 'cfs-editor-preset';
    const presetsApi = global.__CFS_outputPresets;
    const presetsList = (presetsApi && presetsApi.listPresetsForOutputType) ? presetsApi.listPresetsForOutputType(outputType) : [];
    presetsList.forEach(function (p) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label || p.id;
      if (p.id === presetId) opt.selected = true;
      presetSelect.appendChild(opt);
    });
    var presetLabel = null;
    if (presetSelect.options.length) {
      presetLabel = document.createElement('label');
      presetLabel.textContent = 'Preset:';
      toolbar.appendChild(presetLabel);
      toolbar.appendChild(presetSelect);
      presetSelect.dataset.previousPreset = presetSelect.value;
    }

    var canvasZoom = 1;
    var zoomSelect = document.createElement('select');
    zoomSelect.id = 'cfs-editor-zoom';
    zoomSelect.title = 'Zoom';
    zoomSelect.setAttribute('aria-label', 'Canvas zoom');
    var fitOpt = document.createElement('option');
    fitOpt.value = 'fit';
    fitOpt.textContent = 'Fit';
    zoomSelect.appendChild(fitOpt);
    [50, 75, 100, 125, 150, 200].forEach(function (pct) {
      var opt = document.createElement('option');
      opt.value = pct / 100;
      opt.textContent = pct + '%';
      if (pct === 100) opt.selected = true;
      zoomSelect.appendChild(opt);
    });
    var zoomLabel = document.createElement('label');
    zoomLabel.textContent = 'Zoom:';
    toolbar.appendChild(zoomLabel);
    toolbar.appendChild(zoomSelect);

    var dimensionsEl = document.createElement('span');
    dimensionsEl.className = 'cfs-editor-dimensions';
    dimensionsEl.title = 'Canvas dimensions';
    toolbar.appendChild(dimensionsEl);

    var customDimsWrap = document.createElement('span');
    customDimsWrap.className = 'cfs-editor-custom-dims gen-dims-inline';
    customDimsWrap.style.display = 'none';
    var customWidthInput = document.createElement('input');
    customWidthInput.type = 'number';
    customWidthInput.min = 1;
    customWidthInput.max = 99999;
    customWidthInput.placeholder = 'W';
    customWidthInput.title = 'Custom width (px)';
    customWidthInput.setAttribute('aria-label', 'Custom width');
    customWidthInput.style.width = '64px';
    var customHeightInput = document.createElement('input');
    customHeightInput.type = 'number';
    customHeightInput.min = 1;
    customHeightInput.max = 99999;
    customHeightInput.placeholder = 'H';
    customHeightInput.title = 'Custom height (px)';
    customHeightInput.setAttribute('aria-label', 'Custom height');
    customHeightInput.style.width = '64px';
    customDimsWrap.appendChild(customWidthInput);
    customDimsWrap.appendChild(document.createTextNode(' \u00d7 '));
    customDimsWrap.appendChild(customHeightInput);
    toolbar.appendChild(customDimsWrap);

    function onCustomDimInputApply() {
      if (presetSelect.value !== 'custom') return;
      applyCustomDimensionsFromInputs();
    }
    customWidthInput.addEventListener('blur', onCustomDimInputApply);
    customHeightInput.addEventListener('blur', onCustomDimInputApply);
    customWidthInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { customHeightInput.focus(); }
    });
    customHeightInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { onCustomDimInputApply(); }
    });

    var cfgFramerateSelect = document.createElement('select');
    cfgFramerateSelect.id = 'cfs-editor-cfg-framerate';
    [
      { value: '25', label: '25 fps' },
      { value: '30', label: '30 fps' },
      { value: '60', label: '60 fps' },
      { value: '12', label: '12 fps' }
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === '25') opt.selected = true;
      cfgFramerateSelect.appendChild(opt);
    });
    var _fpsField = document.createElement('div');
    _fpsField.className = 'gen-prop-group cfs-video-only-field';
    var _fpsLabel = document.createElement('label');
    _fpsLabel.textContent = 'Framerate (FPS)';
    _fpsField.appendChild(_fpsLabel);
    _fpsField.appendChild(cfgFramerateSelect);
    toolbar.appendChild(_fpsField);

    var cfgVideoLengthInput = document.createElement('input');
    cfgVideoLengthInput.type = 'number';
    cfgVideoLengthInput.id = 'cfs-editor-cfg-video-length';
    cfgVideoLengthInput.min = '0.1';
    cfgVideoLengthInput.step = '0.1';
    cfgVideoLengthInput.placeholder = 'Auto';
    cfgVideoLengthInput.title = 'Video duration in seconds';
    cfgVideoLengthInput.setAttribute('aria-label', 'Video length in seconds');
    var _vidLenField = document.createElement('div');
    _vidLenField.className = 'gen-prop-group cfs-video-only-field';
    var _vidLenLabel = document.createElement('label');
    _vidLenLabel.textContent = 'Video Length (s)';
    _vidLenField.appendChild(_vidLenLabel);
    _vidLenField.appendChild(cfgVideoLengthInput);
    toolbar.appendChild(_vidLenField);

    function _cfgUpdateVideoOnlyFields() {
      var isVideo = outputTypeSelect && (outputTypeSelect.value === 'video');
      var fields = toolbar.querySelectorAll('.cfs-video-only-field');
      for (var i = 0; i < fields.length; i++) {
        fields[i].style.display = isVideo ? '' : 'none';
      }
    }

    var exportScaleResolution = null;
    var resolutionScaleSelect = document.createElement('select');
    resolutionScaleSelect.id = 'cfs-editor-resolution-scale';
    resolutionScaleSelect.title = 'Export resolution: scale template proportionally to match selected size.';
    resolutionScaleSelect.setAttribute('aria-label', 'Export resolution');
    resolutionScaleSelect.style.display = 'none';
    [
      { value: '', label: 'Export at: Same' },
      { value: '1080', label: '1080p' }
    ].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      resolutionScaleSelect.appendChild(opt);
    });
    var resLabel = document.createElement('label');
    resLabel.textContent = 'Res:';
    resLabel.style.marginLeft = '8px';
    toolbar.appendChild(resLabel);
    toolbar.appendChild(resolutionScaleSelect);

    function updateDimensionsDisplay() {
      var d = getCanvasDimensions();
      dimensionsEl.textContent = d.w + ' \u00d7 ' + d.h;
      var inSidebar = toolbar.classList.contains('cfs-toolbar-in-preview');
      if (presetSelect.value === 'custom' || inSidebar) {
        customWidthInput.value = d.w;
        customHeightInput.value = d.h;
      }
      if (cfgResolutionSelect && cfgAspectSelect) {
        _cfgSyncResolutionAspect(d.w, d.h);
      }
    }

    function updateCustomDimsVisibility() {
      var isAudio = _lastOutputType === 'audio' || (outputTypeSelect && outputTypeSelect.value === 'audio');
      var isCustom = presetSelect.value === 'custom';
      var inSidebar = toolbar.classList.contains('cfs-toolbar-in-preview');
      if (inSidebar) {
        dimensionsEl.style.display = 'none';
        customDimsWrap.style.display = isAudio ? 'none' : '';
      } else {
        dimensionsEl.style.display = (isAudio || isCustom) ? 'none' : '';
        customDimsWrap.style.display = isAudio ? 'none' : (isCustom ? '' : 'none');
      }
      if (isCustom || inSidebar) {
        var d = getCanvasDimensions();
        customWidthInput.value = d.w;
        customHeightInput.value = d.h;
      }
      _cfgUpdateVideoOnlyFields();
    }

    function applyCustomDimensionsFromInputs() {
      var w = Math.round(Number(customWidthInput.value));
      var h = Math.round(Number(customHeightInput.value));
      if (!(w > 0) || !(h > 0)) return false;
      width = w;
      height = h;
      if (typeof options.setValue === 'function') {
        options.setValue('outputWidth', width);
        options.setValue('outputHeight', height);
      }
      var hasContent = canvas && canvas.getObjects && canvas.getObjects().length > 0;
      var savedState = null;
      if (hasContent && outputTypeSelect.value !== 'book') {
        savedState = getCanvasStateForPresetSwitch(canvas);
        if (savedState) {
          savedState.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || savedState.width);
          savedState.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || savedState.height);
          enrichSavedStateWithResponsiveProps(canvas, savedState);
        }
        if (!savedState || !savedState.objects || !savedState.objects.length) savedState = null;
      }
      initSingleCanvas(savedState);
      if (zoomSelect) zoomSelect.value = 'fit';
      setTimeout(function () {
        if (typeof zoomToFit === 'function') zoomToFit();
        if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
      }, 50);
      updateDimensionsDisplay();
      var dim = getCanvasDimensions();
      editEvents.emit('output:resized', { width: dim.w, height: dim.h });
      return true;
    }

    var isPanning = false;
    var lastPanX = 0;
    var lastPanY = 0;

    function setCanvasZoom(scale) {
      scale = Math.max(0.1, Math.min(5, Number(scale) || 1));
      canvasZoom = scale;
      if (!canvas) return;
      var vpt = canvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        var m = vpt.slice ? vpt.slice() : [vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]];
        m[0] = scale;
        m[3] = scale;
        if (typeof canvas.setViewportTransform === 'function') {
          canvas.setViewportTransform(m);
        } else {
          canvas.viewportTransform = m;
        }
      }
      if (typeof canvas.setZoom === 'function') {
        try { canvas.setZoom(scale); } catch (_) {}
      }
      if (typeof canvas.calcOffset === 'function') {
        try { canvas.calcOffset(); } catch (_) {}
      }
      if (zoomSelect && zoomSelect.options.length && zoomSelect.value !== 'fit') {
        var best = zoomSelect.options[1] ? zoomSelect.options[1].value : '1';
        for (var i = 1; i < zoomSelect.options.length; i++) {
          var v = zoomSelect.options[i].value;
          if (v === 'fit') continue;
          if (Math.abs(parseFloat(v, 10) - scale) < Math.abs(parseFloat(best, 10) - scale)) best = v;
        }
        zoomSelect.value = best;
      }
      if (canvas.requestRenderAll) canvas.requestRenderAll();
      else if (canvas.renderAll) canvas.renderAll();
      syncZoomScrollArea();
      requestAnimationFrame(function () {
        if (canvas && (canvas.requestRenderAll || canvas.renderAll)) {
          if (typeof canvas.calcOffset === 'function') try { canvas.calcOffset(); } catch (_) {}
          if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
        }
      });
    }

    var _cfsScrollSizer = null;
    var _cfsScrollSyncing = false;

    function syncZoomScrollArea() {
      if (!canvasWrap || !canvas) return;
      var dim = getCanvasDimensions();
      if (!dim.w || !dim.h) return;
      var isFit = zoomSelect && zoomSelect.value === 'fit';

      var wrapper = canvas.wrapperEl || (canvas.lowerCanvas && canvas.lowerCanvas.parentNode) || (canvasFrameEl && canvasFrameEl.firstChild);
      if (wrapper && wrapper.style) {
        wrapper.style.transform = '';
        wrapper.style.transformOrigin = '';
      }

      if (isFit) {
        if (_cfsScrollSizer && _cfsScrollSizer.parentNode) _cfsScrollSizer.parentNode.removeChild(_cfsScrollSizer);
        if (canvasFrameEl) {
          canvasFrameEl.style.position = 'relative';
          canvasFrameEl.style.top = '';
          canvasFrameEl.style.left = '';
          canvasFrameEl.style.zIndex = '';
          canvasFrameEl.style.margin = '';
        }
        canvasWrap.style.display = '';
        canvasWrap.style.justifyContent = '';
        canvasWrap.style.alignItems = '';
        canvasWrap.style.position = '';
        _cfsScrollSyncing = true;
        canvasWrap.scrollLeft = 0;
        canvasWrap.scrollTop = 0;
        _cfsScrollSyncing = false;
        var vpt = canvas.viewportTransform;
        if (vpt && vpt.length >= 6) {
          vpt[4] = 0;
          vpt[5] = 0;
          if (typeof canvas.setViewportTransform === 'function') canvas.setViewportTransform(vpt);
        }
      } else if (canvasZoom > 1) {
        var zoomedW = Math.ceil(dim.w * canvasZoom);
        var zoomedH = Math.ceil(dim.h * canvasZoom);
        if (!_cfsScrollSizer) {
          _cfsScrollSizer = document.createElement('div');
          _cfsScrollSizer.className = 'cfs-editor-scroll-sizer';
          _cfsScrollSizer.style.cssText = 'pointer-events:none;visibility:hidden;';
        }
        var sizerH = Math.max(0, zoomedH - dim.h);
        var sizerW = zoomedW;
        _cfsScrollSizer.style.width = sizerW + 'px';
        _cfsScrollSizer.style.height = sizerH + 'px';
        if (!_cfsScrollSizer.parentNode) canvasWrap.appendChild(_cfsScrollSizer);
        if (canvasFrameEl) {
          canvasFrameEl.style.position = 'sticky';
          canvasFrameEl.style.top = '0';
          canvasFrameEl.style.left = '0';
          canvasFrameEl.style.zIndex = '1';
          canvasFrameEl.style.width = dim.w + 'px';
          canvasFrameEl.style.height = dim.h + 'px';
          canvasFrameEl.style.maxWidth = dim.w + 'px';
          canvasFrameEl.style.maxHeight = dim.h + 'px';
          canvasFrameEl.style.margin = '0';
          canvasFrameEl.style.flexShrink = '0';
        }
        canvasWrap.style.display = 'block';
        canvasWrap.style.justifyContent = '';
        canvasWrap.style.alignItems = '';
        canvasWrap.style.position = 'relative';
      } else {
        if (_cfsScrollSizer && _cfsScrollSizer.parentNode) _cfsScrollSizer.parentNode.removeChild(_cfsScrollSizer);
        var frameW = Math.round(dim.w * canvasZoom);
        var frameH = Math.round(dim.h * canvasZoom);
        if (canvasFrameEl) {
          canvasFrameEl.style.position = 'relative';
          canvasFrameEl.style.top = '';
          canvasFrameEl.style.left = '';
          canvasFrameEl.style.zIndex = '';
          canvasFrameEl.style.width = frameW + 'px';
          canvasFrameEl.style.height = frameH + 'px';
          canvasFrameEl.style.maxWidth = frameW + 'px';
          canvasFrameEl.style.maxHeight = frameH + 'px';
          canvasFrameEl.style.margin = 'auto';
          canvasFrameEl.style.flexShrink = '0';
        }
        canvasWrap.style.display = 'flex';
        canvasWrap.style.justifyContent = 'flex-start';
        canvasWrap.style.alignItems = 'flex-start';
        canvasWrap.style.position = '';
        _cfsScrollSyncing = true;
        canvasWrap.scrollLeft = 0;
        canvasWrap.scrollTop = 0;
        _cfsScrollSyncing = false;
        var vpt = canvas.viewportTransform;
        if (vpt && vpt.length >= 6) {
          vpt[4] = 0;
          vpt[5] = 0;
          if (typeof canvas.setViewportTransform === 'function') canvas.setViewportTransform(vpt);
        }
      }
      if (canvasWrap.scrollLeft < 0) canvasWrap.scrollLeft = 0;
      if (canvasWrap.scrollTop < 0) canvasWrap.scrollTop = 0;
    }

    function onCanvasWrapScroll() {
      if (_cfsScrollSyncing || !canvas || canvasZoom <= 1) return;
      _cfsScrollSyncing = true;
      var vpt = canvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        var dim = getCanvasDimensions();
        var maxPanX = Math.max(0, dim.w * canvasZoom - dim.w);
        var maxPanY = Math.max(0, dim.h * canvasZoom - dim.h);
        vpt[4] = -Math.max(0, Math.min(canvasWrap.scrollLeft || 0, maxPanX));
        vpt[5] = -Math.max(0, Math.min(canvasWrap.scrollTop || 0, maxPanY));
        if (typeof canvas.setViewportTransform === 'function') canvas.setViewportTransform(vpt);
        else if (canvas.requestRenderAll) canvas.requestRenderAll();
      }
      _cfsScrollSyncing = false;
    }

    function updateCanvasWrapAlignment() {
      if (!canvasWrap || !canvas) return;
      if (canvasWrap.scrollLeft < 0) canvasWrap.scrollLeft = 0;
      if (canvasWrap.scrollTop < 0) canvasWrap.scrollTop = 0;
    }

    /** Ensure Fabric canvas dimensions match the selected preset or custom dimensions. */
    function syncCanvasToPresetDimensions() {
      if (!canvas) return;
      var dim = getCanvasDimensions();
      if (!dim || !dim.w || !dim.h) return;
      var cw = canvas.getWidth ? canvas.getWidth() : canvas.width;
      var ch = canvas.getHeight ? canvas.getHeight() : canvas.height;
      var dimsChanged = (cw !== dim.w || ch !== dim.h);
      if (dimsChanged) {
        if (typeof canvas.setDimensions === 'function') {
          canvas.setDimensions({ width: dim.w, height: dim.h });
        } else if (canvas.setWidth && canvas.setHeight) {
          canvas.setWidth(dim.w);
          canvas.setHeight(dim.h);
        } else {
          canvas.width = dim.w;
          canvas.height = dim.h;
        }
        if (typeof canvas.calcOffset === 'function') { try { canvas.calcOffset(); } catch (_) {} }
        /* Re-apply responsive positions so objects scale when canvas dimensions change */
        if (canvas.getObjects && canvas.getObjects().length) {
          applyResponsivePositions(canvas);
          refreshTextboxWrapping(canvas);
        }
      }
      /* Frame div (our container) strictly constrains display to preset - works for all aspect ratios including 16:9 */
      if (canvasFrameEl && canvasFrameEl.nodeType === 1) {
        var pxw = dim.w + 'px';
        var pxh = dim.h + 'px';
        if (zoomSelect && zoomSelect.value === 'fit') {
          scaleFrameToFit();
        } else {
          canvasFrameEl.style.width = pxw;
          canvasFrameEl.style.height = pxh;
          canvasFrameEl.style.maxWidth = pxw;
          canvasFrameEl.style.maxHeight = pxh;
          resetFrameScale();
        }
      }
      /* Also constrain Fabric's wrapper in case frame is missing (e.g. book mode) */
      var wrapper = canvas.wrapperEl || (canvas.lowerCanvas && canvas.lowerCanvas.parentNode);
      if (wrapper && wrapper.nodeType === 1) {
        wrapper.style.overflow = 'hidden';
        if (!(zoomSelect && zoomSelect.value === 'fit')) {
          var pxw = dim.w + 'px';
          var pxh = dim.h + 'px';
          wrapper.style.width = pxw;
          wrapper.style.height = pxh;
          wrapper.style.maxWidth = pxw;
          wrapper.style.maxHeight = pxh;
        }
      }
      if (dimsChanged && (canvas.requestRenderAll || canvas.renderAll)) {
        if (canvas.requestRenderAll) canvas.requestRenderAll();
        else canvas.renderAll();
      }
      updateCanvasWrapAlignment();
    }

    function setupPanWhenZoomed() {
      if (!canvas || !canvas.on) return;
      canvas.on('mouse:down', function (opt) {
        if (canvasZoom <= 1 || opt.target) return;
        isPanning = true;
        lastPanX = opt.e && opt.e.clientX != null ? opt.e.clientX : 0;
        lastPanY = opt.e && opt.e.clientY != null ? opt.e.clientY : 0;
      });
      canvas.on('mouse:move', function (opt) {
        if (!isPanning || !opt.e) return;
        var dx = opt.e.clientX - lastPanX;
        var dy = opt.e.clientY - lastPanY;
        lastPanX = opt.e.clientX;
        lastPanY = opt.e.clientY;
        if (canvasWrap && _cfsScrollSizer && _cfsScrollSizer.parentNode) {
          canvasWrap.scrollLeft = Math.max(0, (canvasWrap.scrollLeft || 0) - dx);
          canvasWrap.scrollTop = Math.max(0, (canvasWrap.scrollTop || 0) - dy);
        } else {
          var vpt = canvas.viewportTransform;
          if (vpt && vpt.length >= 6) {
            vpt[4] += dx;
            vpt[5] += dy;
            canvas.requestRenderAll();
          }
        }
      });
      canvas.on('mouse:up', function () { isPanning = false; });
    }

    function ensureWrappedTextObjects(c) {
      if (!c || !c.getObjects || !fabric || !fabric.Textbox) return;
      var objs = c.getObjects().slice();
      var cw = (c.getWidth && c.getWidth()) || c.width || 1080;
      objs.forEach(function (obj) {
        if (!obj || (obj.type !== 'text' && obj.type !== 'i-text')) return;
        var text = (obj.text || '').toString();
        var rawText = obj.cfsRawText != null ? String(obj.cfsRawText) : text;
        var shouldWrap = obj.cfsWrapText === true || obj.cfsRichText === true || (obj.cfsWrapText !== false && (obj.cfsRightPx != null || text.length > 60));
        if (!shouldWrap) return;
        var idx = c.getObjects().indexOf(obj);
        if (idx < 0) return;
        var left = obj.left || 0;
        var top = obj.top || 0;
        var w;
        var widthPct = obj.cfsWidthPct != null ? Number(obj.cfsWidthPct) : null;
        if (widthPct != null && widthPct > 0) {
          w = Math.max(50, cw * widthPct);
        } else if (obj.cfsRightPx != null) {
          w = Math.max(80, cw - left - Number(obj.cfsRightPx));
        } else {
          var origClip = obj.cfsOriginalClip;
          var origAsset = origClip && origClip.asset;
          var origW = (origAsset && origAsset.width != null) ? Number(origAsset.width) : (origClip && origClip.width != null ? Number(origClip.width) : 0);
          if (origW > 0) {
            w = origW;
          } else {
            var rawW = (obj.width != null ? Number(obj.width) : 0);
            if (obj.scaleX != null && obj.scaleX !== 1) rawW = rawW * Number(obj.scaleX);
            w = (rawW > 0 && rawW <= cw - left) ? rawW : Math.max(200, Math.min(cw - left - 40, cw - left - 80));
          }
        }
        var tbOpts = {
          left: left,
          top: top,
          width: w,
          fontSize: obj.fontSize || 24,
          fontFamily: obj.fontFamily || 'sans-serif',
          fill: obj.fill || '#000000',
          fontWeight: obj.fontWeight || 'normal',
          textBaseline: 'alphabetic',
          padding: 0,
          minWidth: 50,
          maxWidth: Math.max(w, cw - left - 20)
        };
        var tb = new fabric.Textbox(text, tbOpts);
        tb.set('cfsWrapText', true);
        tb.set('cfsRawText', rawText);
        if (obj.cfsRightPx != null) tb.set('cfsRightPx', obj.cfsRightPx);
        if (obj.name != null) tb.set('name', obj.name);
        var keys = ['cfsStart', 'cfsLength', 'cfsLengthWasEnd', 'cfsTrackIndex', 'cfsMergeKey', 'cfsTransition', 'cfsEffect', 'cfsFit', 'cfsScale', 'cfsOriginalClip', 'cfsClipOpacity', 'cfsTextBackground', 'cfsRichText', 'backgroundColor', 'opacity', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsFontSizePct', 'cfsRadiusPct', 'cfsAnimation', 'cfsAlignHorizontal', 'cfsAlignVertical', 'cfsLineHeight', 'cfsLetterSpacing', 'cfsTextTransform', 'cfsTextDecoration', 'cfsGradient', 'cfsStroke', 'cfsShadow', 'cfsFilter', 'cfsMaxHeightPx', 'cfsBottomPx', 'cfsFadeIn', 'cfsFadeOut', 'cfsOpacityTween', 'cfsOffsetTween', 'cfsRotateTween', 'cfsLengthAuto', 'cfsHideOnImage'];
        keys.forEach(function (k) { if (obj[k] != null) tb.set(k, obj[k]); });
        withInternalCanvasMutation(function () {
          c.remove(obj);
          insertObjectAtCanvas(c, tb, idx);
        });
        if (typeof tb.initDimensions === 'function') tb.initDimensions();
      });
      if (c.requestRenderAll) c.requestRenderAll();
    }

    function addToolbarBtn(label, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (onClick) btn.addEventListener('click', onClick);
      toolbar.appendChild(btn);
      return btn;
    }

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'cfs-editor-canvas-wrap';
    if (outputType === 'book') canvasWrap.classList.add('book-mode');

    let canvas = null;

    /** Clear Fabric char width cache and re-run initDimensions on text objects so __charBounds match measureText (fixes caret / arrow-key steps). */
    function invalidateFabricTextLayout(c) {
      if (!fabric || !c || !c.getObjects) return;
      try {
        fabric.charWidthsCache = {};
      } catch (_) {}
      c.getObjects().forEach(function (o) {
        if (!o || typeof o.initDimensions !== 'function') return;
        if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') o.initDimensions();
      });
      if (c.requestRenderAll) c.requestRenderAll();
    }

    let pages = [];
    let currentPageIndex = 0;
    const timelineWrap = document.createElement('div');
    timelineWrap.className = 'cfs-editor-timeline-wrap';
    timelineWrap.style.display = outputType === 'video' || outputType === 'audio' ? 'block' : 'none';

    const bookPanel = document.createElement('div');
    bookPanel.className = 'cfs-editor-book-panel';
    bookPanel.style.display = outputType === 'book' ? 'flex' : 'none';

    /** Panel for walkthrough output: shows runner JS + config JSON for embedding on a site */
    const walkthroughPanel = document.createElement('div');
    walkthroughPanel.className = 'cfs-editor-walkthrough-panel';
    walkthroughPanel.style.display = outputType === 'walkthrough' ? 'block' : 'none';

    const rightColumn = document.createElement('div');
    rightColumn.className = 'cfs-editor-right-column';
    const layersPanel = document.createElement('div');
    layersPanel.className = 'cfs-editor-layers-panel';
    const propertyPanel = document.createElement('div');
    propertyPanel.className = 'cfs-editor-property-panel';
    var propertyPanelExpanded = true;

    var cfsJsonDiff = global.__CFS_jsonPatch && global.__CFS_jsonPatch.diff;
    var cfsJsonPatch = global.__CFS_jsonPatch && global.__CFS_jsonPatch.patch;
    var fabricHead = null;
    var undoPatches = [];
    var redoPatches = [];
    var timelineMinTracks = 2;
    var selectedClipIndices = new Set();
    var lockedTracks = new Set();
    var razorMode = false;
    var maxHistory = 100;
    var isUndoRedo = false;
    var isInternalCanvasMutation = false;
    var saveStateTimer = null;
    var CFS_RESPONSIVE_KEYS = ['dataURL', 'cfsStart', 'cfsLength', 'cfsLengthWasEnd', 'cfsLengthAuto', 'cfsTrackIndex', 'cfsVideoSrc', 'cfsVideoVolume', 'cfsTrim', 'cfsSpeed', 'cfsFadeIn', 'cfsFadeOut', 'cfsMergeKey', 'cfsShapeLine', 'cfsLineLength', 'cfsLineThickness', 'cfsTransition', 'cfsEffect', 'cfsFit', 'cfsScale', 'cfsFilter', 'cfsChromaKey', 'cfsFlip', 'cfsVideoWidth', 'cfsVideoHeight', 'cfsVideoMetadata', 'cfsSvgSrc', 'cfsOriginalClip', 'name', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsRadiusPct', 'cfsFontSizePct', 'cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx', 'cfsWrapText', 'cfsRichText', 'cfsRawText', 'cfsLetterSpacing', 'cfsLineHeight', 'cfsTextTransform', 'cfsTextDecoration', 'cfsGradient', 'cfsStroke', 'cfsShadow', 'cfsAlignHorizontal', 'cfsAlignVertical', 'cfsAnimation', 'cfsOpacityTween', 'cfsOffsetTween', 'cfsRotateTween', 'cfsClipOpacity', 'cfsTextBackground', 'backgroundColor', 'cfsAudioType', 'cfsTtsVoice', 'cfsTtsLocalVoice', 'cfsTtsText', 'cfsCaptionSrc', 'cfsCaptionPadding', 'cfsCaptionBorderRadius', 'cfsImageToVideo', 'cfsItvPrompt', 'cfsItvAspectRatio', 'cfsTextBgFor', 'cfsHideOnImage', 'cfsIsCaption', 'cfsCaptionWords', 'cfsCaptionActive', 'cfsCaptionFont', 'cfsCaptionAnimation', 'cfsCaptionDisplay'];

    /** Get canvas state for preset switch. Prefer toObject (accepts propertiesToInclude); toJSON may not. */
    function getCanvasStateForPresetSwitch(c) {
      if (!c) return null;
      try {
        if (typeof c.toObject === 'function') return c.toObject(CFS_RESPONSIVE_KEYS);
        if (typeof c.toJSON === 'function') return c.toJSON(CFS_RESPONSIVE_KEYS);
      } catch (e) {}
      return null;
    }

    /** Apply left/top/width/height/radius/fontSize from state objects to canvas objects. Use after loadFromJSON when Fabric may not respect scaled values. */
    function applyScaledGeometryFromState(fabricCanvas, stateObjects) {
      if (!fabricCanvas || !fabricCanvas.getObjects || !stateObjects || !stateObjects.length) return;
      var loadedObjs = fabricCanvas.getObjects();
      /* Build name→orig lookup for name-based matching (loadFromJSON may skip objects) */
      var origByName = {};
      stateObjects.forEach(function (o) { if (o && o.name) origByName[o.name] = o; });
      loadedObjs.forEach(function (obj, i) {
        if (!obj || !obj.set) return;
        var orig = (obj.name && origByName[obj.name]) ? origByName[obj.name] : stateObjects[i];
        if (!orig) return;
        if (orig.left != null) obj.set('left', orig.left);
        if (orig.top != null) obj.set('top', orig.top);
        if (obj.type !== 'circle') {
          if (orig.width != null) obj.set('width', orig.width);
          if (orig.height != null && obj.type !== 'text' && obj.type !== 'textbox' && obj.type !== 'i-text') obj.set('height', orig.height);
        }
        if (obj.type === 'circle' && orig.radius != null) obj.set('radius', orig.radius);
        if (orig.fontSize != null) obj.set('fontSize', Math.max(8, orig.fontSize));
        if (obj.type === 'textbox' && orig.width != null) {
          obj.set('minWidth', orig.width);
          obj.set('maxWidth', orig.width);
        }
        ['cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsRadiusPct', 'cfsFontSizePct'].forEach(function (k) {
          if (orig[k] != null) obj.set(k, orig[k]);
        });
        if (typeof obj.setCoords === 'function') obj.setCoords();
      });
      loadedObjs.forEach(function (obj) {
        if (obj && obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
      });
    }

    /** Fabric toJSON may omit custom properties; copy cfs* from live objects so scaleCanvasStateToSize has correct percentages. */
    function enrichSavedStateWithResponsiveProps(c, state) {
      if (!c || !c.getObjects || !state || !state.objects || !state.objects.length) return state;
      var liveObjs = c.getObjects();
      var respKeys = ['cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsRadiusPct', 'cfsFontSizePct', 'cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx'];
      for (var i = 0; i < liveObjs.length && i < state.objects.length; i++) {
        var live = liveObjs[i];
        var saved = state.objects[i];
        if (!live || !saved || typeof saved !== 'object') continue;
        respKeys.forEach(function (k) {
          var v = (live.get && typeof live.get === 'function' ? live.get(k) : live[k]);
          if (v !== undefined && v !== null) saved[k] = v;
        });
      }
      return state;
    }

    var forceWrapTextForWidth = global.__CFS_wrapTextToWidth || function (rawText) { return rawText == null ? '' : String(rawText); };

    function applyTextTransformVisual(obj) {
      if (!obj || !obj.set) return;
      var raw = obj.cfsRawText != null ? String(obj.cfsRawText) : String(obj.text || '');
      var tx = obj.cfsTextTransform;
      var transformed = raw;
      if (tx === 'uppercase') transformed = raw.toUpperCase();
      else if (tx === 'lowercase') transformed = raw.toLowerCase();
      else if (tx === 'capitalize') transformed = raw.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      if (transformed !== obj.text) {
        obj.set('text', transformed);
        if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
      }
    }

    function applyCfsStrokeVisual(obj) {
      if (!obj || !obj.set) return;
      var st = obj.cfsStroke;
      if (st && typeof st === 'object' && (st.width > 0 || st.color)) {
        obj.set('stroke', st.color || '#000000');
        obj.set('strokeWidth', Number(st.width) || 1);
        if (st.opacity != null) obj.set('strokeDashOffset', 0);
      } else {
        obj.set('stroke', null);
        obj.set('strokeWidth', 0);
      }
    }

    function applyCfsShadowVisual(obj) {
      if (!obj || !obj.set) return;
      var sh = obj.cfsShadow;
      if (sh && typeof sh === 'object' && (sh.offsetX || sh.offsetY || sh.blur || sh.color)) {
        var shadowStr = (sh.color || 'rgba(0,0,0,0.5)') + ' ' + (sh.offsetX || 0) + 'px ' + (sh.offsetY || 0) + 'px ' + (sh.blur || 0) + 'px';
        obj.set('shadow', shadowStr);
      } else {
        obj.set('shadow', null);
      }
    }

    function applyCfsFilterVisual(obj) {
      if (!obj || !obj.set || typeof obj.filters === 'undefined') return;
      obj.filters = [];
      var f = obj.cfsFilter;
      if (!f || f === 'none') { if (obj.applyFilters) obj.applyFilters(); return; }
      var F = fabric.Image.filters;
      if (!F) { return; }
      switch (f) {
        case 'blur': if (F.Blur) obj.filters.push(new F.Blur({ blur: 0.3 })); break;
        case 'boost': if (F.Brightness) obj.filters.push(new F.Brightness({ brightness: 0.15 })); break;
        case 'contrast': if (F.Contrast) obj.filters.push(new F.Contrast({ contrast: 0.25 })); break;
        case 'darken': if (F.Brightness) obj.filters.push(new F.Brightness({ brightness: -0.2 })); break;
        case 'greyscale': if (F.Grayscale) obj.filters.push(new F.Grayscale()); break;
        case 'lighten': if (F.Brightness) obj.filters.push(new F.Brightness({ brightness: 0.2 })); break;
        case 'invert': if (F.Invert) obj.filters.push(new F.Invert()); break;
        case 'negative': if (F.Invert) obj.filters.push(new F.Invert()); break;
        case 'sepia': if (F.Sepia) obj.filters.push(new F.Sepia()); break;
        default: break;
      }
      if (obj.applyFilters) obj.applyFilters();
    }

    function forceWrapTextboxObject(c, obj) {
      if (!c || !obj || obj.type !== 'textbox' || obj.cfsWrapText === false || !obj.set) return;
      if (obj.__cfsWrapping) return;
      var w = Number(obj.width);
      if (!(w > 0)) return;
      var raw = String(obj.text || '');
      var wrapped = forceWrapTextForWidth(raw, obj.fontFamily, obj.fontSize, obj.fontWeight, Math.max(1, w - 4));
      if (wrapped === String(obj.text || '')) return;
      obj.__cfsWrapping = true;
      obj.set('text', wrapped);
      if (typeof obj.initDimensions === 'function') obj.initDimensions();
      obj.__cfsWrapping = false;
    }

    /** Recompute dimensions from responsive percentages and from Left+Right / Top+Bottom (px). */
    function applyResponsivePositions(c) {
      if (!c || !c.getObjects) return;
      var cw = c.getWidth ? c.getWidth() : (c.width || 1080);
      var ch = c.getHeight ? c.getHeight() : (c.height || 1080);
      var minSide = Math.min(cw, ch);
      c.getObjects().forEach(function (obj) {
        if (!obj.set) return;
        var left = obj.left != null ? Number(obj.left) : 0;
        var top = obj.top != null ? Number(obj.top) : 0;
        if (obj.cfsRightPx != null && (obj.type === 'rect' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'image' || obj.type === 'path')) {
          var rightPx = Number(obj.cfsRightPx);
          var newW = Math.max(1, cw - left - rightPx);
          obj.set('width', newW);
          if (obj.type === 'textbox') {
            obj.set('minWidth', newW);
            obj.set('maxWidth', newW);
            if (obj.clipPath) obj.set('clipPath', null);
            forceWrapTextboxObject(c, obj);
            if (typeof obj.initDimensions === 'function') obj.initDimensions();
          }
        }
        if (obj.cfsBottomPx != null && obj.type !== 'circle' && obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox' && (obj.type === 'rect' || obj.type === 'image' || obj.type === 'path')) {
          var bottomPx = Number(obj.cfsBottomPx);
          obj.set('height', Math.max(0, ch - top - bottomPx));
        }
        if (!obj.cfsResponsive) return;
        var l = obj.cfsLeftPct != null ? Number(obj.cfsLeftPct) : null;
        var t = obj.cfsTopPct != null ? Number(obj.cfsTopPct) : null;
        var w = obj.cfsWidthPct != null ? Number(obj.cfsWidthPct) : null;
        var h = obj.cfsHeightPct != null ? Number(obj.cfsHeightPct) : null;
        if (l != null) obj.set('left', cw * l);
        if (t != null) obj.set('top', ch * t);
        if (obj.type === 'image') {
          if (w != null && obj.width > 0) {
            var targetVisW = cw * w;
            obj.set('scaleX', targetVisW / obj.width);
          }
          if (h != null && obj.height > 0) {
            var targetVisH = ch * h;
            obj.set('scaleY', targetVisH / obj.height);
          }
          if (obj.setCoords) obj.setCoords();
        } else if (obj.type === 'rect' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'path') {
          var isRotatedLine = obj.cfsShapeLine && obj.angle != null && (function () {
            var a = ((Number(obj.angle) % 360) + 360) % 360;
            return (Math.abs(a - 90) < 5 || Math.abs(a - 270) < 5);
          })();
          var wDim = isRotatedLine ? ch : cw;
          var hDim = isRotatedLine ? cw : ch;
          if (w != null) {
            var newW = wDim * w;
            obj.set('width', newW);
            if (obj.type === 'textbox') {
              obj.set('minWidth', newW);
              obj.set('maxWidth', newW);
              if (obj.clipPath) obj.set('clipPath', null);
              forceWrapTextboxObject(c, obj);
              if (typeof obj.initDimensions === 'function') obj.initDimensions();
            }
          }
          if (h != null && obj.type !== 'circle' && obj.type !== 'text' && obj.type !== 'textbox' && obj.type !== 'i-text') obj.set('height', hDim * h);
        }
        if (obj.type === 'circle' && obj.cfsRadiusPct != null) {
          var r = minSide * Number(obj.cfsRadiusPct);
          obj.set('radius', r);
        }
        if (obj.cfsFontSizePct != null && minSide > 0) {
          obj.set('fontSize', Math.max(8, Math.round(minSide * Number(obj.cfsFontSizePct))));
        } else if (obj.fontSize != null && minSide > 0 && obj.cfsResponsive) {
          obj.set('cfsFontSizePct', Number(obj.fontSize) / minSide);
        }
      });
      c.renderAll();
    }

    /** Set cfsResponsive and percentage fields (cfsLeftPct etc.) on all objects from current pixel geometry. Ensures templates scale correctly when preset/size changes. */
    function setResponsivePercentagesOnCanvas(c) {
      if (!c || !c.getObjects) return;
      var cw = c.getWidth ? c.getWidth() : (c.width || 1080);
      var ch = c.getHeight ? c.getHeight() : (c.height || 1080);
      if (!cw || !ch) return;
      var minSide = Math.min(cw, ch);
      c.getObjects().forEach(function (obj) {
        if (!obj.set) return;
        obj.set('cfsResponsive', true);
        var left = obj.left != null ? Number(obj.left) : 0;
        var top = obj.top != null ? Number(obj.top) : 0;
        obj.set('cfsLeftPct', left / cw);
        obj.set('cfsTopPct', top / ch);
        if (obj.type === 'rect' || obj.type === 'image' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'path') {
          if (obj.type === 'image') {
            var visW = (obj.width || 0) * (obj.scaleX || 1);
            var visH = (obj.height || 0) * (obj.scaleY || 1);
            if (visW > 0) obj.set('cfsWidthPct', visW / cw);
            if (visH > 0) obj.set('cfsHeightPct', visH / ch);
          } else {
            var isRotLine = obj.cfsShapeLine && obj.angle != null && (function () {
              var a = ((Number(obj.angle) % 360) + 360) % 360;
              return (Math.abs(a - 90) < 5 || Math.abs(a - 270) < 5);
            })();
            var wBase = isRotLine ? ch : cw;
            var hBase = isRotLine ? cw : ch;
            if (obj.width != null) obj.set('cfsWidthPct', Number(obj.width) / wBase);
            if (obj.height != null && obj.type !== 'text' && obj.type !== 'textbox' && obj.type !== 'i-text') obj.set('cfsHeightPct', Number(obj.height) / hBase);
          }
        }
        if (obj.type === 'circle' && obj.radius != null) obj.set('cfsRadiusPct', Number(obj.radius) / minSide);
        if (obj.fontSize != null && minSide > 0) obj.set('cfsFontSizePct', Number(obj.fontSize) / minSide);
      });
    }

    /** Keep all objects within canvas bounds; reflow textboxes; optionally shrink text font to fit max height. */
    function constrainToBounds(c) {
      if (!c || !c.getObjects) return;
      var cw = (c.getWidth && c.getWidth()) || c.width || 1080;
      var ch = (c.getHeight && c.getHeight()) || c.height || 1080;
      c.getObjects().forEach(function (obj) {
        if (!obj.set) return;
        var left = Number(obj.left) || 0;
        var top = Number(obj.top) || 0;
        var w = obj.width != null ? Number(obj.width) * (obj.scaleX != null ? obj.scaleX : 1) : 0;
        var h = obj.height != null ? Number(obj.height) * (obj.scaleY != null ? obj.scaleY : 1) : 0;
        if (obj.type === 'circle') { w = h = (Number(obj.radius) || 0) * 2 * (obj.scaleX != null ? obj.scaleX : 1); }
        if (left < 0) obj.set('left', 0);
        if (top < 0) obj.set('top', 0);
        left = Number(obj.left) || 0;
        top = Number(obj.top) || 0;
        if (left + w > cw && w > 0) {
          if (obj.type === 'textbox' && obj.cfsRightPx != null) { /* width will be fixed by applyResponsivePositions */ } else {
            obj.set('left', Math.max(0, cw - w));
          }
        }
        if (top + h > ch && h > 0 && obj.type !== 'textbox') {
          obj.set('top', Math.max(0, ch - h));
        }
      });
      applyResponsivePositions(c);
      refreshTextboxWrapping(c);
      fitTextboxesToMaxHeight(c);
      c.renderAll();
    }

    /** If textboxes have cfsMaxHeightPx or extend past canvas bottom, reduce font size until they fit. Does NOT permanently alter cfsFontSizePct; uses a temporary visual-only shrink. */
    function fitTextboxesToMaxHeight(c) {
      if (!c || !c.getObjects || !fabric || !fabric.Textbox) return;
      var ch = (c.getHeight && c.getHeight()) || c.height || 1080;
      c.getObjects().forEach(function (obj) {
        if (obj.type !== 'textbox' || !obj.set) return;
        if (obj.cfsMaxHeightPx == null) return;
        var top = Number(obj.top) || 0;
        var maxH = Number(obj.cfsMaxHeightPx);
        if (maxH <= 0) return;
        var currentH = (obj.height != null ? obj.height : 0) * (obj.scaleY != null ? obj.scaleY : 1);
        if (currentH <= maxH) return;
        var fontSize = Math.max(8, Math.floor((obj.fontSize || 24) * (maxH / currentH)));
        if (fontSize >= (obj.fontSize || 24)) return;
        obj.set('fontSize', fontSize);
        if (typeof obj.initDimensions === 'function') obj.initDimensions();
      });
      c.requestRenderAll();
    }

    /* ── Merge state snapshot/restore — hoisted to create() scope so pushUndo/undo/redo can access them ── */
    var _mergeDefaults = {};

    /** Snapshot the template.merge array for undo purposes. */
    function snapshotMergeState() {
      if (!template || !Array.isArray(template.merge)) return null;
      try { return JSON.parse(JSON.stringify(template.merge)); } catch (e) { return null; }
    }

    /** Restore template.merge from a snapshot. */
    function restoreMergeState(snapshot) {
      if (!template || !Array.isArray(snapshot)) return;
      template.merge = snapshot;
      /* Rebuild _mergeDefaults */
      Object.keys(_mergeDefaults).forEach(function (k) { delete _mergeDefaults[k]; });
      template.merge.forEach(function (m) {
        if (!m) return;
        var k = (m.find != null ? m.find : m.search);
        if (k != null && String(k).indexOf('__CFS_') !== 0) _mergeDefaults[String(k)] = (m.replace != null ? m.replace : m.value);
      });
    }

    function pushUndo(stateOverride) {
      if (!canvas || isUndoRedo || isInternalCanvasMutation) return;
      try {
        var newState = stateOverride || canvas.toJSON(CFS_RESPONSIVE_KEYS);
        if (newState && newState.width == null) newState.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || 0);
        if (newState && newState.height == null) newState.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || 0);
        if (!fabricHead) { fabricHead = newState; _mergeHead = snapshotMergeState(); updateUndoRedoButtons(); return; }
        if (!cfsJsonDiff) { fabricHead = newState; return; }
        var reversePatch = cfsJsonDiff(newState, fabricHead);
        var curMerge = snapshotMergeState();
        var mergeChanged = JSON.stringify(curMerge) !== JSON.stringify(_mergeHead);
        if (!reversePatch.length && !mergeChanged) return;
        undoPatches.unshift({ ops: reversePatch, at: Date.now(), isSave: false, mergeSnapshot: _mergeHead });
        if (undoPatches.length > maxHistory) undoPatches.pop();
        redoPatches.length = 0;
        fabricHead = newState;
        _mergeHead = curMerge;
        updateUndoRedoButtons();
      } catch (e) { /* ignore */ }
    }
    var _mergeHead = null;

    /** After template load / injectMergeData, sync fabricHead to the visible canvas and clear patches so Undo does not revert to pre-merge placeholders. */
    function resetEditorUndoBaseline() {
      if (!canvas) return;
      try {
        var s = canvas.toJSON(CFS_RESPONSIVE_KEYS);
        if (s && s.width == null) s.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || 0);
        if (s && s.height == null) s.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || 0);
        fabricHead = s;
        _mergeHead = snapshotMergeState();
        undoPatches.length = 0;
        redoPatches.length = 0;
        updateUndoRedoButtons();
      } catch (e) { /* ignore */ }
    }

    var lastSavedFingerprint = null;

    function saveStateDebounced() {
      if (saveStateTimer) clearTimeout(saveStateTimer);
      saveStateTimer = setTimeout(function () {
        pushUndo();
        editEvents.emit('edit:changed', {});
      }, 400);
    }

    function updateUndoRedoButtons() {
      if (undoBtn) undoBtn.disabled = !undoPatches.length;
      if (redoBtn) redoBtn.disabled = !redoPatches.length;
    }

    var _isRestoring = false;
    var _pendingRestoreAction = null;

    function restoreState(state) {
      if (!canvas || !state) return;
      _isRestoring = true;
      isUndoRedo = true;
      canvas.loadFromJSON(state, function () {
        ensureCanvasObjectsSelectable(canvas);
        fixTextBaseline(canvas);
        applyResponsivePositions(canvas);
        refreshTextboxWrapping(canvas);
        constrainToBounds(canvas);
        canvas.renderAll();
        refreshLayersPanel();
        refreshPropertyPanel();
        refreshTimeline();
        invalidateFabricTextLayout(canvas);
        /* Re-sync fabricHead to the actual canvas state AFTER all post-load
           modifications (text wrapping, responsive positions, constrain-to-bounds,
           text layout invalidation).  Without this, the canvas differs from
           fabricHead and the next pushUndo() creates a spurious entry that
           wipes redoPatches. */
        try {
          var syncState = canvas.toJSON(CFS_RESPONSIVE_KEYS);
          if (syncState && syncState.width == null) syncState.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || 0);
          if (syncState && syncState.height == null) syncState.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || 0);
          fabricHead = syncState;
        } catch (e) { /* ignore */ }
        updateUndoRedoButtons();
        _isRestoring = false;
        /* Reset isUndoRedo AFTER loadFromJSON callback completes, so
           object:added/removed events fired during the load don't trigger
           pushUndo (which would wipe redoPatches). */
        setTimeout(function () {
          isUndoRedo = false;
          /* If an undo/redo was requested while we were restoring, execute it now. */
          if (_pendingRestoreAction) {
            var fn = _pendingRestoreAction;
            _pendingRestoreAction = null;
            fn();
          }
        }, 0);
      });
    }

    function withInternalCanvasMutation(fn) {
      isInternalCanvasMutation = true;
      try { return fn && fn(); }
      finally {
        setTimeout(function () { isInternalCanvasMutation = false; }, 0);
      }
    }

    function undo() {
      if (_isRestoring) { _pendingRestoreAction = undo; return; }
      if (!undoPatches.length || !fabricHead || !canvas) return;
      if (!cfsJsonPatch || !cfsJsonDiff) return;
      var entry = undoPatches.shift();
      var prevState = cfsJsonPatch(fabricHead, entry.ops);
      var forwardPatch = cfsJsonDiff(prevState, fabricHead);
      redoPatches.unshift({ ops: forwardPatch, at: entry.at, isSave: entry.isSave, mergeSnapshot: _mergeHead });
      fabricHead = prevState;
      if (entry.mergeSnapshot) { _mergeHead = entry.mergeSnapshot; restoreMergeState(entry.mergeSnapshot); }
      restoreState(fabricHead);
      editEvents.emit('edit:undo', {});
    }

    function redo() {
      if (_isRestoring) { _pendingRestoreAction = redo; return; }
      if (!redoPatches.length || !fabricHead || !canvas) return;
      if (!cfsJsonPatch || !cfsJsonDiff) return;
      var entry = redoPatches.shift();
      var nextState = cfsJsonPatch(fabricHead, entry.ops);
      var reversePatch = cfsJsonDiff(nextState, fabricHead);
      undoPatches.unshift({ ops: reversePatch, at: entry.at, isSave: entry.isSave, mergeSnapshot: _mergeHead });
      fabricHead = nextState;
      if (entry.mergeSnapshot) { _mergeHead = entry.mergeSnapshot; restoreMergeState(entry.mergeSnapshot); }
      restoreState(fabricHead);
      editEvents.emit('edit:redo', {});
    }

    var undoBtn;
    var redoBtn;

    function getCanvasDimensions() {
      const pId = presetSelect ? presetSelect.value : null;
      const p = pId ? getPreset(pId) : null;
      if (p && p.width != null && p.height != null && p.width > 0 && p.height > 0) return { w: p.width, h: p.height };
      if (pId === 'custom' && options.getMergeValues) {
        var vals = options.getMergeValues();
        var cw = vals && Number(vals.outputWidth) > 0 ? Number(vals.outputWidth) : null;
        var ch = vals && Number(vals.outputHeight) > 0 ? Number(vals.outputHeight) : null;
        if (cw != null && ch != null) return { w: cw, h: ch };
      }
      return { w: width, h: height };
    }

    function createFabricCanvas(w, h, bg) {
      const el = document.createElement('canvas');
      el.width = w;
      el.height = h;
      el.setAttribute('data-fabric-canvas', '1');
      if (!fabric) return { el: el, canvas: null, wrapperEl: el };
      const c = new fabric.Canvas(el, {
        width: w,
        height: h,
        backgroundColor: bg || '#ffffff',
        preserveObjectStacking: true,
      });
      var wrapperEl = (c.wrapperEl && c.wrapperEl.nodeType === 1) ? c.wrapperEl : (el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : el);
      if (wrapperEl !== el && !wrapperEl.getAttribute('data-fabric-canvas')) wrapperEl.setAttribute('data-fabric-canvas', '1');
      return { el: el, canvas: c, wrapperEl: wrapperEl };
    }

    function ensureCanvasObjectsSelectable(c) {
      if (!c || !c.getObjects) return;
      c.getObjects().forEach(function (obj) {
        if (obj.set) {
          obj.set('selectable', true);
          obj.set('evented', true);
          obj.set('hasControls', true);
          obj.set('hasBorders', true);
          obj.set('lockMovementX', false);
          obj.set('lockMovementY', false);
          obj.set('lockScalingX', false);
          obj.set('lockScalingY', false);
        }
      });
      c.renderAll();
    }

    function buildMergeValuesFrom(values) {
      values = values || {};
      var schema = extension.inputSchema || [];
      var out = {};
      var mergeDefaults = {};
      if (template && Array.isArray(template.merge)) {
        template.merge.forEach(function (m) {
          if (!m) return;
          var key = (m.find != null ? m.find : m.search);
          if (key == null) return;
          var val = (m.replace != null ? m.replace : m.value);
          out[String(key)] = val;
          out[String(key).toUpperCase().replace(/\s+/g, '_')] = val;
          mergeDefaults[String(key).trim()] = val;
        });
      }
      var utils = (typeof window !== 'undefined' && window.__CFS_mergeUtils) || null;
      schema.forEach(function (field) {
        var keyUpper = (field.mergeField || field.id || '').toUpperCase().replace(/\s+/g, '_');
        var val = values[field.id];
        if ((val === undefined || val === null) && utils && utils.resolveMergeWithFallbacks && (Array.isArray(field.fallbacks) || utils.isMediaFieldType(field.type))) {
          val = utils.resolveMergeWithFallbacks(field, values, mergeDefaults);
        }
        if (val === undefined || val === null) return;
        if (keyUpper) out[keyUpper] = val;
        if (field.id) out[field.id] = val;
      });
      return Object.keys(out).length ? out : values;
    }

    /** Build merge values from current canvas (for export/bulk when Variables panel is hidden). */
    function getMergeValuesFromCanvas() {
      var c = canvas;
      if (!c || !c.getObjects) return buildMergeValuesFrom(options.values || {});
      var byName = {};
      var backgroundFill = null;
      c.getObjects().forEach(function (obj) {
        var name = (obj.name || '').toString().trim();
        if (!name) return;
        if (name === 'background' && (obj.type === 'rect' || obj.type === 'path') && obj.get('fill')) {
          backgroundFill = obj.get('fill');
          return;
        }
        var key = name.toUpperCase().replace(/\s+/g, '_');
        if (obj.type === 'image' && obj.get('src')) byName[key] = obj.get('src');
        else if ((obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') && obj.get('text') !== undefined) byName[key] = obj.get('text');
        else if ((obj.type === 'rect' || obj.type === 'path') && obj.get('fill')) byName[key] = obj.get('fill');
      });
      var out = {};
      if (backgroundFill != null) out.backgroundColor = backgroundFill;
      (extension.inputSchema || []).forEach(function (field) {
        var keyUpper = (field.mergeField || field.id || '').toUpperCase().replace(/\s+/g, '_');
        if (keyUpper && byName[keyUpper] !== undefined) out[field.id] = byName[keyUpper];
      });
      return Object.keys(out).length ? out : buildMergeValuesFrom(options.values || {});
    }

    function buildMergeValuesForInject() {
      var values = (typeof options.getMergeValues === 'function' && options.getMergeValues()) || options.values || {};
      return buildMergeValuesFrom(values);
    }

    /** Match template-engine still PNG: seek past typewriter/fade-in so Fabric preview shows final text. */
    function computeEditorStillSeekSec(fabricCanvasArg) {
      var eng = global.__CFS_templateEngine;
      if (!eng || typeof eng.computeStillImageSeekTimeSec !== 'function' || !template) return 0;
      var fc = fabricCanvasArg || canvas;
      var dur = (coreScene && coreScene.getTimelineFromCanvas && fc) ? coreScene.getTimelineFromCanvas(fc).durationSec : 0;
      if (!dur || dur <= 0 || !isFinite(dur)) {
        dur = 10;
        if (template.timeline && template.timeline.tracks) {
          template.timeline.tracks.forEach(function (tr) {
            (tr.clips || []).forEach(function (c) {
              var end = (Number(c.start) || 0) + (Number(c.length) || 0);
              if (end > dur) dur = end;
            });
          });
        }
      }
      return eng.computeStillImageSeekTimeSec(template, dur);
    }

    /** Image: all clips visible at still seek time (ignore clip timing), minus cfsHideOnImage; video/audio: playhead seek. */
    function applySeekForOutputPreview(fabricCanvasArg) {
      var fc = fabricCanvasArg || canvas;
      if (!coreScene || !fc) return;
      var ot = outputTypeSelect && outputTypeSelect.value;
      if (ot === 'image') {
        if (coreScene.restoreAllBaseStates) coreScene.restoreAllBaseStates(fc);
        var tStill = computeEditorStillSeekSec(fc);
        if (typeof setPlayheadTime === 'function') setPlayheadTime(tStill);
        if (coreScene.seekToTime) coreScene.seekToTime(fc, tStill, { ignoreClipTiming: true });
        fc.getObjects().forEach(function (obj) {
          if (obj.cfsHideOnImage && obj.set) obj.set('visible', false);
        });
        fc.renderAll();
        return;
      }
      if (!coreScene.seekToTime) return;
      var t = currentPlayheadSec || 0;
      coreScene.seekToTime(fc, t);
    }

    /** Fix Fabric.js 5 typo, apply cfsAlignHorizontal to textAlign, ensure origin for correct positioning. */
    function fixTextBaseline(c) {
      if (!c || !c.getObjects) return;
      var valid = ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'];
      c.getObjects().forEach(function (obj) {
        if ((obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') && obj.set) {
          var base = obj.textBaseline;
          if (base === 'alphabetical' || (base && valid.indexOf(base) === -1)) {
            obj.set('textBaseline', 'alphabetic');
          }
          if (obj.cfsAlignHorizontal != null) {
            var h = String(obj.cfsAlignHorizontal).toLowerCase();
            obj.set('textAlign', (h === 'center' ? 'center' : h === 'right' ? 'right' : 'left'));
          }
          if (obj.cfsLineHeight != null) obj.set('lineHeight', Number(obj.cfsLineHeight));
          obj.set('originX', obj.originX || 'left');
          obj.set('originY', obj.originY || 'top');
        }
      });
    }

    /** Recreate each textbox so Fabric computes height from text + width (fixes wrapped text being cut off). */
    function refreshTextboxWrapping(c) {
      if (!c || !c.getObjects || !fabric || !fabric.Textbox) return;
      var cw = (c.getWidth && c.getWidth()) || c.width || 1080;
      var objs = c.getObjects();
      var toReplace = [];
      objs.forEach(function (obj, idx) {
        if (obj.type !== 'textbox') return;
        var left = obj.get('left') || 0;
        var cfsRightPx = obj.cfsRightPx != null ? Number(obj.cfsRightPx) : null;
        var w;
        if (cfsRightPx != null) {
          w = Math.max(50, cw - left - cfsRightPx + 8);
        } else {
          var widthPct = obj.cfsWidthPct != null ? Number(obj.cfsWidthPct) : (obj.get && obj.get('cfsWidthPct') != null ? Number(obj.get('cfsWidthPct')) : null);
          if (widthPct != null && widthPct > 0) {
            w = Math.max(50, cw * widthPct);
          } else {
            var origClip = obj.cfsOriginalClip || (obj.get && obj.get('cfsOriginalClip'));
            var origAsset = origClip && origClip.asset;
            var origW = (origAsset && origAsset.width != null) ? Number(origAsset.width) : (origClip && origClip.width != null ? Number(origClip.width) : 0);
            if (origW > 0) {
              w = origW;
            } else {
              w = obj.get('width');
              if (w == null || w <= 0) w = Math.max(200, cw - left - 80);
            }
          }
        }
        toReplace.push({ obj: obj, idx: idx, w: w });
      });
      toReplace.sort(function (a, b) { return b.idx - a.idx; });
      toReplace.forEach(function (item) {
        var obj = item.obj;
        var idx = item.idx;
        var w = item.w;
        var txt = (obj.get('text') || '').toString();
        var textToUse = txt;
        var left = obj.get('left') || 0;
        var top = obj.get('top') || 0;
        var fontSize = obj.get('fontSize') || 24;
        var fontFamily = obj.get('fontFamily') || 'sans-serif';
        var fill = obj.get('fill') || '#000000';
        var fontWeight = obj.get('fontWeight') || 'normal';
        var preWrap = global.__CFS_wrapTextToWidth;
        if (typeof preWrap === 'function' && w > 0) {
          textToUse = preWrap(textToUse, fontFamily, fontSize, fontWeight, Math.max(1, w - 2));
        }
        var name = obj.get('name') || obj.get('id');
        var cfsStart = obj.get('cfsStart');
        var cfsLength = obj.get('cfsLength');
        var cfsTrackIndex = obj.get('cfsTrackIndex');
        var cfsRightPx = obj.get('cfsRightPx');
        var lockedWidth = cfsRightPx != null;
        var lineHeightVal = (obj.get && obj.get('cfsLineHeight') != null) ? Number(obj.get('cfsLineHeight')) : (name === 'AD_APPLE_NOTES_TEXT_1' ? 1.55 : null);
        var opts = {
          left: left,
          top: top,
          width: w,
          fontSize: fontSize,
          fontFamily: fontFamily,
          fill: fill,
          fontWeight: fontWeight,
          textBaseline: 'alphabetic',
          padding: 0,
          minWidth: lockedWidth ? w : 50,
          maxWidth: lockedWidth ? w : Math.max(w, cw - left - 20),
        };
        if (lineHeightVal != null && lineHeightVal > 0) opts.lineHeight = lineHeightVal;
        var newObj = new fabric.Textbox(textToUse, opts);
        /* No clipPath - Fabric Textbox wraps by width; clipPath was clipping text vertically */
        newObj.set('name', name);
        newObj.set('cfsStart', cfsStart);
        newObj.set('cfsLength', cfsLength);
        if (cfsTrackIndex != null) newObj.set('cfsTrackIndex', cfsTrackIndex);
        newObj.set('cfsWrapText', true);
        var cfsRawTextVal = (obj.get && obj.get('cfsRawText') != null) ? obj.get('cfsRawText') : null;
        if (cfsRawTextVal != null) newObj.set('cfsRawText', cfsRawTextVal);
        if (cfsRightPx != null) newObj.set('cfsRightPx', cfsRightPx);
        if (obj.get && obj.get('cfsRichText')) newObj.set('cfsRichText', true);
        if (obj.get && obj.get('cfsAnimation')) newObj.set('cfsAnimation', obj.get('cfsAnimation'));
        if (obj.get && obj.get('cfsOriginalClip')) newObj.set('cfsOriginalClip', obj.get('cfsOriginalClip'));
        if (obj.get && obj.get('cfsAlignHorizontal')) {
          newObj.set('cfsAlignHorizontal', obj.get('cfsAlignHorizontal'));
          var h = String(obj.get('cfsAlignHorizontal')).toLowerCase();
          newObj.set('textAlign', (h === 'center' ? 'center' : h === 'right' ? 'right' : 'left'));
        }
        if (obj.get && obj.get('cfsAlignVertical')) newObj.set('cfsAlignVertical', obj.get('cfsAlignVertical'));
        if (obj.get && obj.get('cfsLineHeight') != null) {
          newObj.set('cfsLineHeight', obj.get('cfsLineHeight'));
          newObj.set('lineHeight', Number(obj.get('cfsLineHeight')));
        }
        newObj.set('originX', 'left');
        newObj.set('originY', 'top');
        if (obj.get && obj.get('cfsClipOpacity') != null) newObj.set('cfsClipOpacity', obj.get('cfsClipOpacity'));
        if (obj.get && obj.get('cfsLengthWasEnd') != null) newObj.set('cfsLengthWasEnd', obj.get('cfsLengthWasEnd'));
        if (obj.get && obj.get('cfsResponsive')) newObj.set('cfsResponsive', true);
        if (obj.get && obj.get('cfsLeftPct') != null) newObj.set('cfsLeftPct', obj.get('cfsLeftPct'));
        if (obj.get && obj.get('cfsTopPct') != null) newObj.set('cfsTopPct', obj.get('cfsTopPct'));
        if (obj.get && obj.get('cfsWidthPct') != null) newObj.set('cfsWidthPct', obj.get('cfsWidthPct'));
        if (obj.get && obj.get('cfsHeightPct') != null) newObj.set('cfsHeightPct', obj.get('cfsHeightPct'));
        if (obj.get && obj.get('cfsFontSizePct') != null) newObj.set('cfsFontSizePct', obj.get('cfsFontSizePct'));
        if (obj.get && obj.get('cfsRadiusPct') != null) newObj.set('cfsRadiusPct', obj.get('cfsRadiusPct'));
        if (obj.get && obj.get('cfsMergeKey') != null) newObj.set('cfsMergeKey', obj.get('cfsMergeKey'));
        if (obj.get && obj.get('cfsLetterSpacing') != null) newObj.set('cfsLetterSpacing', obj.get('cfsLetterSpacing'));
        if (obj.get && obj.get('cfsTextTransform')) newObj.set('cfsTextTransform', obj.get('cfsTextTransform'));
        if (obj.get && obj.get('cfsTextDecoration')) newObj.set('cfsTextDecoration', obj.get('cfsTextDecoration'));
        if (obj.get && obj.get('cfsGradient')) newObj.set('cfsGradient', obj.get('cfsGradient'));
        if (obj.get && obj.get('cfsStroke')) newObj.set('cfsStroke', obj.get('cfsStroke'));
        if (obj.get && obj.get('cfsShadow')) newObj.set('cfsShadow', obj.get('cfsShadow'));
        if (obj.get && obj.get('cfsFilter')) newObj.set('cfsFilter', obj.get('cfsFilter'));
        if (obj.get && obj.get('cfsMaxHeightPx') != null) newObj.set('cfsMaxHeightPx', obj.get('cfsMaxHeightPx'));
        if (obj.get && obj.get('cfsBottomPx') != null) newObj.set('cfsBottomPx', obj.get('cfsBottomPx'));
        if (obj.get && obj.get('cfsFadeIn') != null) newObj.set('cfsFadeIn', obj.get('cfsFadeIn'));
        if (obj.get && obj.get('cfsFadeOut') != null) newObj.set('cfsFadeOut', obj.get('cfsFadeOut'));
        if (obj.get && obj.get('cfsTransition')) newObj.set('cfsTransition', obj.get('cfsTransition'));
        if (obj.get && obj.get('cfsEffect')) newObj.set('cfsEffect', obj.get('cfsEffect'));
        if (obj.get && obj.get('cfsOpacityTween')) newObj.set('cfsOpacityTween', obj.get('cfsOpacityTween'));
        if (obj.get && obj.get('cfsOffsetTween')) newObj.set('cfsOffsetTween', obj.get('cfsOffsetTween'));
        if (obj.get && obj.get('cfsRotateTween')) newObj.set('cfsRotateTween', obj.get('cfsRotateTween'));
        if (obj.get && obj.get('cfsLengthAuto') != null) newObj.set('cfsLengthAuto', obj.get('cfsLengthAuto'));
        if (obj.get && obj.get('cfsTextBackground')) {
          newObj.set('cfsTextBackground', obj.get('cfsTextBackground'));
          newObj.set('backgroundColor', obj.get('cfsTextBackground'));
        }
        withInternalCanvasMutation(function () {
          c.remove(obj);
          insertObjectAtCanvas(c, newObj, idx);
        });
        newObj.set('width', w);
        newObj.set('minWidth', lockedWidth ? w : 50);
        newObj.set('maxWidth', lockedWidth ? w : Math.max(w, cw - left - 20));
        if (typeof newObj.initDimensions === 'function') newObj.initDimensions();
        (function (tb, canvas, wid) {
          [0, 100, 300, 600].forEach(function (delay) {
            setTimeout(function () {
              if (!tb || !tb.set) return;
              tb.set('width', wid);
              if (typeof tb.initDimensions === 'function') tb.initDimensions();
              if (canvas.requestRenderAll) canvas.requestRenderAll();
            }, delay);
          });
        })(newObj, c, w);
      });
      c.requestRenderAll();
    }

    /** Resolve "auto" length using HTML5 video/audio: get duration from media element and update canvas objects + template clips. */
    function getMediaDuration(src, kind) {
      kind = (kind === 'audio' || kind === 'video') ? kind : 'video';
      if (!src || typeof src !== 'string') return Promise.resolve(NaN);
      var el = document.createElement(kind);
      el.preload = 'metadata';
      el.crossOrigin = kind === 'video' ? 'anonymous' : undefined;
      return new Promise(function (resolve) {
        var done = function (dur) {
          el.removeAttribute('src');
          el.load();
          resolve(typeof dur === 'number' && !isNaN(dur) && dur > 0 ? dur : 5);
        };
        el.onloadedmetadata = function () { done(el.duration); };
        el.onerror = function () { done(5); };
        el.ontimeout = function () { done(5); };
        el.src = src;
        if (el.duration && !isNaN(el.duration) && el.duration > 0) done(el.duration);
        else setTimeout(function () { done(5); }, 8000);
      });
    }

    function resolveAutoLengthsFromMedia() {
      if (!canvas || !canvas.getObjects) return;
      var pending = 0;
      function afterResolve() {
        pending--;
        if (pending <= 0) refreshTimeline();
      }
      canvas.getObjects().forEach(function (obj) {
        if (!obj.get || !obj.set) return;
        if (obj.get('cfsLengthAuto') && obj.get('cfsVideoSrc')) {
          pending++;
          getMediaDuration(obj.get('cfsVideoSrc'), 'video').then(function (dur) {
            obj.set('cfsLength', Math.round(dur * 10) / 10);
            obj.set('cfsLengthAuto', false);
            afterResolve();
          });
        }
      });
      if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
        template.timeline.tracks.forEach(function (track) {
          (track.clips || []).forEach(function (clip) {
            var asset = clip.asset || {};
            var type = (asset.type || '').toLowerCase();
            var src = asset.src || asset.url;
            if (clip.length !== 'auto' || !src || typeof src !== 'string') return;
            if (type !== 'audio' && type !== 'video' && type !== 'luma') return;
            pending++;
            getMediaDuration(src, type === 'audio' ? 'audio' : 'video').then(function (dur) {
              clip.length = Math.round(dur * 10) / 10;
              afterResolve();
            });
          });
        });
      }
      if (pending <= 0) refreshTimeline();
    }

    /** If options.downloadToUploads(url) is provided, resolve remote media URLs to local (e.g. uploads folder) before adding to canvas. */
    function resolveMediaInStructure(structure, downloadToUploads) {
      if (!structure || !structure.objects || typeof downloadToUploads !== 'function') return Promise.resolve();
      var promises = [];
      structure.objects.forEach(function (obj) {
        if (obj.src && typeof obj.src === 'string' && /^https?:\/\//i.test(obj.src) && obj.src.indexOf('{{') === -1) {
          promises.push(Promise.resolve(downloadToUploads(obj.src)).then(function (localUrl) {
            if (localUrl) obj.src = localUrl;
          }).catch(function () {}));
        }
        if (obj.cfsVideoSrc && typeof obj.cfsVideoSrc === 'string' && /^https?:\/\//i.test(obj.cfsVideoSrc) && obj.cfsVideoSrc.indexOf('{{') === -1) {
          promises.push(Promise.resolve(downloadToUploads(obj.cfsVideoSrc)).then(function (localUrl) {
            if (localUrl) obj.cfsVideoSrc = localUrl;
          }).catch(function () {}));
        }
        if (obj.cfsSvgSrc && typeof obj.cfsSvgSrc === 'string' && /^https?:\/\//i.test(obj.cfsSvgSrc)) {
          promises.push(Promise.resolve(downloadToUploads(obj.cfsSvgSrc)).then(function (localUrl) {
            if (localUrl) {
              obj.cfsSvgSrc = localUrl;
              if (obj.type === 'image') obj.src = localUrl;
            }
          }).catch(function () {}));
        }
      });
      return Promise.all(promises);
    }

    /** Auto-migrate legacy caption clips → rich-caption on template load. */
    function migrateCaptionsToRichCaption(tmpl) {
      if (!tmpl || !tmpl.timeline || !Array.isArray(tmpl.timeline.tracks)) return;
      tmpl.timeline.tracks.forEach(function (track) {
        if (!track || !Array.isArray(track.clips)) return;
        track.clips.forEach(function (clip) {
          if (clip && clip.asset && (clip.asset.type === 'caption' || clip.asset.type === 'rich-caption')) {
            clip.asset.type = 'rich-caption';
          }
        });
      });
    }
    /**
     * Auto-generate a rich-caption track when a template has TTS but no captions.
     * Uses estimateWords for word-level timing so karaoke highlighting works out of the box.
     * Returns true if captions were added.
     */
    function ensureCaptionsForTts(tpl) {
      if (!tpl || !tpl.timeline || !Array.isArray(tpl.timeline.tracks)) return false;
      /* 1. Collect TTS clips */
      var ttsClips = [];
      tpl.timeline.tracks.forEach(function (track) {
        (track.clips || []).forEach(function (clip) {
          if (clip.asset && clip.asset.type === 'text-to-speech' && clip.asset.text) {
            ttsClips.push(clip);
          }
        });
      });
      if (!ttsClips.length) return false;
      /* 2. Check if any caption track already exists */
      var hasCaptions = tpl.timeline.tracks.some(function (track) {
        return (track.clips || []).some(function (clip) {
          return clip.asset && (clip.asset.type === 'rich-caption' || clip.asset.type === 'caption');
        });
      });
      if (hasCaptions) return false;
      /* 3. Generate estimated words for each TTS clip → inject caption track */
      var estimateWords = (typeof window !== 'undefined') && window.__CFS_estimateWords;
      if (!estimateWords) return false;
      var captionClips = [];
      ttsClips.forEach(function (ttsClip) {
        var startOffset = Number(ttsClip.start) || 0;
        /* Word timings must be relative to the clip start (0-based) because
           seekToTime converts to localTime = timeSec - clipStart before matching.
           Use estimateWordsInSpan if clip has a known duration for precise distribution. */
        var ttsLen = Number(ttsClip.length) || 0;
        var spanEstimate = (typeof window !== 'undefined') && window.__CFS_estimateWordsInSpan;
        var words = (ttsLen > 0 && spanEstimate)
          ? spanEstimate(ttsClip.asset.text, 0, ttsLen)
          : estimateWords(ttsClip.asset.text, 0);
        if (!words || !words.length) return;
        /* Determine clip length from TTS clip or estimate from word timings */
        var lastWord = words[words.length - 1];
        var estDuration = lastWord ? (lastWord.end + 0.5) : 10;
        var clipLength = ttsLen || estDuration;
        captionClips.push({
          start: startOffset,
          length: clipLength,
          position: 'bottom',
          asset: {
            type: 'rich-caption',
            words: words,
            font: { family: 'Open Sans', size: 34, color: '#ffffff', weight: 700 },
            active: { font: { color: '#efbf04' } },
            background: { color: '#000000', padding: 8, borderRadius: 4 },
            animation: { style: 'karaoke' },
            _autoGenerated: true
          }
        });
      });
      if (!captionClips.length) return false;
      /* Insert as first track (topmost visual layer) */
      tpl.timeline.tracks.unshift({ clips: captionClips });
      return true; /* captions were added */
    }

    /**
     * Regenerate caption words from current TTS clips.
     * Call this whenever TTS text, timing, or related audio/video structure changes.
     * Only updates existing caption tracks; does not create new ones (use ensureCaptionsForTts for that).
     */
    function regenerateCaptionsFromTts(tpl) {
      if (!tpl || !tpl.timeline || !Array.isArray(tpl.timeline.tracks)) return false;
      /* 1. Collect TTS clips */
      var ttsClips = [];
      tpl.timeline.tracks.forEach(function (track) {
        (track.clips || []).forEach(function (clip) {
          if (clip.asset && clip.asset.type === 'text-to-speech' && clip.asset.text) {
            ttsClips.push(clip);
          }
        });
      });
      if (!ttsClips.length) return false;
      /* 2. Find existing caption tracks */
      var captionTracks = [];
      tpl.timeline.tracks.forEach(function (track, idx) {
        (track.clips || []).forEach(function (clip, ci) {
          if (clip.asset && (clip.asset.type === 'rich-caption' || clip.asset.type === 'caption')) {
            captionTracks.push({ trackIdx: idx, clipIdx: ci, clip: clip });
          }
        });
      });
      if (!captionTracks.length) return false;
      /* 3. Generate word-level timings from TTS text */
      var estimateWords = (typeof window !== 'undefined') && window.__CFS_estimateWords;
      var spanEstimate = (typeof window !== 'undefined') && window.__CFS_estimateWordsInSpan;
      if (!estimateWords) return false;
      var updated = false;
      /* Match TTS clips to caption clips by order (first TTS → first caption, etc.) */
      for (var i = 0; i < Math.min(ttsClips.length, captionTracks.length); i++) {
        var ttsClip = ttsClips[i];
        var capEntry = captionTracks[i];
        var startOffset = Number(ttsClip.start) || 0;
        /* Word timings must be relative to clip start (0-based) — seekToTime
           computes localTime = timeSec - clipStart before matching words.
           Use estimateWordsInSpan if clip duration is known. */
        var ttsLen = Number(ttsClip.length) || 0;
        var words = (ttsLen > 0 && spanEstimate)
          ? spanEstimate(ttsClip.asset.text, 0, ttsLen)
          : estimateWords(ttsClip.asset.text, 0);
        if (!words || !words.length) continue;
        /* Update caption clip */
        capEntry.clip.asset.words = words;
        capEntry.clip.asset._autoGenerated = true;
        capEntry.clip.start = startOffset;
        var lastWord = words[words.length - 1];
        var estDuration = lastWord ? (lastWord.end + 0.5) : 10;
        capEntry.clip.length = ttsLen || estDuration;
        updated = true;
      }
      return updated;
    }

    /**
     * Auto-populate an empty caption track (one without words) from TTS text.
     * Called when user manually adds a caption track.
     */
    function autoPopulateCaptionFromTts(tpl) {
      if (!tpl || !tpl.timeline || !Array.isArray(tpl.timeline.tracks)) return false;
      var estimateWords = (typeof window !== 'undefined') && window.__CFS_estimateWords;
      var spanEstimate = (typeof window !== 'undefined') && window.__CFS_estimateWordsInSpan;
      if (!estimateWords) return false;
      /* Find TTS clips */
      var ttsClips = [];
      tpl.timeline.tracks.forEach(function (track) {
        (track.clips || []).forEach(function (clip) {
          if (clip.asset && clip.asset.type === 'text-to-speech' && clip.asset.text) {
            ttsClips.push(clip);
          }
        });
      });
      if (!ttsClips.length) return false;
      /* Find empty caption clips (no words property or empty words array) */
      var populated = false;
      var ttsIdx = 0;
      tpl.timeline.tracks.forEach(function (track) {
        (track.clips || []).forEach(function (clip) {
          if (clip.asset && (clip.asset.type === 'rich-caption' || clip.asset.type === 'caption')) {
            if ((!clip.asset.words || !clip.asset.words.length) && ttsIdx < ttsClips.length) {
              var ttsClip = ttsClips[ttsIdx];
              var startOffset = Number(ttsClip.start) || 0;
              /* Word timings must be 0-based (seekToTime subtracts clipStart).
                 Use estimateWordsInSpan if clip duration is known. */
              var ttsLen = Number(ttsClip.length) || 0;
              var words = (ttsLen > 0 && spanEstimate)
                ? spanEstimate(ttsClip.asset.text, 0, ttsLen)
                : estimateWords(ttsClip.asset.text, 0);
              if (words && words.length) {
                clip.asset.words = words;
                clip.asset.type = 'rich-caption';
                clip.asset._autoGenerated = true;
                clip.start = startOffset;
                var lastWord = words[words.length - 1];
                clip.length = ttsLen || (lastWord ? lastWord.end + 0.5 : 10);
                if (!clip.asset.animation) clip.asset.animation = { style: 'karaoke' };
                if (!clip.asset.active) clip.asset.active = { font: { color: '#efbf04' } };
                populated = true;
              }
              ttsIdx++;
            }
          }
        });
      });
      return populated;
    }

    /**
     * Check if a clip type is one whose changes can invalidate captions.
     * Moving an image/shape/text does NOT invalidate captions.
     * Changing TTS text, audio timing, or video timing DOES.
     */
    function isCaptionInvalidatingType(type) {
      return type === 'text-to-speech' || type === 'audio' || type === 'video';
    }

    /* Debounced caption regeneration (500ms) — prevents rapid-fire updates */
    var _captionRegenTimer = null;
    function debouncedRegenerateCaptions() {
      if (_captionRegenTimer) clearTimeout(_captionRegenTimer);
      _captionRegenTimer = setTimeout(function () {
        _captionRegenTimer = null;
        if (regenerateCaptionsFromTts(template)) {
          if (typeof refreshTimeline === 'function') refreshTimeline();
          if (canvas && typeof canvas.renderAll === 'function') canvas.renderAll();
        }
      }, 500);
    }

    function loadTemplateIntoCanvas(fabricCanvas, onDone) {
      if (!fabricCanvas) return;
      migrateCaptionsToRichCaption(template);
      ensureCaptionsForTts(template);
      var fontLoadResult = (template && template.timeline && typeof global.__CFS_loadTimelineFonts === 'function')
        ? global.__CFS_loadTimelineFonts(template) : null;
      var doBuild = function () {
      var structure = coreScene && template.timeline ? coreScene.shotstackToFabricStructure(template) : null;
      if (structure && structure.objects && structure.objects.length) {
        var doLoad = function () {
          var dim = getCanvasDimensions();
          var targetW = dim.w;
          var targetH = dim.h;
          var fabricState = {
            version: fabric.Canvas.VERSION || '4.0',
            width: structure.width,
            height: structure.height,
            background: (template.timeline && template.timeline.background) || '#ffffff',
            objects: structure.objects,
          };
          if (targetW > 0 && targetH > 0 && (targetW !== structure.width || targetH !== structure.height)) {
            fabricState = scaleCanvasStateToSize(fabricState, targetW, targetH);
          }
          width = targetW > 0 ? targetW : structure.width;
          height = targetH > 0 ? targetH : structure.height;
          var stateToLoad = fabricState;
          /* Preserve original structure objects BEFORE loadFromJSON (which may mutate input) */
          var origObjectsSnapshot = JSON.parse(JSON.stringify(structure.objects));
          withInternalCanvasMutation(function () {
          fabricCanvas.loadFromJSON(stateToLoad, function () {
          if (fabricCanvas.setDimensions) {
            fabricCanvas.setDimensions({ width: targetW, height: targetH });
            if (typeof fabricCanvas.calcOffset === 'function') { try { fabricCanvas.calcOffset(); } catch (_) {} }
          }
          ensureCanvasObjectsSelectable(fabricCanvas);
          var loadedObjs = fabricCanvas.getObjects();
          var keys = ['cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx', 'cfsLineHeight', 'cfsWrapText', 'cfsStart', 'cfsLength', 'cfsLengthWasEnd', 'cfsTrackIndex', 'cfsVideoSrc', 'cfsVideoVolume', 'cfsFadeIn', 'cfsFadeOut', 'cfsMergeKey', 'cfsVideoWidth', 'cfsVideoHeight', 'cfsVideoMetadata', 'cfsSvgSrc', 'cfsRichText', 'cfsAnimation', 'cfsLengthAuto', 'cfsShapeLine', 'cfsLineLength', 'cfsLineThickness', 'cfsTransition', 'cfsEffect', 'cfsFit', 'cfsScale', 'cfsOriginalClip', 'cfsClipOpacity', 'cfsTextBackground', 'backgroundColor', 'cfsStroke', 'cfsShadow', 'cfsTextTransform', 'cfsFilter', 'cfsChromaKey', 'cfsFlip', 'cfsAlignVertical', 'cfsAlignHorizontal', 'cfsLetterSpacing', 'cfsOpacityTween', 'cfsOffsetTween', 'cfsRotateTween', 'cfsAudioType', 'cfsTtsVoice', 'cfsTtsLocalVoice', 'cfsTtsText', 'cfsCaptionSrc', 'cfsCaptionPadding', 'cfsCaptionBorderRadius', 'cfsFontSizePct', 'cfsImageToVideo', 'cfsItvPrompt', 'cfsItvAspectRatio', 'cfsHideOnImage', 'cfsIsCaption', 'cfsCaptionWords', 'cfsCaptionActive', 'cfsCaptionFont', 'cfsCaptionAnimation', 'cfsCaptionDisplay', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct'];
          var origObjects = origObjectsSnapshot;
          /* Build name→orig lookup for name-based matching (loadFromJSON may skip/reorder objects) */
          var origByName = {};
          origObjects.forEach(function (o) { if (o && o.name) origByName[o.name] = o; });
          loadedObjs.forEach(function (obj, i) {
            if (!obj || !obj.set) return;
            /* Match by name first, then fall back to index */
            var orig = (obj.name && origByName[obj.name]) ? origByName[obj.name] : origObjects[i];
            if (!orig) return;
            keys.forEach(function (k) {
              if (orig[k] != null) {
                /* Use Fabric set() for known Fabric props, direct assignment for custom cfs* props */
                if (k.indexOf('cfs') === 0) {
                  obj[k] = orig[k];
                } else {
                  obj.set(k, orig[k]);
                }
              }
            });
          });
          applyScaledGeometryFromState(fabricCanvas, origObjectsSnapshot);
          setResponsivePercentagesOnCanvas(fabricCanvas);
          fixTextBaseline(fabricCanvas);
          if (coreScene && coreScene.injectMergeData) coreScene.injectMergeData(fabricCanvas, buildMergeValuesForInject());
          if (coreScene && coreScene.applyFitToImages) coreScene.applyFitToImages(fabricCanvas, width, height);
          ensureWrappedTextObjects(fabricCanvas);
          applyResponsivePositions(fabricCanvas);
          refreshTextboxWrapping(fabricCanvas);
          ensureCanvasObjectsSelectable(fabricCanvas);
          loadedObjs = fabricCanvas.getObjects();
          loadedObjs.forEach(function (obj) {
            if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
            applyTextTransformVisual(obj);
            applyCfsStrokeVisual(obj);
            applyCfsShadowVisual(obj);
            applyCfsFilterVisual(obj);
          });
          applySeekForOutputPreview(fabricCanvas);
          setCanvasZoom(canvasZoom);
          invalidateFabricTextLayout(fabricCanvas);
          fabricCanvas.renderAll();
          resetEditorUndoBaseline();
          /* Delayed passes: re-apply scaled geometry in case Fabric/canvas dimensions weren't ready; refreshTextboxWrapping fixes textbox height */
          setTimeout(function () {
            applyScaledGeometryFromState(fabricCanvas, origObjectsSnapshot);
            if (coreScene && coreScene.applyFitToImages) coreScene.applyFitToImages(fabricCanvas, width, height);
            syncCanvasToPresetDimensions();
            applyResponsivePositions(fabricCanvas);
            refreshTextboxWrapping(fabricCanvas);
            invalidateFabricTextLayout(fabricCanvas);
            fabricCanvas.requestRenderAll();
            if (typeof zoomToFit === 'function') zoomToFit();
            if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
            updateCanvasWrapAlignment();
            refreshLayersPanel();
            refreshPropertyPanel();
            /* Reset caption auto-shrink cache: applyScaledGeometryFromState may have
               reset the width back to the original, but seekToTime won't re-shrink
               because the text is already set. Clear cached values so seekToTime
               re-captures and re-shrinks with correct geometry. */
            fabricCanvas.getObjects().forEach(function (obj) {
              if (obj.cfsIsCaption) {
                obj._cfsOrigWidth = null;
                obj._cfsOrigCenterX = null;
                /* Force text-change guard to re-fire */
                if (obj.set && obj.text) {
                  var t = obj.text;
                  obj.set('text', '');
                  obj.set('text', t);
                }
              }
            });
            applySeekForOutputPreview(fabricCanvas);
            resetEditorUndoBaseline();
            if (typeof onDone === 'function') onDone();
          }, 150);
          if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready === 'object') {
            document.fonts.ready.then(function () {
              setTimeout(function () {
                /* Reset caption auto-shrink cache so seekToTime recalculates with correct font metrics */
                fabricCanvas.getObjects().forEach(function (obj) {
                  if (obj.cfsIsCaption) {
                    obj._cfsOrigWidth = null;
                    obj._cfsOrigCenterX = null;
                    /* Force text-change guard to re-fire by temporarily clearing text */
                    var savedText = obj.text;
                    if (obj.set) obj.set('text', '');
                    if (obj.set) obj.set('text', savedText);
                  }
                });
                invalidateFabricTextLayout(fabricCanvas);
                applyResponsivePositions(fabricCanvas);
                refreshTextboxWrapping(fabricCanvas);
                applySeekForOutputPreview(fabricCanvas);
                fabricCanvas.requestRenderAll();
              }, 50);
            });
          }
          refreshLayersPanel();
          refreshPropertyPanel();
          setTimeout(resolveAutoLengthsFromMedia, 500);
        });
        });
        };
        var downloadToUploads = (typeof options.downloadToUploads === 'function' && options.downloadToUploads) || (typeof global !== 'undefined' && global.__CFS_downloadToUploads) || (typeof window !== 'undefined' && window.__CFS_downloadToUploads);
        if (downloadToUploads) {
          resolveMediaInStructure(structure, downloadToUploads).then(function () { doLoad(); }).catch(function (err) {
            console.warn('Resolving media for uploads failed', err);
            doLoad();
          });
        } else {
          doLoad();
        }
      } else if (structure && structure.width > 0 && structure.height > 0) {
        /* Template has no visual clips (e.g. audio-only): use preset dimensions so editor matches selected size. */
        var dim = getCanvasDimensions();
        var targetW = dim.w;
        var targetH = dim.h;
        var emptyState = {
          version: fabric.Canvas.VERSION || '4.0',
          width: targetW,
          height: targetH,
          background: (template.timeline && template.timeline.background) || '#ffffff',
          objects: []
        };
        if (fabricCanvas.getWidth && fabricCanvas.getHeight && (fabricCanvas.getWidth() !== targetW || fabricCanvas.getHeight() !== targetH)) {
          if (typeof fabricCanvas.setDimensions === 'function') {
            fabricCanvas.setDimensions({ width: targetW, height: targetH });
          } else if (fabricCanvas.setWidth && fabricCanvas.setHeight) {
            fabricCanvas.setWidth(targetW);
            fabricCanvas.setHeight(targetH);
          }
          if (typeof fabricCanvas.calcOffset === 'function') { try { fabricCanvas.calcOffset(); } catch (_) {} }
        }
        width = targetW;
        height = targetH;
        withInternalCanvasMutation(function () {
        fabricCanvas.loadFromJSON(emptyState, function () {
          syncCanvasToPresetDimensions();
          fabricCanvas.renderAll();
          refreshLayersPanel();
          refreshPropertyPanel();
          resetEditorUndoBaseline();
          if (typeof onDone === 'function') onDone();
        });
        });
      } else if (typeof onDone === 'function') onDone();
      };
      if (fontLoadResult && typeof fontLoadResult.then === 'function') {
        fontLoadResult.then(doBuild).catch(function () { doBuild(); });
      } else {
        doBuild();
      }
    }

    var emptyHintEl = null;
    function updateEmptyHint() {
      if (!emptyHintEl || !canvas || !canvas.getObjects) return;
      emptyHintEl.style.display = canvas.getObjects().length === 0 ? 'block' : 'none';
    }
    /** Scale canvas state objects when canvas size changes. Uses percentage-based (cfsLeftPct etc.) when present for responsive layout across presets. */
    function scaleCanvasStateToSize(state, newW, newH) {
      if (!state || !state.objects || !state.objects.length) return state;
      var oldW = state.width || newW;
      var oldH = state.height || newH;
      if (oldW <= 0 || oldH <= 0 || (oldW === newW && oldH === newH)) return state;
      var sx = newW / oldW;
      var sy = newH / oldH;
      var minScale = Math.min(sx, sy);
      var minSide = Math.min(oldW, oldH);
      var out = { version: state.version, width: newW, height: newH, background: state.background, objects: state.objects.map(function (obj) {
        var o = {};
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) o[k] = obj[k];
        var usePct = o.cfsResponsive && (o.cfsLeftPct != null || o.cfsTopPct != null || o.cfsWidthPct != null || o.cfsHeightPct != null || o.cfsRadiusPct != null);
        if (!usePct && oldW > 0 && oldH > 0 && o.name !== 'background') {
          o.cfsResponsive = true;
          o.cfsLeftPct = (o.left != null ? Number(o.left) : 0) / oldW;
          o.cfsTopPct = (o.top != null ? Number(o.top) : 0) / oldH;
          if (o.type !== 'circle') {
            var isRotFallback = o.cfsShapeLine && o.angle != null && (function () {
              var a = ((Number(o.angle) % 360) + 360) % 360;
              return (Math.abs(a - 90) < 5 || Math.abs(a - 270) < 5);
            })();
            var wOld = isRotFallback ? oldH : oldW;
            var hOld = isRotFallback ? oldW : oldH;
            if (o.width != null) o.cfsWidthPct = Number(o.width) / wOld;
            if (o.height != null && o.type !== 'text' && o.type !== 'textbox' && o.type !== 'i-text') o.cfsHeightPct = Number(o.height) / hOld;
          }
          if (o.type === 'circle' && o.radius != null) o.cfsRadiusPct = Number(o.radius) / (minSide || 1);
          if (o.fontSize != null && minSide > 0) o.cfsFontSizePct = Number(o.fontSize) / minSide;
          usePct = true;
        }
        var newMinSide = Math.min(newW, newH);
        if (usePct) {
          if (o.cfsLeftPct != null) o.left = newW * Number(o.cfsLeftPct);
          else if (o.left != null) o.left = o.left * sx;
          if (o.cfsTopPct != null) o.top = newH * Number(o.cfsTopPct);
          else if (o.top != null) o.top = o.top * sy;
          if (o.type !== 'circle') {
            var isRotLine = o.cfsShapeLine && o.angle != null && (function () {
              var a = ((Number(o.angle) % 360) + 360) % 360;
              return (Math.abs(a - 90) < 5 || Math.abs(a - 270) < 5);
            })();
            var wRef = isRotLine ? newH : newW;
            var hRef = isRotLine ? newW : newH;
            if (o.cfsWidthPct != null) o.width = wRef * Number(o.cfsWidthPct);
            else if (o.width != null) o.width = o.width * sx;
            if (o.cfsHeightPct != null && o.type !== 'text' && o.type !== 'textbox' && o.type !== 'i-text') o.height = hRef * Number(o.cfsHeightPct);
            else if (o.height != null) o.height = o.height * sy;
          }
          if (o.type === 'circle' && o.cfsRadiusPct != null) o.radius = newMinSide * Number(o.cfsRadiusPct);
          else if (o.radius != null) {
            var scaledR = o.radius * minScale;
            if (o.name === 'btn_red' || o.name === 'btn_yellow' || o.name === 'btn_green') o.radius = Math.max(10, scaledR);
            else o.radius = scaledR;
          }
          if (o.cfsFontSizePct == null && o.fontSize != null && minSide > 0) o.cfsFontSizePct = Number(o.fontSize) / minSide;
          if (o.cfsFontSizePct != null && newMinSide > 0) o.fontSize = Math.max(8, Math.round(newMinSide * Number(o.cfsFontSizePct)));
          else if (o.fontSize != null) o.fontSize = Math.max(8, o.fontSize * minScale);
          if (o.cfsRightPx != null) o.cfsRightPx = o.cfsRightPx * sx;
          if (o.cfsBottomPx != null) o.cfsBottomPx = o.cfsBottomPx * sy;
          if (o.cfsMaxHeightPx != null) o.cfsMaxHeightPx = o.cfsMaxHeightPx * sy;
        } else {
          if (o.left != null) o.left = Math.max(0, o.left * sx);
          if (o.top != null) o.top = o.top * sy;
          if (o.width != null) o.width = o.width * sx;
          if (o.height != null) o.height = o.height * sy;
          if (o.cfsFontSizePct != null && newMinSide > 0) o.fontSize = Math.max(8, Math.round(newMinSide * Number(o.cfsFontSizePct)));
          else if (o.fontSize != null) o.fontSize = Math.max(8, o.fontSize * minScale);
          if (o.radius != null) {
            var scaledR = o.radius * minScale;
            if (o.name === 'btn_red' || o.name === 'btn_yellow' || o.name === 'btn_green') o.radius = Math.max(10, scaledR);
            else o.radius = scaledR;
          }
          if (o.cfsRightPx != null) o.cfsRightPx = o.cfsRightPx * sx;
          if (o.cfsBottomPx != null) o.cfsBottomPx = o.cfsBottomPx * sy;
          if (o.cfsMaxHeightPx != null) o.cfsMaxHeightPx = o.cfsMaxHeightPx * sy;
        }
        if (o.objects && Array.isArray(o.objects)) {
          o.objects = o.objects.map(function (sub) {
            var s = {};
            for (var k in sub) if (Object.prototype.hasOwnProperty.call(sub, k)) s[k] = sub[k];
            if (s.left != null) s.left = s.left * sx;
            if (s.top != null) s.top = s.top * sy;
            if (s.width != null) s.width = s.width * sx;
            if (s.height != null) s.height = s.height * sy;
            return s;
          });
        }
        return o;
      }) };
      return out;
    }
    var canvasFrameEl = null; /* Fixed-size frame that constrains Fabric canvas to preset (fixes 16:9 extension) */
    function initSingleCanvas(savedState, onAfterLoad) {
      const dim = getCanvasDimensions();
      const bg = (template.timeline && template.timeline.background) || '#ffffff';
      const pair = createFabricCanvas(dim.w, dim.h, bg);
      canvasWrap.innerHTML = '';
      canvasFrameEl = document.createElement('div');
      canvasFrameEl.className = 'cfs-editor-canvas-frame';
      canvasFrameEl.style.cssText = 'width:' + dim.w + 'px;height:' + dim.h + 'px;max-width:' + dim.w + 'px;max-height:' + dim.h + 'px;overflow:hidden;flex-shrink:0;flex-grow:0;position:relative;';
      canvasFrameEl.appendChild(pair.wrapperEl || pair.el);
      canvasWrap.appendChild(canvasFrameEl);
      if (!emptyHintEl || !emptyHintEl.parentNode) {
        emptyHintEl = document.createElement('div');
        emptyHintEl.className = 'cfs-editor-empty-hint';
        emptyHintEl.textContent = 'Add content with the GENERATOR sidebar (Add text, Add image, Add shape, Add video, Import SVG, Import JSON). Drag objects to snap to canvas center or other objects; hold Alt to disable snap.';
        emptyHintEl.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:280px;padding:12px;text-align:center;color:var(--gen-muted,#888);font-size:13px;pointer-events:none;';
        canvasWrap.appendChild(emptyHintEl);
      }
      canvas = pair.canvas;
      if (canvas) {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { invalidateFabricTextLayout(canvas); });
        }
        syncCanvasToPresetDimensions();
        setCanvasZoom(canvasZoom);
        if (savedState && savedState.objects && savedState.objects.length) {
          var stateToLoad = scaleCanvasStateToSize(savedState, dim.w, dim.h);
          stateToLoad.background = stateToLoad.background || bg;
          withInternalCanvasMutation(function () {
          canvas.loadFromJSON(stateToLoad, function () {
            var loadedObjs = canvas.getObjects();
            var oldW = savedState.width || dim.w;
            var oldH = savedState.height || dim.h;
            var sx = dim.w / (oldW || 1);
            var sy = dim.h / (oldH || 1);
            (stateToLoad.objects || []).forEach(function (orig, i) {
              var obj = loadedObjs[i];
              if (!obj || !obj.set) return;
              ['cfsRightPx', 'cfsBottomPx', 'cfsMaxHeightPx', 'cfsLineHeight', 'cfsWrapText', 'cfsRichText', 'cfsVideoSrc', 'cfsVideoVolume', 'cfsSvgSrc', 'cfsStart', 'cfsLength', 'cfsLengthWasEnd', 'cfsLengthAuto', 'cfsTrackIndex', 'cfsFadeIn', 'cfsFadeOut', 'cfsMergeKey', 'cfsVideoWidth', 'cfsVideoHeight', 'cfsVideoMetadata', 'name', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsRadiusPct', 'cfsFontSizePct', 'cfsAnimation', 'cfsShapeLine', 'cfsLineLength', 'cfsLineThickness', 'cfsTransition', 'cfsEffect', 'cfsFit', 'cfsScale', 'cfsOriginalClip', 'cfsClipOpacity', 'cfsTextBackground', 'backgroundColor', 'cfsStroke', 'cfsShadow', 'cfsTextTransform', 'cfsFilter', 'cfsChromaKey', 'cfsFlip', 'cfsAlignVertical', 'cfsAlignHorizontal', 'cfsLetterSpacing', 'cfsOpacityTween', 'cfsOffsetTween', 'cfsRotateTween', 'cfsAudioType', 'cfsTtsVoice', 'cfsTtsLocalVoice', 'cfsTtsText', 'cfsCaptionSrc', 'cfsCaptionPadding', 'cfsCaptionBorderRadius'].forEach(function (k) {
                if (orig[k] != null) obj.set(k, orig[k]);
              });
              /* Apply scaled geometry from stateToLoad; fallback to manual scale if values seem wrong */
              var targetLeft = orig.left != null ? orig.left : (obj.left != null ? obj.left * sx : 0);
              var targetTop = orig.top != null ? orig.top : (obj.top != null ? obj.top * sy : 0);
              obj.set('left', targetLeft);
              obj.set('top', targetTop);
              if (obj.type !== 'circle') {
                var targetW = orig.width != null ? orig.width : (obj.width != null ? obj.width * sx : null);
                var targetH = orig.height != null ? orig.height : (obj.height != null && obj.type !== 'text' && obj.type !== 'textbox' && obj.type !== 'i-text' ? obj.height * sy : null);
                if (targetW != null) { obj.set('width', targetW); if (obj.type === 'textbox') { obj.set('minWidth', targetW); obj.set('maxWidth', targetW); } }
                if (targetH != null) obj.set('height', targetH);
              }
              if (obj.type === 'circle' && orig.radius != null) obj.set('radius', orig.radius);
              else if (obj.type === 'circle' && obj.radius != null) obj.set('radius', Math.max(6, obj.radius * Math.min(sx, sy)));
              if (orig.fontSize != null) obj.set('fontSize', Math.max(8, orig.fontSize));
              else if (obj.fontSize != null) obj.set('fontSize', Math.max(8, obj.fontSize * Math.min(sx, sy)));
              if (typeof obj.setCoords === 'function') obj.setCoords();
            });
            loadedObjs.forEach(function (obj) {
              if (obj && obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
            });
            if (typeof canvas.setDimensions === 'function') canvas.setDimensions({ width: dim.w, height: dim.h });
            ensureCanvasObjectsSelectable(canvas);
            if (coreScene && coreScene.injectMergeData) coreScene.injectMergeData(canvas, buildMergeValuesForInject());
            syncCanvasToPresetDimensions();
            fixTextBaseline(canvas);
            applyResponsivePositions(canvas);
            refreshTextboxWrapping(canvas);
            constrainToBounds(canvas);
            applySeekForOutputPreview(canvas);
            if (typeof onAfterLoad === 'function') { try { onAfterLoad(); } catch (_) {} }
            invalidateFabricTextLayout(canvas);
            canvas.renderAll();
            if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
            refreshLayersPanel();
            refreshPropertyPanel();
            refreshTimeline();
            resetEditorUndoBaseline();
            /* Delayed passes: re-apply scaled geometry in case Fabric overwrote; then applyResponsivePositions */
            setTimeout(function () {
              applyScaledGeometryFromState(canvas, stateToLoad.objects);
              if (coreScene && coreScene.applyFitToImages) coreScene.applyFitToImages(canvas, dim.w, dim.h);
              syncCanvasToPresetDimensions();
              applyResponsivePositions(canvas);
              refreshTextboxWrapping(canvas);
              applySeekForOutputPreview(canvas);
              invalidateFabricTextLayout(canvas);
              if (canvas.requestRenderAll) canvas.requestRenderAll();
              if (typeof zoomToFit === 'function') zoomToFit();
              if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
              updateCanvasWrapAlignment();
            }, 50);
            setTimeout(function () {
              applyScaledGeometryFromState(canvas, stateToLoad.objects);
              if (coreScene && coreScene.applyFitToImages) coreScene.applyFitToImages(canvas, dim.w, dim.h);
              syncCanvasToPresetDimensions();
              applyResponsivePositions(canvas);
              refreshTextboxWrapping(canvas);
              applySeekForOutputPreview(canvas);
              invalidateFabricTextLayout(canvas);
              if (canvas.requestRenderAll) canvas.requestRenderAll();
              if (typeof zoomToFit === 'function') zoomToFit();
              if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
              updateCanvasWrapAlignment();
              resetEditorUndoBaseline();
            }, 200);
          });
          });
        } else {
          loadTemplateIntoCanvas(canvas, function () {
            if (typeof onAfterLoad === 'function') { try { onAfterLoad(); } catch (_) {} }
          });
        }
        if (canvas.on) {
          if (typeof attachObjectModifiedRefresh === 'function') attachObjectModifiedRefresh(canvas);
          canvas.on('mouse:down', function (opt) {
            if (opt && opt.target && !fabricHead) pushUndo();
          });
          canvas.on('selection:created', function (opt) {
            refreshLayersPanel();
            refreshPropertyPanel();
            var obj = opt && opt.selected && opt.selected[0];
            if (obj) editEvents.emit('clip:selected', { object: obj, selected: opt.selected });
          });
          canvas.on('selection:updated', function () { refreshLayersPanel(); refreshPropertyPanel(); });
          canvas.on('selection:cleared', function () {
            refreshLayersPanel();
            refreshPropertyPanel();
            editEvents.emit('selection:cleared', {});
          });
          var _textChangePanelTimer = null;
          function _scheduleTextPanelSync() {
            if (_textChangePanelTimer) clearTimeout(_textChangePanelTimer);
            _textChangePanelTimer = setTimeout(function () {
              _textChangePanelTimer = null;
              refreshPropertyPanel();
            }, 300);
          }
          canvas.on('object:added', function (e) {
            var obj = e.target;
            if (obj && (obj.type === 'textbox' || obj.type === 'i-text') && typeof obj.on === 'function') {
              obj.on('changed', function () {
                if (this.__cfsWrapping) return;
                var curText = String(this.text || '');
                var unwrapped = curText.replace(/\n/g, ' ').replace(/ {2,}/g, ' ');
                this.set('cfsRawText', unwrapped);
                if (this.type === 'textbox') {
                  forceWrapTextboxObject(canvas, this);
                  if (typeof this.initDimensions === 'function') {
                    this.initDimensions();
                  }
                }
                if (canvas && canvas.requestRenderAll) canvas.requestRenderAll();
                _scheduleTextPanelSync();
              });
            }
            refreshLayersPanel();
            if (!isInternalCanvasMutation) pushUndo();
          });
          canvas.on('text:editing:entered', function () {
            if (canvas && typeof canvas.calcOffset === 'function') {
              try { canvas.calcOffset(); } catch (_) {}
            }
          });
          canvas.on('text:editing:exited', function (opt) {
            var obj = opt && opt.target;
            if (obj) {
              var raw = String(obj.text || '');
              obj.set('cfsRawText', raw.replace(/\n/g, ' ').replace(/ {2,}/g, ' '));
            }
            refreshPropertyPanel();
            saveStateDebounced();
          });
          canvas.on('object:removed', function () { refreshLayersPanel(); if (!isInternalCanvasMutation) pushUndo(); });
          var SNAP_THRESHOLD = 6;
          var activeGuides = [];
          function getObjectBounds(obj) {
            if (!obj) return null;
            var w = (obj.width != null ? obj.width : 0) * (obj.scaleX != null ? obj.scaleX : 1);
            var h = (obj.height != null ? obj.height : 0) * (obj.scaleY != null ? obj.scaleY : 1);
            var l = obj.left != null ? obj.left : 0;
            var t = obj.top != null ? obj.top : 0;
            var ox = obj.originX || 'left';
            var oy = obj.originY || 'top';
            if (ox === 'center') l -= w / 2;
            else if (ox === 'right') l -= w;
            if (oy === 'center') t -= h / 2;
            else if (oy === 'bottom') t -= h;
            return { left: l, top: t, width: w, height: h, centerX: l + w / 2, centerY: t + h / 2, right: l + w, bottom: t + h };
          }
          function setObjectPositionFromBounds(target, boundsLeft, boundsTop, bounds) {
            if (!target || !target.set || !bounds) return;
            var ox = target.originX || 'left';
            var oy = target.originY || 'top';
            var left = boundsLeft;
            var top = boundsTop;
            if (ox === 'center') left = boundsLeft + (bounds.width / 2);
            else if (ox === 'right') left = boundsLeft + bounds.width;
            if (oy === 'center') top = boundsTop + (bounds.height / 2);
            else if (oy === 'bottom') top = boundsTop + bounds.height;
            target.set('left', left);
            target.set('top', top);
          }
          function bestSnapCandidate(edges, points, threshold) {
            var best = null;
            for (var e = 0; e < edges.length; e++) {
              var val = edges[e].val;
              for (var i = 0; i < points.length; i++) {
                var dist = Math.abs(val - points[i].v);
                if (dist > 0.5 && dist <= threshold && (!best || dist < best.dist)) {
                  best = { edge: edges[e].edge, snapTo: points[i].v, dist: dist, guide: points[i].guide || null };
                }
              }
            }
            return best;
          }
          function applySnapAlignment(target) {
            activeGuides = [];
            if (stateRef._snapDisabled || !canvas || !target || !target.set) return;
            var objs = canvas.getObjects();
            if (!objs || objs.length === 0) return;
            var cw = canvas.getWidth ? canvas.getWidth() : 1080;
            var ch = canvas.getHeight ? canvas.getHeight() : 1080;
            var b = getObjectBounds(target);
            if (!b || b.width <= 0 || b.height <= 0) return;
            var th = SNAP_THRESHOLD;

            var xPoints = [
              { v: 0, guide: { axis: 'x', pos: 0, type: 'edge' } },
              { v: cw / 2, guide: { axis: 'x', pos: cw / 2, type: 'center' } },
              { v: cw, guide: { axis: 'x', pos: cw, type: 'edge' } }
            ];
            var yPoints = [
              { v: 0, guide: { axis: 'y', pos: 0, type: 'edge' } },
              { v: ch / 2, guide: { axis: 'y', pos: ch / 2, type: 'center' } },
              { v: ch, guide: { axis: 'y', pos: ch, type: 'edge' } }
            ];

            var otherBounds = [];
            objs.forEach(function (o) {
              if (o === target) return;
              var ob = getObjectBounds(o);
              if (!ob || ob.width <= 0 || ob.height <= 0) return;
              otherBounds.push(ob);
              xPoints.push({ v: ob.left, guide: { axis: 'x', pos: ob.left, type: 'object' } });
              xPoints.push({ v: ob.centerX, guide: { axis: 'x', pos: ob.centerX, type: 'object' } });
              xPoints.push({ v: ob.right, guide: { axis: 'x', pos: ob.right, type: 'object' } });
              yPoints.push({ v: ob.top, guide: { axis: 'y', pos: ob.top, type: 'object' } });
              yPoints.push({ v: ob.centerY, guide: { axis: 'y', pos: ob.centerY, type: 'object' } });
              yPoints.push({ v: ob.bottom, guide: { axis: 'y', pos: ob.bottom, type: 'object' } });
            });

            /* Margin-mirror: if object is d from left edge, offer cw-d (mirror from right), and vice versa for top/bottom */
            var mirrorEdgesX = [b.left, b.right];
            for (var mi = 0; mi < mirrorEdgesX.length; mi++) {
              var dLeft = mirrorEdgesX[mi];
              var dRight = cw - mirrorEdgesX[mi];
              if (dLeft > 2 && dLeft < cw - 2) {
                xPoints.push({ v: cw - dLeft, guide: { axis: 'x', pos: cw - dLeft, type: 'mirror', mirror: dLeft } });
              }
              if (dRight > 2 && dRight < cw - 2) {
                xPoints.push({ v: dRight, guide: { axis: 'x', pos: dRight, type: 'mirror', mirror: dRight } });
              }
            }
            var mirrorEdgesY = [b.top, b.bottom];
            for (var mj = 0; mj < mirrorEdgesY.length; mj++) {
              var dTop = mirrorEdgesY[mj];
              var dBot = ch - mirrorEdgesY[mj];
              if (dTop > 2 && dTop < ch - 2) {
                yPoints.push({ v: ch - dTop, guide: { axis: 'y', pos: ch - dTop, type: 'mirror', mirror: dTop } });
              }
              if (dBot > 2 && dBot < ch - 2) {
                yPoints.push({ v: dBot, guide: { axis: 'y', pos: dBot, type: 'mirror', mirror: dBot } });
              }
            }

            /* Margin-mirror from other objects: if another object's left is d from canvas left, snap dragged object's left to d too */
            for (var oi = 0; oi < otherBounds.length; oi++) {
              var ob = otherBounds[oi];
              var oMarginL = ob.left;
              var oMarginR = cw - ob.right;
              var oMarginT = ob.top;
              var oMarginB = ch - ob.bottom;
              if (oMarginL > 2) {
                xPoints.push({ v: oMarginL, guide: { axis: 'x', pos: oMarginL, type: 'margin' } });
                xPoints.push({ v: cw - oMarginL - b.width, guide: { axis: 'x', pos: cw - oMarginL, type: 'margin' } });
              }
              if (oMarginR > 2) {
                xPoints.push({ v: cw - oMarginR - b.width, guide: { axis: 'x', pos: cw - oMarginR, type: 'margin' } });
                xPoints.push({ v: oMarginR, guide: { axis: 'x', pos: oMarginR, type: 'margin' } });
              }
              if (oMarginT > 2) {
                yPoints.push({ v: oMarginT, guide: { axis: 'y', pos: oMarginT, type: 'margin' } });
                yPoints.push({ v: ch - oMarginT - b.height, guide: { axis: 'y', pos: ch - oMarginT, type: 'margin' } });
              }
              if (oMarginB > 2) {
                yPoints.push({ v: ch - oMarginB - b.height, guide: { axis: 'y', pos: ch - oMarginB, type: 'margin' } });
                yPoints.push({ v: oMarginB, guide: { axis: 'y', pos: oMarginB, type: 'margin' } });
              }
            }

            /* Equal spacing between objects: if 2+ siblings along X or Y, suggest the position that makes gaps equal */
            if (otherBounds.length >= 2) {
              var sortedX = otherBounds.slice().sort(function (a, c) { return a.left - c.left; });
              var sortedY = otherBounds.slice().sort(function (a, c) { return a.top - c.top; });

              /* X-axis equal spacing: find gaps between consecutive objects along X */
              for (var si = 0; si < sortedX.length - 1; si++) {
                var gap = sortedX[si + 1].left - sortedX[si].right;
                if (gap < 0) continue;
                /* Place dragged object before first, between consecutive, or after last at same gap */
                var beforeFirst = sortedX[0].left - gap - b.width;
                if (beforeFirst >= 0) {
                  xPoints.push({ v: beforeFirst, guide: { axis: 'x', pos: sortedX[0].left - gap / 2, type: 'spacing', gap: gap } });
                }
                var afterLast = sortedX[sortedX.length - 1].right + gap;
                if (afterLast + b.width <= cw) {
                  xPoints.push({ v: afterLast, guide: { axis: 'x', pos: afterLast + b.width / 2, type: 'spacing', gap: gap } });
                }
                for (var sj = 0; sj < sortedX.length - 1; sj++) {
                  var midX = sortedX[sj].right + gap;
                  if (midX >= 0 && midX + b.width <= cw) {
                    xPoints.push({ v: midX, guide: { axis: 'x', pos: midX + b.width / 2, type: 'spacing', gap: gap } });
                  }
                }
              }
              /* Y-axis equal spacing */
              for (var ti = 0; ti < sortedY.length - 1; ti++) {
                var gapY = sortedY[ti + 1].top - sortedY[ti].bottom;
                if (gapY < 0) continue;
                var beforeFirstY = sortedY[0].top - gapY - b.height;
                if (beforeFirstY >= 0) {
                  yPoints.push({ v: beforeFirstY, guide: { axis: 'y', pos: sortedY[0].top - gapY / 2, type: 'spacing', gap: gapY } });
                }
                var afterLastY = sortedY[sortedY.length - 1].bottom + gapY;
                if (afterLastY + b.height <= ch) {
                  yPoints.push({ v: afterLastY, guide: { axis: 'y', pos: afterLastY + b.height / 2, type: 'spacing', gap: gapY } });
                }
                for (var tk = 0; tk < sortedY.length - 1; tk++) {
                  var midY = sortedY[tk].bottom + gapY;
                  if (midY >= 0 && midY + b.height <= ch) {
                    yPoints.push({ v: midY, guide: { axis: 'y', pos: midY + b.height / 2, type: 'spacing', gap: gapY } });
                  }
                }
              }

              /* Gap matching: match the gap between the dragged object and a neighbor to other existing gaps */
              var existingGapsX = [];
              var existingGapsY = [];
              for (var gi = 0; gi < sortedX.length - 1; gi++) {
                var gx = sortedX[gi + 1].left - sortedX[gi].right;
                if (gx > 0) existingGapsX.push(gx);
              }
              for (var gj = 0; gj < sortedY.length - 1; gj++) {
                var gy = sortedY[gj + 1].top - sortedY[gj].bottom;
                if (gy > 0) existingGapsY.push(gy);
              }
              for (var exi = 0; exi < otherBounds.length; exi++) {
                var nb = otherBounds[exi];
                for (var egi = 0; egi < existingGapsX.length; egi++) {
                  var eg = existingGapsX[egi];
                  xPoints.push({ v: nb.right + eg, guide: { axis: 'x', pos: nb.right + eg / 2, type: 'spacing', gap: eg } });
                  xPoints.push({ v: nb.left - eg - b.width, guide: { axis: 'x', pos: nb.left - eg / 2, type: 'spacing', gap: eg } });
                }
                for (var egj = 0; egj < existingGapsY.length; egj++) {
                  var egY = existingGapsY[egj];
                  yPoints.push({ v: nb.bottom + egY, guide: { axis: 'y', pos: nb.bottom + egY / 2, type: 'spacing', gap: egY } });
                  yPoints.push({ v: nb.top - egY - b.height, guide: { axis: 'y', pos: nb.top - egY / 2, type: 'spacing', gap: egY } });
                }
              }
            }

            /* Find best X and Y snap, prioritizing edge/center/object over spacing/margin/mirror */
            var bestX = bestSnapCandidate(
              [{ edge: 'left', val: b.left }, { edge: 'center', val: b.centerX }, { edge: 'right', val: b.right }],
              xPoints, th
            );
            if (bestX) {
              var dx = bestX.edge === 'left' ? 0 : bestX.edge === 'center' ? -(b.width / 2) : -b.width;
              setObjectPositionFromBounds(target, bestX.snapTo + dx, b.top, b);
              if (bestX.guide) activeGuides.push(bestX.guide);
              else activeGuides.push({ axis: 'x', pos: bestX.snapTo, type: 'edge' });
            }
            var afterX = bestX ? getObjectBounds(target) : b;
            var bestY = bestSnapCandidate(
              [{ edge: 'top', val: afterX.top }, { edge: 'center', val: afterX.centerY }, { edge: 'bottom', val: afterX.bottom }],
              yPoints, th
            );
            if (bestY) {
              var dy = bestY.edge === 'top' ? 0 : bestY.edge === 'center' ? -(afterX.height / 2) : -afterX.height;
              setObjectPositionFromBounds(target, afterX.left, bestY.snapTo + dy, afterX);
              if (bestY.guide) activeGuides.push(bestY.guide);
              else activeGuides.push({ axis: 'y', pos: bestY.snapTo, type: 'edge' });
            }

            /* Add symmetric margin indicators when snapped */
            if (bestX || bestY) {
              var finalB = getObjectBounds(target);
              if (finalB) {
                var mL = finalB.left;
                var mR = cw - finalB.right;
                var mT = finalB.top;
                var mB = ch - finalB.bottom;
                if (Math.abs(mL - mR) < 1 && mL > 1) {
                  activeGuides.push({ axis: 'x', pos: 0, type: 'margin-bracket', from: 0, to: finalB.left, y: finalB.centerY });
                  activeGuides.push({ axis: 'x', pos: cw, type: 'margin-bracket', from: finalB.right, to: cw, y: finalB.centerY });
                }
                if (Math.abs(mT - mB) < 1 && mT > 1) {
                  activeGuides.push({ axis: 'y', pos: 0, type: 'margin-bracket', from: 0, to: finalB.top, x: finalB.centerX });
                  activeGuides.push({ axis: 'y', pos: ch, type: 'margin-bracket', from: finalB.bottom, to: ch, x: finalB.centerX });
                }
              }
              canvas.requestRenderAll();
            }
          }
          function clearContextTop() {
            var ctx = canvas.contextTop || (canvas.upperCanvasEl && canvas.upperCanvasEl.getContext('2d'));
            if (ctx && ctx.canvas) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          }
          function drawAlignmentGuides(ctx) {
            if (!ctx || !ctx.canvas) return;
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            if (!activeGuides.length || !canvas) return;
            var vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
            var zoom = vpt[0] || 1;
            var panX = vpt[4] || 0;
            var panY = vpt[5] || 0;
            var cw = canvas.getWidth ? canvas.getWidth() : 1080;
            var ch = canvas.getHeight ? canvas.getHeight() : 1080;
            ctx.save();
            for (var i = 0; i < activeGuides.length; i++) {
              var g = activeGuides[i];
              var gType = g.type || 'edge';

              if (gType === 'margin-bracket') {
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#f97316';
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                if (g.axis === 'x') {
                  var fromPx = g.from * zoom + panX;
                  var toPx = g.to * zoom + panX;
                  var yPx = g.y * zoom + panY;
                  ctx.moveTo(fromPx, yPx);
                  ctx.lineTo(toPx, yPx);
                  /* Arrow ticks */
                  ctx.moveTo(fromPx + 3, yPx - 4); ctx.lineTo(fromPx, yPx); ctx.lineTo(fromPx + 3, yPx + 4);
                  ctx.moveTo(toPx - 3, yPx - 4); ctx.lineTo(toPx, yPx); ctx.lineTo(toPx - 3, yPx + 4);
                } else {
                  var fromPy = g.from * zoom + panY;
                  var toPy = g.to * zoom + panY;
                  var xPx = g.x * zoom + panX;
                  ctx.moveTo(xPx, fromPy);
                  ctx.lineTo(xPx, toPy);
                  ctx.moveTo(xPx - 4, fromPy + 3); ctx.lineTo(xPx, fromPy); ctx.lineTo(xPx + 4, fromPy + 3);
                  ctx.moveTo(xPx - 4, toPy - 3); ctx.lineTo(xPx, toPy); ctx.lineTo(xPx + 4, toPy - 3);
                }
                ctx.stroke();
                continue;
              }

              var p = g.pos * zoom + (g.axis === 'x' ? panX : panY);

              if (gType === 'spacing') {
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#22c55e';
                ctx.setLineDash([3, 3]);
              } else if (gType === 'mirror' || gType === 'margin') {
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#f97316';
                ctx.setLineDash([5, 3]);
              } else if (gType === 'center') {
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#ef4444';
                ctx.setLineDash([6, 4]);
              } else {
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#6366f1';
                ctx.setLineDash([4, 3]);
              }

              ctx.beginPath();
              if (g.axis === 'x') {
                ctx.moveTo(p, 0);
                ctx.lineTo(p, ch * zoom + panY);
              } else {
                ctx.moveTo(0, p);
                ctx.lineTo(cw * zoom + panX, p);
              }
              ctx.stroke();
            }
            ctx.restore();
          }
          canvas.on('after:render', function () {
            var ctx = canvas.contextTop || (canvas.upperCanvasEl && canvas.upperCanvasEl.getContext('2d'));
            if (ctx) drawAlignmentGuides(ctx);
          });
          canvas.on('object:moving', function (e) {
            try {
              if (canvasWrap) canvasWrap.style.overflow = 'hidden';
              var target = e && e.target;
              if (target) applySnapAlignment(target);
            } catch (err) { console.warn('[CFS Editor] object:moving handler error:', err); }
          });
          canvas.on('object:scaling', function () {
            if (canvasWrap) canvasWrap.style.overflow = 'hidden';
          });
          canvas.on('object:modified', function (e) {
            try {
              activeGuides = [];
              clearContextTop();
              if (canvasWrap) canvasWrap.style.overflow = 'auto';
              var target = (e && e.target) || (canvas.getActiveObject && canvas.getActiveObject());
              if (target) {
                var cw = canvas.getWidth ? canvas.getWidth() : 1080;
                var ch = canvas.getHeight ? canvas.getHeight() : 1080;
                var visualW = (target.width || 0) * (target.scaleX || 1);
                var visualH = (target.height || 0) * (target.scaleY || 1);
                if (target.cfsRightPx != null) {
                  target.set('cfsRightPx', cw - (target.left || 0) - visualW);
                }
                if (target.cfsBottomPx != null) {
                  target.set('cfsBottomPx', ch - (target.top || 0) - visualH);
                }
                if (target.type === 'textbox') {
                  applyTextboxReflow(target);
                }
              }
              if (canvas.requestRenderAll) canvas.requestRenderAll();
              saveStateDebounced();
              refreshPropertyPanel();
              editEvents.emit('clip:updated', {});
            } catch (err) { console.warn('[CFS Editor] object:modified handler error:', err); }
          });
          function applyTextboxReflow(target, options) {
            options = options || {};
            var unlockRightPin = options.unlockRightPin === true;
            if (!target || target.type !== 'textbox' || !target.set) return;
            var curW = (target.width != null ? target.width : 200) * (target.scaleX != null ? target.scaleX : 1);
            var cw = canvas.getWidth ? canvas.getWidth() : 1080;
            var ch = canvas.getHeight ? canvas.getHeight() : 1080;
            if (unlockRightPin && target.cfsRightPx != null) {
              /* If width was pinned by left+right margins from template import, unlock on manual resize. */
              target.set('cfsRightPx', null);
              target.set('cfsResponsive', true);
              target.set('cfsLeftPct', Math.max(0, Math.min(1, (target.left || 0) / Math.max(1, cw))));
              target.set('cfsTopPct', Math.max(0, Math.min(1, (target.top || 0) / Math.max(1, ch))));
              target.set('cfsWidthPct', Math.max(0.02, Math.min(1, curW / Math.max(1, cw))));
            }
            if (target.scaleX !== 1 || target.scaleY !== 1) {
              var maxW = Math.max(curW, cw - (target.left || 0) - 20);
              curW = Math.max(50, Math.min(maxW, curW));
              target.set('width', curW);
              target.set('scaleX', 1);
              target.set('scaleY', 1);
              target.set('minWidth', 50);
              target.set('maxWidth', maxW);
              if (target.cfsResponsive) {
                target.set('cfsWidthPct', Math.max(0.02, Math.min(1, curW / Math.max(1, cw))));
                target.set('cfsLeftPct', Math.max(0, Math.min(1, (target.left || 0) / Math.max(1, cw))));
                target.set('cfsTopPct', Math.max(0, Math.min(1, (target.top || 0) / Math.max(1, ch))));
              }
            }
            forceWrapTextboxObject(canvas, target);
            if (typeof target.initDimensions === 'function') target.initDimensions();
            if (canvas && canvas.requestRenderAll) canvas.requestRenderAll();
          }
          canvas.on('object:scaling', function (e) {
            var target = e && e.target;
            if (target && target.type === 'textbox') applyTextboxReflow(target, { unlockRightPin: true });
          });
          canvas.on('object:resizing', function (e) {
            var target = e && e.target;
            if (target && target.type === 'textbox') applyTextboxReflow(target, { unlockRightPin: true });
          });
        }
        setupPanWhenZoomed();
        if (!document.__CFS_dragSafetyMouseup) {
          document.__CFS_dragSafetyMouseup = true;
          document.addEventListener('mouseup', function () {
            setTimeout(function () {
              if (!canvas) return;
              if (canvas._currentTransform) {
                canvas._currentTransform = null;
                canvas._groupSelector = null;
                canvas._isMouseDown = false;
                if (canvasWrap) canvasWrap.style.overflow = 'auto';
                if (canvas.requestRenderAll) canvas.requestRenderAll();
              }
            }, 0);
          });
        }
        if (!canvasWrap.__CFS_wheelZoom) {
          canvasWrap.__CFS_wheelZoom = true;
          canvasWrap.addEventListener('wheel', function (e) {
            if (!canvas || !e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            var delta = e.deltaY > 0 ? -0.1 : 0.1;
            var next = Math.max(0.1, Math.min(5, canvasZoom + delta));
            setCanvasZoom(next);
          }, { passive: false });
          canvasWrap.addEventListener('scroll', onCanvasWrapScroll);
        }
        if (!canvasWrap.__CFS_resizeObserver && typeof ResizeObserver !== 'undefined') {
          var resizeObserver = new ResizeObserver(function () {
            if (zoomSelect && zoomSelect.value === 'fit' && typeof zoomToFit === 'function') {
              zoomToFit();
            }
          });
          resizeObserver.observe(canvasWrap);
          canvasWrap.__CFS_resizeObserver = resizeObserver;
        }
        refreshLayersPanel();
        updateEmptyHint();
        updateDimensionsDisplay();
        if (document.body.__CFS_editorKeydown) {
          document.removeEventListener('keydown', document.body.__CFS_editorKeydown);
        }
        if (document.body.__CFS_editorKeyup) {
          document.removeEventListener('keyup', document.body.__CFS_editorKeyup);
        }
        document.body.__CFS_editorKeydown = onEditorKeydown;
        document.body.__CFS_editorKeyup = function (e) {
          if (e.key === 'Alt') stateRef._snapDisabled = false;
        };
        document.addEventListener('keydown', onEditorKeydown);
        document.addEventListener('keyup', document.body.__CFS_editorKeyup);
        setTimeout(function () {
          if (canvas && !fabricHead) pushUndo();
        }, 0);
      }
    }

    function refreshLayersPanel() {
      layersPanel.innerHTML = '';
      if (!canvas || !canvas.getObjects) return;
      var _iconFolder = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
      var _iconUp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
      var _iconDown = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      var _iconTrash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
      var _iconPlus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      var _clipTypeIcons = {
        text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        shape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
        audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        caption: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
        system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'
      };
      function getClipTypeIcon(obj) {
        if (obj.cfsVideoSrc) return _clipTypeIcons.video;
        if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') return _clipTypeIcons.text;
        if (obj.type === 'image') return obj.cfsSvgSrc ? _clipTypeIcons.shape : _clipTypeIcons.image;
        if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'path') return _clipTypeIcons.shape;
        return '';
      }
      var container = document.createElement('div');
      container.className = 'gen-layers-panel';
      var active = canvas.getActiveObject && canvas.getActiveObject();
      var objects = canvas.getObjects();
      /* Build track groups from template.timeline.tracks */
      if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var tracks = template.timeline.tracks;
        tracks.forEach(function (track, tIdx) {
          if (!track) return;
          var trackGroup = document.createElement('div');
          trackGroup.className = 'gen-track-group';
          /* Track header */
          var header = document.createElement('div');
          header.className = 'gen-track-header';
          var headerLeft = document.createElement('div');
          headerLeft.className = 'gen-track-header-left';
          headerLeft.innerHTML = _iconFolder;
          var trackName = document.createElement('span');
          trackName.className = 'gen-track-header-name';
          trackName.textContent = 'Track ' + (tracks.length - tIdx);
          headerLeft.appendChild(trackName);
          header.appendChild(headerLeft);
          /* Track controls: up / down / trash */
          var controls = document.createElement('div');
          controls.className = 'gen-track-controls';
          var upBtn = document.createElement('button');
          upBtn.type = 'button';
          upBtn.title = 'Move track up';
          upBtn.innerHTML = _iconUp;
          upBtn.addEventListener('click', function (e) { e.stopPropagation(); moveTrack(tIdx, -1); });
          controls.appendChild(upBtn);
          var downBtn = document.createElement('button');
          downBtn.type = 'button';
          downBtn.title = 'Move track down';
          downBtn.innerHTML = _iconDown;
          downBtn.addEventListener('click', function (e) { e.stopPropagation(); moveTrack(tIdx, 1); });
          controls.appendChild(downBtn);
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'gen-track-delete';
          delBtn.title = 'Delete track';
          delBtn.innerHTML = _iconTrash;
          delBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteTrack(tIdx); });
          controls.appendChild(delBtn);
          header.appendChild(controls);
          trackGroup.appendChild(header);
          /* Clips within this track */
          var clips = Array.isArray(track.clips) ? track.clips : [];
          if (clips.length === 0) {
            var emptyEl = document.createElement('div');
            emptyEl.className = 'gen-track-empty';
            emptyEl.textContent = 'Empty Track';
            trackGroup.appendChild(emptyEl);
          } else {
            clips.forEach(function (clip, ci) {
              if (!clip || !clip.asset) return;
              var assetType = ((clip.asset.type || '') + '').toLowerCase();
              var isAudio = assetType === 'audio';
              var isTts = assetType === 'text-to-speech';
              var isCaption = assetType === 'caption' || assetType === 'rich-caption';
              var isHtml = assetType === 'html';
              var isLuma = assetType === 'luma';
              var isTextToImage = assetType === 'text-to-image';
              var isImageToVideo = assetType === 'image-to-video';
              /* Find matching canvas object for visual clips */
              var matchObj = null;
              if (!isAudio && !isTts && !isCaption && !isHtml && !isLuma && !isTextToImage && !isImageToVideo) {
                objects.forEach(function (o) {
                  if (matchObj) return;
                  if (o.cfsTrackIndex === tIdx) matchObj = o;
                  else if (o.cfsOriginalClip === clip) matchObj = o;
                });
              }
              var clipRow = document.createElement('div');
              clipRow.className = 'gen-track-clip';
              /* Determine active state */
              if (matchObj && matchObj === active) clipRow.classList.add('active');
              if (isAudio && selectedAudioClip && selectedAudioClip.templateTrackIndex === tIdx && selectedAudioClip.templateClipIndex === ci) clipRow.classList.add('active');
              if (isCaption && selectedCaptionClip && selectedCaptionClip.templateTrackIndex === tIdx && selectedCaptionClip.templateClipIndex === ci) clipRow.classList.add('active');
              if (isTts && selectedTtsClip && selectedTtsClip.templateTrackIndex === tIdx && selectedTtsClip.templateClipIndex === ci) clipRow.classList.add('active');
              if (isHtml && selectedHtmlClip && selectedHtmlClip.templateTrackIndex === tIdx && selectedHtmlClip.templateClipIndex === ci) clipRow.classList.add('active');
              /* Clip name */
              var label;
              if (matchObj) {
                label = getFriendlyLayerName(matchObj);
              } else if (isAudio) {
                var src = clip.asset.src || '';
                label = 'Audio';
                if (src && src.indexOf('{{') === -1) { var fname = src.split('/').pop().split('?')[0]; if (fname) label += ' (' + (fname.length > 20 ? fname.slice(0, 17) + '\u2026' : fname) + ')'; }
              } else if (isTts) {
                label = 'TTS';
              } else if (isCaption) {
                label = 'Captions';
              } else if (isHtml) {
                label = 'HTML';
              } else if (isLuma) {
                label = 'Luma mask';
              } else if (isTextToImage) {
                label = 'Text-to-image';
              } else if (isImageToVideo) {
                label = 'Image-to-video';
              } else {
                label = clip.asset.type || 'Clip';
              }
              var nameSpan = document.createElement('span');
              nameSpan.className = 'gen-track-clip-name';
              nameSpan.textContent = label;
              nameSpan.title = label;
              clipRow.appendChild(nameSpan);
              /* Type icon */
              var iconHtml = '';
              if (matchObj) iconHtml = getClipTypeIcon(matchObj);
              else if (isAudio || isTts) iconHtml = _clipTypeIcons.audio;
              else if (isCaption) iconHtml = _clipTypeIcons.caption;
              else if (isHtml) iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
              else iconHtml = _clipTypeIcons.system;
              if (iconHtml) {
                var iconSpan = document.createElement('span');
                iconSpan.className = 'gen-track-clip-icon';
                iconSpan.innerHTML = iconHtml;
                clipRow.appendChild(iconSpan);
              }
              if (matchObj) {
                var hideImgBtn = document.createElement('button');
                hideImgBtn.type = 'button';
                hideImgBtn.className = 'gen-clip-hide-img-btn' + (matchObj.cfsHideOnImage ? ' gen-clip-hide-img-active' : '');
                hideImgBtn.title = matchObj.cfsHideOnImage ? 'Show on image (clear hide-on-image)' : 'Hide on image export';
                hideImgBtn.setAttribute('aria-pressed', matchObj.cfsHideOnImage ? 'true' : 'false');
                hideImgBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><line x1="4" y1="20" x2="20" y2="4"/></svg>';
                if (!matchObj.cfsHideOnImage) {
                  hideImgBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
                }
                hideImgBtn.addEventListener('click', function (e) {
                  e.stopPropagation();
                  if (!matchObj || !matchObj.set) return;
                  pushUndo();
                  matchObj.set('cfsHideOnImage', !matchObj.cfsHideOnImage);
                  refreshTimeline();
                  applySeekForOutputPreview(canvas);
                  refreshLayersPanel();
                  refreshPropertyPanel();
                  if (canvas.renderAll) canvas.renderAll();
                });
                clipRow.appendChild(hideImgBtn);
              }
              /* Click handler */
              clipRow.addEventListener('click', function () {
                /* Clear all non-visual clip selections first */
                selectedAudioClip = null;
                selectedCaptionClip = null;
                selectedTtsClip = null;
                selectedHtmlClip = null;
                selectedLumaClip = null;
                selectedTextToImageClip = null;
                selectedImageToVideoClip = null;
                if (matchObj) {
                  canvas.setActiveObject(matchObj);
                  canvas.renderAll();
                } else if (isAudio) {
                  selectedAudioClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isCaption) {
                  selectedCaptionClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isTts) {
                  selectedTtsClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isHtml) {
                  selectedHtmlClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isLuma) {
                  selectedLumaClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isTextToImage) {
                  selectedTextToImageClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                } else if (isImageToVideo) {
                  selectedImageToVideoClip = { templateTrackIndex: tIdx, templateClipIndex: ci, clip: clip };
                  if (canvas.discardActiveObject) canvas.discardActiveObject();
                  canvas.renderAll();
                }
                refreshLayersPanel();
                refreshPropertyPanel();
              });
              trackGroup.appendChild(clipRow);
            });
          }
          container.appendChild(trackGroup);
        });
      } else {
        /* Fallback: simple flat list for non-timeline templates */
        objects.forEach(function (obj) {
          if (obj.visible === false && obj.cfsAudioType) return;
          var label = getFriendlyLayerName(obj);
          if (label === 'Object' && (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox')) {
            var preview = (obj.text || 'Text').toString().trim().slice(0, 24);
            if (preview) label = preview + (preview.length >= 24 ? '\u2026' : '');
          }
          var row = document.createElement('div');
          row.className = 'gen-track-clip' + (obj === active ? ' active' : '');
          var nameSpan = document.createElement('span');
          nameSpan.className = 'gen-track-clip-name';
          nameSpan.textContent = label;
          nameSpan.title = label;
          row.appendChild(nameSpan);
          var iconHtml = getClipTypeIcon(obj);
          if (iconHtml) {
            var iconSpan = document.createElement('span');
            iconSpan.className = 'gen-track-clip-icon';
            iconSpan.innerHTML = iconHtml;
            row.appendChild(iconSpan);
          }
          if (obj.name !== 'background' && !obj.cfsAudioType) {
            var hideImgBtnFb = document.createElement('button');
            hideImgBtnFb.type = 'button';
            hideImgBtnFb.className = 'gen-clip-hide-img-btn' + (obj.cfsHideOnImage ? ' gen-clip-hide-img-active' : '');
            hideImgBtnFb.title = obj.cfsHideOnImage ? 'Show on image (clear hide-on-image)' : 'Hide on image export';
            hideImgBtnFb.setAttribute('aria-pressed', obj.cfsHideOnImage ? 'true' : 'false');
            hideImgBtnFb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/><line x1="4" y1="20" x2="20" y2="4"/></svg>';
            if (!obj.cfsHideOnImage) {
              hideImgBtnFb.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
            }
            hideImgBtnFb.addEventListener('click', function (e) {
              e.stopPropagation();
              if (!obj || !obj.set) return;
              pushUndo();
              obj.set('cfsHideOnImage', !obj.cfsHideOnImage);
              refreshTimeline();
              applySeekForOutputPreview(canvas);
              refreshLayersPanel();
              refreshPropertyPanel();
              if (canvas.renderAll) canvas.renderAll();
            });
            row.appendChild(hideImgBtnFb);
          }
          row.addEventListener('click', function () {
            canvas.setActiveObject(obj);
            canvas.renderAll();
            refreshLayersPanel();
            refreshPropertyPanel();
          });
          container.appendChild(row);
        });
      }
      layersPanel.appendChild(container);
      /* + Add Track button */
      var addTrackBtn = document.createElement('button');
      addTrackBtn.type = 'button';
      addTrackBtn.className = 'gen-add-track-btn';
      addTrackBtn.innerHTML = _iconPlus + ' Add Track';
      addTrackBtn.addEventListener('click', function () { addTrack(); });
      layersPanel.appendChild(addTrackBtn);
      updateEmptyHint();
    }

    /** Move a track up (direction=-1) or down (direction=1) within the template timeline. */
    function moveTrack(index, direction) {
      if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      var tracks = template.timeline.tracks;
      var target = index + direction;
      if (target < 0 || target >= tracks.length) return;
      var temp = tracks[index];
      tracks[index] = tracks[target];
      tracks[target] = temp;
      /* Re-map cfsTrackIndex on canvas objects */
      if (canvas && canvas.getObjects) {
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsTrackIndex === index) obj.cfsTrackIndex = target;
          else if (obj.cfsTrackIndex === target) obj.cfsTrackIndex = index;
        });
      }
      pushUndo();
      refreshLayersPanel();
      refreshTimeline();
    }

    /** Delete a track and remove its associated canvas objects. */
    function deleteTrack(index) {
      if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      var tracks = template.timeline.tracks;
      if (index < 0 || index >= tracks.length) return;
      var deletedTrack = tracks[index];
      /* Remove canvas objects on this track */
      if (canvas && canvas.getObjects) {
        var toRemove = [];
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsTrackIndex === index) toRemove.push(obj);
        });
        toRemove.forEach(function (obj) { canvas.remove(obj); });
        /* Shift track indices for higher tracks */
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsTrackIndex > index) obj.cfsTrackIndex--;
        });
      }
      /* Check if deleted track had caption-invalidating clips */
      var deletedHadTtsOrAudio = (deletedTrack.clips || []).some(function (c) {
        return c.asset && isCaptionInvalidatingType(c.asset.type);
      });
      tracks.splice(index, 1);
      /* Clear selection if it was on deleted track */
      if (selectedAudioClip && selectedAudioClip.templateTrackIndex === index) selectedAudioClip = null;
      if (selectedCaptionClip && selectedCaptionClip.templateTrackIndex === index) selectedCaptionClip = null;
      if (selectedTtsClip && selectedTtsClip.templateTrackIndex === index) selectedTtsClip = null;
      if (selectedHtmlClip && selectedHtmlClip.templateTrackIndex === index) selectedHtmlClip = null;
      if (selectedLumaClip && selectedLumaClip.templateTrackIndex === index) selectedLumaClip = null;
      pushUndo();
      refreshLayersPanel();
      refreshPropertyPanel();
      refreshTimeline();
      canvas.renderAll();
      /* If a TTS/audio track was deleted, captions may need regeneration */
      if (deletedHadTtsOrAudio) debouncedRegenerateCaptions();
    }

    /** Add a new empty track to the template timeline. */
    function addTrack() {
      if (!template) return;
      if (!template.timeline) template.timeline = {};
      if (!Array.isArray(template.timeline.tracks)) template.timeline.tracks = [];
      template.timeline.tracks.unshift({ clips: [] });
      pushUndo();
      refreshLayersPanel();
      refreshTimeline();
    }

    function getFriendlyLayerName(obj) {
      if (!obj) return 'Object';
      if (obj.cfsVideoSrc) return 'Video';
      var name = (obj.name || obj.id || '').toString().trim();
      if (!name) return obj.type === 'rect' ? 'Background' : (obj.type || 'Object');
      var upper = name.toUpperCase().replace(/\s+/g, '_');
      if (upper === 'BACKGROUND') return 'Background';
      if (extension.inputSchema && extension.inputSchema.length) {
        var field = extension.inputSchema.find(function (f) {
          var k = (f.mergeField || f.id || '').toString().toUpperCase().replace(/\s+/g, '_');
          return k && k === upper;
        });
        if (field && (field.label || field.id)) return field.label || field.id;
      }
      var known = { NAME_INPUT: 'Name', HANDLE_INPUT: 'Handle', TEXT_INPUT: 'Ad text', PROFILE_IMAGE: 'Profile image', NOTE_CARD: 'Note card', BTN_RED: 'Red button', BTN_YELLOW: 'Yellow button', BTN_GREEN: 'Green button' };
      return known[upper] || name;
    }

    var selectedAudioClip = null;
    var selectedLumaClip = null;
    var selectedCaptionClip = null;
    var selectedTtsClip = null;
    var selectedHtmlClip = null;
    var selectedTextToImageClip = null;
    var selectedImageToVideoClip = null;
    var captionWordPreviewUnsub = null;
    function refreshPropertyPanel() {
      if (typeof captionWordPreviewUnsub === 'function') {
        try { captionWordPreviewUnsub(); } catch (_) {}
        captionWordPreviewUnsub = null;
      }
      var existing = propertyPanel.querySelector('.cfs-properties-form');
      if (existing) existing.remove();
      propertyPanel.querySelectorAll('.cfs-properties-empty').forEach(function (el) { el.remove(); });
      propertyPanel.querySelectorAll('.gen-prop-empty').forEach(function (el) { el.remove(); });
      propertyPanel.querySelectorAll('.cfs-properties-toggle').forEach(function (el) { el.remove(); });
      propertyPanel.querySelectorAll('.cfs-properties-form-wrap').forEach(function (el) { el.remove(); });
      propertyPanel.querySelectorAll('.cfs-properties-editing').forEach(function (el) { el.remove(); });
      var _propsExtra = document.getElementById('propsAccordionExtra');
      if (!canvas) {
        if (_propsExtra) _propsExtra.textContent = '';
        return;
      }
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (_propsExtra) {
        _propsExtra.textContent = obj ? ('— ' + (obj.name || obj.id || obj.type || 'Object').toString().slice(0, 20)) : '';
      }
      if (!obj && selectedAudioClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var tr = template.timeline.tracks[selectedAudioClip.templateTrackIndex];
        var audioClip = tr && tr.clips && tr.clips[selectedAudioClip.templateClipIndex];
        if (audioClip && (audioClip.asset || {}).type === 'audio') {
          var form = document.createElement('div');
          form.className = 'cfs-properties-form';
          var heading = document.createElement('div');
          heading.className = 'cfs-properties-editing';
          heading.textContent = 'Editing: Audio clip';
          form.appendChild(heading);
          var wrap = document.createElement('div');
          wrap.className = 'cfs-properties-form-wrap';
          var urlRow = document.createElement('div');
          urlRow.className = 'cfs-prop-row';
          urlRow.innerHTML = '<label>Audio URL: </label><input type="text" class="cfs-prop-audio-url" style="width:100%;max-width:200px;" placeholder="URL or choose file">';
          var urlInput = urlRow.querySelector('input.cfs-prop-audio-url');
          if (urlInput) {
            urlInput.value = (audioClip.asset.src || '').replace(/^blob:/, '[local file]');
            urlInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              var val = urlInput.value.trim();
              if (val === '[local file]') return;
              if (!c.asset) c.asset = { type: 'audio' };
              c.asset.src = val || '{{ AUDIO_URL }}';
              saveStateDebounced();
              refreshTimeline();
            });
          }
          wrap.appendChild(urlRow);
          var mixLabel = document.createElement('div');
          mixLabel.className = 'cfs-prop-section-label';
          mixLabel.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);margin:8px 0 4px 0;font-weight:600;';
          mixLabel.textContent = 'Audio Mix';
          wrap.appendChild(mixLabel);
          var volumeRow = document.createElement('div');
          volumeRow.className = 'cfs-prop-row';
          volumeRow.innerHTML = '<label>Volume: </label><input type="number" class="cfs-prop-audio-volume" min="0" step="0.01" style="width:80px;" placeholder="1.0">';
          var volumeInput = volumeRow.querySelector('input.cfs-prop-audio-volume');
          if (volumeInput) {
            var currentVolume = (audioClip.asset && audioClip.asset.volume != null) ? Number(audioClip.asset.volume) : 1;
            volumeInput.value = isNaN(currentVolume) ? '1' : String(currentVolume);
            volumeInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'audio' };
              var n = Number(volumeInput.value);
              c.asset.volume = isNaN(n) ? 1 : Math.max(0, n);
              saveStateDebounced();
            });
          }
          wrap.appendChild(volumeRow);
          var fadeInRow = document.createElement('div');
          fadeInRow.className = 'cfs-prop-row';
          fadeInRow.innerHTML = '<label>Fade in (s): </label><input type="number" class="cfs-prop-audio-fadein" min="0" step="0.1" style="width:80px;" placeholder="0">';
          var fadeInInput = fadeInRow.querySelector('input.cfs-prop-audio-fadein');
          if (fadeInInput) {
            fadeInInput.value = (audioClip.fadeIn != null && isFinite(Number(audioClip.fadeIn))) ? String(Number(audioClip.fadeIn)) : '';
            fadeInInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              var n = Number(fadeInInput.value);
              c.fadeIn = (fadeInInput.value === '' || isNaN(n)) ? undefined : Math.max(0, n);
              saveStateDebounced();
            });
          }
          wrap.appendChild(fadeInRow);
          var fadeOutRow = document.createElement('div');
          fadeOutRow.className = 'cfs-prop-row';
          fadeOutRow.innerHTML = '<label>Fade out (s): </label><input type="number" class="cfs-prop-audio-fadeout" min="0" step="0.1" style="width:80px;" placeholder="0">';
          var fadeOutInput = fadeOutRow.querySelector('input.cfs-prop-audio-fadeout');
          if (fadeOutInput) {
            fadeOutInput.value = (audioClip.fadeOut != null && isFinite(Number(audioClip.fadeOut))) ? String(Number(audioClip.fadeOut)) : '';
            fadeOutInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              var n = Number(fadeOutInput.value);
              c.fadeOut = (fadeOutInput.value === '' || isNaN(n)) ? undefined : Math.max(0, n);
              saveStateDebounced();
            });
          }
          wrap.appendChild(fadeOutRow);
          var audioTrimRow = document.createElement('div');
          audioTrimRow.className = 'cfs-prop-row';
          audioTrimRow.innerHTML = '<label>Trim (s): </label><input type="number" class="cfs-prop-audio-trim" min="0" step="0.1" style="width:80px;" placeholder="0">';
          var audioTrimInput = audioTrimRow.querySelector('input.cfs-prop-audio-trim');
          if (audioTrimInput) {
            audioTrimInput.value = (audioClip.asset && audioClip.asset.trim != null && isFinite(Number(audioClip.asset.trim))) ? String(Number(audioClip.asset.trim)) : '';
            audioTrimInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'audio' };
              var n = Number(audioTrimInput.value);
              c.asset.trim = (audioTrimInput.value === '' || isNaN(n)) ? undefined : Math.max(0, n);
              saveStateDebounced();
            });
          }
          wrap.appendChild(audioTrimRow);
          var audioEffectRow = document.createElement('div');
          audioEffectRow.className = 'cfs-prop-row';
          audioEffectRow.innerHTML = '<label>Effect: </label><select class="cfs-prop-audio-effect" style="width:140px;"><option value="">None</option><option value="fadeIn">fadeIn</option><option value="fadeOut">fadeOut</option><option value="fadeInFadeOut">fadeInFadeOut</option></select>';
          var audioEffectSel = audioEffectRow.querySelector('select.cfs-prop-audio-effect');
          if (audioEffectSel) {
            audioEffectSel.value = (audioClip.asset && audioClip.asset.effect) ? String(audioClip.asset.effect) : '';
            audioEffectSel.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'audio' };
              c.asset.effect = audioEffectSel.value || undefined;
              saveStateDebounced();
            });
          }
          wrap.appendChild(audioEffectRow);
          var fileRow = document.createElement('div');
          fileRow.className = 'cfs-prop-row';
          var fileBtn = document.createElement('button');
          fileBtn.type = 'button';
          fileBtn.className = 'cfs-btn-secondary';
          fileBtn.textContent = 'Replace with local file';
          fileBtn.addEventListener('click', function () {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'audio/*';
            input.style.display = 'none';
            input.onchange = function () {
              var file = input.files && input.files[0];
              var c = template.timeline.tracks[selectedAudioClip.templateTrackIndex] && template.timeline.tracks[selectedAudioClip.templateTrackIndex].clips[selectedAudioClip.templateClipIndex];
              if (!file || !c) return;
              var src = URL.createObjectURL(file);
              if (!c.asset) c.asset = { type: 'audio' };
              c.asset.src = src;
              if (urlInput) urlInput.value = '[local file]';
              saveStateDebounced();
              refreshTimeline();
              refreshPropertyPanel();
            };
            input.click();
          });
          fileRow.appendChild(fileBtn);
          wrap.appendChild(fileRow);
          var deleteAudioRow = document.createElement('div');
          deleteAudioRow.className = 'cfs-prop-row cfs-prop-buttons';
          deleteAudioRow.style.marginTop = '8px';
          var deleteAudioBtn = document.createElement('button');
          deleteAudioBtn.type = 'button';
          deleteAudioBtn.className = 'cfs-btn-delete';
          deleteAudioBtn.textContent = 'Delete audio clip';
          deleteAudioBtn.addEventListener('click', function () { deleteSelectedAudioClip(); });
          deleteAudioRow.appendChild(deleteAudioBtn);
          wrap.appendChild(deleteAudioRow);
          form.appendChild(wrap);
          propertyPanel.appendChild(form);
          return;
        }
      }
      if (!obj && selectedLumaClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var lumaTr = template.timeline.tracks[selectedLumaClip.templateTrackIndex];
        var lumaClip = lumaTr && lumaTr.clips && lumaTr.clips[selectedLumaClip.templateClipIndex];
        if (lumaClip && (lumaClip.asset || {}).type === 'luma') {
            var lumaForm = document.createElement('div');
            lumaForm.className = 'cfs-properties-form';
            var lumaHeading = document.createElement('div');
            lumaHeading.className = 'cfs-properties-editing';
            lumaHeading.textContent = 'Editing: Luma mask';
            lumaForm.appendChild(lumaHeading);
            var lumaWrap = document.createElement('div');
            lumaWrap.className = 'cfs-properties-form-wrap';
            var lumaUrlRow = document.createElement('div');
            lumaUrlRow.className = 'cfs-prop-row';
            lumaUrlRow.innerHTML = '<label>Luma mask video URL: </label><input type="text" class="cfs-prop-luma-url" style="width:100%;max-width:240px;" placeholder="URL or choose file">';
            var lumaUrlInput = lumaUrlRow.querySelector('input.cfs-prop-luma-url');
            if (lumaUrlInput) {
              lumaUrlInput.value = (lumaClip.asset.src || '').replace(/^blob:/, '[local file]');
              lumaUrlInput.addEventListener('change', function () {
                var c = template.timeline.tracks[selectedLumaClip.templateTrackIndex] && template.timeline.tracks[selectedLumaClip.templateTrackIndex].clips[selectedLumaClip.templateClipIndex];
                if (!c) return;
                var val = lumaUrlInput.value.trim();
                if (val === '[local file]') return;
                if (!c.asset) c.asset = { type: 'luma' };
                c.asset.src = val || '';
                saveStateDebounced();
                refreshTimeline();
              });
            }
            lumaWrap.appendChild(lumaUrlRow);
            var lumaFileRow = document.createElement('div');
            lumaFileRow.className = 'cfs-prop-row';
            var lumaFileBtn = document.createElement('button');
            lumaFileBtn.type = 'button';
            lumaFileBtn.className = 'cfs-btn-secondary';
            lumaFileBtn.textContent = 'Replace with local file';
            lumaFileBtn.addEventListener('click', function () {
              var input = document.createElement('input');
              input.type = 'file';
              input.accept = 'video/*';
              input.style.display = 'none';
              input.onchange = function () {
                var file = input.files && input.files[0];
                if (!file || !template.timeline.tracks[selectedLumaClip.templateTrackIndex]) return;
                var c = template.timeline.tracks[selectedLumaClip.templateTrackIndex].clips[selectedLumaClip.templateClipIndex];
                if (!c) return;
                var src = URL.createObjectURL(file);
                if (!c.asset) c.asset = { type: 'luma' };
                c.asset.src = src;
                if (lumaUrlInput) lumaUrlInput.value = '[local file]';
                saveStateDebounced();
                refreshTimeline();
              };
              input.click();
            });
            lumaFileRow.appendChild(lumaFileBtn);
            lumaWrap.appendChild(lumaFileRow);
            lumaForm.appendChild(lumaWrap);
            propertyPanel.appendChild(lumaForm);
            return;
        }
      }
      if (selectedCaptionClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var capTr = template.timeline.tracks[selectedCaptionClip.templateTrackIndex];
        var capClip = capTr && capTr.clips && capTr.clips[selectedCaptionClip.templateClipIndex];
        var capAssetType = (capClip && capClip.asset) ? capClip.asset.type : '';
        if (capAssetType === 'caption' || capAssetType === 'rich-caption') {
          var capAsset = capClip.asset;
          var capForm = document.createElement('div');
          capForm.className = 'cfs-properties-form';
          var capHeading = document.createElement('div');
          capHeading.className = 'cfs-properties-editing';
          capHeading.textContent = 'Editing: Rich Caption';
          capForm.appendChild(capHeading);

          /* Chunk-specific text editor when a chunk is selected from the timeline */
          var selectedChunkIdx = (selectedCaptionClip && selectedCaptionClip.selectedChunkIndex != null) ? selectedCaptionClip.selectedChunkIndex : -1;
          if (selectedChunkIdx >= 0 && capAsset.words && capAsset.words.length && global.__CFS_chunkUtils) {
            var capChunks = global.__CFS_chunkUtils.buildCaptionChunks(capAsset.words, capAsset.display || {});
            var selChunk = capChunks[selectedChunkIdx];
            if (selChunk) {
              var chunkSection = document.createElement('div');
              chunkSection.style.cssText = 'background:#1a2e1a;border:1px solid #22c55e;border-radius:6px;padding:10px 12px;margin:6px 0;';
              var chunkTitle = document.createElement('div');
              chunkTitle.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#4ade80;margin-bottom:6px;';
              chunkTitle.textContent = 'Chunk ' + (selectedChunkIdx + 1) + ' of ' + capChunks.length + ' (' + selChunk.timeStart.toFixed(2) + 's – ' + selChunk.timeEnd.toFixed(2) + 's)';
              chunkSection.appendChild(chunkTitle);
              var chunkTextarea = document.createElement('textarea');
              chunkTextarea.style.cssText = 'width:100%;min-height:48px;resize:vertical;background:#09090b;border:1px solid #27272a;border-radius:4px;color:#e4e4e7;padding:6px 8px;font-size:12px;font-family:inherit;';
              chunkTextarea.value = selChunk.text;
              chunkTextarea.addEventListener('change', function () {
                var newText = chunkTextarea.value.trim();
                if (!newText) return;
                var newWords = newText.split(/\s+/);
                var a = getCapAsset();
                if (!a || !a.words) return;
                /* Replace the words in this chunk's range */
                var oldWords = a.words.splice(selChunk.wordStartIdx, selChunk.wordEndIdx - selChunk.wordStartIdx + 1);
                /* Distribute timing across new words */
                var tStart = oldWords.length ? oldWords[0].start : selChunk.timeStart;
                var tEnd = oldWords.length ? oldWords[oldWords.length - 1].end : selChunk.timeEnd;
                var tSpan = tEnd - tStart;
                var replacements = newWords.map(function (w, wi) {
                  return { text: w, start: tStart + (tSpan * wi / newWords.length), end: tStart + (tSpan * (wi + 1) / newWords.length) };
                });
                Array.prototype.splice.apply(a.words, [selChunk.wordStartIdx, 0].concat(replacements));
                saveStateDebounced();
                debouncedRegenerateCaptions();
                refreshTimeline();
                if (coreScene && coreScene.seekToTime && canvas) { coreScene.seekToTime(canvas, currentPlayheadSec); canvas.renderAll(); }
              });
              chunkSection.appendChild(chunkTextarea);
              capForm.appendChild(chunkSection);
            }
          } else if (capAsset._autoGenerated) {
            /* Info banner when captions were auto-generated from TTS */
            var autoGenBanner = document.createElement('div');
            autoGenBanner.style.cssText = 'background:#1e3a5f;border:1px solid #2563eb;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:0.82rem;color:#93c5fd;display:flex;align-items:flex-start;gap:8px;';
            autoGenBanner.innerHTML = '<span style="flex-shrink:0;font-size:1rem;">ℹ️</span>' +
              '<span>Captions auto-generated from TTS text with estimated timing. ' +
              'Click <strong>Generate captions from audio</strong> above for more precise word timing.</span>';
            capForm.appendChild(autoGenBanner);
          }
          var capWrap = document.createElement('div');
          capWrap.className = 'cfs-properties-form-wrap';

          /* ── Helper to get/update the asset safely ── */
          function getCapAsset() {
            var c = template.timeline.tracks[selectedCaptionClip.templateTrackIndex] && template.timeline.tracks[selectedCaptionClip.templateTrackIndex].clips[selectedCaptionClip.templateClipIndex];
            if (!c) return null;
            if (!c.asset) c.asset = { type: 'rich-caption' };
            return c.asset;
          }

          /* ── Curated Google Fonts list ── */
          var GOOGLE_FONTS = [
            'Open Sans', 'Roboto', 'Inter', 'Lato', 'Montserrat', 'Oswald', 'Poppins',
            'Raleway', 'Nunito', 'Ubuntu', 'Playfair Display', 'Merriweather', 'Bebas Neue',
            'Outfit', 'Space Grotesk', 'DM Sans', 'Rubik', 'Karla', 'Lexend', 'Archivo Black',
            'Bangers', 'Permanent Marker', 'Luckiest Guy', 'Anton', 'Righteous'
          ];

          /* ── SRC / ALIAS ── */
          var capSrcRow = document.createElement('div');
          capSrcRow.className = 'cfs-prop-row';
          capSrcRow.innerHTML = '<label>Source URL / alias: </label><input type="text" class="gen-prop-input" style="width:100%;" placeholder="URL to .srt/.vtt or alias://clip_name">';
          var capSrcInput = capSrcRow.querySelector('input');
          capSrcInput.value = capAsset.src || '';
          capSrcInput.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; var v = capSrcInput.value.trim(); if (v) a.src = v; else delete a.src; saveStateDebounced(); refreshTimeline(); });
          capWrap.appendChild(capSrcRow);

          /* ── BOX BACKGROUND (moved to top for visibility) ── */
          var boxBgSection = document.createElement('div');
          boxBgSection.className = 'cfs-prop-section';
          boxBgSection.innerHTML = '<div class="cfs-prop-section-title">Box Background</div>';
          var boxBgObj = capAsset.background || {};
          var boxBgRow = document.createElement('div');
          boxBgRow.className = 'cfs-prop-row';
          boxBgRow.innerHTML = '<input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (boxBgObj.color || '#000000') + '">' +
            '<label style="margin-left:4px;font-size:11px;"><input type="checkbox" class="cfs-cap-box-bg-on"' + (boxBgObj.color ? ' checked' : '') + '> On</label>' +
            '<label style="margin-left:6px;font-size:11px;">Transparency %</label>' +
            '<input type="number" class="gen-prop-input cfs-cap-box-bg-op" min="0" max="100" step="5" value="' + Math.round(100 - (boxBgObj.opacity != null ? boxBgObj.opacity : 1) * 100) + '" style="width:48px;margin-left:2px;">';
          var boxBgColorIn = boxBgRow.querySelector('input[type=color]');
          var boxBgCheckIn = boxBgRow.querySelector('.cfs-cap-box-bg-on');
          var boxBgOpIn = boxBgRow.querySelector('.cfs-cap-box-bg-op');
          function isCaptionObj(obj) {
            if (obj.cfsIsCaption) return true;
            if (obj.cfsOriginalClip && obj.cfsOriginalClip.asset) {
              var t = obj.cfsOriginalClip.asset.type;
              return t === 'caption' || t === 'rich-caption';
            }
            return false;
          }
          function computeBgString(color, transparency) {
            var op = Math.min(1, Math.max(0, 1 - transparency / 100));
            if (op <= 0) return '';
            if (op >= 1) return color;
            var rr = parseInt(color.slice(1, 3), 16) || 0;
            var gg = parseInt(color.slice(3, 5), 16) || 0;
            var bb = parseInt(color.slice(5, 7), 16) || 0;
            return 'rgba(' + rr + ',' + gg + ',' + bb + ',' + op.toFixed(2) + ')';
          }
          function syncBoxBg() {
            var a = getCapAsset(); if (!a) return;
            if (!a.background) a.background = {};
            var transparency = Math.min(100, Math.max(0, Number(boxBgOpIn.value) || 0));
            var opacity = Math.min(1, Math.max(0, 1 - transparency / 100));
            if (boxBgCheckIn.checked) {
              a.background.color = boxBgColorIn.value || '#000000';
              a.background.opacity = opacity;
            } else {
              delete a.background.color;
              delete a.background.opacity;
            }
            /* Update Fabric.js canvas object immediately */
            if (canvas && canvas.getObjects) {
              var bgStr = boxBgCheckIn.checked ? computeBgString(boxBgColorIn.value || '#000000', transparency) : '';
              canvas.getObjects().forEach(function (obj) {
                if (!isCaptionObj(obj)) return;
                obj.set('backgroundColor', bgStr);
                obj.set('cfsTextBackground', bgStr || undefined);
                obj.dirty = true;
              });
              canvas.requestRenderAll ? canvas.requestRenderAll() : canvas.renderAll();
            }
            saveStateDebounced();
          }
          boxBgColorIn.addEventListener('input', syncBoxBg);
          boxBgColorIn.addEventListener('change', syncBoxBg);
          boxBgCheckIn.addEventListener('change', syncBoxBg);
          boxBgOpIn.addEventListener('input', syncBoxBg);
          boxBgOpIn.addEventListener('change', syncBoxBg);
          boxBgSection.appendChild(boxBgRow);
          capWrap.appendChild(boxBgSection);

          /* ── FONT SECTION ── */
          var fontSection = document.createElement('div');
          fontSection.className = 'cfs-prop-section';
          fontSection.innerHTML = '<div class="cfs-prop-section-title">Font</div>';
          var fontObj = capAsset.font || {};

          // Font family: Google Fonts dropdown + custom input
          var fontFamRow = document.createElement('div');
          fontFamRow.className = 'cfs-prop-row';
          fontFamRow.innerHTML = '<label>Family</label>';
          var fontFamSelect = document.createElement('select');
          fontFamSelect.className = 'gen-prop-input';
          fontFamSelect.style.cssText = 'width:100%;margin-bottom:4px;';
          var currentFam = fontObj.family || 'Open Sans';
          var optCustom = document.createElement('option');
          optCustom.value = '__custom__';
          optCustom.textContent = '— Custom font —';
          fontFamSelect.appendChild(optCustom);
          var foundInList = false;
          GOOGLE_FONTS.forEach(function (f) {
            var opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            if (f === currentFam) { opt.selected = true; foundInList = true; }
            fontFamSelect.appendChild(opt);
          });
          var fontCustomInput = document.createElement('input');
          fontCustomInput.type = 'text';
          fontCustomInput.className = 'gen-prop-input';
          fontCustomInput.placeholder = 'Custom font family or TTF filename';
          fontCustomInput.style.cssText = 'width:100%;margin-top:4px;' + (foundInList ? 'display:none;' : '');
          if (!foundInList) { optCustom.selected = true; fontCustomInput.value = currentFam; }
          fontFamSelect.addEventListener('change', function () {
            if (fontFamSelect.value === '__custom__') { fontCustomInput.style.display = ''; fontCustomInput.focus(); return; }
            fontCustomInput.style.display = 'none';
            var a = getCapAsset(); if (!a) return;
            if (!a.font) a.font = {};
            a.font.family = fontFamSelect.value;
            saveStateDebounced();
          });
          fontCustomInput.addEventListener('change', function () {
            var a = getCapAsset(); if (!a) return;
            if (!a.font) a.font = {};
            a.font.family = fontCustomInput.value.trim() || 'Open Sans';
            saveStateDebounced();
          });
          fontFamRow.appendChild(fontFamSelect);
          fontFamRow.appendChild(fontCustomInput);
          fontSection.appendChild(fontFamRow);

          // Font size + weight
          var fontSizeRow = document.createElement('div');
          fontSizeRow.className = 'cfs-prop-row gen-prop-pair';
          fontSizeRow.innerHTML = '<div class="gen-prop-group"><label>Size</label><input type="number" class="gen-prop-input cfs-cap-font-size" min="8" max="500" step="1" value="' + (fontObj.size || 32) + '"></div>' +
            '<div class="gen-prop-group"><label>Weight</label><select class="gen-prop-input cfs-cap-font-weight"><option value="400">Normal</option><option value="500">Medium</option><option value="600">Semi-bold</option><option value="700"' + ((fontObj.weight || 400) >= 700 ? ' selected' : '') + '>Bold</option><option value="800">Extra-bold</option><option value="900">Black</option></select></div>';
          fontSizeRow.querySelector('.cfs-cap-font-size').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.font) a.font = {}; a.font.size = Math.max(8, Number(this.value) || 32); saveStateDebounced(); });
          fontSizeRow.querySelector('.cfs-cap-font-weight').value = String(fontObj.weight || 400);
          fontSizeRow.querySelector('.cfs-cap-font-weight').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.font) a.font = {}; a.font.weight = Number(this.value) || 400; saveStateDebounced(); });
          fontSection.appendChild(fontSizeRow);

          // Font color + opacity
          var fontColorRow = document.createElement('div');
          fontColorRow.className = 'cfs-prop-row gen-prop-pair';
          fontColorRow.innerHTML = '<div class="gen-prop-group"><label>Color</label><input type="color" class="gen-prop-input cfs-cap-font-color" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (fontObj.color || '#ffffff') + '"></div>' +
            '<div class="gen-prop-group"><label>OP %</label><input type="number" class="gen-prop-input cfs-cap-font-opacity" min="0" max="100" step="5" value="' + Math.round((fontObj.opacity != null ? fontObj.opacity : 1) * 100) + '"></div>';
          fontColorRow.querySelector('.cfs-cap-font-color').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.font) a.font = {}; a.font.color = this.value; saveStateDebounced(); });
          fontColorRow.querySelector('.cfs-cap-font-opacity').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.font) a.font = {}; a.font.opacity = Math.min(1, Math.max(0, (Number(this.value) || 100) / 100)); saveStateDebounced(); });
          fontSection.appendChild(fontColorRow);

          // Font background
          var fontBgRow = document.createElement('div');
          fontBgRow.className = 'cfs-prop-row';
          fontBgRow.innerHTML = '<label>Word Highlight</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (fontObj.background || '#000000') + '"><label style="margin-left:4px;font-size:11px;"><input type="checkbox" class="cfs-cap-font-bg-on"' + (fontObj.background ? ' checked' : '') + '> On</label><label style="margin-left:6px;font-size:11px;">OP %</label><input type="number" class="gen-prop-input cfs-cap-font-bg-op" min="0" max="100" step="5" value="' + Math.round((fontObj.backgroundOpacity != null ? fontObj.backgroundOpacity : 1) * 100) + '" style="width:48px;margin-left:2px;">';
          var fontBgColor = fontBgRow.querySelector('input[type=color]');
          var fontBgCheck = fontBgRow.querySelector('.cfs-cap-font-bg-on');
          var fontBgOpIn = fontBgRow.querySelector('.cfs-cap-font-bg-op');
          function syncFontBg() { var a = getCapAsset(); if (!a) return; if (!a.font) a.font = {}; if (fontBgCheck.checked) { a.font.background = fontBgColor.value || '#000000'; a.font.backgroundOpacity = Math.min(1, Math.max(0, (Number(fontBgOpIn.value) || 100) / 100)); } else { delete a.font.background; delete a.font.backgroundOpacity; } saveStateDebounced(); }
          fontBgColor.addEventListener('change', syncFontBg);
          fontBgCheck.addEventListener('change', syncFontBg);
          fontBgOpIn.addEventListener('change', syncFontBg);
          fontSection.appendChild(fontBgRow);
          capWrap.appendChild(fontSection);

          /* ── STROKE SECTION ── */
          var strokeSection = document.createElement('div');
          strokeSection.className = 'cfs-prop-section';
          strokeSection.innerHTML = '<div class="cfs-prop-section-title">Stroke</div>';
          var strokeObj = capAsset.stroke || {};
          var strokeRow = document.createElement('div');
          strokeRow.className = 'cfs-prop-row gen-prop-pair';
          strokeRow.innerHTML = '<div class="gen-prop-group"><label>Width</label><input type="number" class="gen-prop-input cfs-cap-stroke-w" min="0" max="20" step="1" value="' + (strokeObj.width || 0) + '"></div>' +
            '<div class="gen-prop-group"><label>Color</label><input type="color" class="gen-prop-input cfs-cap-stroke-c" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (strokeObj.color || '#000000') + '"></div>';
          strokeRow.querySelector('.cfs-cap-stroke-w').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.stroke) a.stroke = {}; a.stroke.width = Math.max(0, Number(this.value) || 0); saveStateDebounced(); });
          strokeRow.querySelector('.cfs-cap-stroke-c').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.stroke) a.stroke = {}; a.stroke.color = this.value; saveStateDebounced(); });
          strokeSection.appendChild(strokeRow);
          var strokeOpRow = document.createElement('div');
          strokeOpRow.className = 'cfs-prop-row';
          strokeOpRow.innerHTML = '<label>Stroke OP %</label><input type="number" class="gen-prop-input" min="0" max="100" step="5" value="' + Math.round((strokeObj.opacity != null ? strokeObj.opacity : 1) * 100) + '" style="width:60px;">';
          strokeOpRow.querySelector('input').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.stroke) a.stroke = {}; a.stroke.opacity = Math.min(1, Math.max(0, (Number(this.value) || 100) / 100)); saveStateDebounced(); });
          strokeSection.appendChild(strokeOpRow);
          capWrap.appendChild(strokeSection);

          /* ── SHADOW SECTION ── */
          var shadowSection = document.createElement('div');
          shadowSection.className = 'cfs-prop-section';
          shadowSection.innerHTML = '<div class="cfs-prop-section-title">Shadow</div>';
          var shadowObj = capAsset.shadow || {};
          var shadowRow = document.createElement('div');
          shadowRow.className = 'cfs-prop-row gen-prop-pair';
          shadowRow.innerHTML = '<div class="gen-prop-group"><label>Color</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (shadowObj.color || '#000000') + '"></div>' +
            '<div class="gen-prop-group"><label>Blur</label><input type="number" class="gen-prop-input" min="0" max="50" step="1" value="' + (shadowObj.blur || 0) + '" style="width:60px;"></div>';
          var shadowColorIn = shadowRow.querySelectorAll('input')[0];
          var shadowBlurIn = shadowRow.querySelectorAll('input')[1];
          shadowColorIn.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.shadow) a.shadow = {}; a.shadow.color = this.value; saveStateDebounced(); });
          shadowBlurIn.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.shadow) a.shadow = {}; a.shadow.blur = Math.max(0, Number(this.value) || 0); saveStateDebounced(); });
          shadowSection.appendChild(shadowRow);
          var shadowOffRow = document.createElement('div');
          shadowOffRow.className = 'cfs-prop-row gen-prop-pair';
          shadowOffRow.innerHTML = '<div class="gen-prop-group"><label>X</label><input type="number" class="gen-prop-input" min="-50" max="50" step="1" value="' + (shadowObj.x || 0) + '" style="width:60px;"></div>' +
            '<div class="gen-prop-group"><label>Y</label><input type="number" class="gen-prop-input" min="-50" max="50" step="1" value="' + (shadowObj.y || 0) + '" style="width:60px;"></div>';
          var shadowXIn = shadowOffRow.querySelectorAll('input')[0];
          var shadowYIn = shadowOffRow.querySelectorAll('input')[1];
          shadowXIn.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.shadow) a.shadow = {}; a.shadow.x = Number(this.value) || 0; saveStateDebounced(); });
          shadowYIn.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.shadow) a.shadow = {}; a.shadow.y = Number(this.value) || 0; saveStateDebounced(); });
          shadowSection.appendChild(shadowOffRow);
          capWrap.appendChild(shadowSection);

          /* ── ANIMATION SECTION ── */
          var animSection = document.createElement('div');
          animSection.className = 'cfs-prop-section';
          animSection.innerHTML = '<div class="cfs-prop-section-title">Animation</div>';
          var animObj = capAsset.animation || {};
          var ANIM_STYLES = ['karaoke', 'highlight', 'pop', 'fade', 'slide', 'bounce', 'typewriter', 'none'];
          var animRow = document.createElement('div');
          animRow.className = 'cfs-prop-row';
          animRow.innerHTML = '<label>Style</label><select class="gen-prop-input cfs-cap-anim-style" style="width:100%;"></select>';
          var animSelect = animRow.querySelector('select');
          ANIM_STYLES.forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = s.charAt(0).toUpperCase() + s.slice(1); if (s === (animObj.style || 'none')) o.selected = true; animSelect.appendChild(o); });
          var animDirRow = document.createElement('div');
          animDirRow.className = 'cfs-prop-row';
          animDirRow.innerHTML = '<label>Direction</label><select class="gen-prop-input cfs-cap-anim-dir"><option value="up">Up</option><option value="down">Down</option><option value="left">Left</option><option value="right">Right</option></select>';
          animDirRow.style.display = (animObj.style === 'slide') ? '' : 'none';
          var animDirSelect = animDirRow.querySelector('select');
          animDirSelect.value = animObj.direction || 'up';
          animSelect.addEventListener('change', function () {
            var a = getCapAsset(); if (!a) return;
            if (!a.animation) a.animation = {};
            a.animation.style = animSelect.value;
            animDirRow.style.display = animSelect.value === 'slide' ? '' : 'none';
            if (animSelect.value !== 'slide') delete a.animation.direction;
            /* Update Fabric object so seekToTime picks up the new style immediately */
            if (canvas && canvas.getObjects) {
              canvas.getObjects().forEach(function (obj) {
                if (obj.cfsIsCaption) {
                  obj.cfsCaptionAnimation = { style: animSelect.value };
                  if (animSelect.value === 'slide' && a.animation.direction) {
                    obj.cfsCaptionAnimation.direction = a.animation.direction;
                  }
                }
              });
            }
            saveStateDebounced();
            /* Force re-render with new style */
            if (typeof applySeekForOutputPreview === 'function') applySeekForOutputPreview(canvas);
          });
          animDirSelect.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.animation) a.animation = {}; a.animation.direction = animDirSelect.value; saveStateDebounced(); });
          animSection.appendChild(animRow);
          animSection.appendChild(animDirRow);

          /* ── DISPLAY SETTINGS (words per line, lines) ── */
          var displayObj = capAsset.display || {};
          var displayRow = document.createElement('div');
          displayRow.className = 'cfs-prop-row';
          displayRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;';
          displayRow.innerHTML = '<label style="flex-shrink:0;font-size:12px;">Words/line</label>' +
            '<input type="number" class="gen-prop-input cfs-cap-wpl" min="1" max="12" step="1" value="' + (displayObj.wordsPerLine || 4) + '" style="width:48px;">' +
            '<label style="flex-shrink:0;font-size:12px;margin-left:4px;">Lines</label>' +
            '<input type="number" class="gen-prop-input cfs-cap-lines" min="1" max="4" step="1" value="' + (displayObj.lines || 2) + '" style="width:48px;">';
          var wplInput = displayRow.querySelector('.cfs-cap-wpl');
          var linesInput = displayRow.querySelector('.cfs-cap-lines');
          function syncDisplay() {
            var a = getCapAsset(); if (!a) return;
            if (!a.display) a.display = {};
            a.display.wordsPerLine = Math.max(1, Math.min(12, parseInt(wplInput.value, 10) || 4));
            a.display.lines = Math.max(1, Math.min(4, parseInt(linesInput.value, 10) || 2));
            /* Propagate to Fabric objects */
            if (canvas && canvas.getObjects) {
              canvas.getObjects().forEach(function (obj) {
                if (obj.cfsIsCaption) {
                  obj.cfsCaptionDisplay = { wordsPerLine: a.display.wordsPerLine, lines: a.display.lines };
                }
              });
            }
            saveStateDebounced();
            if (typeof applySeekForOutputPreview === 'function') applySeekForOutputPreview(canvas);
          }
          wplInput.addEventListener('change', syncDisplay);
          linesInput.addEventListener('change', syncDisplay);
          animSection.appendChild(displayRow);

          capWrap.appendChild(animSection);

          /* ── ACTIVE WORD STYLING ── */
          var activeSection = document.createElement('div');
          activeSection.className = 'cfs-prop-section';
          activeSection.innerHTML = '<div class="cfs-prop-section-title">Active Word</div>';
          var activeObj = capAsset.active || {};
          var activeFontObj = activeObj.font || {};
          var activeStrokeObj = activeObj.stroke || {};
          var activeRow = document.createElement('div');
          activeRow.className = 'cfs-prop-row gen-prop-pair';
          activeRow.innerHTML = '<div class="gen-prop-group"><label>Color</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (activeFontObj.color || '#efbf04') + '"></div>' +
            '<div class="gen-prop-group"><label>Background</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (activeFontObj.background || '#000000') + '"><label style="margin-left:4px;font-size:11px;"><input type="checkbox"' + (activeFontObj.background ? ' checked' : '') + '> On</label></div>' +
            '<div class="gen-prop-group"><label>OP %</label><input type="number" class="gen-prop-input cfs-cap-active-bg-op" min="0" max="100" step="5" value="' + Math.round((activeFontObj.backgroundOpacity != null ? activeFontObj.backgroundOpacity : 1) * 100) + '" style="width:48px;"></div>';
          var activeColorIn = activeRow.querySelectorAll('input[type=color]')[0];
          var activeBgIn = activeRow.querySelectorAll('input[type=color]')[1];
          var activeBgCheck = activeRow.querySelector('input[type=checkbox]');
          var activeBgOpIn = activeRow.querySelector('.cfs-cap-active-bg-op');
          activeColorIn.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.active) a.active = {}; if (!a.active.font) a.active.font = {}; a.active.font.color = this.value; saveStateDebounced(); });
          function syncActiveBg() { var a = getCapAsset(); if (!a) return; if (!a.active) a.active = {}; if (!a.active.font) a.active.font = {}; if (activeBgCheck.checked) { a.active.font.background = activeBgIn.value; a.active.font.backgroundOpacity = Math.min(1, Math.max(0, (Number(activeBgOpIn.value) || 100) / 100)); } else { delete a.active.font.background; delete a.active.font.backgroundOpacity; } saveStateDebounced(); }
          activeBgIn.addEventListener('change', syncActiveBg);
          activeBgCheck.addEventListener('change', syncActiveBg);
          activeBgOpIn.addEventListener('change', syncActiveBg);
          activeSection.appendChild(activeRow);
          // Active stroke
          var activeStrokeRow = document.createElement('div');
          activeStrokeRow.className = 'cfs-prop-row gen-prop-pair';
          activeStrokeRow.innerHTML = '<div class="gen-prop-group"><label>Stroke W</label><input type="number" class="gen-prop-input" min="0" max="20" step="1" value="' + (activeStrokeObj.width || 0) + '" style="width:50px;"></div>' +
            '<div class="gen-prop-group"><label>Stroke Color</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (activeStrokeObj.color || '#000000') + '"></div>';
          activeStrokeRow.querySelectorAll('input')[0].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.active) a.active = {}; if (!a.active.stroke) a.active.stroke = {}; a.active.stroke.width = Math.max(0, Number(this.value) || 0); saveStateDebounced(); });
          activeStrokeRow.querySelectorAll('input')[1].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.active) a.active = {}; if (!a.active.stroke) a.active.stroke = {}; a.active.stroke.color = this.value; saveStateDebounced(); });
          activeSection.appendChild(activeStrokeRow);
          capWrap.appendChild(activeSection);

          /* ── ALIGNMENT ── */
          var alignSection = document.createElement('div');
          alignSection.className = 'cfs-prop-section';
          alignSection.innerHTML = '<div class="cfs-prop-section-title">Alignment & Style</div>';
          var alignObj = capAsset.align || {};
          var styleObj = capAsset.style || {};
          var alignRow = document.createElement('div');
          alignRow.className = 'cfs-prop-row gen-prop-pair';
          alignRow.innerHTML = '<div class="gen-prop-group"><label>Vertical</label><select class="gen-prop-input cfs-cap-align-v"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></div>' +
            '<div class="gen-prop-group"><label>Transform</label><select class="gen-prop-input cfs-cap-transform"><option value="">None</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option></select></div>';
          alignRow.querySelector('.cfs-cap-align-v').value = alignObj.vertical || 'bottom';
          alignRow.querySelector('.cfs-cap-transform').value = styleObj.textTransform || '';
          alignRow.querySelector('.cfs-cap-align-v').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.align) a.align = {}; a.align.vertical = this.value; saveStateDebounced(); });
          alignRow.querySelector('.cfs-cap-transform').addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (this.value) { if (!a.style) a.style = {}; a.style.textTransform = this.value; } else { if (a.style) delete a.style.textTransform; } saveStateDebounced(); });
          alignSection.appendChild(alignRow);
          capWrap.appendChild(alignSection);

          /* ── BORDER ── */
          var borderSection = document.createElement('div');
          borderSection.className = 'cfs-prop-section';
          borderSection.innerHTML = '<div class="cfs-prop-section-title">Border</div>';
          var borderObj = capAsset.border || {};
          var borderRow = document.createElement('div');
          borderRow.className = 'cfs-prop-row gen-prop-pair';
          borderRow.innerHTML = '<div class="gen-prop-group"><label>Width</label><input type="number" class="gen-prop-input" min="0" max="20" step="1" value="' + (borderObj.width || 0) + '" style="width:50px;"></div>' +
            '<div class="gen-prop-group"><label>Radius</label><input type="number" class="gen-prop-input" min="0" max="100" step="1" value="' + (borderObj.radius || 0) + '" style="width:50px;"></div>';
          borderRow.querySelectorAll('input')[0].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.border) a.border = {}; a.border.width = Math.max(0, Number(this.value) || 0); saveStateDebounced(); });
          borderRow.querySelectorAll('input')[1].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.border) a.border = {}; a.border.radius = Math.max(0, Number(this.value) || 0); saveStateDebounced(); });
          borderSection.appendChild(borderRow);
          var borderColorRow = document.createElement('div');
          borderColorRow.className = 'cfs-prop-row gen-prop-pair';
          borderColorRow.innerHTML = '<div class="gen-prop-group"><label>Color</label><input type="color" class="gen-prop-input" style="width:48px;height:28px;padding:0;border:0;background:none;" value="' + (borderObj.color || '#000000') + '"></div>' +
            '<div class="gen-prop-group"><label>OP %</label><input type="number" class="gen-prop-input" min="0" max="100" step="5" value="' + Math.round((borderObj.opacity != null ? borderObj.opacity : 1) * 100) + '" style="width:50px;"></div>';
          borderColorRow.querySelectorAll('input')[0].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.border) a.border = {}; a.border.color = this.value; saveStateDebounced(); });
          borderColorRow.querySelectorAll('input')[1].addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.border) a.border = {}; a.border.opacity = Math.min(1, Math.max(0, (Number(this.value) || 100) / 100)); saveStateDebounced(); });
          borderSection.appendChild(borderColorRow);
          capWrap.appendChild(borderSection);

          /* ── PADDING ── */
          var padSection = document.createElement('div');
          padSection.className = 'cfs-prop-section';
          padSection.innerHTML = '<div class="cfs-prop-section-title">Padding</div>';
          var padObj = capAsset.padding || {};
          var padRow = document.createElement('div');
          padRow.className = 'cfs-prop-row gen-prop-pair';
          padRow.innerHTML = '<div class="gen-prop-group"><label>Top</label><input type="number" class="gen-prop-input cfs-pad-t" min="0" max="200" step="1" value="' + (padObj.top || 0) + '" style="width:50px;"></div>' +
            '<div class="gen-prop-group"><label>Right</label><input type="number" class="gen-prop-input cfs-pad-r" min="0" max="200" step="1" value="' + (padObj.right || 0) + '" style="width:50px;"></div>';
          var padRow2 = document.createElement('div');
          padRow2.className = 'cfs-prop-row gen-prop-pair';
          padRow2.innerHTML = '<div class="gen-prop-group"><label>Bottom</label><input type="number" class="gen-prop-input cfs-pad-b" min="0" max="200" step="1" value="' + (padObj.bottom || 0) + '" style="width:50px;"></div>' +
            '<div class="gen-prop-group"><label>Left</label><input type="number" class="gen-prop-input cfs-pad-l" min="0" max="200" step="1" value="' + (padObj.left || 0) + '" style="width:50px;"></div>';
          ['t', 'r', 'b', 'l'].forEach(function (d) { var key = { t: 'top', r: 'right', b: 'bottom', l: 'left' }[d]; var el = (d === 't' || d === 'r' ? padRow : padRow2).querySelector('.cfs-pad-' + d); if (el) el.addEventListener('change', function () { var a = getCapAsset(); if (!a) return; if (!a.padding) a.padding = {}; a.padding[key] = Math.max(0, Number(this.value) || 0); saveStateDebounced(); }); });
          padSection.appendChild(padRow);
          padSection.appendChild(padRow2);
          capWrap.appendChild(padSection);

          /* ── TEXT / WORDS ── */
          var textSection = document.createElement('div');
          textSection.className = 'cfs-prop-section';
          textSection.innerHTML = '<div class="cfs-prop-section-title">Caption Content</div>';
          var capTextRow = document.createElement('div');
          capTextRow.className = 'cfs-prop-row';
          capTextRow.innerHTML = '<label>Text: </label>';
          var capTextarea = document.createElement('textarea');
          capTextarea.className = 'gen-prop-input';
          capTextarea.rows = 3;
          capTextarea.style.cssText = 'width:100%;resize:vertical;';
          var capText = (capAsset.text || '').toString();
          if (!capText && capAsset.words && Array.isArray(capAsset.words)) {
            capText = capAsset.words.map(function (w) { return w && w.text != null ? w.text : ''; }).join(' ');
          }
          capTextarea.value = capText;
          capTextarea.addEventListener('change', function () {
            var a = getCapAsset(); if (!a) return;
            a.text = capTextarea.value.trim();
            delete a.words;
            saveStateDebounced(); refreshTimeline();
          });
          capTextRow.appendChild(capTextarea);
          textSection.appendChild(capTextRow);

          var capWordsRow = document.createElement('div');
          capWordsRow.className = 'cfs-prop-row';
          capWordsRow.innerHTML = '<label>Words timing (JSON): </label>';
          var capWordsTextarea = document.createElement('textarea');
          capWordsTextarea.className = 'gen-prop-input';
          capWordsTextarea.rows = 4;
          capWordsTextarea.style.cssText = 'width:100%;resize:vertical;font-family:monospace;font-size:11px;';
          var wordsVal = Array.isArray(capAsset.words) ? capAsset.words : [];
          try { capWordsTextarea.value = wordsVal.length ? JSON.stringify(wordsVal, null, 2) : ''; } catch (_) { capWordsTextarea.value = ''; }
          capWordsTextarea.addEventListener('change', function () {
            var a = getCapAsset(); if (!a) return;
            var raw = capWordsTextarea.value.trim();
            if (!raw) { delete a.words; saveStateDebounced(); refreshTimeline(); return; }
            try { var parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw new Error('Must be array'); a.words = parsed; saveStateDebounced(); refreshTimeline(); }
            catch (e) { try { window.alert('Invalid words JSON. Use [{\"text\":\"Hello\",\"start\":0,\"end\":0.4}].'); } catch (_) {} }
          });
          capWordsRow.appendChild(capWordsTextarea);
          textSection.appendChild(capWordsRow);
          capWrap.appendChild(textSection);

          /* ── LIVE WORD PREVIEW ── */
          var capLiveRow = document.createElement('div');
          capLiveRow.className = 'cfs-prop-row';
          capLiveRow.innerHTML = '<label style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.7;">Now speaking:</label>';
          var capLiveWord = document.createElement('div');
          capLiveWord.style.cssText = 'font-size:13px;font-weight:500;padding:6px 10px;border:1px solid var(--gen-border,#444);border-radius:6px;min-height:20px;background:var(--gen-surface,#2a2a2e);color:var(--gen-text,#e0e0e0);';
          function updateLiveWord(absTimeSec) {
            var c = template.timeline.tracks[selectedCaptionClip.templateTrackIndex] && template.timeline.tracks[selectedCaptionClip.templateTrackIndex].clips[selectedCaptionClip.templateClipIndex];
            if (!c || !c.asset || !Array.isArray(c.asset.words) || !c.asset.words.length) { capLiveWord.textContent = 'No timed words'; return; }
            var rel = Math.max(0, Number(absTimeSec || 0) - Number(c.start || 0));
            var active = null;
            for (var wi = 0; wi < c.asset.words.length; wi++) {
              var w = c.asset.words[wi]; if (!w) continue;
              var ws = Number(w.start); var we = Number(w.end);
              if (!isFinite(ws)) ws = wi > 0 ? Number(c.asset.words[wi - 1].end) || 0 : 0;
              if (!isFinite(we) || we < ws) we = ws + 0.35;
              if (rel >= ws && rel < we) { active = w; break; }
            }
            capLiveWord.textContent = active && active.text ? String(active.text) : '(none)';
          }
          updateLiveWord(currentPlayheadSec || 0);
          capLiveRow.appendChild(capLiveWord);
          capWrap.appendChild(capLiveRow);
          captionWordPreviewUnsub = editEvents.on('playback:time', function (evt) {
            updateLiveWord(evt && typeof evt.time === 'number' ? evt.time : currentPlayheadSec);
          });

          /* ── GENERATE CAPTIONS (STT) ── */
          var capGenRow = document.createElement('div');
          capGenRow.className = 'cfs-prop-row';
          var capGenBtn = document.createElement('button');
          capGenBtn.type = 'button';
          capGenBtn.className = 'cfs-btn-secondary';
          capGenBtn.style.cssText = 'width:100%;';
          capGenBtn.textContent = 'Generate captions from audio (STT)';
          capGenBtn.addEventListener('click', function () {
            var sttGen = typeof window !== 'undefined' && window.__CFS_sttGenerate;
            if (!sttGen) { try { window.alert('STT not configured. Set window.__CFS_sttApiUrl or window.__CFS_sttGenerate.'); } catch (_) {} return; }
            var audioSrc = window.prompt('Audio URL to transcribe (or leave blank for template audio):', '');
            if (audioSrc === null) return;
            capGenBtn.disabled = true; capGenBtn.textContent = 'Transcribing…';
            function handleResult(result) {
              var a = getCapAsset(); if (!a) return;
              if (result && result.text) a.text = result.text;
              if (result && Array.isArray(result.words) && result.words.length) {
                a.words = result.words; delete a.text;
                /* Calibrate timing model from real STT word data */
                if (typeof window.__CFS_calibrateFromWords === 'function') {
                  window.__CFS_calibrateFromWords(result.words);
                }
              }
              /* Clear auto-generated flag since user manually regenerated via STT */
              delete a._autoGenerated;
              saveStateDebounced(); refreshTimeline(); refreshPropertyPanel();
            }
            function findFirstAudioSrc() {
              if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return null;
              for (var ti = 0; ti < template.timeline.tracks.length; ti++) {
                var clips = (template.timeline.tracks[ti] && template.timeline.tracks[ti].clips) || [];
                for (var ci = 0; ci < clips.length; ci++) {
                  var a = clips[ci] && clips[ci].asset;
                  if (a && (a.type === 'audio' || a.type === 'video') && a.src && a.src.indexOf('{{') === -1) return { type: 'url', src: a.src };
                }
              }
              if (template.timeline.soundtrack && template.timeline.soundtrack.src) return { type: 'url', src: template.timeline.soundtrack.src };
              /* Look for text-to-speech clips */
              for (var ti2 = 0; ti2 < template.timeline.tracks.length; ti2++) {
                var clips2 = (template.timeline.tracks[ti2] && template.timeline.tracks[ti2].clips) || [];
                for (var ci2 = 0; ci2 < clips2.length; ci2++) {
                  var a2 = clips2[ci2] && clips2[ci2].asset;
                  if (a2 && a2.type === 'text-to-speech' && a2.text) return { type: 'tts', text: a2.text, voice: a2.localVoice || a2.voice || 'Amy' };
                }
              }
              return null;
            }
            var audioInfo = (audioSrc && audioSrc.trim()) ? { type: 'url', src: audioSrc.trim() } : findFirstAudioSrc();
            if (!audioInfo) {
              try { window.alert('No audio source found. Add an audio, video, or text-to-speech clip first.'); } catch (_) {}
              capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false; return;
            }

            if (audioInfo.type === 'tts') {
              /* TTS → STT pipeline: generate speech audio then transcribe it */
              var ttsGen = typeof window !== 'undefined' && window.__CFS_ttsGenerate;
              if (ttsGen) {
                capGenBtn.textContent = 'Generating speech…';
                Promise.resolve(ttsGen(audioInfo.text)).then(function (audioBlob) {
                  if (!audioBlob || audioBlob.size < 500) {
                    /* Silent/tiny audio — use estimated words instead */
                    var estWords = window.__CFS_estimateWords ? window.__CFS_estimateWords(audioInfo.text, 0) : [];
                    handleResult({ words: estWords, text: audioInfo.text });
                    capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
                    return;
                  }
                  capGenBtn.textContent = 'Transcribing…';
                  return Promise.resolve(sttGen(audioBlob)).then(function (result) {
                    if (!result || !result.words || !result.words.length) {
                      var estW = window.__CFS_estimateWords ? window.__CFS_estimateWords(audioInfo.text, 0) : [];
                      handleResult({ words: estW, text: audioInfo.text });
                    } else {
                      handleResult(result);
                    }
                    capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
                  });
                }).catch(function (err) {
                  /* Fallback to estimateWords */
                  var estW2 = window.__CFS_estimateWords ? window.__CFS_estimateWords(audioInfo.text, 0) : [];
                  if (estW2.length) {
                    handleResult({ words: estW2, text: audioInfo.text });
                  } else {
                    try { window.alert('TTS/STT error: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
                  }
                  capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
                });
              } else {
                /* No TTS available — use estimateWords */
                var estW3 = window.__CFS_estimateWords ? window.__CFS_estimateWords(audioInfo.text, 0) : [];
                if (estW3.length) {
                  handleResult({ words: estW3, text: audioInfo.text });
                } else {
                  try { window.alert('No TTS engine available. Set window.__CFS_ttsGenerate.'); } catch (_) {}
                }
                capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
              }
            } else {
              /* Direct audio URL → STT */
              Promise.resolve(sttGen(audioInfo.src)).then(function (result) {
                handleResult(result); capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
              }).catch(function (err) {
                try { window.alert('STT error: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
                capGenBtn.textContent = 'Generate captions from audio (STT)'; capGenBtn.disabled = false;
              });
            }
          });
          capGenRow.appendChild(capGenBtn);
          capWrap.appendChild(capGenRow);

          /* ── SRT IMPORT / EXPORT ── */
          var srtSection = document.createElement('div');
          srtSection.className = 'cfs-prop-section';
          srtSection.innerHTML = '<div class="cfs-prop-section-title">SRT / VTT</div>';

          // Import SRT file
          var srtImportRow = document.createElement('div');
          srtImportRow.className = 'cfs-prop-row';
          var srtFileInput = document.createElement('input');
          srtFileInput.type = 'file';
          srtFileInput.accept = '.srt,.vtt,.txt';
          srtFileInput.style.cssText = 'display:none;';
          var srtImportBtn = document.createElement('button');
          srtImportBtn.type = 'button';
          srtImportBtn.className = 'cfs-btn-secondary';
          srtImportBtn.style.cssText = 'width:100%;';
          srtImportBtn.textContent = 'Import SRT / VTT file';
          srtImportBtn.addEventListener('click', function () { srtFileInput.click(); });
          srtFileInput.addEventListener('change', function () {
            var file = srtFileInput.files && srtFileInput.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              var text = reader.result;
              var parser = typeof window.__CFS_parseSrt === 'function' ? window.__CFS_parseSrt : null;
              if (!parser) { try { window.alert('SRT parser not loaded.'); } catch (_) {} return; }
              var result = parser(text);
              var a = getCapAsset(); if (!a) return;
              if (result.words && result.words.length) {
                a.words = result.words;
                delete a.text;
              } else if (result.text) {
                a.text = result.text;
              }
              saveStateDebounced(); refreshTimeline(); refreshPropertyPanel();
            };
            reader.readAsText(file);
            srtFileInput.value = ''; // Reset so same file can be re-imported
          });
          srtImportRow.appendChild(srtImportBtn);
          srtImportRow.appendChild(srtFileInput);
          srtSection.appendChild(srtImportRow);

          // Fetch SRT from URL
          var srtUrlRow = document.createElement('div');
          srtUrlRow.className = 'cfs-prop-row';
          var srtUrlBtn = document.createElement('button');
          srtUrlBtn.type = 'button';
          srtUrlBtn.className = 'cfs-btn-secondary';
          srtUrlBtn.style.cssText = 'width:100%;';
          srtUrlBtn.textContent = 'Import SRT from URL';
          srtUrlBtn.addEventListener('click', function () {
            var url = window.prompt('SRT / VTT URL:', '');
            if (!url || !url.trim()) return;
            srtUrlBtn.disabled = true; srtUrlBtn.textContent = 'Fetching…';
            fetch(url.trim()).then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.text();
            }).then(function (text) {
              var parser = typeof window.__CFS_parseSrt === 'function' ? window.__CFS_parseSrt : null;
              if (!parser) { try { window.alert('SRT parser not loaded.'); } catch (_) {} return; }
              var result = parser(text);
              var a = getCapAsset(); if (!a) return;
              if (result.words && result.words.length) {
                a.words = result.words;
                delete a.text;
              } else if (result.text) {
                a.text = result.text;
              }
              saveStateDebounced(); refreshTimeline(); refreshPropertyPanel();
            }).catch(function (err) {
              try { window.alert('SRT fetch error: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
            }).finally(function () {
              srtUrlBtn.textContent = 'Import SRT from URL'; srtUrlBtn.disabled = false;
            });
          });
          srtUrlRow.appendChild(srtUrlBtn);
          srtSection.appendChild(srtUrlRow);

          // Export SRT
          var srtExportRow = document.createElement('div');
          srtExportRow.className = 'cfs-prop-row gen-prop-pair';
          var srtExportBtn = document.createElement('button');
          srtExportBtn.type = 'button';
          srtExportBtn.className = 'cfs-btn-secondary';
          srtExportBtn.style.cssText = 'flex:1;';
          srtExportBtn.textContent = 'Export .srt';
          srtExportBtn.addEventListener('click', function () {
            var a = getCapAsset(); if (!a) return;
            var words = a.words;
            if (!Array.isArray(words) || !words.length) {
              // If only text (no word-level timing), use estimate-words to generate timing
              if (a.text && typeof window.__CFS_estimateWords === 'function') {
                words = window.__CFS_estimateWords(a.text, 0);
              }
            }
            if (!words || !words.length) { try { window.alert('No words data to export. Add timed words or generate captions first.'); } catch (_) {} return; }
            var gen = typeof window.__CFS_wordsToSrt === 'function' ? window.__CFS_wordsToSrt : null;
            if (!gen) { try { window.alert('SRT generator not loaded.'); } catch (_) {} return; }
            var srtText = gen(words);
            var blob = new Blob([srtText], { type: 'text/plain' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url; link.download = 'captions.srt';
            document.body.appendChild(link); link.click();
            setTimeout(function () { document.body.removeChild(link); URL.revokeObjectURL(url); }, 100);
          });
          var vttExportBtn = document.createElement('button');
          vttExportBtn.type = 'button';
          vttExportBtn.className = 'cfs-btn-secondary';
          vttExportBtn.style.cssText = 'flex:1;';
          vttExportBtn.textContent = 'Export .vtt';
          vttExportBtn.addEventListener('click', function () {
            var a = getCapAsset(); if (!a) return;
            var words = a.words;
            if (!Array.isArray(words) || !words.length) {
              if (a.text && typeof window.__CFS_estimateWords === 'function') {
                words = window.__CFS_estimateWords(a.text, 0);
              }
            }
            if (!words || !words.length) { try { window.alert('No words data to export.'); } catch (_) {} return; }
            var gen = typeof window.__CFS_wordsToVtt === 'function' ? window.__CFS_wordsToVtt : null;
            if (!gen) { try { window.alert('VTT generator not loaded.'); } catch (_) {} return; }
            var vttText = gen(words);
            var blob = new Blob([vttText], { type: 'text/vtt' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url; link.download = 'captions.vtt';
            document.body.appendChild(link); link.click();
            setTimeout(function () { document.body.removeChild(link); URL.revokeObjectURL(url); }, 100);
          });
          srtExportRow.appendChild(srtExportBtn);
          srtExportRow.appendChild(vttExportBtn);
          srtSection.appendChild(srtExportRow);
          capWrap.appendChild(srtSection);

          capForm.appendChild(capWrap);
          propertyPanel.appendChild(capForm);
          setTimeout(function () { try { capForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 50);
          return;
        }
      }
      if (!obj && selectedTtsClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var ttsTr = template.timeline.tracks[selectedTtsClip.templateTrackIndex];
        var ttsClip = ttsTr && ttsTr.clips && ttsTr.clips[selectedTtsClip.templateClipIndex];
        if (ttsClip && (ttsClip.asset || {}).type === 'text-to-speech') {
          var ttsForm = document.createElement('div');
          ttsForm.className = 'cfs-properties-form';
          var ttsHeading = document.createElement('div');
          ttsHeading.className = 'cfs-properties-editing';
          ttsHeading.textContent = 'Editing: Text-to-speech';
          ttsForm.appendChild(ttsHeading);
          var ttsWrap = document.createElement('div');
          ttsWrap.className = 'cfs-properties-form-wrap';
          var ttsTextRow = document.createElement('div');
          ttsTextRow.className = 'cfs-prop-row';
          ttsTextRow.innerHTML = '<label>Script / text: </label>';
          var ttsTextarea = document.createElement('textarea');
          ttsTextarea.className = 'cfs-prop-tts-text';
          ttsTextarea.rows = 3;
          ttsTextarea.style.cssText = 'width:100%;max-width:280px;resize:vertical;';
          ttsTextarea.value = (ttsClip.asset.text || '').toString();
          ttsTextarea.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'text-to-speech' };
            c.asset.text = ttsTextarea.value.trim();
            saveStateDebounced();
            refreshTimeline();
            /* TTS text changed → regenerate captions to stay in sync */
            debouncedRegenerateCaptions();
          });
          ttsTextRow.appendChild(ttsTextarea);
          ttsWrap.appendChild(ttsTextRow);
          var ttsVoiceRow = document.createElement('div');
          ttsVoiceRow.className = 'cfs-prop-row';
          ttsVoiceRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
          ttsVoiceRow.innerHTML = '<label style="flex-shrink:0;">Voice: </label>';
          var ttsVoiceSelect = document.createElement('select');
          ttsVoiceSelect.className = 'cfs-prop-tts-voice';
          ttsVoiceSelect.style.cssText = 'flex:1;min-width:140px;max-width:240px;';
          /* Populate with system voices */
          function populateTtsVoiceSelect(currentVoice) {
            ttsVoiceSelect.innerHTML = '';
            var customOpt = document.createElement('option');
            customOpt.value = '';
            customOpt.textContent = '— Default (af_heart) —';
            ttsVoiceSelect.appendChild(customOpt);

            /* ── Kokoro TTS voices (work in export) ── */
            var kokoroVoices = [
              /* American English */
              { id: 'af_heart',    label: 'Heart ❤️',    lang: 'American English', gender: 'F', grade: 'A' },
              { id: 'af_alloy',    label: 'Alloy',        lang: 'American English', gender: 'F', grade: 'C' },
              { id: 'af_aoede',    label: 'Aoede',        lang: 'American English', gender: 'F', grade: 'C+' },
              { id: 'af_bella',    label: 'Bella 🔥',    lang: 'American English', gender: 'F', grade: 'A-' },
              { id: 'af_jessica',  label: 'Jessica',      lang: 'American English', gender: 'F', grade: 'D' },
              { id: 'af_kore',     label: 'Kore',         lang: 'American English', gender: 'F', grade: 'C+' },
              { id: 'af_nicole',   label: 'Nicole 🎧',   lang: 'American English', gender: 'F', grade: 'B-' },
              { id: 'af_nova',     label: 'Nova',         lang: 'American English', gender: 'F', grade: 'C' },
              { id: 'af_river',    label: 'River',        lang: 'American English', gender: 'F', grade: 'D' },
              { id: 'af_sarah',    label: 'Sarah',        lang: 'American English', gender: 'F', grade: 'C+' },
              { id: 'af_sky',      label: 'Sky',          lang: 'American English', gender: 'F', grade: 'C-' },
              { id: 'am_adam',     label: 'Adam',         lang: 'American English', gender: 'M', grade: 'F+' },
              { id: 'am_echo',     label: 'Echo',         lang: 'American English', gender: 'M', grade: 'D' },
              { id: 'am_eric',     label: 'Eric',         lang: 'American English', gender: 'M', grade: 'D' },
              { id: 'am_fenrir',   label: 'Fenrir',       lang: 'American English', gender: 'M', grade: 'C+' },
              { id: 'am_liam',     label: 'Liam',         lang: 'American English', gender: 'M', grade: 'D' },
              { id: 'am_michael',  label: 'Michael',      lang: 'American English', gender: 'M', grade: 'C+' },
              { id: 'am_onyx',     label: 'Onyx',         lang: 'American English', gender: 'M', grade: 'D' },
              { id: 'am_puck',     label: 'Puck',         lang: 'American English', gender: 'M', grade: 'C+' },
              { id: 'am_santa',    label: 'Santa',        lang: 'American English', gender: 'M', grade: 'D-' },
              /* British English */
              { id: 'bf_alice',    label: 'Alice',        lang: 'British English', gender: 'F', grade: 'D' },
              { id: 'bf_emma',     label: 'Emma',         lang: 'British English', gender: 'F', grade: 'B-' },
              { id: 'bf_isabella', label: 'Isabella',     lang: 'British English', gender: 'F', grade: 'C' },
              { id: 'bf_lily',     label: 'Lily',         lang: 'British English', gender: 'F', grade: 'D' },
              { id: 'bm_daniel',   label: 'Daniel',       lang: 'British English', gender: 'M', grade: 'D' },
              { id: 'bm_fable',    label: 'Fable',        lang: 'British English', gender: 'M', grade: 'C' },
              { id: 'bm_george',   label: 'George',       lang: 'British English', gender: 'M', grade: 'C' },
              { id: 'bm_lewis',    label: 'Lewis',        lang: 'British English', gender: 'M', grade: 'D+' },
              /* Japanese */
              { id: 'jf_alpha',      label: 'Alpha',        lang: 'Japanese', gender: 'F', grade: 'C+' },
              { id: 'jf_gongitsune', label: 'Gongitsune',   lang: 'Japanese', gender: 'F', grade: 'C' },
              { id: 'jf_nezumi',     label: 'Nezumi',       lang: 'Japanese', gender: 'F', grade: 'C-' },
              { id: 'jf_tebukuro',   label: 'Tebukuro',     lang: 'Japanese', gender: 'F', grade: 'C' },
              { id: 'jm_kumo',       label: 'Kumo',         lang: 'Japanese', gender: 'M', grade: 'C-' },
              /* Mandarin Chinese */
              { id: 'zf_xiaobei',  label: 'Xiaobei',      lang: 'Chinese', gender: 'F', grade: 'D' },
              { id: 'zf_xiaoni',   label: 'Xiaoni',       lang: 'Chinese', gender: 'F', grade: 'D' },
              { id: 'zf_xiaoxiao', label: 'Xiaoxiao',     lang: 'Chinese', gender: 'F', grade: 'D' },
              { id: 'zf_xiaoyi',   label: 'Xiaoyi',       lang: 'Chinese', gender: 'F', grade: 'D' },
              { id: 'zm_yunjian',  label: 'Yunjian',      lang: 'Chinese', gender: 'M', grade: 'D' },
              { id: 'zm_yunxi',    label: 'Yunxi',         lang: 'Chinese', gender: 'M', grade: 'D' },
              { id: 'zm_yunxia',   label: 'Yunxia',        lang: 'Chinese', gender: 'M', grade: 'D' },
              { id: 'zm_yunyang',  label: 'Yunyang',       lang: 'Chinese', gender: 'M', grade: 'D' },
              /* Spanish */
              { id: 'ef_dora',     label: 'Dora',          lang: 'Spanish', gender: 'F', grade: '' },
              { id: 'em_alex',     label: 'Alex',          lang: 'Spanish', gender: 'M', grade: '' },
              { id: 'em_santa',    label: 'Santa',         lang: 'Spanish', gender: 'M', grade: '' },
              /* French */
              { id: 'ff_siwis',    label: 'Siwis',         lang: 'French', gender: 'F', grade: 'B-' },
              /* Hindi */
              { id: 'hf_alpha',    label: 'Alpha',         lang: 'Hindi', gender: 'F', grade: 'C' },
              { id: 'hf_beta',     label: 'Beta',          lang: 'Hindi', gender: 'F', grade: 'C' },
              { id: 'hm_omega',    label: 'Omega',         lang: 'Hindi', gender: 'M', grade: 'C' },
              { id: 'hm_psi',      label: 'Psi',           lang: 'Hindi', gender: 'M', grade: 'C' },
              /* Italian */
              { id: 'if_sara',     label: 'Sara',          lang: 'Italian', gender: 'F', grade: 'C' },
              { id: 'im_nicola',   label: 'Nicola',        lang: 'Italian', gender: 'M', grade: 'C' },
              /* Brazilian Portuguese */
              { id: 'pf_dora',     label: 'Dora',          lang: 'Portuguese', gender: 'F', grade: '' },
              { id: 'pm_alex',     label: 'Alex',          lang: 'Portuguese', gender: 'M', grade: '' },
              { id: 'pm_santa',    label: 'Santa',         lang: 'Portuguese', gender: 'M', grade: '' },
            ];

            /* Group Kokoro voices by language */
            var kokoroGroups = {};
            kokoroVoices.forEach(function (v) {
              if (!kokoroGroups[v.lang]) kokoroGroups[v.lang] = [];
              kokoroGroups[v.lang].push(v);
            });
            var kokoroLangOrder = ['American English', 'British English', 'Japanese', 'Chinese', 'Spanish', 'French', 'Hindi', 'Italian', 'Portuguese'];
            kokoroLangOrder.forEach(function (lang) {
              var voices = kokoroGroups[lang];
              if (!voices || !voices.length) return;
              var optgroup = document.createElement('optgroup');
              optgroup.label = '🔊 ' + lang;
              voices.forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v.id;
                var genderIcon = v.gender === 'F' ? '♀' : '♂';
                opt.textContent = v.label + ' ' + genderIcon + (v.grade ? ' [' + v.grade + ']' : '');
                if (v.id === currentVoice) opt.selected = true;
                optgroup.appendChild(opt);
              });
              ttsVoiceSelect.appendChild(optgroup);
            });

            /* If the stored localVoice isn't in the list, fall back to Default */
            if (currentVoice && ttsVoiceSelect.value !== currentVoice) {
              ttsVoiceSelect.value = '';
            }
          }
          var currentLocalVoiceName = (ttsClip.asset.localVoice || '').toString();
          populateTtsVoiceSelect(currentLocalVoiceName);
          /* Language mismatch warning element */
          var ttsLangWarnEl = document.createElement('div');
          ttsLangWarnEl.style.cssText = 'font-size:11px;color:#f59e0b;background:#f59e0b18;border:1px solid #f59e0b44;border-radius:4px;padding:4px 8px;margin-top:4px;display:none;';
          function detectTextLang(text) {
            if (!text) return 'en';
            /* Simple heuristic: check dominant character sets */
            if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; /* Hiragana/Katakana */
            if (/[\u4e00-\u9fff]{3,}/.test(text)) return 'zh'; /* CJK */
            if (/[\uac00-\ud7af]{3,}/.test(text)) return 'ko'; /* Hangul */
            if (/[\u0400-\u04ff]{3,}/.test(text)) return 'ru'; /* Cyrillic */
            if (/[\u0600-\u06ff]{3,}/.test(text)) return 'ar'; /* Arabic */
            if (/[\u0900-\u097f]{3,}/.test(text)) return 'hi'; /* Devanagari */
            /* Latin-script: check common words */
            var lower = text.toLowerCase();
            if (/\b(el|la|los|las|es|está|por|que|como|pero)\b/.test(lower)) return 'es';
            if (/\b(le|la|les|des|est|une|dans|pour|avec|sur)\b/.test(lower)) return 'fr';
            if (/\b(der|die|das|und|ist|ein|sich|mit|auf|für)\b/.test(lower)) return 'de';
            if (/\b(il|la|di|che|per|con|una|sono|del|alla)\b/.test(lower)) return 'it';
            if (/\b(o|os|um|uma|da|do|para|com|não|que)\b/.test(lower)) return 'pt';
            return 'en';
          }
          function checkLangMismatch() {
            var voiceName = ttsVoiceSelect.value;
            if (!voiceName) { ttsLangWarnEl.style.display = 'none'; return; }
            var voiceLang = '';
            /* Check Kokoro prefix → language mapping */
            var kokoroLangMap = { a: 'en', b: 'en', j: 'ja', z: 'zh', e: 'es', f: 'fr', h: 'hi', i: 'it', p: 'pt' };
            if (/^[a-z]{2}_[a-z]/i.test(voiceName)) {
              voiceLang = kokoroLangMap[voiceName.charAt(0)] || '';
            } else {
              /* Browser voice — look up lang from speechSynthesis */
              var voices = (typeof speechSynthesis !== 'undefined') ? speechSynthesis.getVoices() : [];
              var voice = null;
              for (var i = 0; i < voices.length; i++) { if (voices[i].name === voiceName) { voice = voices[i]; break; } }
              if (!voice) { ttsLangWarnEl.style.display = 'none'; return; }
              voiceLang = (voice.lang || '').split('-')[0].toLowerCase();
            }
            var scriptText = (ttsClip.asset.text || '').toString();
            var textLang = detectTextLang(scriptText);
            if (voiceLang && textLang && voiceLang !== textLang) {
              var langNames = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', pl: 'Polish', sv: 'Swedish' };
              ttsLangWarnEl.textContent = '⚠ Language mismatch: your text appears to be ' + (langNames[textLang] || textLang.toUpperCase()) + ', but this voice is ' + (langNames[voiceLang] || voiceLang.toUpperCase()) + '. This may sound unnatural.';
              ttsLangWarnEl.style.display = 'block';
            } else {
              ttsLangWarnEl.style.display = 'none';
            }
          }
          ttsVoiceSelect.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'text-to-speech' };
            c.asset.localVoice = ttsVoiceSelect.value || undefined;
            /* Also update Fabric object for live preview */
            if (canvas && canvas.getObjects) {
              var tIdx = selectedTtsClip.templateTrackIndex;
              var cIdx = selectedTtsClip.templateClipIndex;
              canvas.getObjects().forEach(function (obj) {
                if (obj.cfsAudioType === 'text-to-speech' &&
                    ((obj.cfsTrackIndex === tIdx && obj.cfsClipIndex === cIdx) ||
                     obj.cfsTrackIndex === tIdx)) {
                  obj.cfsTtsLocalVoice = ttsVoiceSelect.value || '';
                }
              });
            }
            checkLangMismatch();
            saveStateDebounced();
            refreshTimeline();
            /* Voice change may affect pacing → regenerate captions */
            debouncedRegenerateCaptions();
          });
          ttsVoiceRow.appendChild(ttsVoiceSelect);
          /* Preview button — speaks a short sample in the selected voice */
          var ttsPreviewVoiceBtn = document.createElement('button');
          ttsPreviewVoiceBtn.type = 'button';
          ttsPreviewVoiceBtn.textContent = '🔊';
          ttsPreviewVoiceBtn.title = 'Preview selected voice — also calibrates word timing';
          ttsPreviewVoiceBtn.style.cssText = 'padding:4px 8px;cursor:pointer;flex-shrink:0;font-size:14px;';
          ttsPreviewVoiceBtn.addEventListener('click', function () {
            var voiceName = ttsVoiceSelect.value;
            var sampleText = (ttsClip.asset.text || 'Hello, this is a voice preview.').toString();
            /* Check if this is a Kokoro voice (pattern: xx_name) */
            var isKokoroVoice = /^[a-z]{2}_[a-z]/i.test(voiceName) || !voiceName;
            if (isKokoroVoice && typeof window.__CFS_ttsGenerate === 'function') {
              /* Preview via Kokoro TTS */
              ttsPreviewVoiceBtn.disabled = true;
              ttsPreviewVoiceBtn.textContent = '⏳';
              window.__CFS_ttsGenerate(sampleText.substring(0, 200), { voice: voiceName || 'af_heart' }).then(function (blob) {
                if (blob && blob.size > 100) {
                  var url = URL.createObjectURL(blob);
                  var audio = new Audio(url);
                  audio.onended = function () { URL.revokeObjectURL(url); };
                  audio.play().catch(function () {});
                }
              }).catch(function (err) {
                console.warn('[CFS TTS] Preview failed:', err);
              }).finally(function () {
                ttsPreviewVoiceBtn.disabled = false;
                ttsPreviewVoiceBtn.textContent = '🔊';
              });
              return;
            }
            /* Fall back to browser speechSynthesis for non-Kokoro voices */
            if (typeof speechSynthesis === 'undefined') return;
            speechSynthesis.cancel();
            var utter = new SpeechSynthesisUtterance(sampleText);
            if (voiceName) {
              var voices = speechSynthesis.getVoices();
              for (var v = 0; v < voices.length; v++) {
                if (voices[v].name === voiceName) { utter.voice = voices[v]; break; }
              }
            }
            utter.rate = 1;
            /* ── Capture real word boundaries for calibration ── */
            var boundaryWords = [];
            var utterTokens = sampleText.trim().split(/\s+/).filter(Boolean);
            var wordIdx = 0;
            utter.onboundary = function (ev) {
              if (ev.name !== 'word' || wordIdx >= utterTokens.length) return;
              var timeSec = (ev.elapsedTime || 0) / 1000;
              /* Close previous word's end time */
              if (boundaryWords.length > 0 && boundaryWords[boundaryWords.length - 1].end == null) {
                boundaryWords[boundaryWords.length - 1].end = timeSec;
              }
              boundaryWords.push({ text: utterTokens[wordIdx], start: timeSec, end: null });
              wordIdx++;
            };
            utter.onend = function () {
              /* Close last word using the total utterance duration */
              var totalSec = (utter._cfsEndTime || Date.now()) / 1000;
              if (boundaryWords.length > 0 && boundaryWords[boundaryWords.length - 1].end == null) {
                /* Estimate last word duration from its character count */
                var lastW = boundaryWords[boundaryWords.length - 1];
                var lastDur = (lastW.text.replace(/[^\w]/g, '').length || 3) * 0.06;
                lastW.end = lastW.start + lastDur;
              }
              /* Calibrate if we captured enough words */
              if (boundaryWords.length >= 3 && typeof window.__CFS_calibrateFromWords === 'function') {
                window.__CFS_calibrateFromWords(boundaryWords);
                var cal = typeof window.__CFS_getWordCalibration === 'function' ? window.__CFS_getWordCalibration() : null;
                if (cal) {
                  console.log('[CFS TTS] Calibrated from ' + boundaryWords.length + ' words: '
                    + (cal.charRate * 1000).toFixed(1) + 'ms/char, '
                    + (cal.wordGap * 1000).toFixed(0) + 'ms gap, '
                    + cal.sampleCount + ' samples');
                }
              }
            };
            speechSynthesis.speak(utter);
          });
          ttsVoiceRow.appendChild(ttsPreviewVoiceBtn);
          ttsWrap.appendChild(ttsVoiceRow);
          ttsWrap.appendChild(ttsLangWarnEl);
          checkLangMismatch(); /* Initial check */
          /* Voice count hint */
          var ttsVoiceHelpRow = document.createElement('div');
          ttsVoiceHelpRow.className = 'cfs-prop-row';
          ttsVoiceHelpRow.style.cssText = 'font-size:11px;opacity:0.7;padding:2px 0 4px;';
          ttsVoiceHelpRow.textContent = '54 Kokoro voices across 8 languages.';
          ttsWrap.appendChild(ttsVoiceHelpRow);

          /* ── API VOICE (ShotStack) ── */
          var ttsApiVoiceRow = document.createElement('div');
          ttsApiVoiceRow.className = 'cfs-prop-row';
          ttsApiVoiceRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
          ttsApiVoiceRow.innerHTML = '<label style="flex-shrink:0;">API voice: </label>';
          var ttsApiVoiceInput = document.createElement('input');
          ttsApiVoiceInput.type = 'text';
          ttsApiVoiceInput.className = 'gen-prop-input';
          ttsApiVoiceInput.style.cssText = 'flex:1;min-width:100px;max-width:180px;';
          ttsApiVoiceInput.placeholder = 'e.g. Amy, Brian';
          ttsApiVoiceInput.value = (ttsClip.asset.voice || '').toString();
          ttsApiVoiceInput.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'text-to-speech' };
            c.asset.voice = ttsApiVoiceInput.value.trim() || undefined;
            /* Also update Fabric object */
            if (canvas && canvas.getObjects) {
              var tIdx = selectedTtsClip.templateTrackIndex;
              var cIdx = selectedTtsClip.templateClipIndex;
              canvas.getObjects().forEach(function (obj) {
                if (obj.cfsAudioType === 'text-to-speech' &&
                    ((obj.cfsTrackIndex === tIdx && obj.cfsClipIndex === cIdx) ||
                     obj.cfsTrackIndex === tIdx)) {
                  obj.cfsTtsVoice = ttsApiVoiceInput.value.trim() || '';
                }
              });
            }
            saveStateDebounced();
          });
          ttsApiVoiceRow.appendChild(ttsApiVoiceInput);
          ttsWrap.appendChild(ttsApiVoiceRow);
          var ttsApiVoiceHint = document.createElement('div');
          ttsApiVoiceHint.style.cssText = 'font-size:10px;color:#93c5fd;background:#1e3a5f;border:1px solid #2563eb;border-radius:4px;padding:4px 8px;margin:2px 0 6px;';
          ttsApiVoiceHint.textContent = 'ℹ Used when rendering via ShotStack API. Export to Staging first to hear this voice.';
          ttsWrap.appendChild(ttsApiVoiceHint);
          var ttsLangRow = document.createElement('div');
          ttsLangRow.className = 'cfs-prop-row';
          ttsLangRow.innerHTML = '<label>Language: </label><input type="text" class="cfs-prop-tts-lang" style="width:100%;max-width:200px;" placeholder="e.g. en-US, es-ES">';
          var ttsLangInput = ttsLangRow.querySelector('input.cfs-prop-tts-lang');
          if (ttsLangInput) {
            ttsLangInput.value = (ttsClip.asset.language || '').toString();
            ttsLangInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'text-to-speech' };
              c.asset.language = ttsLangInput.value.trim() || undefined;
              saveStateDebounced();
            });
          }
          ttsWrap.appendChild(ttsLangRow);
          var ttsNewscasterRow = document.createElement('div');
          ttsNewscasterRow.className = 'cfs-prop-row';
          ttsNewscasterRow.innerHTML = '<label>Newscaster: </label><select class="cfs-prop-tts-newscaster" style="width:100px;"><option value="">Off</option><option value="true">On</option></select>';
          var ttsNewscasterSel = ttsNewscasterRow.querySelector('select.cfs-prop-tts-newscaster');
          if (ttsNewscasterSel) {
            ttsNewscasterSel.value = (ttsClip.asset.newscaster === true || ttsClip.asset.newscaster === 'true') ? 'true' : '';
            ttsNewscasterSel.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'text-to-speech' };
              c.asset.newscaster = ttsNewscasterSel.value === 'true' ? true : undefined;
              saveStateDebounced();
            });
          }
          ttsWrap.appendChild(ttsNewscasterRow);
          var ttsPreviewRow = document.createElement('div');
          ttsPreviewRow.className = 'cfs-prop-row';
          var ttsPreviewBtn = document.createElement('button');
          ttsPreviewBtn.type = 'button';
          ttsPreviewBtn.className = 'cfs-btn-secondary';
          ttsPreviewBtn.textContent = 'Preview TTS';
          ttsPreviewBtn.addEventListener('click', function () {
            var gen = typeof window !== 'undefined' && window.__CFS_ttsGenerate;
            if (!gen) { try { window.alert('TTS not configured. Set window.__CFS_ttsApiUrl or window.__CFS_ttsGenerate.'); } catch (_) {} return; }
            var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
            if (!c || !c.asset || !c.asset.text) return;
            ttsPreviewBtn.disabled = true;
            ttsPreviewBtn.textContent = 'Generating…';
            Promise.resolve(gen(c.asset.text, { voice: c.asset.localVoice || c.asset.voice || '', language: c.asset.language })).then(function (blobUrl) {
              var audio = new Audio(blobUrl);
              audio.play().catch(function () {});
              ttsPreviewBtn.textContent = 'Playing…';
              audio.onended = function () { ttsPreviewBtn.textContent = 'Preview TTS'; ttsPreviewBtn.disabled = false; };
              audio.onerror = function () { ttsPreviewBtn.textContent = 'Preview TTS'; ttsPreviewBtn.disabled = false; };
            }).catch(function (err) {
              try { window.alert('TTS error: ' + (err && err.message ? err.message : String(err))); } catch (_) {}
              ttsPreviewBtn.textContent = 'Preview TTS';
              ttsPreviewBtn.disabled = false;
            });
          });
          ttsPreviewRow.appendChild(ttsPreviewBtn);
          ttsWrap.appendChild(ttsPreviewRow);
          var ttsMixLabel = document.createElement('div');
          ttsMixLabel.className = 'cfs-prop-section-label';
          ttsMixLabel.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);margin:8px 0 4px 0;font-weight:600;';
          ttsMixLabel.textContent = 'Audio Mix';
          ttsWrap.appendChild(ttsMixLabel);
          var ttsVolumeRow = document.createElement('div');
          ttsVolumeRow.className = 'cfs-prop-row';
          ttsVolumeRow.innerHTML = '<label>Volume: </label><input type="number" class="cfs-prop-tts-volume" min="0" step="0.01" style="width:80px;" placeholder="1.0">';
          var ttsVolumeInput = ttsVolumeRow.querySelector('input.cfs-prop-tts-volume');
          if (ttsVolumeInput) {
            var ttsVolume = (ttsClip.asset && ttsClip.asset.volume != null) ? Number(ttsClip.asset.volume) : 1;
            ttsVolumeInput.value = isNaN(ttsVolume) ? '1' : String(ttsVolume);
            ttsVolumeInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
              if (!c) return;
              if (!c.asset) c.asset = { type: 'text-to-speech' };
              var n = Number(ttsVolumeInput.value);
              c.asset.volume = isNaN(n) ? 1 : Math.max(0, n);
              saveStateDebounced();
            });
          }
          ttsWrap.appendChild(ttsVolumeRow);
          var ttsFadeInRow = document.createElement('div');
          ttsFadeInRow.className = 'cfs-prop-row';
          ttsFadeInRow.innerHTML = '<label>Fade in (s): </label><input type="number" class="cfs-prop-tts-fadein" min="0" step="0.1" style="width:80px;" placeholder="0">';
          var ttsFadeInInput = ttsFadeInRow.querySelector('input.cfs-prop-tts-fadein');
          if (ttsFadeInInput) {
            ttsFadeInInput.value = (ttsClip.fadeIn != null && isFinite(Number(ttsClip.fadeIn))) ? String(Number(ttsClip.fadeIn)) : '';
            ttsFadeInInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
              if (!c) return;
              var n = Number(ttsFadeInInput.value);
              c.fadeIn = (ttsFadeInInput.value === '' || isNaN(n)) ? undefined : Math.max(0, n);
              saveStateDebounced();
            });
          }
          ttsWrap.appendChild(ttsFadeInRow);
          var ttsFadeOutRow = document.createElement('div');
          ttsFadeOutRow.className = 'cfs-prop-row';
          ttsFadeOutRow.innerHTML = '<label>Fade out (s): </label><input type="number" class="cfs-prop-tts-fadeout" min="0" step="0.1" style="width:80px;" placeholder="0">';
          var ttsFadeOutInput = ttsFadeOutRow.querySelector('input.cfs-prop-tts-fadeout');
          if (ttsFadeOutInput) {
            ttsFadeOutInput.value = (ttsClip.fadeOut != null && isFinite(Number(ttsClip.fadeOut))) ? String(Number(ttsClip.fadeOut)) : '';
            ttsFadeOutInput.addEventListener('change', function () {
              var c = template.timeline.tracks[selectedTtsClip.templateTrackIndex] && template.timeline.tracks[selectedTtsClip.templateTrackIndex].clips[selectedTtsClip.templateClipIndex];
              if (!c) return;
              var n = Number(ttsFadeOutInput.value);
              c.fadeOut = (ttsFadeOutInput.value === '' || isNaN(n)) ? undefined : Math.max(0, n);
              saveStateDebounced();
            });
          }
          ttsWrap.appendChild(ttsFadeOutRow);
          ttsForm.appendChild(ttsWrap);
          propertyPanel.appendChild(ttsForm);
          /* Auto-scroll so user sees the TTS editing panel */
          setTimeout(function () { try { ttsForm.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} }, 50);
          return;
        }
      }
      if (!obj && selectedHtmlClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var htmlTr = template.timeline.tracks[selectedHtmlClip.templateTrackIndex];
        var htmlClip = htmlTr && htmlTr.clips && htmlTr.clips[selectedHtmlClip.templateClipIndex];
        if (htmlClip && (htmlClip.asset || {}).type === 'html') {
          var htmlForm = document.createElement('div');
          htmlForm.className = 'cfs-properties-form';
          var htmlHeading = document.createElement('div');
          htmlHeading.className = 'cfs-properties-editing';
          htmlHeading.textContent = 'Editing: HTML clip';
          htmlForm.appendChild(htmlHeading);
          var htmlWrap = document.createElement('div');
          htmlWrap.className = 'cfs-properties-form-wrap';
          var htmlContentRow = document.createElement('div');
          htmlContentRow.className = 'cfs-prop-row';
          htmlContentRow.innerHTML = '<label>HTML: </label>';
          var htmlTextarea = document.createElement('textarea');
          htmlTextarea.className = 'cfs-prop-html-content';
          htmlTextarea.rows = 4;
          htmlTextarea.style.cssText = 'width:100%;max-width:280px;resize:vertical;font-family:monospace;font-size:12px;';
          htmlTextarea.value = (htmlClip.asset.html || '').toString();
          htmlTextarea.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedHtmlClip.templateTrackIndex] && template.timeline.tracks[selectedHtmlClip.templateTrackIndex].clips[selectedHtmlClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'html' };
            c.asset.html = htmlTextarea.value;
            saveStateDebounced();
            refreshTimeline();
          });
          htmlContentRow.appendChild(htmlTextarea);
          htmlWrap.appendChild(htmlContentRow);
          var htmlCssRow = document.createElement('div');
          htmlCssRow.className = 'cfs-prop-row';
          htmlCssRow.innerHTML = '<label>CSS (optional): </label>';
          var cssTextarea = document.createElement('textarea');
          cssTextarea.className = 'cfs-prop-html-css';
          cssTextarea.rows = 2;
          cssTextarea.style.cssText = 'width:100%;max-width:280px;resize:vertical;font-family:monospace;font-size:12px;';
          cssTextarea.value = (htmlClip.asset.css || '').toString();
          cssTextarea.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedHtmlClip.templateTrackIndex] && template.timeline.tracks[selectedHtmlClip.templateTrackIndex].clips[selectedHtmlClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'html' };
            c.asset.css = cssTextarea.value || undefined;
            saveStateDebounced();
            refreshTimeline();
          });
          htmlCssRow.appendChild(cssTextarea);
          htmlWrap.appendChild(htmlCssRow);
          htmlForm.appendChild(htmlWrap);
          propertyPanel.appendChild(htmlForm);
          return;
        }
      }
      if (!obj && selectedTextToImageClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var ttiTr = template.timeline.tracks[selectedTextToImageClip.templateTrackIndex];
        var ttiClip = ttiTr && ttiTr.clips && ttiTr.clips[selectedTextToImageClip.templateClipIndex];
        if (ttiClip && (ttiClip.asset || {}).type === 'text-to-image') {
          var ttiForm = document.createElement('div');
          ttiForm.className = 'cfs-properties-form';
          var ttiHeading = document.createElement('div');
          ttiHeading.className = 'cfs-properties-editing';
          ttiHeading.textContent = 'Editing: Text-to-image';
          ttiForm.appendChild(ttiHeading);
          var ttiWrap = document.createElement('div');
          ttiWrap.className = 'cfs-properties-form-wrap';
          var ttiPromptRow = document.createElement('div');
          ttiPromptRow.className = 'cfs-prop-row';
          ttiPromptRow.innerHTML = '<label>Prompt: </label>';
          var ttiPrompt = document.createElement('textarea');
          ttiPrompt.className = 'cfs-prop-tti-prompt';
          ttiPrompt.rows = 3;
          ttiPrompt.style.cssText = 'width:100%;max-width:280px;resize:vertical;';
          ttiPrompt.value = (ttiClip.asset.prompt || ttiClip.asset.text || '').toString();
          ttiPrompt.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedTextToImageClip.templateTrackIndex] && template.timeline.tracks[selectedTextToImageClip.templateTrackIndex].clips[selectedTextToImageClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'text-to-image' };
            c.asset.prompt = ttiPrompt.value.trim() || (c.asset.text !== undefined ? c.asset.text : undefined);
            if (c.asset.prompt != null) delete c.asset.text;
            saveStateDebounced();
            refreshTimeline();
          });
          ttiPromptRow.appendChild(ttiPrompt);
          ttiWrap.appendChild(ttiPromptRow);
          ttiForm.appendChild(ttiWrap);
          propertyPanel.appendChild(ttiForm);
          return;
        }
      }
      if (!obj && selectedImageToVideoClip && template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var itvTr = template.timeline.tracks[selectedImageToVideoClip.templateTrackIndex];
        var itvClip = itvTr && itvTr.clips && itvTr.clips[selectedImageToVideoClip.templateClipIndex];
        if (itvClip && (itvClip.asset || {}).type === 'image-to-video') {
          var itvForm = document.createElement('div');
          itvForm.className = 'cfs-properties-form';
          var itvHeading = document.createElement('div');
          itvHeading.className = 'cfs-properties-editing';
          itvHeading.textContent = 'Editing: Image-to-video';
          itvForm.appendChild(itvHeading);
          var itvWrap = document.createElement('div');
          itvWrap.className = 'cfs-properties-form-wrap';
          var itvSrcRow = document.createElement('div');
          itvSrcRow.className = 'cfs-prop-row';
          itvSrcRow.innerHTML = '<label>Source image URL: </label>';
          var itvSrc = document.createElement('input');
          itvSrc.type = 'text';
          itvSrc.className = 'cfs-prop-itv-src';
          itvSrc.style.cssText = 'width:100%;max-width:280px;';
          itvSrc.placeholder = 'URL of image to animate';
          itvSrc.value = (itvClip.asset.src || itvClip.asset.url || '').toString();
          itvSrc.addEventListener('change', function () {
            var c = template.timeline.tracks[selectedImageToVideoClip.templateTrackIndex] && template.timeline.tracks[selectedImageToVideoClip.templateTrackIndex].clips[selectedImageToVideoClip.templateClipIndex];
            if (!c) return;
            if (!c.asset) c.asset = { type: 'image-to-video' };
            c.asset.src = itvSrc.value.trim() || undefined;
            if (c.asset.src != null) delete c.asset.url;
            saveStateDebounced();
            refreshTimeline();
          });
          itvSrcRow.appendChild(itvSrc);
          itvWrap.appendChild(itvSrcRow);
          itvForm.appendChild(itvWrap);
          propertyPanel.appendChild(itvForm);
          return;
        }
      }
      if (!obj) {
        selectedAudioClip = null;
        selectedLumaClip = null;
        selectedCaptionClip = null;
        selectedTtsClip = null;
        selectedHtmlClip = null;
        selectedTextToImageClip = null;
        selectedImageToVideoClip = null;
        var e = document.createElement('div');
        e.className = 'gen-prop-empty';
        e.textContent = 'Select an object or a clip on the timeline';
        propertyPanel.appendChild(e);
        return;
      }
      selectedAudioClip = null;
      selectedLumaClip = null;
      selectedCaptionClip = null;
      selectedTtsClip = null;
      selectedHtmlClip = null;
      selectedTextToImageClip = null;
      selectedImageToVideoClip = null;
      var form = document.createElement('div');
      form.className = 'cfs-properties-form';
      form.style.cssText = 'padding:4px 16px 16px;';
      var editingHeading = document.createElement('div');
      editingHeading.style.cssText = 'font-size:10px;color:#71717a;margin-bottom:12px;display:flex;align-items:center;gap:8px;';
      var editingBadge = document.createElement('span');
      editingBadge.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);color:#60a5fa;font-size:10px;font-weight:500;letter-spacing:0.02em;';
      var typeStr = (obj.type || 'object');
      if (typeStr === 'i-text' || typeStr === 'textbox') typeStr = 'text';
      editingBadge.textContent = typeStr.charAt(0).toUpperCase() + typeStr.slice(1);
      editingHeading.appendChild(editingBadge);
      var editingName = document.createElement('span');
      editingName.style.cssText = 'color:#a1a1aa;font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;';
      editingName.textContent = (obj.name || obj.id || '');
      editingHeading.appendChild(editingName);
      form.appendChild(editingHeading);
      var wrap = document.createElement('div');
      wrap.className = 'cfs-properties-form-wrap';
      if (obj.name !== 'background' && !obj.cfsAudioType && !obj.cfsTtsText) {
        var hideImgRow = document.createElement('div');
        hideImgRow.className = 'cfs-prop-row cfs-prop-hide-on-image-row';
        var hideImgLabel = document.createElement('label');
        hideImgLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--gen-text-secondary);';
        var hideImgCb = document.createElement('input');
        hideImgCb.type = 'checkbox';
        hideImgCb.style.cssText = 'width:auto;accent-color:var(--gen-accent);';
        hideImgCb.checked = !!obj.cfsHideOnImage;
        hideImgLabel.appendChild(hideImgCb);
        hideImgLabel.appendChild(document.createTextNode('Hide on image'));
        hideImgRow.appendChild(hideImgLabel);
        hideImgCb.addEventListener('change', function () {
          pushUndo();
          obj.set('cfsHideOnImage', !!hideImgCb.checked);
          refreshTimeline();
          applySeekForOutputPreview(canvas);
          refreshLayersPanel();
          refreshPropertyPanel();
          if (canvas.renderAll) canvas.renderAll();
        });
        wrap.appendChild(hideImgRow);
      }
      /* Re-initialize _mergeDefaults (outer-scope var) from template.merge */
      Object.keys(_mergeDefaults).forEach(function (k) { delete _mergeDefaults[k]; });
      if (template && Array.isArray(template.merge)) {
        template.merge.forEach(function (m) {
          if (!m) return;
          var k = (m.find != null ? m.find : m.search);
          if (k != null && String(k).indexOf('__CFS_') !== 0) _mergeDefaults[String(k)] = (m.replace != null ? m.replace : m.value);
        });
      }
      function getMergeDefault(key) {
        if (!key) return undefined;
        if (_mergeDefaults[key] !== undefined) return _mergeDefaults[key];
        return _mergeDefaults[String(key).toUpperCase().replace(/\s+/g, '_')];
      }
      function setMergeDefault(key, newValue) {
        if (!key) return;
        var upper = String(key).toUpperCase().replace(/\s+/g, '_');
        _mergeDefaults[key] = newValue;
        _mergeDefaults[upper] = newValue;
        if (template && Array.isArray(template.merge)) {
          for (var i = 0; i < template.merge.length; i++) {
            var mk = template.merge[i].find != null ? template.merge[i].find : template.merge[i].search;
            if (mk === key || String(mk).toUpperCase().replace(/\s+/g, '_') === upper) {
              template.merge[i].replace = newValue;
              return;
            }
          }
          template.merge.push({ find: key, replace: newValue });
        }
      }
      function getOriginalTemplateText(o) {
        var clip = o.cfsOriginalClip || (typeof o.get === 'function' ? o.get('cfsOriginalClip') : null);
        if (clip && clip.asset && clip.asset.text) return clip.asset.text;
        return null;
      }
      function extractPlaceholders(text) {
        if (!text || typeof text !== 'string') return [];
        var result = [], re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, m;
        while ((m = re.exec(text)) !== null) result.push(m[1]);
        return result;
      }
      function ensureMergeField(findKey, replaceVal) {
        if (!findKey || !template) return;
        if (!Array.isArray(template.merge)) template.merge = [];
        var exists = template.merge.some(function (m) { return m && String(m.find) === String(findKey); });
        if (!exists) template.merge.push({ find: String(findKey), replace: replaceVal != null ? String(replaceVal) : '' });
      }
      function removeMergeField(findKey) {
        if (!findKey || !template || !Array.isArray(template.merge)) return;
        template.merge = template.merge.filter(function (m) { return !m || String(m.find) !== String(findKey); });
      }

      /* ── Advanced Merge Field Synchronization ── */

      /** Map of merge keys that were removed from text but whose data is retained for recovery. { KEY: { defaultValue, lastValue } } */
      var _unlinkedMergeFields = {};

      /** Generate a unique merge key, auto-incrementing if collision detected. */
      function generateUniqueMergeKey(desired) {
        if (!desired) desired = 'UNNAMED_VAR';
        desired = String(desired).toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'UNNAMED_VAR';
        if (!template || !Array.isArray(template.merge)) return desired;
        var existing = {};
        template.merge.forEach(function (m) {
          if (m && m.find) existing[String(m.find).toUpperCase()] = true;
        });
        /* Also scan canvas objects for cfsMergeKey */
        if (canvas && canvas.getObjects) {
          canvas.getObjects().forEach(function (o) {
            if (o.cfsMergeKey) existing[String(o.cfsMergeKey).toUpperCase()] = true;
            /* Scan text for inline {{ vars }} */
            var raw = o.cfsRawText || o.text;
            if (raw && typeof raw === 'string') {
              var re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, m;
              while ((m = re.exec(raw)) !== null) existing[m[1].toUpperCase()] = true;
            }
          });
        }
        if (!existing[desired.toUpperCase()]) return desired;
        /* Collision: auto-increment */
        var base = desired.replace(/_\d+$/, '');
        for (var i = 2; i < 999; i++) {
          var candidate = base + '_' + i;
          if (!existing[candidate.toUpperCase()]) return candidate;
        }
        return desired + '_' + Date.now();
      }

      /** Rename a merge key globally: update template.merge, all canvas objects' cfsRawText, and _mergeDefaults. Calls pushUndo. */
      function renameMergeKeyGlobal(oldKey, newKey) {
        if (!oldKey || !newKey || oldKey === newKey) return;
        /* Update template.merge array */
        if (template && Array.isArray(template.merge)) {
          template.merge.forEach(function (m) {
            if (m && String(m.find) === oldKey) m.find = newKey;
          });
        }
        /* Update _mergeDefaults */
        if (_mergeDefaults[oldKey] !== undefined) {
          _mergeDefaults[newKey] = _mergeDefaults[oldKey];
          _mergeDefaults[newKey.toUpperCase().replace(/\s+/g, '_')] = _mergeDefaults[oldKey];
          delete _mergeDefaults[oldKey];
          delete _mergeDefaults[oldKey.toUpperCase().replace(/\s+/g, '_')];
        }
        /* Propagate to all canvas objects on this template */
        if (canvas && canvas.getObjects) {
          var re = new RegExp('\\{\\{\\s*' + oldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}', 'g');
          canvas.getObjects().forEach(function (o) {
            /* Update cfsMergeKey on the object itself */
            if (o.cfsMergeKey === oldKey) o.set('cfsMergeKey', newKey);
            /* Update cfsRawText (the source-of-truth for text objects) */
            var raw = o.cfsRawText;
            if (raw && typeof raw === 'string' && re.test(raw)) {
              re.lastIndex = 0;
              var updated = raw.replace(re, '{{ ' + newKey + ' }}');
              o.set('cfsRawText', updated);
              o.set('text', updated);
            }
          });
          canvas.renderAll();
        }
        /* Transfer unlinked state if applicable */
        if (_unlinkedMergeFields[oldKey]) {
          _unlinkedMergeFields[newKey] = _unlinkedMergeFields[oldKey];
          delete _unlinkedMergeFields[oldKey];
        }
        pushUndo();
      }

      /** Display a brief toast notification in the editor. */
      function showEditorToast(message, durationMs) {
        durationMs = durationMs || 3000;
        var existing = document.querySelector('.gen-editor-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'gen-editor-toast';
        toast.textContent = message;
        (container || document.body).appendChild(toast);
        /* Trigger entrance animation */
        requestAnimationFrame(function () {
          toast.classList.add('gen-editor-toast-visible');
        });
        setTimeout(function () {
          toast.classList.remove('gen-editor-toast-visible');
          setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
        }, durationMs);
      }

      /** Handle merge field key rename on blur. Validates, checks collisions, propagates. */
      function handleMergeFieldBlur(oldKey, newRaw, obj) {
        var newKey = String(newRaw || '').toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
        if (!newKey) newKey = 'UNNAMED_VAR';
        if (newKey === oldKey) return oldKey;
        /* Check for global collision */
        var unique = generateUniqueMergeKey(newKey);
        if (unique !== newKey) {
          showEditorToast('Key "' + newKey + '" already exists — renamed to "' + unique + '"');
          newKey = unique;
        }
        renameMergeKeyGlobal(oldKey, newKey);
        refreshPropertyPanel();
        return newKey;
      }

      /* snapshotMergeState + restoreMergeState are now hoisted to the outer create() scope */

      function buildConvertToMergeUI(parentEl, objectRef, propName, currentValue, onConverted) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:3px;';
        var convertBtn = document.createElement('button');
        convertBtn.type = 'button';
        convertBtn.className = 'cfs-btn-secondary';
        convertBtn.textContent = 'Make merge field';
        convertBtn.style.cssText = 'font-size:10px;padding:2px 6px;';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'FIELD_NAME';
        nameInput.style.cssText = 'width:100px;font-size:10px;padding:2px 4px;border:1px solid var(--gen-border,#ccc);border-radius:3px;display:none;';
        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'cfs-btn-secondary';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.style.cssText = 'font-size:10px;padding:2px 6px;display:none;';
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'cfs-btn-secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'font-size:10px;padding:2px 6px;display:none;';
        convertBtn.addEventListener('click', function () {
          convertBtn.style.display = 'none';
          nameInput.style.display = '';
          confirmBtn.style.display = '';
          cancelBtn.style.display = '';
          var suggest = (objectRef.name || propName || 'FIELD').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
          nameInput.value = suggest;
          nameInput.focus();
          nameInput.select();
        });
        cancelBtn.addEventListener('click', function () {
          convertBtn.style.display = '';
          nameInput.style.display = 'none';
          confirmBtn.style.display = 'none';
          cancelBtn.style.display = 'none';
        });
        confirmBtn.addEventListener('click', function () {
          var key = nameInput.value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
          if (!key) { nameInput.focus(); return; }
          ensureMergeField(key, currentValue != null ? String(currentValue) : '');
          objectRef.set('cfsMergeKey', key);
          objectRef.set('name', objectRef.name || key);
          if (typeof onConverted === 'function') onConverted(key);
          refreshPropertyPanel();
        });
        wrap.appendChild(convertBtn);
        wrap.appendChild(nameInput);
        wrap.appendChild(confirmBtn);
        wrap.appendChild(cancelBtn);
        parentEl.appendChild(wrap);
      }
      function buildRemoveMergeUI(parentEl, mergeKey, objectRef, onRemoved) {
        var rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'cfs-btn-secondary';
        rmBtn.textContent = 'Remove merge field';
        rmBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-top:3px;color:#c00;';
        rmBtn.addEventListener('click', function () {
          removeMergeField(mergeKey);
          objectRef.set('cfsMergeKey', undefined);
          if (typeof onRemoved === 'function') onRemoved();
          refreshPropertyPanel();
        });
        parentEl.appendChild(rmBtn);
      }
      function addRow(label, value, onChange) {
        var row = document.createElement('div');
        row.className = 'gen-prop-group';
        var lab = document.createElement('label');
        lab.textContent = label;
        row.appendChild(lab);
        var input = document.createElement('input');
        input.type = typeof value === 'number' ? 'number' : 'text';
        input.className = 'gen-prop-input';
        input.value = value != null ? value : '';
        input.addEventListener('change', function () {
          var v = input.type === 'number' ? parseFloat(input.value, 10) : input.value;
          if (onChange) onChange(v);
          canvas.renderAll();
          refreshTimeline();
          saveStateDebounced();
        });
        row.appendChild(input);
        form.appendChild(row);
      }
      /** Add a prop row to a specific container (for grid layouts). Returns the input element. */
      function addRowTo(container, label, value, onChange) {
        var row = document.createElement('div');
        row.className = 'gen-prop-group';
        var lab = document.createElement('label');
        lab.textContent = label;
        row.appendChild(lab);
        var input = document.createElement('input');
        input.type = typeof value === 'number' ? 'number' : 'text';
        input.className = 'gen-prop-input';
        input.value = value != null ? value : '';
        input.addEventListener('change', function () {
          var v = input.type === 'number' ? parseFloat(input.value, 10) : input.value;
          if (onChange) onChange(v);
          canvas.renderAll();
          refreshTimeline();
          saveStateDebounced();
        });
        row.appendChild(input);
        container.appendChild(row);
        return input;
      }
      var objNameUpper = (obj.name || obj.id || '').toString().toUpperCase().replace(/\s+/g, '_');
      var linkedField = extension.inputSchema && extension.inputSchema.find(function (f) {
        var key = (f.mergeField || f.id || '').toString().toUpperCase().replace(/\s+/g, '_');
        return key && key === objNameUpper;
      });
      var cw = canvas.getWidth ? canvas.getWidth() : (canvas.width || 1080);
      var ch = canvas.getHeight ? canvas.getHeight() : (canvas.height || 1080);
      var minSide = Math.min(cw, ch);
      function syncResponsiveFromPixels() {
        if (!obj.cfsResponsive || !cw || !ch) return;
        obj.set('cfsLeftPct', (obj.left || 0) / cw);
        obj.set('cfsTopPct', (obj.top || 0) / ch);
        if (obj.width != null) obj.set('cfsWidthPct', obj.width / cw);
        if (obj.height != null && obj.type !== 'circle') obj.set('cfsHeightPct', obj.height / ch);
        if (obj.type === 'circle' && obj.radius != null) obj.set('cfsRadiusPct', obj.radius / minSide);
        if (obj.fontSize != null && minSide > 0) obj.set('cfsFontSizePct', obj.fontSize / minSide);
      }
      /* ── SECTION: LAYOUT & POSITION ── */
      var layoutLabel = document.createElement('div');
      layoutLabel.className = 'gen-prop-section-label';
      layoutLabel.textContent = 'Layout & Position';
      form.appendChild(layoutLabel);
      var segCtrl = document.createElement('div');
      segCtrl.className = 'gen-segmented-control';
      var posFixed = document.createElement('button');
      posFixed.type = 'button';
      posFixed.className = 'gen-segmented-btn' + (!obj.cfsResponsive ? ' active' : '');
      posFixed.textContent = 'Fixed';
      posFixed.title = 'Fixed pixels (left, top, width, height)';
      var posResp = document.createElement('button');
      posResp.type = 'button';
      posResp.className = 'gen-segmented-btn' + (obj.cfsResponsive ? ' active' : '');
      posResp.textContent = 'Responsive';
      posResp.title = 'Percent of canvas (resizes with canvas)';
      posFixed.addEventListener('click', function () {
        obj.set('cfsResponsive', false);
        refreshPropertyPanel();
        canvas.renderAll();
      });
      posResp.addEventListener('click', function () {
        syncResponsiveFromPixels();
        obj.set('cfsResponsive', true);
        refreshPropertyPanel();
        applyResponsivePositions(canvas);
      });
      segCtrl.appendChild(posFixed);
      segCtrl.appendChild(posResp);
      form.appendChild(segCtrl);
      if (!obj.cfsResponsive) {
        /* Fixed mode: use 2-column grid for Left/Top */
        var posGrid = document.createElement('div');
        posGrid.className = 'gen-prop-pair';
        addRowTo(posGrid, 'Left', Math.round(obj.left || 0), function (v) { obj.set('left', Number(v) || 0); if (obj.cfsRightPx != null) applyResponsivePositions(canvas); });
        addRowTo(posGrid, 'Top', Math.round(obj.top || 0), function (v) { obj.set('top', Number(v) || 0); if (obj.cfsBottomPx != null) applyResponsivePositions(canvas); });
        form.appendChild(posGrid);
        if (obj.type === 'rect' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'image' || obj.type === 'path') {
          var hasRight = obj.cfsRightPx != null;
          var dispWidth = hasRight ? Math.round(cw - (obj.left || 0) - Number(obj.cfsRightPx)) : Math.round((obj.width || 0) * (obj.scaleX || 1));
          var sizeGrid = document.createElement('div');
          sizeGrid.className = 'gen-prop-pair';
          addRowTo(sizeGrid, hasRight ? 'W (auto)' : 'Width', dispWidth, function (v) {
            if (hasRight) return;
            var s = obj.scaleX || 1;
            obj.set('width', (Number(v) || 0) / (s || 1));
            if (obj.scaleX) obj.set('scaleX', 1);
            obj.set('cfsRightPx', undefined);
          });
          addRowTo(sizeGrid, 'Right (px)', obj.cfsRightPx != null ? Math.round(Number(obj.cfsRightPx)) : '', function (v) {
            var val = (v === '' || v == null) ? undefined : Number(v);
            if (val == null || isNaN(val)) { obj.set('cfsRightPx', undefined); return; }
            obj.set('cfsRightPx', val);
            applyResponsivePositions(canvas);
            refreshPropertyPanel();
          });
          form.appendChild(sizeGrid);
          if (obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox') {
            var hasBottom = obj.cfsBottomPx != null;
            var dispHeight = hasBottom ? Math.round(ch - (obj.top || 0) - Number(obj.cfsBottomPx)) : Math.round((obj.height || 0) * (obj.scaleY || 1));
            var hGrid = document.createElement('div');
            hGrid.className = 'gen-prop-pair';
            addRowTo(hGrid, hasBottom ? 'H (auto)' : 'Height', dispHeight, function (v) {
              if (hasBottom) return;
              var s = obj.scaleY || 1;
              obj.set('height', (Number(v) || 0) / (s || 1));
              if (obj.scaleY) obj.set('scaleY', 1);
              obj.set('cfsBottomPx', undefined);
            });
            addRowTo(hGrid, 'Bottom (px)', obj.cfsBottomPx != null ? Math.round(Number(obj.cfsBottomPx)) : '', function (v) {
              var val = (v === '' || v == null) ? undefined : Number(v);
              if (val == null || isNaN(val)) { obj.set('cfsBottomPx', undefined); return; }
              obj.set('cfsBottomPx', val);
              applyResponsivePositions(canvas);
              refreshPropertyPanel();
            });
            form.appendChild(hGrid);
          }
        }
        if (obj.type === 'circle') addRow('Radius', Math.round(obj.radius || 0), function (v) { obj.set('radius', Number(v) || 0); });
      } else {
        /* Responsive mode: use 4-column quad grid for L%/T%/W%/OP% */
        var lPct = (obj.cfsLeftPct != null ? Number(obj.cfsLeftPct) * 100 : (cw ? ((obj.left || 0) / cw) * 100 : 0)).toFixed(1);
        var tPct = (obj.cfsTopPct != null ? Number(obj.cfsTopPct) * 100 : (ch ? ((obj.top || 0) / ch) * 100 : 0)).toFixed(1);
        var respQuad = document.createElement('div');
        respQuad.className = 'gen-prop-quad';
        addRowTo(respQuad, 'L %', lPct, function (v) { var p = (Number(v) || 0) / 100; obj.set('cfsLeftPct', p); obj.set('left', cw * p); });
        addRowTo(respQuad, 'T %', tPct, function (v) { var p = (Number(v) || 0) / 100; obj.set('cfsTopPct', p); obj.set('top', ch * p); });
        if (obj.type === 'rect' || obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'image' || obj.type === 'path') {
          var wPct = (obj.cfsWidthPct != null ? Number(obj.cfsWidthPct) * 100 : (cw && obj.width ? (obj.width / cw) * 100 : 0)).toFixed(1);
          addRowTo(respQuad, 'W %', wPct, function (v) { var p = (Number(v) || 0) / 100; obj.set('cfsWidthPct', p); obj.set('width', cw * p); });
          if (obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox') {
            var hPct = (obj.cfsHeightPct != null ? Number(obj.cfsHeightPct) * 100 : (ch && obj.height ? (obj.height / ch) * 100 : 0)).toFixed(1);
            addRowTo(respQuad, 'H %', hPct, function (v) { var p = (Number(v) || 0) / 100; obj.set('cfsHeightPct', p); obj.set('height', ch * p); });
          }
        }
        if (obj.type === 'circle') {
          var rPct = (obj.cfsRadiusPct != null ? Number(obj.cfsRadiusPct) * 100 : (minSide && obj.radius ? (obj.radius / minSide) * 100 : 0)).toFixed(1);
          addRowTo(respQuad, 'R %', rPct, function (v) { var p = (Number(v) || 0) / 100; obj.set('cfsRadiusPct', p); obj.set('radius', minSide * p); });
        }
        form.appendChild(respQuad);
      }
      /* Opacity - add to its own row or attach to the last grid */
      addRow('OP %', Math.round((obj.cfsClipOpacity != null ? obj.cfsClipOpacity : (obj.opacity != null ? obj.opacity : 1)) * 100), function (v) {
        var val = Math.max(0, Math.min(1, (Number(v) || 100) / 100));
        obj.set('opacity', val);
        obj.set('cfsClipOpacity', val);
      });
      if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
        /* ── SECTION: TEXT CONTENT ── */
        var textSectionLabel = document.createElement('div');
        textSectionLabel.className = 'gen-prop-section-label';
        textSectionLabel.textContent = 'Text Content';
        form.appendChild(textSectionLabel);
        var rawTextForPanel = (obj.cfsRawText != null ? String(obj.cfsRawText) : (typeof obj.get === 'function' && obj.get('cfsRawText') != null ? String(obj.get('cfsRawText')) : String(obj.text || '')));
        var _origTplText = getOriginalTemplateText(obj);
        var _currentText = rawTextForPanel;
        var _origPlaceholders = _origTplText ? extractPlaceholders(_origTplText) : [];
        var _currentPlaceholders = extractPlaceholders(_currentText);
        var _seen = {};
        var _allPlaceholders = [];
        _origPlaceholders.concat(_currentPlaceholders).forEach(function (pk) {
          if (!_seen[pk]) { _seen[pk] = true; _allPlaceholders.push(pk); }
        });
        _currentPlaceholders.forEach(function (pk) { ensureMergeField(pk, ''); });
        var _displayText = _currentText;
        /* Detect unlinked fields: keys in _unlinkedMergeFields that belong to this object */
        var _unlinkedForObj = [];
        Object.keys(_unlinkedMergeFields).forEach(function (uKey) {
          if (_allPlaceholders.indexOf(uKey) === -1) _unlinkedForObj.push(uKey);
        });
        var _hasAnyMergeContent = _allPlaceholders.length > 0 || _unlinkedForObj.length > 0;
        if (_hasAnyMergeContent) {
          /* ── SECTION: MERGE FIELD SETUP ── */
          var mergeSectionLabel = document.createElement('div');
          mergeSectionLabel.className = 'gen-prop-section-label';
          mergeSectionLabel.textContent = 'Merge Field Setup';
          form.appendChild(mergeSectionLabel);
          var tplSection = document.createElement('div');
          tplSection.className = 'gen-merge-fields-container';
          var tplLabel = document.createElement('div');
          tplLabel.className = 'gen-merge-tpl-label';
          tplLabel.textContent = 'Template text:';
          tplSection.appendChild(tplLabel);
          var tplCode = document.createElement('textarea');
          tplCode.className = 'gen-merge-tpl-code gen-merge-tpl-editable';
          tplCode.value = _displayText;
          tplCode.rows = Math.max(2, Math.min(6, (_displayText || '').split('\n').length));
          tplCode.spellcheck = false;
          tplCode.placeholder = 'Type text and {{ MERGE_FIELDS }} here…';
          tplCode.addEventListener('input', function () {
            var v = tplCode.value;
            var oldText = obj.cfsRawText || obj.text || '';
            var oldPlaceholders = extractPlaceholders(oldText);
            obj.set('cfsRawText', String(v != null ? v : ''));
            var newPlaceholders = extractPlaceholders(v);
            /* Two-way sync: auto-create cards for new {{ vars }} */
            newPlaceholders.forEach(function (pk) { ensureMergeField(pk, ''); });
            /* Mark removed placeholders as unlinked */
            oldPlaceholders.forEach(function (pk) {
              if (newPlaceholders.indexOf(pk) === -1) {
                _unlinkedMergeFields[pk] = { defaultValue: getMergeDefault(pk), lastValue: null };
              }
            });
            /* Clear unlinked for re-added */
            newPlaceholders.forEach(function (pk) {
              if (_unlinkedMergeFields[pk]) delete _unlinkedMergeFields[pk];
            });
            /* Resolve {{ VAR }} → values locally (use merge values, fallback to defaults, then key name) */
            var resolvedText = v;
            if (newPlaceholders.length > 0) {
              var mergeVals = buildMergeValuesForInject();
              resolvedText = v.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (match, key) {
                var val = mergeVals[key] !== undefined ? mergeVals[key] : mergeVals[key.toUpperCase().replace(/\s+/g, '_')];
                if (val !== undefined && val !== null && String(val) !== '') return String(val);
                var def = getMergeDefault(key);
                if (def !== undefined && def !== null && String(def) !== '') return String(def);
                return key; /* Use the key name itself as placeholder display text */
              });
            }
            obj.set('text', resolvedText);
            if (obj.type === 'textbox') forceWrapTextboxObject(canvas, obj);
            if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
            if (linkedField && typeof options.setValue === 'function') options.setValue(linkedField.id, v);
            canvas.requestRenderAll();
          });
          tplCode.addEventListener('change', function () {
            /* On blur: run full injectMergeData for non-text properties, then re-apply local resolution */
            if (coreScene && coreScene.injectMergeData && canvas) {
              coreScene.injectMergeData(canvas, buildMergeValuesForInject());
            }
            /* Re-apply our local resolution after injectMergeData (which may have overwritten obj.text) */
            var rawAfter = obj.cfsRawText || '';
            var phAfter = extractPlaceholders(rawAfter);
            if (phAfter.length > 0) {
              var mVals = buildMergeValuesForInject();
              var reResolved = rawAfter.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (m, k) {
                var v2 = mVals[k] !== undefined ? mVals[k] : mVals[k.toUpperCase().replace(/\s+/g, '_')];
                if (v2 !== undefined && v2 !== null && String(v2) !== '') return String(v2);
                var d2 = getMergeDefault(k);
                if (d2 !== undefined && d2 !== null && String(d2) !== '') return String(d2);
                return k;
              });
              obj.set('text', reResolved);
              if (obj.type === 'textbox') forceWrapTextboxObject(canvas, obj);
              canvas.requestRenderAll();
            }
            pushUndo();
            refreshPropertyPanel();
          });
          tplSection.appendChild(tplCode);
          var _mergeVals = buildMergeValuesForInject();
          /* ── Linked (active) merge field cards ── */
          _allPlaceholders.forEach(function (pk) {
            var fieldBlock = document.createElement('div');
            fieldBlock.className = 'gen-merge-field-block';
            /* Editable key header */
            var fieldHeader = document.createElement('div');
            fieldHeader.className = 'gen-merge-field-header';
            var braceL = document.createElement('span');
            braceL.className = 'gen-merge-brace';
            braceL.textContent = '{{';
            fieldHeader.appendChild(braceL);
            var keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.className = 'gen-merge-key-input';
            keyInput.value = pk;
            keyInput.title = 'Rename this merge key (changes propagate across all objects)';
            keyInput.addEventListener('blur', (function (oldKey, inputEl) { return function () {
              var newVal = inputEl.value.trim();
              var result = handleMergeFieldBlur(oldKey, newVal, obj);
              inputEl.value = result;
            }; })(pk, keyInput));
            keyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') keyInput.blur(); });
            fieldHeader.appendChild(keyInput);
            var braceR = document.createElement('span');
            braceR.className = 'gen-merge-brace';
            braceR.textContent = '}}';
            fieldHeader.appendChild(braceR);
            fieldBlock.appendChild(fieldHeader);
            /* Default row */
            var pkDefault = getMergeDefault(pk);
            var defRow = document.createElement('div');
            defRow.className = 'gen-merge-field-row';
            var defLabel = document.createElement('span');
            defLabel.className = 'gen-merge-field-row-label';
            defLabel.textContent = 'Default:';
            defRow.appendChild(defLabel);
            var defInput = document.createElement('input');
            defInput.type = 'text';
            defInput.className = 'gen-merge-field-input';
            defInput.value = pkDefault != null ? String(pkDefault) : '';
            defInput.placeholder = pk;
            defInput.addEventListener('change', (function (mergeKey) { return function () {
              setMergeDefault(mergeKey, defInput.value);
              pushUndo();
            }; })(pk));
            defRow.appendChild(defInput);
            fieldBlock.appendChild(defRow);
            /* Value row */
            var curVal = _mergeVals[pk] !== undefined ? _mergeVals[pk] : _mergeVals[pk.toUpperCase().replace(/\s+/g, '_')];
            var isColorField = /COLOR|COLOUR/i.test(pk) && !/COLORADO/i.test(pk);
            var valRow = document.createElement('div');
            valRow.className = 'gen-merge-field-row';
            var valLabel = document.createElement('span');
            valLabel.className = 'gen-merge-field-row-label';
            valLabel.textContent = 'Value:';
            valRow.appendChild(valLabel);
            if (isColorField) {
              var colorPicker = document.createElement('input');
              colorPicker.type = 'color';
              colorPicker.className = 'gen-merge-color-swatch';
              var cv = (curVal && typeof curVal === 'string' && curVal.indexOf('#') === 0) ? curVal : (pkDefault && String(pkDefault).indexOf('#') === 0 ? String(pkDefault) : '#000000');
              colorPicker.value = cv;
              colorPicker.addEventListener('change', (function (mergeKey) { return function () {
                var v = colorPicker.value;
                if (typeof options.setValue === 'function') options.setValue(mergeKey, v);
                var sf = extension.inputSchema && extension.inputSchema.find(function (f) {
                  return (f.mergeField || f.id || '').toUpperCase().replace(/\s+/g, '_') === mergeKey.toUpperCase().replace(/\s+/g, '_');
                });
                if (sf && typeof options.setValue === 'function') options.setValue(sf.id, v);
                if (coreScene && coreScene.injectMergeData && canvas) {
                  var vals = buildMergeValuesForInject();
                  vals[mergeKey] = v;
                  vals[mergeKey.toUpperCase().replace(/\s+/g, '_')] = v;
                  coreScene.injectMergeData(canvas, vals);
                  canvas.renderAll();
                }
              }; })(pk));
              valRow.appendChild(colorPicker);
            }
            var valInput = document.createElement('input');
            valInput.type = 'text';
            valInput.className = 'gen-merge-field-input';
            valInput.value = curVal != null ? String(curVal) : '';
            valInput.placeholder = pkDefault != null ? String(pkDefault) : pk;
            valInput.addEventListener('change', (function (mergeKey) { return function () {
              var v = valInput.value;
              if (typeof options.setValue === 'function') options.setValue(mergeKey, v);
              var schemaField = extension.inputSchema && extension.inputSchema.find(function (f) {
                return (f.mergeField || f.id || '').toUpperCase().replace(/\s+/g, '_') === mergeKey.toUpperCase().replace(/\s+/g, '_');
              });
              if (schemaField && typeof options.setValue === 'function') options.setValue(schemaField.id, v);
              if (coreScene && coreScene.injectMergeData && canvas) {
                var vals = buildMergeValuesForInject();
                vals[mergeKey] = v;
                vals[mergeKey.toUpperCase().replace(/\s+/g, '_')] = v;
                coreScene.injectMergeData(canvas, vals);
                canvas.renderAll();
              }
            }; })(pk));
            valRow.appendChild(valInput);
            fieldBlock.appendChild(valRow);
            tplSection.appendChild(fieldBlock);
          });
          /* ── Unlinked merge field cards (red) ── */
          _unlinkedForObj.forEach(function (uKey) {
            var uData = _unlinkedMergeFields[uKey] || {};
            var uBlock = document.createElement('div');
            uBlock.className = 'gen-merge-field-block gen-merge-field-unlinked';
            /* Unlinked header */
            var uHeader = document.createElement('div');
            uHeader.className = 'gen-merge-unlinked-bar';
            var uLabel = document.createElement('span');
            uLabel.className = 'gen-merge-unlinked-label';
            uLabel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Unlinked';
            uHeader.appendChild(uLabel);
            var uActions = document.createElement('div');
            uActions.className = 'gen-merge-unlinked-actions';
            var addBackBtn = document.createElement('button');
            addBackBtn.type = 'button';
            addBackBtn.className = 'gen-merge-addback';
            addBackBtn.textContent = 'Add Back';
            addBackBtn.addEventListener('click', (function (key) { return function () {
              /* Re-insert {{ KEY }} at end of text */
              var rawText = obj.cfsRawText || obj.text || '';
              var updated = rawText + ' {{ ' + key + ' }}';
              obj.set('cfsRawText', updated);
              obj.set('text', updated);
              delete _unlinkedMergeFields[key];
              ensureMergeField(key, '');
              pushUndo();
              if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
              canvas.renderAll();
              refreshPropertyPanel();
            }; })(uKey));
            uActions.appendChild(addBackBtn);
            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'gen-merge-delete-mf';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (function (key) { return function () {
              removeMergeField(key);
              delete _unlinkedMergeFields[key];
              pushUndo();
              refreshPropertyPanel();
            }; })(uKey));
            uActions.appendChild(deleteBtn);
            uHeader.appendChild(uActions);
            uBlock.appendChild(uHeader);
            /* Key badge (read-only for unlinked) */
            var uKeyLabel = document.createElement('div');
            uKeyLabel.className = 'gen-merge-field-header';
            uKeyLabel.innerHTML = '<span class="gen-merge-brace">{{</span><code class="gen-merge-field-key-badge">' + uKey + '</code><span class="gen-merge-brace">}}</span>';
            uBlock.appendChild(uKeyLabel);
            /* Show stored default if any */
            if (uData.defaultValue) {
              var uDefRow = document.createElement('div');
              uDefRow.className = 'gen-merge-field-row';
              var uDefLabel = document.createElement('span');
              uDefLabel.className = 'gen-merge-field-row-label';
              uDefLabel.textContent = 'Default:';
              uDefRow.appendChild(uDefLabel);
              var uDefVal = document.createElement('span');
              uDefVal.className = 'gen-merge-field-hex';
              uDefVal.textContent = uData.defaultValue;
              uDefRow.appendChild(uDefVal);
              uBlock.appendChild(uDefRow);
            }
            tplSection.appendChild(uBlock);
          });
          form.appendChild(tplSection);
        }
        if (!_hasAnyMergeContent) {
          /* Plain text (no merge fields) — show simple text row */
          addRow('Text', rawTextForPanel, function (v) {
            obj.set('cfsRawText', String(v != null ? v : ''));
            obj.set('text', v);
            var newPlaceholders = extractPlaceholders(v);
            newPlaceholders.forEach(function (pk) { ensureMergeField(pk, ''); });
            if (obj.type === 'textbox') forceWrapTextboxObject(canvas, obj);
            if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
            if (linkedField && typeof options.setValue === 'function') options.setValue(linkedField.id, v);
            canvas.requestRenderAll();
            pushUndo();
            refreshPropertyPanel();
          });
        }
        /* ── SECTION: TYPOGRAPHY ── */
        var typoSectionLabel = document.createElement('div');
        typoSectionLabel.className = 'gen-prop-section-label';
        typoSectionLabel.textContent = 'Typography';
        form.appendChild(typoSectionLabel);
        /* Font Family + Weight in a 2-column grid */
        var fontPair = document.createElement('div');
        fontPair.className = 'gen-prop-pair';
        (function () {
          var ffRow = document.createElement('div');
          ffRow.className = 'gen-prop-group';
          ffRow.innerHTML = '<label>Font Family</label>';
          var ffInput = document.createElement('input');
          ffInput.type = 'text';
          ffInput.className = 'gen-prop-input';
          ffInput.value = obj.fontFamily || 'sans-serif';
          ffInput.addEventListener('change', function () {
            obj.set('fontFamily', ffInput.value || 'sans-serif');
            if (obj.type === 'textbox') { forceWrapTextboxObject(canvas, obj); if (typeof obj.initDimensions === 'function') obj.initDimensions(); }
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          ffRow.appendChild(ffInput);
          fontPair.appendChild(ffRow);
        })();
        (function () {
          var fwRow = document.createElement('div');
          fwRow.className = 'gen-prop-group';
          fwRow.innerHTML = '<label>Weight</label><select class="gen-prop-input"><option value="normal">Normal</option><option value="bold">Bold</option><option value="100">100</option><option value="200">200</option><option value="300">300</option><option value="400">400</option><option value="500">500</option><option value="600">600</option><option value="700">700</option><option value="800">800</option><option value="900">900</option></select>';
          var fwSel = fwRow.querySelector('select');
          fwSel.value = obj.fontWeight || 'normal';
          fwSel.addEventListener('change', function () { obj.set('fontWeight', fwSel.value); canvas.requestRenderAll(); saveStateDebounced(); });
          fontPair.appendChild(fwRow);
        })();
        form.appendChild(fontPair);
        /* Size + Line Height in a 2-column grid */
        var sizePair = document.createElement('div');
        sizePair.className = 'gen-prop-pair';
        addRowTo(sizePair, 'Size', obj.fontSize || 24, function (v) {
          var newSize = Number(v) || 24;
          obj.set('fontSize', newSize);
          if (minSide > 0) obj.set('cfsFontSizePct', newSize / minSide);
          if (obj.type === 'textbox') {
            forceWrapTextboxObject(canvas, obj);
            if (typeof obj.initDimensions === 'function') obj.initDimensions();
          }
          canvas.requestRenderAll();
          if (obj.type === 'textbox') refreshPropertyPanel();
        });
        addRowTo(sizePair, 'Line Height', obj.cfsLineHeight != null ? obj.cfsLineHeight : '', function (v) {
          var n = v === '' ? undefined : Number(v);
          obj.set('cfsLineHeight', n);
          if (n != null) obj.set('lineHeight', n);
          if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
          canvas.requestRenderAll();
        });
        form.appendChild(sizePair);
        addRow('Letter spacing', obj.cfsLetterSpacing != null ? obj.cfsLetterSpacing : '', function (v) {
          var n = v === '' ? undefined : Number(v);
          obj.set('cfsLetterSpacing', n);
          obj.set('charSpacing', n != null ? Math.round(n * 10) : 0);
          if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') obj.initDimensions();
          canvas.requestRenderAll();
        });
        /* Transform + Decoration in a 2-column grid */
        var textStylePair = document.createElement('div');
        textStylePair.className = 'gen-prop-pair';
        (function () {
          var txRow = document.createElement('div');
          txRow.className = 'gen-prop-group';
          txRow.innerHTML = '<label>Transform</label><select class="gen-prop-input"><option value="">None</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option><option value="capitalize">Capitalize</option></select>';
          var txSel = txRow.querySelector('select');
          txSel.value = obj.cfsTextTransform || '';
          txSel.addEventListener('change', function () {
            obj.set('cfsTextTransform', txSel.value || undefined);
            applyTextTransformVisual(obj);
            canvas.requestRenderAll();
            saveStateDebounced();
            refreshPropertyPanel();
          });
          textStylePair.appendChild(txRow);
        })();
        (function () {
          var tdRow = document.createElement('div');
          tdRow.className = 'gen-prop-group';
          tdRow.innerHTML = '<label>Decoration</label><select class="gen-prop-input"><option value="">None</option><option value="underline">Underline</option><option value="line-through">Line-through</option></select>';
          var tdSel = tdRow.querySelector('select');
          tdSel.value = obj.cfsTextDecoration || '';
          tdSel.addEventListener('change', function () {
            obj.set('cfsTextDecoration', tdSel.value || undefined);
            obj.set('underline', tdSel.value === 'underline');
            obj.set('linethrough', tdSel.value === 'line-through');
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          textStylePair.appendChild(tdRow);
        })();
        form.appendChild(textStylePair);
        /* Align H + Align V in a 2-column grid */
        var alignPair = document.createElement('div');
        alignPair.className = 'gen-prop-pair';
        (function () {
          var ahRow = document.createElement('div');
          ahRow.className = 'gen-prop-group';
          ahRow.innerHTML = '<label>Align H</label><select class="gen-prop-input"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option></select>';
          var ahSel = ahRow.querySelector('select');
          ahSel.value = obj.cfsAlignHorizontal || obj.textAlign || 'left';
          ahSel.addEventListener('change', function () {
            obj.set('cfsAlignHorizontal', ahSel.value);
            obj.set('textAlign', ahSel.value);
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          alignPair.appendChild(ahRow);
        })();
        (function () {
          var avRow = document.createElement('div');
          avRow.className = 'gen-prop-group';
          avRow.innerHTML = '<label>Align V</label><select class="gen-prop-input"><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select>';
          var avSel = avRow.querySelector('select');
          avSel.value = obj.cfsAlignVertical || 'top';
          avSel.addEventListener('change', function () { obj.set('cfsAlignVertical', avSel.value); canvas.requestRenderAll(); saveStateDebounced(); });
          alignPair.appendChild(avRow);
        })();
        form.appendChild(alignPair);
        (function () {
          var tbgRow = document.createElement('div');
          tbgRow.className = 'gen-prop-group';
          tbgRow.innerHTML = '<label>Background</label><div class="gen-color-pair"><input type="color" class="gen-color-swatch"><button type="button" class="gen-tool-icon-btn" title="Clear" style="width:28px;height:28px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
          var tbgInput = tbgRow.querySelector('input[type="color"]');
          var tbgClear = tbgRow.querySelector('button');
          var curBg = obj.cfsTextBackground || obj.backgroundColor || '';
          tbgInput.value = (curBg && curBg.indexOf('#') === 0) ? curBg : '#ffffff';
          tbgInput.addEventListener('change', function () {
            obj.set('cfsTextBackground', tbgInput.value);
            obj.set('backgroundColor', tbgInput.value);
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          tbgClear.addEventListener('click', function () {
            obj.set('cfsTextBackground', undefined);
            obj.set('backgroundColor', '');
            canvas.requestRenderAll();
            saveStateDebounced();
            refreshPropertyPanel();
          });
          form.appendChild(tbgRow);
        })();
        var wrapRow = document.createElement('div');
        wrapRow.className = 'gen-prop-group';
        wrapRow.innerHTML = '<label>Wrap Text</label><div style="display:flex;align-items:center;gap:6px;"><input type="checkbox" class="cfs-prop-wrap" style="width:auto;accent-color:var(--gen-accent);"><span style="font-size:11px;color:var(--gen-text-secondary);">Enable word wrap</span></div>';
        var wrapInput = wrapRow.querySelector('input.cfs-prop-wrap');
        if (wrapInput) {
          var isWrap = obj.cfsWrapText !== false;
          wrapInput.checked = isWrap;
          wrapInput.addEventListener('change', function () {
            var wantWrap = wrapInput.checked;
            var objs = canvas.getObjects();
            var idx = objs.indexOf(obj);
            if (idx < 0) return;
            var left = obj.left || 0;
            var top = obj.top || 0;
            var text = (obj.text || '').toString();
            var fontSize = obj.fontSize || 24;
            var fontFamily = obj.fontFamily || 'sans-serif';
            var fill = obj.fill || '#000000';
            var fontWeight = obj.fontWeight || 'normal';
            var name = obj.name || obj.id;
            var cfsStart = obj.cfsStart;
            var cfsLength = obj.cfsLength;
            var cfsTrackIndex = obj.cfsTrackIndex;
            var cfsRightPx = obj.cfsRightPx;
            var cw = canvas.getWidth ? canvas.getWidth() : 1080;
            var newObj;
            if (wantWrap) {
              var w;
              if (obj.type === 'textbox') {
                w = obj.width != null && obj.width > 0 ? obj.width : Math.max(200, cw - left - 80);
              } else {
                w = Math.min(500, Math.max(200, cw - left - 80));
              }
              if (cfsRightPx != null) w = Math.max(0, cw - left - Number(cfsRightPx));
              if (w <= 0) w = 200;
              var tbOpts = { left: left, top: top, width: w, fontSize: fontSize, fontFamily: fontFamily, fill: fill, fontWeight: fontWeight, textBaseline: 'alphabetic' };
              if (cfsRightPx != null) {
                tbOpts.minWidth = w;
                tbOpts.maxWidth = w;
              } else {
                tbOpts.minWidth = 50;
                tbOpts.maxWidth = Math.max(w, cw - left - 20);
              }
              newObj = new fabric.Textbox(text, tbOpts);
              newObj.set('cfsRawText', obj.cfsRawText != null ? String(obj.cfsRawText) : text);
            } else {
              newObj = new fabric.Text(text, { left: left, top: top, fontSize: fontSize, fontFamily: fontFamily, fill: fill, fontWeight: fontWeight, textBaseline: 'alphabetic' });
            }
            newObj.set('name', name);
            newObj.set('cfsStart', cfsStart);
            newObj.set('cfsLength', cfsLength);
            if (cfsTrackIndex != null) newObj.set('cfsTrackIndex', cfsTrackIndex);
            newObj.set('cfsWrapText', wantWrap);
            if (wantWrap && cfsRightPx != null) newObj.set('cfsRightPx', cfsRightPx);
            ['cfsAnimation', 'cfsOriginalClip', 'cfsClipOpacity', 'cfsLengthWasEnd', 'cfsResponsive', 'cfsLeftPct', 'cfsTopPct', 'cfsWidthPct', 'cfsHeightPct', 'cfsFontSizePct', 'cfsRadiusPct', 'cfsMergeKey', 'cfsAlignHorizontal', 'cfsAlignVertical', 'cfsLineHeight', 'cfsLetterSpacing', 'cfsTextTransform', 'cfsTextDecoration', 'cfsGradient', 'cfsStroke', 'cfsShadow', 'cfsFilter', 'cfsMaxHeightPx', 'cfsBottomPx', 'cfsFadeIn', 'cfsFadeOut', 'cfsOpacityTween', 'cfsOffsetTween', 'cfsRotateTween', 'cfsLengthAuto', 'cfsTextBackground'].forEach(function (k) {
              if (obj[k] != null) newObj.set(k, obj[k]);
            });
            canvas.remove(obj);
            insertObjectAtCanvas(canvas, newObj, idx);
            canvas.setActiveObject(newObj);
            fixTextBaseline(canvas);
            if (wantWrap && newObj) {
              if (typeof newObj.initDimensions === 'function') newObj.initDimensions();
              canvas.requestRenderAll();
              var tb = newObj;
              setTimeout(function () {
                if (tb && typeof tb.initDimensions === 'function') tb.initDimensions();
                if (canvas && canvas.requestRenderAll) canvas.requestRenderAll();
                refreshLayersPanel();
                refreshPropertyPanel();
              }, 0);
            }
            pushUndo();
            refreshLayersPanel();
            refreshPropertyPanel();
            canvas.requestRenderAll();
          });
        }
        form.appendChild(wrapRow);
        if (obj.type === 'textbox') {
          var textHint = document.createElement('div');
          textHint.className = 'cfs-prop-hint';
          textHint.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);margin-top:4px;';
          textHint.textContent = 'Lines break automatically when text is too long for the box width. Resize by dragging the edges; double-click to edit. Press Enter for a manual line break.';
          form.appendChild(textHint);
        }
        /* ── SECTION: TEXT ENTRANCE ANIMATION ── */
        var animSectionLabel = document.createElement('div');
        animSectionLabel.className = 'gen-prop-section-label';
        animSectionLabel.textContent = 'Text Entrance Animation';
        form.appendChild(animSectionLabel);
        var animPresets = ['none', 'fadeIn', 'typewriter', 'slideIn', 'ascend', 'shift'];
        var animRow = document.createElement('div');
        animRow.className = 'gen-prop-group';
        animRow.innerHTML = '<label>Preset</label><select class="gen-prop-input cfs-prop-anim-preset"></select>';
        var animPresetSel = animRow.querySelector('select.cfs-prop-anim-preset');
        if (animPresetSel) {
          animPresets.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p === 'none' ? 'None' : (p.charAt(0).toUpperCase() + p.slice(1));
            animPresetSel.appendChild(opt);
          });
          var anim = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
          anim = anim && typeof anim === 'object' ? anim : {};
          animPresetSel.value = (anim.preset && anim.preset !== 'none') ? anim.preset : 'none';
          animPresetSel.addEventListener('change', function () {
            var preset = animPresetSel.value;
            if (preset === 'none') { obj.set('cfsAnimation', null); } else { var a = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation; a = (a && typeof a === 'object') ? { preset: preset, duration: a.duration, style: a.style, direction: a.direction } : { preset: preset }; obj.set('cfsAnimation', a); extendClipLengthForAnimation(obj); }
            canvas.renderAll();
            saveStateDebounced();
          });
        }
        form.appendChild(animRow);
        /* Duration (s) + Style in a 2-column grid */
        var animPair = document.createElement('div');
        animPair.className = 'gen-prop-pair';
        var animDurationRow = document.createElement('div');
        animDurationRow.className = 'gen-prop-group';
        animDurationRow.innerHTML = '<label>Duration (s)</label><input type="number" class="gen-prop-input cfs-prop-anim-duration" min="0" step="0.5" placeholder="clip">';
        var animDurationInput = animDurationRow.querySelector('input.cfs-prop-anim-duration');
        if (animDurationInput) {
          var animDur = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
          animDurationInput.value = (animDur && animDur.duration != null) ? animDur.duration : '';
          animDurationInput.placeholder = 'clip length';
          animDurationInput.addEventListener('change', function () {
            var val = animDurationInput.value.trim();
            var a = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
            if (!a || typeof a !== 'object') a = { preset: 'fadeIn' };
            a.duration = val === '' ? undefined : Number(val);
            obj.set('cfsAnimation', a);
            extendClipLengthForAnimation(obj);
            canvas.renderAll();
            saveStateDebounced();
          });
        }
        animPair.appendChild(animDurationRow);
        var animStyleRow = document.createElement('div');
        animStyleRow.className = 'gen-prop-group';
        animStyleRow.innerHTML = '<label>Style</label><select class="gen-prop-input cfs-prop-anim-style"><option value="">Default</option><option value="character">Character</option><option value="word">Word</option><option value="full">Full</option></select>';
        var animStyleSel = animStyleRow.querySelector('select.cfs-prop-anim-style');
        if (animStyleSel) {
          var a2 = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
          animStyleSel.value = (a2 && a2.style) ? a2.style : '';
          animStyleSel.addEventListener('change', function () {
            var a = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
            if (!a || typeof a !== 'object') a = { preset: 'fadeIn' };
            a.style = animStyleSel.value || undefined;
            obj.set('cfsAnimation', a);
            canvas.renderAll();
            saveStateDebounced();
          });
        }
        animPair.appendChild(animStyleRow);
        form.appendChild(animPair);
        var animDirRow = document.createElement('div');
        animDirRow.className = 'gen-prop-group';
        animDirRow.innerHTML = '<label>Direction</label><select class="gen-prop-input cfs-prop-anim-direction"><option value="">Default</option><option value="left">Left</option><option value="right">Right</option><option value="up">Up</option><option value="down">Down</option></select>';
        var animDirSel = animDirRow.querySelector('select.cfs-prop-anim-direction');
        if (animDirSel) {
          var a3 = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
          animDirSel.value = (a3 && a3.direction) ? a3.direction : '';
          animDirSel.addEventListener('change', function () {
            var a = obj.get ? obj.get('cfsAnimation') : obj.cfsAnimation;
            if (!a || typeof a !== 'object') a = { preset: 'fadeIn' };
            a.direction = animDirSel.value || undefined;
            obj.set('cfsAnimation', a);
            canvas.renderAll();
            saveStateDebounced();
          });
        }
        form.appendChild(animDirRow);
        var fillRow = document.createElement('div');
        fillRow.className = 'gen-merge-field-block';
        fillRow.style.cssText = '';
        var _textFillMergeKey = obj.cfsMergeKey || (typeof obj.get === 'function' ? obj.get('cfsMergeKey') : null);
        if (!_textFillMergeKey && obj.name && getMergeDefault(obj.name) !== undefined) _textFillMergeKey = obj.name;
        if (_textFillMergeKey) {
          var tfLabelRow = document.createElement('div');
          tfLabelRow.className = 'gen-merge-field-header';
          tfLabelRow.innerHTML = 'Fill <span class="gen-merge-brace">{{</span><code class="gen-merge-field-key-badge">' + _textFillMergeKey + '</code><span class="gen-merge-brace">}}</span>';
          fillRow.appendChild(tfLabelRow);
          var tfDef = getMergeDefault(_textFillMergeKey);
          var tfDefRow = document.createElement('div');
          tfDefRow.className = 'gen-merge-field-row';
          var tfDefLabel = document.createElement('span');
          tfDefLabel.className = 'gen-merge-field-row-label';
          tfDefLabel.textContent = 'Default:';
          tfDefRow.appendChild(tfDefLabel);
          var tfDefPicker = document.createElement('input');
          tfDefPicker.type = 'color';
          tfDefPicker.className = 'gen-merge-color-swatch';
          var tfDefHex = (tfDef && String(tfDef).indexOf('#') === 0) ? String(tfDef) : '#000000';
          tfDefPicker.value = tfDefHex;
          tfDefPicker.addEventListener('change', (function (mk) { return function () {
            setMergeDefault(mk, tfDefPicker.value);
          }; })(_textFillMergeKey));
          tfDefRow.appendChild(tfDefPicker);
          var tfDefCode = document.createElement('span');
          tfDefCode.className = 'gen-merge-field-hex';
          tfDefCode.textContent = tfDefHex;
          tfDefPicker.addEventListener('input', function () { tfDefCode.textContent = tfDefPicker.value; });
          tfDefRow.appendChild(tfDefCode);
          fillRow.appendChild(tfDefRow);
          var tfValRow = document.createElement('div');
          tfValRow.className = 'gen-merge-field-row';
          var tfLabel = document.createElement('span');
          tfLabel.className = 'gen-merge-field-row-label';
          tfLabel.textContent = 'Value:';
          tfValRow.appendChild(tfLabel);
          var tfPicker = document.createElement('input');
          tfPicker.type = 'color';
          tfPicker.className = 'gen-merge-color-swatch';
          var tfFill = obj.fill || (tfDef && String(tfDef).indexOf('#') === 0 ? tfDef : '#000000');
          tfPicker.value = typeof tfFill === 'string' && tfFill.indexOf('#') === 0 ? tfFill : '#000000';
          tfPicker.addEventListener('change', function () {
            obj.set('fill', tfPicker.value);
            if (typeof options.setValue === 'function') options.setValue(_textFillMergeKey, tfPicker.value);
            if (coreScene && coreScene.injectMergeData && canvas) {
              var vals = buildMergeValuesForInject();
              vals[_textFillMergeKey] = tfPicker.value;
              coreScene.injectMergeData(canvas, vals);
            }
            canvas.renderAll();
            saveStateDebounced();
          });
          tfValRow.appendChild(tfPicker);
          fillRow.appendChild(tfValRow);
          buildRemoveMergeUI(fillRow, _textFillMergeKey, obj);
        } else {
          fillRow.innerHTML = '<label>Fill: </label><input type="color" class="cfs-prop-fill" style="width:40px;height:24px;padding:0;">';
          var fillInput = fillRow.querySelector('input.cfs-prop-fill');
          if (fillInput) {
            var fillVal = obj.fill || '#000000';
            fillInput.value = typeof fillVal === 'string' && fillVal.indexOf('#') === 0 ? fillVal : '#000000';
            fillInput.addEventListener('change', function () { obj.set('fill', fillInput.value); canvas.renderAll(); saveStateDebounced(); });
          }
          buildConvertToMergeUI(fillRow, obj, 'FILL', obj.fill || '#000000');
        }
        form.appendChild(fillRow);
        (function () {
          /* ── SECTION: STROKE ── */
          var stLabel = document.createElement('div');
          stLabel.className = 'gen-prop-section-label';
          stLabel.textContent = 'Stroke';
          form.appendChild(stLabel);
          var curStroke = obj.cfsStroke && typeof obj.cfsStroke === 'object' ? obj.cfsStroke : {};
          addRow('Stroke width', curStroke.width != null ? curStroke.width : '', function (v) {
            var st = obj.cfsStroke && typeof obj.cfsStroke === 'object' ? Object.assign({}, obj.cfsStroke) : {};
            var n = v === '' ? undefined : Number(v);
            if (n == null || isNaN(n) || n <= 0) { st.width = undefined; } else { st.width = n; }
            obj.set('cfsStroke', Object.keys(st).some(function (k) { return st[k] != null; }) ? st : undefined);
            applyCfsStrokeVisual(obj);
            canvas.requestRenderAll();
          });
          var stcRow = document.createElement('div');
          stcRow.className = 'gen-prop-group';
          stcRow.innerHTML = '<label>Stroke color</label><input type="color" class="gen-color-swatch">';
          var stcInput = stcRow.querySelector('input[type="color"]');
          stcInput.value = (curStroke.color && curStroke.color.indexOf('#') === 0) ? curStroke.color : '#000000';
          stcInput.addEventListener('change', function () {
            var st = obj.cfsStroke && typeof obj.cfsStroke === 'object' ? Object.assign({}, obj.cfsStroke) : {};
            st.color = stcInput.value;
            obj.set('cfsStroke', st);
            applyCfsStrokeVisual(obj);
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          form.appendChild(stcRow);
        })();
        (function () {
          /* ── SECTION: SHADOW ── */
          var shLabel = document.createElement('div');
          shLabel.className = 'gen-prop-section-label';
          shLabel.textContent = 'Shadow';
          form.appendChild(shLabel);
          var curShadow = obj.cfsShadow && typeof obj.cfsShadow === 'object' ? obj.cfsShadow : {};
          addRow('Shadow X', curShadow.offsetX != null ? curShadow.offsetX : '', function (v) {
            var sh = obj.cfsShadow && typeof obj.cfsShadow === 'object' ? Object.assign({}, obj.cfsShadow) : {};
            sh.offsetX = v === '' ? undefined : Number(v);
            obj.set('cfsShadow', Object.keys(sh).some(function (k) { return sh[k] != null; }) ? sh : undefined);
            applyCfsShadowVisual(obj);
            canvas.requestRenderAll();
          });
          addRow('Shadow Y', curShadow.offsetY != null ? curShadow.offsetY : '', function (v) {
            var sh = obj.cfsShadow && typeof obj.cfsShadow === 'object' ? Object.assign({}, obj.cfsShadow) : {};
            sh.offsetY = v === '' ? undefined : Number(v);
            obj.set('cfsShadow', Object.keys(sh).some(function (k) { return sh[k] != null; }) ? sh : undefined);
            applyCfsShadowVisual(obj);
            canvas.requestRenderAll();
          });
          addRow('Shadow blur', curShadow.blur != null ? curShadow.blur : '', function (v) {
            var sh = obj.cfsShadow && typeof obj.cfsShadow === 'object' ? Object.assign({}, obj.cfsShadow) : {};
            sh.blur = v === '' ? undefined : Number(v);
            obj.set('cfsShadow', Object.keys(sh).some(function (k) { return sh[k] != null; }) ? sh : undefined);
            applyCfsShadowVisual(obj);
            canvas.requestRenderAll();
          });
          var shcRow = document.createElement('div');
          shcRow.className = 'gen-prop-group';
          shcRow.innerHTML = '<label>Shadow color</label><input type="color" class="gen-color-swatch">';
          var shcInput = shcRow.querySelector('input[type="color"]');
          shcInput.value = (curShadow.color && curShadow.color.indexOf('#') === 0) ? curShadow.color : '#000000';
          shcInput.addEventListener('change', function () {
            var sh = obj.cfsShadow && typeof obj.cfsShadow === 'object' ? Object.assign({}, obj.cfsShadow) : {};
            sh.color = shcInput.value;
            obj.set('cfsShadow', sh);
            applyCfsShadowVisual(obj);
            canvas.requestRenderAll();
            saveStateDebounced();
          });
          form.appendChild(shcRow);
        })();
      }
      if (obj.type === 'rect' || obj.type === 'path' || obj.type === 'circle') {
        var _shapeMergeKey = obj.cfsMergeKey || (typeof obj.get === 'function' ? obj.get('cfsMergeKey') : null)
          || ((obj.name && getMergeDefault(obj.name) !== undefined) ? obj.name : null);
        var _shapeOrigFill = null;
        if (_shapeMergeKey) {
          var origClipShape = obj.cfsOriginalClip || (typeof obj.get === 'function' ? obj.get('cfsOriginalClip') : null);
          if (origClipShape && origClipShape.asset && origClipShape.asset.fill) {
            var fc = origClipShape.asset.fill;
            _shapeOrigFill = (typeof fc === 'object' && fc.color) ? fc.color : (typeof fc === 'string' ? fc : null);
          }
        }
        var shapeFillRow = document.createElement('div');
        shapeFillRow.className = 'cfs-prop-row';
        if (_shapeMergeKey) {
          shapeFillRow.style.cssText = 'flex-direction:column;gap:4px;';
          var sfLabel = document.createElement('div');
          sfLabel.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);';
          sfLabel.innerHTML = 'Fill <code style="background:var(--gen-surface,#f3f3f3);padding:1px 4px;border-radius:3px;font-size:11px;">{{' + _shapeMergeKey + '}}</code>';
          shapeFillRow.appendChild(sfLabel);
          var sfDefault = getMergeDefault(_shapeMergeKey);
          var sfDefRow = document.createElement('div');
          sfDefRow.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;';
          var sfDefLabel = document.createElement('span');
          sfDefLabel.style.cssText = 'color:var(--gen-muted,#888);';
          sfDefLabel.textContent = 'Default:';
          sfDefRow.appendChild(sfDefLabel);
          var sfDefPicker = document.createElement('input');
          sfDefPicker.type = 'color';
          sfDefPicker.style.cssText = 'width:28px;height:18px;padding:0;border:0;background:none;';
          var sfDefHex = (sfDefault && String(sfDefault).indexOf('#') === 0) ? String(sfDefault) : '#6366f1';
          sfDefPicker.value = sfDefHex;
          sfDefPicker.addEventListener('change', (function (mk) { return function () {
            setMergeDefault(mk, sfDefPicker.value);
          }; })(_shapeMergeKey));
          sfDefRow.appendChild(sfDefPicker);
          var sfDefCode = document.createElement('code');
          sfDefCode.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);';
          sfDefCode.textContent = sfDefHex;
          sfDefPicker.addEventListener('input', function () { sfDefCode.textContent = sfDefPicker.value; });
          sfDefRow.appendChild(sfDefCode);
          shapeFillRow.appendChild(sfDefRow);
          var sfValRow = document.createElement('div');
          sfValRow.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;';
          sfValRow.innerHTML = '<span style="color:var(--gen-muted,#888);">Value:</span>';
          var sfPicker = document.createElement('input');
          sfPicker.type = 'color';
          sfPicker.style.cssText = 'width:40px;height:24px;padding:0;border:0;background:none;';
          var sf = obj.fill || sfDefault || '#6366f1';
          sfPicker.value = typeof sf === 'string' && sf.indexOf('#') === 0 ? sf : '#6366f1';
          sfPicker.addEventListener('change', function () {
            obj.set('fill', sfPicker.value);
            if (linkedField && typeof options.setValue === 'function') options.setValue(linkedField.id, sfPicker.value);
            else if (typeof options.setValue === 'function') options.setValue(_shapeMergeKey, sfPicker.value);
            canvas.renderAll();
            saveStateDebounced();
          });
          sfValRow.appendChild(sfPicker);
          var sfValCode = document.createElement('code');
          sfValCode.style.cssText = 'font-size:11px;';
          sfValCode.textContent = sfPicker.value;
          sfPicker.addEventListener('input', function () { sfValCode.textContent = sfPicker.value; });
          sfValRow.appendChild(sfValCode);
          shapeFillRow.appendChild(sfValRow);
          buildRemoveMergeUI(shapeFillRow, _shapeMergeKey, obj);
        } else {
          shapeFillRow.innerHTML = '<label>Fill: </label><input type="color" class="cfs-prop-fill" style="width:40px;height:24px;padding:0;">';
          var shapeFillInput = shapeFillRow.querySelector('input.cfs-prop-fill');
          if (shapeFillInput) {
            var sf = obj.fill || '#6366f1';
            shapeFillInput.value = typeof sf === 'string' && sf.indexOf('#') === 0 ? sf : '#6366f1';
            shapeFillInput.addEventListener('change', function () { obj.set('fill', shapeFillInput.value); canvas.renderAll(); saveStateDebounced(); });
          }
          buildConvertToMergeUI(shapeFillRow, obj, 'FILL_COLOR', obj.fill || '#6366f1');
        }
        form.appendChild(shapeFillRow);
        if (obj.type === 'rect') {
          addRow('Corner radius', obj.rx != null ? obj.rx : 0, function (v) {
            var r = Math.max(0, Number(v) || 0);
            obj.set('rx', r);
            obj.set('ry', r);
            canvas.requestRenderAll();
          });
        }
        addRow('Stroke width', obj.strokeWidth != null ? obj.strokeWidth : 0, function (v) {
          obj.set('strokeWidth', Math.max(0, Number(v) || 0));
          canvas.requestRenderAll();
        });
        (function () {
          var ssRow = document.createElement('div');
          ssRow.className = 'gen-prop-group';
          ssRow.innerHTML = '<label>Stroke color</label><input type=\"color\" class=\"gen-color-swatch\">';
          var ssInput = ssRow.querySelector('input[type="color"]');
          ssInput.value = (obj.stroke && typeof obj.stroke === 'string' && obj.stroke.indexOf('#') === 0) ? obj.stroke : '#000000';
          ssInput.addEventListener('change', function () { obj.set('stroke', ssInput.value); canvas.requestRenderAll(); saveStateDebounced(); });
          form.appendChild(ssRow);
        })();
        if (obj.cfsShapeLine) {
          addRow('Line length', obj.cfsLineLength != null ? obj.cfsLineLength : (obj.width || 100), function (v) {
            var n = Math.max(1, Number(v) || 100);
            obj.set('cfsLineLength', n);
            obj.set('width', n);
            canvas.requestRenderAll();
          });
          addRow('Line thickness', obj.cfsLineThickness != null ? obj.cfsLineThickness : (obj.height || 4), function (v) {
            var n = Math.max(1, Number(v) || 4);
            obj.set('cfsLineThickness', n);
            obj.set('height', n);
            canvas.requestRenderAll();
          });
        }
      }
      if (obj.type === 'image' && obj.cfsSvgSrc) {
        var svgHint = document.createElement('div');
        svgHint.className = 'cfs-prop-row';
        svgHint.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);margin:4px 0;';
        svgHint.textContent = 'SVG asset – raw source preserved for export';
        form.appendChild(svgHint);
      }
      if (obj.type === 'image') {
        var replaceImgRow = document.createElement('div');
        replaceImgRow.className = 'cfs-prop-row';
        var replaceImgBtn = document.createElement('button');
        replaceImgBtn.type = 'button';
        replaceImgBtn.className = 'cfs-btn-secondary';
        replaceImgBtn.textContent = 'Replace image';
        replaceImgBtn.addEventListener('click', function () {
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = function () {
            var file = input.files && input.files[0];
            if (!file || !canvas) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
              var dataUrl = ev.target && ev.target.result;
              if (!dataUrl) return;
              var _cv = canvas;
              var _imgTarget = obj;
              var _savedLeft = obj.left;
              var _savedTop = obj.top;
              _imgTarget._cfsSavedVisW = (obj.width || 1) * (obj.scaleX || 1);
              _imgTarget._cfsSavedVisH = (obj.height || 1) * (obj.scaleY || 1);
              var _onLoaded = function () {
                fitNewImageToCurrentBounds(_imgTarget);
                if (_savedLeft != null) _imgTarget.set('left', _savedLeft);
                if (_savedTop != null) _imgTarget.set('top', _savedTop);
                if (_imgTarget.setCoords) _imgTarget.setCoords();
                if (_cv && _cv.renderAll) _cv.renderAll();
                pushUndo();
                refreshLayersPanel();
                refreshPropertyPanel();
              };
              if (typeof obj.setSrc === 'function') {
                var result = obj.setSrc(dataUrl, _onLoaded, { crossOrigin: 'anonymous' });
                if (result && typeof result.then === 'function') {
                  result.then(_onLoaded).catch(function (e) { console.warn('[CFS] Replace image load failed', e); });
                }
              } else if (obj.set) {
                obj.set('src', dataUrl);
                _onLoaded();
              }
              if (linkedField && typeof options.setValue === 'function') options.setValue(linkedField.id, dataUrl);
            };
            reader.readAsDataURL(file);
          };
          input.click();
        });
        replaceImgRow.appendChild(replaceImgBtn);
        form.appendChild(replaceImgRow);
        (function () {
          var imgUrlRow = document.createElement('div');
          imgUrlRow.className = 'cfs-prop-row';
          imgUrlRow.innerHTML = '<label>Image URL: </label><span style="display:flex;align-items:center;gap:4px;flex:1;min-width:0;"><input type="text" class="cfs-prop-img-url" style="flex:1;min-width:0;max-width:200px;font-size:11px;" placeholder="URL"><button type="button" class="cfs-btn-align" title="Copy URL" style="padding:2px 6px;font-size:10px;">Copy</button></span>';
          var imgUrlInput = imgUrlRow.querySelector('input.cfs-prop-img-url');
          var imgCopyBtn = imgUrlRow.querySelector('button');
          var origClip = obj.cfsOriginalClip || {};
          var origAsset = origClip.asset || {};
          var currentSrc = (typeof obj.getSrc === 'function' ? obj.getSrc() : obj.src) || origAsset.src || '';
          var displaySrc = currentSrc.indexOf('data:') === 0 ? '[data URL]' : currentSrc;
          if (imgUrlInput) {
            imgUrlInput.value = displaySrc;
            imgUrlInput.title = currentSrc;
            imgUrlInput.addEventListener('change', function () {
              var newUrl = imgUrlInput.value.trim();
              if (!newUrl || newUrl === '[data URL]') return;
              if (typeof obj.setSrc === 'function') {
                var _cv = canvas;
                var _imgTarget = obj;
                var _savedLeft = obj.left;
                var _savedTop = obj.top;
                _imgTarget._cfsSavedVisW = (obj.width || 1) * (obj.scaleX || 1);
                _imgTarget._cfsSavedVisH = (obj.height || 1) * (obj.scaleY || 1);
                var _onLoad = function () {
                  fitNewImageToCurrentBounds(_imgTarget);
                  if (_savedLeft != null) _imgTarget.set('left', _savedLeft);
                  if (_savedTop != null) _imgTarget.set('top', _savedTop);
                  if (_imgTarget.setCoords) _imgTarget.setCoords();
                  if (_cv && _cv.renderAll) _cv.renderAll();
                };
                var _r = obj.setSrc(newUrl, _onLoad, { crossOrigin: 'anonymous' });
                if (_r && typeof _r.then === 'function') _r.then(_onLoad).catch(function (e) { console.warn('[CFS] Image load failed', e); });
              } else {
                obj.set('src', newUrl);
              }
              if (linkedField && typeof options.setValue === 'function') options.setValue(linkedField.id, newUrl);
              canvas.renderAll();
              pushUndo();
            });
          }
          if (imgCopyBtn) {
            imgCopyBtn.addEventListener('click', function () {
              var url = (typeof obj.getSrc === 'function' ? obj.getSrc() : obj.src) || '';
              if (url && navigator.clipboard) {
                navigator.clipboard.writeText(url).catch(function () {});
                imgCopyBtn.textContent = 'Done';
                setTimeout(function () { imgCopyBtn.textContent = 'Copy'; }, 1500);
              }
            });
          }
          form.appendChild(imgUrlRow);
        })();
        (function () {
          var _imgMergeKey = obj.cfsMergeKey || (typeof obj.get === 'function' ? obj.get('cfsMergeKey') : null)
            || ((obj.name && getMergeDefault(obj.name) !== undefined) ? obj.name : null);
          if (_imgMergeKey) {
            var imgMergeSection = document.createElement('div');
            imgMergeSection.className = 'gen-merge-fields-container';
            var imgFieldBlock = document.createElement('div');
            imgFieldBlock.className = 'gen-merge-field-block';
            /* Editable key header */
            var imgFieldHeader = document.createElement('div');
            imgFieldHeader.className = 'gen-merge-field-header';
            var imgBraceL = document.createElement('span');
            imgBraceL.className = 'gen-merge-brace';
            imgBraceL.textContent = '{{';
            imgFieldHeader.appendChild(imgBraceL);
            var imgKeyInput = document.createElement('input');
            imgKeyInput.type = 'text';
            imgKeyInput.className = 'gen-merge-key-input';
            imgKeyInput.value = _imgMergeKey;
            imgKeyInput.title = 'Rename this merge key';
            imgKeyInput.addEventListener('blur', (function (oldKey, inputEl) { return function () {
              var newVal = inputEl.value.trim();
              var result = handleMergeFieldBlur(oldKey, newVal, obj);
              inputEl.value = result;
            }; })(_imgMergeKey, imgKeyInput));
            imgKeyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') imgKeyInput.blur(); });
            imgFieldHeader.appendChild(imgKeyInput);
            var imgBraceR = document.createElement('span');
            imgBraceR.className = 'gen-merge-brace';
            imgBraceR.textContent = '}}';
            imgFieldHeader.appendChild(imgBraceR);
            var imgTypeLabel = document.createElement('span');
            imgTypeLabel.className = 'gen-merge-field-type-badge';
            imgTypeLabel.textContent = 'Image';
            imgFieldHeader.appendChild(imgTypeLabel);
            imgFieldBlock.appendChild(imgFieldHeader);
            /* Default row */
            var imgMkDefault = getMergeDefault(_imgMergeKey);
            var imgDefRow = document.createElement('div');
            imgDefRow.className = 'gen-merge-field-row';
            var imgDefLabel = document.createElement('span');
            imgDefLabel.className = 'gen-merge-field-row-label';
            imgDefLabel.textContent = 'Default:';
            imgDefRow.appendChild(imgDefLabel);
            var imgDefInput = document.createElement('input');
            imgDefInput.type = 'text';
            imgDefInput.className = 'gen-merge-field-input';
            imgDefInput.value = imgMkDefault != null ? String(imgMkDefault) : '';
            imgDefInput.placeholder = 'URL';
            imgDefInput.addEventListener('change', (function (mk) { return function () {
              setMergeDefault(mk, imgDefInput.value);
              pushUndo();
            }; })(_imgMergeKey));
            imgDefRow.appendChild(imgDefInput);
            imgFieldBlock.appendChild(imgDefRow);
            /* Value row */
            var _imgMergeVals = buildMergeValuesForInject();
            var _imgCurVal = _imgMergeVals[_imgMergeKey] !== undefined ? _imgMergeVals[_imgMergeKey] : _imgMergeVals[_imgMergeKey.toUpperCase().replace(/\s+/g, '_')];
            var imgValRow = document.createElement('div');
            imgValRow.className = 'gen-merge-field-row';
            var imgValLabel = document.createElement('span');
            imgValLabel.className = 'gen-merge-field-row-label';
            imgValLabel.textContent = 'Value:';
            imgValRow.appendChild(imgValLabel);
            var imgValInput = document.createElement('input');
            imgValInput.type = 'text';
            imgValInput.className = 'gen-merge-field-input';
            imgValInput.placeholder = 'URL or leave empty for default';
            imgValInput.value = _imgCurVal != null ? String(_imgCurVal) : '';
            imgValInput.addEventListener('change', (function (mk) { return function () {
              var v = imgValInput.value.trim();
              if (typeof options.setValue === 'function') options.setValue(mk, v);
              var sf = extension.inputSchema && extension.inputSchema.find(function (f) {
                return (f.mergeField || f.id || '').toUpperCase().replace(/\s+/g, '_') === mk.toUpperCase().replace(/\s+/g, '_');
              });
              if (sf && typeof options.setValue === 'function') options.setValue(sf.id, v);
              if (v && typeof obj.setSrc === 'function') {
                var _cv = canvas;
                var _imgTarget = obj;
                var _savedLeft = obj.left;
                var _savedTop = obj.top;
                _imgTarget._cfsSavedVisW = (obj.width || 1) * (obj.scaleX || 1);
                _imgTarget._cfsSavedVisH = (obj.height || 1) * (obj.scaleY || 1);
                var _onLoad = function () {
                  fitNewImageToCurrentBounds(_imgTarget);
                  if (_savedLeft != null) _imgTarget.set('left', _savedLeft);
                  if (_savedTop != null) _imgTarget.set('top', _savedTop);
                  if (_imgTarget.setCoords) _imgTarget.setCoords();
                  if (_cv && _cv.renderAll) _cv.renderAll();
                };
                var _r = obj.setSrc(v, _onLoad, { crossOrigin: 'anonymous' });
                if (_r && typeof _r.then === 'function') _r.then(_onLoad).catch(function (e) { console.warn('[CFS] Merge image load failed', e); });
              }
              pushUndo();
            }; })(_imgMergeKey));
            imgValRow.appendChild(imgValInput);
            imgFieldBlock.appendChild(imgValRow);
            imgMergeSection.appendChild(imgFieldBlock);
            buildRemoveMergeUI(imgMergeSection, _imgMergeKey, obj);
            form.appendChild(imgMergeSection);
          } else {
            var imgConvertRow = document.createElement('div');
            imgConvertRow.className = 'cfs-prop-row';
            var currentImgSrc = (typeof obj.getSrc === 'function' ? obj.getSrc() : obj.src) || '';
            buildConvertToMergeUI(imgConvertRow, obj, 'IMAGE', currentImgSrc);
            form.appendChild(imgConvertRow);
          }
        })();
      }
      if (obj.cfsVideoSrc) {
        var videoUrlRow = document.createElement('div');
        videoUrlRow.className = 'cfs-prop-row';
        videoUrlRow.innerHTML = '<label>Video URL: </label><input type="text" class="cfs-prop-video-url" style="width:100%;max-width:200px;" placeholder="URL or leave blank">';
        var videoUrlInput = videoUrlRow.querySelector('input.cfs-prop-video-url');
        if (videoUrlInput) {
          videoUrlInput.value = obj.cfsVideoSrc || '';
          videoUrlInput.addEventListener('change', function () { obj.set('cfsVideoSrc', videoUrlInput.value.trim() || obj.cfsVideoSrc); saveStateDebounced(); });
        }
        form.appendChild(videoUrlRow);
        var audioMixLabel = document.createElement('div');
        audioMixLabel.className = 'gen-prop-section-label';
        audioMixLabel.textContent = 'Audio Mix';
        form.appendChild(audioMixLabel);
        addRow('Volume', obj.cfsVideoVolume != null ? obj.cfsVideoVolume : 1, function (v) {
          var n = Number(v);
          obj.set('cfsVideoVolume', isNaN(n) ? 1 : Math.max(0, n));
        });
        addRow('Fade in (s)', obj.cfsFadeIn != null ? obj.cfsFadeIn : '', function (v) {
          if (v === '' || v == null || isNaN(Number(v))) { obj.set('cfsFadeIn', undefined); return; }
          obj.set('cfsFadeIn', Math.max(0, Number(v)));
        });
        addRow('Fade out (s)', obj.cfsFadeOut != null ? obj.cfsFadeOut : '', function (v) {
          if (v === '' || v == null || isNaN(Number(v))) { obj.set('cfsFadeOut', undefined); return; }
          obj.set('cfsFadeOut', Math.max(0, Number(v)));
        });
        var videoPropsLabel = document.createElement('div');
        videoPropsLabel.className = 'gen-prop-section-label';
        videoPropsLabel.textContent = 'Video Properties';
        form.appendChild(videoPropsLabel);
        var origClip = (obj.cfsOriginalClip && typeof obj.cfsOriginalClip === 'object') ? obj.cfsOriginalClip : {};
        var origAsset = origClip.asset || {};
        addRow('Trim (s)', origAsset.trim != null ? origAsset.trim : (obj.cfsTrim || ''), function (v) {
          if (!obj.cfsOriginalClip) obj.set('cfsOriginalClip', {});
          var oc = obj.cfsOriginalClip;
          if (!oc.asset) oc.asset = {};
          var n = Number(v);
          var trimVal = (v === '' || isNaN(n)) ? 0 : Math.max(0, n);
          oc.asset.trim = trimVal || undefined;
          obj.set('cfsOriginalClip', oc);
          obj.set('cfsTrim', trimVal);
          /* Immediately sync the Fabric preview to show the trimmed frame */
          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') {
            syncVideosToTime(currentPlayheadSec);
          }
        });
        addRow('Speed', origAsset.speed != null ? origAsset.speed : (obj.cfsSpeed || ''), function (v) {
          if (!obj.cfsOriginalClip) obj.set('cfsOriginalClip', {});
          var oc = obj.cfsOriginalClip;
          if (!oc.asset) oc.asset = {};
          var n = Number(v);
          var speedVal = (v === '' || isNaN(n)) ? 1 : Math.max(0.1, Math.min(10, n));
          oc.asset.speed = speedVal !== 1 ? speedVal : undefined;
          obj.set('cfsOriginalClip', oc);
          obj.set('cfsSpeed', speedVal);
          if (typeof syncVideosToTime === 'function' && typeof currentPlayheadSec !== 'undefined') {
            syncVideosToTime(currentPlayheadSec);
          }
        });
        var cropLabel = document.createElement('div');
        cropLabel.className = 'gen-prop-section-label';
        cropLabel.textContent = 'Crop (0–1 Normalized)';
        form.appendChild(cropLabel);
        var cropObj = origAsset.crop || {};
        ['top', 'bottom', 'left', 'right'].forEach(function (side) {
          addRow('Crop ' + side, cropObj[side] != null ? cropObj[side] : '', function (v) {
            if (!obj.cfsOriginalClip) obj.set('cfsOriginalClip', {});
            var oc = obj.cfsOriginalClip;
            if (!oc.asset) oc.asset = {};
            if (!oc.asset.crop) oc.asset.crop = {};
            var n = Number(v);
            oc.asset.crop[side] = (v === '' || isNaN(n)) ? undefined : Math.max(0, Math.min(1, n));
            obj.set('cfsOriginalClip', oc);
          });
        });
        (function () {
          var ckLabel = document.createElement('div');
          ckLabel.className = 'gen-prop-section-label';
          ckLabel.textContent = 'Chroma Key';
          form.appendChild(ckLabel);
          var ck = obj.cfsChromaKey && typeof obj.cfsChromaKey === 'object' ? obj.cfsChromaKey : {};
          var ckColorRow = document.createElement('div');
          ckColorRow.className = 'cfs-prop-row';
          ckColorRow.innerHTML = '<label>Key color: </label><input type="color" style="width:40px;height:24px;padding:0;"><button type="button" style="margin-left:4px;font-size:10px;padding:1px 4px;">Clear</button>';
          var ckColorInput = ckColorRow.querySelector('input[type="color"]');
          var ckClearBtn = ckColorRow.querySelector('button');
          ckColorInput.value = (ck.color && ck.color.indexOf('#') === 0) ? ck.color : '#00b140';
          ckColorInput.addEventListener('change', function () {
            var c = obj.cfsChromaKey && typeof obj.cfsChromaKey === 'object' ? Object.assign({}, obj.cfsChromaKey) : { threshold: 150, halo: 100 };
            c.color = ckColorInput.value;
            obj.set('cfsChromaKey', c);
            saveStateDebounced();
          });
          ckClearBtn.addEventListener('click', function () { obj.set('cfsChromaKey', undefined); refreshPropertyPanel(); saveStateDebounced(); });
          form.appendChild(ckColorRow);
          addRow('Threshold', ck.threshold != null ? ck.threshold : '', function (v) {
            if (v === '' && !obj.cfsChromaKey) return;
            var c = obj.cfsChromaKey && typeof obj.cfsChromaKey === 'object' ? Object.assign({}, obj.cfsChromaKey) : { color: '#00b140', halo: 100 };
            c.threshold = v === '' ? undefined : Math.max(0, Number(v) || 0);
            obj.set('cfsChromaKey', c);
          });
          addRow('Halo', ck.halo != null ? ck.halo : '', function (v) {
            if (v === '' && !obj.cfsChromaKey) return;
            var c = obj.cfsChromaKey && typeof obj.cfsChromaKey === 'object' ? Object.assign({}, obj.cfsChromaKey) : { color: '#00b140', threshold: 150 };
            c.halo = v === '' ? undefined : Math.max(0, Number(v) || 0);
            obj.set('cfsChromaKey', c);
          });
        })();
        var replaceVideoRow = document.createElement('div');
        replaceVideoRow.className = 'cfs-prop-row';
        var replaceVideoBtn = document.createElement('button');
        replaceVideoBtn.type = 'button';
        replaceVideoBtn.className = 'cfs-btn-secondary';
        replaceVideoBtn.textContent = 'Replace video';
        replaceVideoBtn.addEventListener('click', function () {
          var fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'video/*';
          fileInput.style.display = 'none';
          fileInput.onchange = function () {
            var file = fileInput.files && fileInput.files[0];
            if (file && canvas) {
              var src = URL.createObjectURL(file);
              obj.set('cfsVideoSrc', src);
              if (videoUrlInput) videoUrlInput.value = src;
              getVideoMetadata(src).then(function (meta) {
                if (!obj.canvas) return;
                if (meta.duration > 0) obj.set('cfsLength', Math.round(meta.duration * 10) / 10);
                if (meta.width > 0 && meta.height > 0) {
                  obj.set('cfsVideoWidth', meta.width);
                  obj.set('cfsVideoHeight', meta.height);
                  var maxW = 400, maxH = 280;
                  var scale = Math.min(maxW / meta.width, maxH / meta.height, 1);
                  var w = Math.max(80, Math.round(meta.width * scale));
                  var h = Math.max(60, Math.round(meta.height * scale));
                  var items = obj.getObjects && obj.getObjects();
                  if (items && items.length >= 2) {
                    items[0].set({ width: w, height: h, left: -w / 2, top: -h / 2 });
                    items[1].set({ left: 0, top: 0 });
                  }
                  obj.set({ width: w, height: h });
                  if (obj.setCoords) obj.setCoords();
                  if (obj.dirty != null) obj.dirty = true;
                }
                if (meta.metadata) obj.set('cfsVideoMetadata', meta.metadata);
                canvas.renderAll();
                refreshTimeline();
                refreshPropertyPanel();
              });
            }
          };
          fileInput.click();
        });
        replaceVideoRow.appendChild(replaceVideoBtn);
        form.appendChild(replaceVideoRow);
        var resW = obj.cfsVideoWidth != null ? Number(obj.cfsVideoWidth) : (obj.cfsVideoMetadata && obj.cfsVideoMetadata.width != null) ? Number(obj.cfsVideoMetadata.width) : null;
        var resH = obj.cfsVideoHeight != null ? Number(obj.cfsVideoHeight) : (obj.cfsVideoMetadata && obj.cfsVideoMetadata.height != null) ? Number(obj.cfsVideoMetadata.height) : null;
        var dur = (obj.cfsLength != null && typeof obj.cfsLength === 'number') ? obj.cfsLength : (obj.cfsVideoMetadata && obj.cfsVideoMetadata.duration != null) ? Number(obj.cfsVideoMetadata.duration) : null;
        if ((resW && resH) || (dur != null && isFinite(dur))) {
          var infoRow = document.createElement('div');
          infoRow.className = 'cfs-prop-row';
          infoRow.style.fontSize = '11px';
          infoRow.style.color = 'var(--gen-muted,#666)';
          infoRow.textContent = (resW && resH ? resW + '×' + resH : '') + (resW && resH && dur ? ' · ' : '') + (dur != null && isFinite(dur) ? dur.toFixed(1) + 's' : '');
          form.appendChild(infoRow);
        }
        var _timingHeader = document.createElement('div');
        _timingHeader.className = 'gen-prop-section-label';
        _timingHeader.textContent = 'Clip Timeline & Transitions';
        form.appendChild(_timingHeader);
        var startVal = obj.cfsStart != null ? String(obj.cfsStart) : '';
        var lengthVal = obj.cfsLength != null ? String(obj.cfsLength) : '';
        var timingGrid = document.createElement('div');
        timingGrid.className = 'gen-prop-pair';
        addRowTo(timingGrid, 'Start (s)', startVal, function (v) {
          var val = (v === '' || v == null) ? undefined : (v === 'auto' ? 'auto' : (isNaN(Number(v)) ? undefined : Number(v)));
          obj.set('cfsStart', val);
          refreshTimeline();
        });
        addRowTo(timingGrid, 'Length (s)', lengthVal, function (v) {
          var val = (v === '' || v == null) ? undefined : (v === 'auto' || v === 'end' ? v : (isNaN(Number(v)) ? undefined : Number(v)));
          obj.set('cfsLength', val);
          refreshTimeline();
        });
        form.appendChild(timingGrid);
      } else {
        var _timingHeader2 = document.createElement('div');
        _timingHeader2.className = 'gen-prop-section-label';
        _timingHeader2.textContent = 'Clip Timeline & Transitions';
        form.appendChild(_timingHeader2);
        var timingGrid2 = document.createElement('div');
        timingGrid2.className = 'gen-prop-pair';
        addRowTo(timingGrid2, 'Start (s)', obj.cfsStart != null ? obj.cfsStart : '', function (v) { obj.set('cfsStart', v === '' || isNaN(v) ? undefined : Number(v)); refreshTimeline(); });
        addRowTo(timingGrid2, 'Length (s)', obj.cfsLength != null ? obj.cfsLength : '', function (v) { obj.set('cfsLength', v === '' || isNaN(v) ? undefined : Number(v)); refreshTimeline(); });
        form.appendChild(timingGrid2);
      }
      addRow('Track', obj.cfsTrackIndex != null ? obj.cfsTrackIndex : 0, function (v) { var n = parseInt(v, 10); obj.set('cfsTrackIndex', isNaN(n) || n < 0 ? 0 : n); refreshTimeline(); });
      (function () {
        var allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = 'cfs-btn-secondary';
        allBtn.textContent = 'Set duration for all clips';
        allBtn.style.cssText = 'font-size:10px;padding:2px 6px;margin-top:2px;';
        allBtn.addEventListener('click', function () {
          var curLen = obj.cfsLength != null ? obj.cfsLength : 10;
          var newLen = prompt('Set duration (seconds) for ALL clips on the canvas:', curLen);
          if (newLen == null || newLen === '') return;
          var n = Number(newLen);
          if (isNaN(n) || n <= 0) return;
          if (canvas && canvas.getObjects) {
            canvas.getObjects().forEach(function (o) {
              if (o && o.set) o.set('cfsLength', n);
            });
          }
          refreshTimeline();
          refreshPropertyPanel();
        });
        form.appendChild(allBtn);
      })();
      (function () {
        var vizLabel = document.createElement('div');
        vizLabel.className = 'gen-prop-section-label';
        vizLabel.textContent = 'Transform';
        form.appendChild(vizLabel);
      })();
      /* Rotation + Scale in a 2-column grid */
      var transformPair = document.createElement('div');
      transformPair.className = 'gen-prop-pair';
      addRowTo(transformPair, 'Rotation', obj.angle != null ? Math.round(obj.angle * 100) / 100 : 0, function (v) {
        obj.set('angle', Number(v) || 0);
        if (typeof obj.setCoords === 'function') obj.setCoords();
        canvas.requestRenderAll();
      });
      addRowTo(transformPair, 'Scale', obj.cfsScale != null ? obj.cfsScale : '', function (v) {
        var s = v === '' ? 1 : Math.max(0.01, Number(v) || 1);
        obj.set('cfsScale', v === '' ? undefined : s);
        if (obj.type === 'image' || (obj.type === 'group' && obj.cfsVideoSrc)) {
          obj.set('scaleX', s);
          obj.set('scaleY', s);
          if (typeof obj.setCoords === 'function') obj.setCoords();
          canvas.requestRenderAll();
        }
      });
      form.appendChild(transformPair);
      (function () {
        var flipRow = document.createElement('div');
        flipRow.className = 'gen-prop-group';
        flipRow.innerHTML = '<label>Flip</label><div style="display:flex;gap:12px;align-items:center;"><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--gen-text-secondary);cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" style="width:auto;accent-color:var(--gen-accent);"> H</label><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--gen-text-secondary);cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" style="width:auto;accent-color:var(--gen-accent);"> V</label></div>';
        var checks = flipRow.querySelectorAll('input[type="checkbox"]');
        var curFlip = obj.cfsFlip && typeof obj.cfsFlip === 'object' ? obj.cfsFlip : {};
        if (checks[0]) { checks[0].checked = !!curFlip.horizontal || !!obj.flipX; checks[0].addEventListener('change', function () { obj.set('flipX', checks[0].checked); obj.set('cfsFlip', { horizontal: checks[0].checked, vertical: checks[1] ? checks[1].checked : false }); canvas.requestRenderAll(); saveStateDebounced(); }); }
        if (checks[1]) { checks[1].checked = !!curFlip.vertical || !!obj.flipY; checks[1].addEventListener('change', function () { obj.set('flipY', checks[1].checked); obj.set('cfsFlip', { horizontal: checks[0] ? checks[0].checked : false, vertical: checks[1].checked }); canvas.requestRenderAll(); saveStateDebounced(); }); }
        form.appendChild(flipRow);
      })();
      (function () {
        var filterOpts = ['none', 'blur', 'boost', 'contrast', 'darken', 'greyscale', 'lighten', 'muted', 'negative'];
        var filterRow = document.createElement('div');
        filterRow.className = 'gen-prop-group';
        filterRow.innerHTML = '<label>Filter</label><select class="gen-prop-input"></select>';
        var filterSel = filterRow.querySelector('select');
        filterOpts.forEach(function (f) { var o = document.createElement('option'); o.value = f; o.textContent = f.charAt(0).toUpperCase() + f.slice(1); filterSel.appendChild(o); });
        filterSel.value = obj.cfsFilter || 'none';
        filterSel.addEventListener('change', function () {
          obj.set('cfsFilter', filterSel.value === 'none' ? undefined : filterSel.value);
          applyCfsFilterVisual(obj);
          canvas.requestRenderAll();
          saveStateDebounced();
        });
        form.appendChild(filterRow);
      })();
      (function () {
        var twLabel = document.createElement('div');
        twLabel.className = 'gen-prop-section-label';
        twLabel.textContent = 'Tweens (Keyframes)';
        form.appendChild(twLabel);
        var twHint = document.createElement('div');
        twHint.className = 'cfs-prop-row';
        twHint.style.cssText = 'font-size:10px;color:var(--gen-muted,#888);margin-bottom:4px;';
        twHint.textContent = 'JSON array of {from, to, start, length, interpolation, easing}';
        form.appendChild(twHint);
        var opTw = obj.cfsOpacityTween;
        addRow('Opacity tween', opTw ? JSON.stringify(opTw) : '', function (v) {
          if (!v || v.trim() === '') { obj.set('cfsOpacityTween', undefined); return; }
          try { var arr = JSON.parse(v); obj.set('cfsOpacityTween', Array.isArray(arr) ? arr : undefined); } catch (e) { /* invalid JSON */ }
        });
        var offTw = obj.cfsOffsetTween;
        addRow('Offset tween', offTw ? JSON.stringify(offTw) : '', function (v) {
          if (!v || v.trim() === '') { obj.set('cfsOffsetTween', undefined); return; }
          try { var parsed = JSON.parse(v); obj.set('cfsOffsetTween', parsed && typeof parsed === 'object' ? parsed : undefined); } catch (e) { /* invalid JSON */ }
        });
        var rotTw = obj.cfsRotateTween;
        addRow('Rotate tween', rotTw ? JSON.stringify(rotTw) : '', function (v) {
          if (!v || v.trim() === '') { obj.set('cfsRotateTween', undefined); return; }
          try { var arr = JSON.parse(v); obj.set('cfsRotateTween', Array.isArray(arr) ? arr : undefined); } catch (e) { /* invalid JSON */ }
        });
      })();
      /* ── SECTION: CLIP ACTIONS ── */
      var clipActionsLabel = document.createElement('div');
      clipActionsLabel.className = 'gen-prop-section-label';
      clipActionsLabel.textContent = 'Clip Actions';
      form.appendChild(clipActionsLabel);
      var nameRow = document.createElement('div');
      nameRow.className = 'gen-prop-group';
      nameRow.innerHTML = '<label>Name</label><input type="text" class="gen-prop-input cfs-prop-name">';
      var nameInput = nameRow.querySelector('input.cfs-prop-name');
      if (nameInput) {
        nameInput.value = obj.name || obj.id || '';
        nameInput.addEventListener('change', function () { obj.set('name', nameInput.value || undefined); refreshLayersPanel(); saveStateDebounced(); });
      }
      form.appendChild(nameRow);
      (function () {
        var mergeKey = obj.cfsMergeKey || (typeof obj.get === 'function' ? obj.get('cfsMergeKey') : null);
        if (!mergeKey) return;
        var mergeSection = document.createElement('div');
        mergeSection.className = 'cfs-prop-row';
        mergeSection.style.cssText = 'flex-direction:column;gap:4px;';
        var mkRow = document.createElement('div');
        mkRow.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);';
        mkRow.innerHTML = '<span style="font-weight:600;">Merge field:</span> <code style="background:var(--gen-surface,#f3f3f3);padding:1px 4px;border-radius:3px;font-size:11px;">{{' + mergeKey + '}}</code>';
        mergeSection.appendChild(mkRow);
        var _mkDefault = getMergeDefault(mergeKey);
        var mkDefRow = document.createElement('div');
        mkDefRow.style.cssText = 'font-size:10px;color:var(--gen-muted,#888);margin-top:1px;display:flex;gap:4px;align-items:center;';
        var mkDefLabel = document.createElement('span');
        mkDefLabel.style.cssText = 'flex-shrink:0;';
        mkDefLabel.textContent = 'Default:';
        mkDefRow.appendChild(mkDefLabel);
        var mkDefInput = document.createElement('input');
        mkDefInput.type = 'text';
        mkDefInput.style.cssText = 'flex:1;min-width:0;font-size:10px;padding:1px 4px;border:1px solid var(--gen-border,#ccc);border-radius:3px;color:var(--gen-fg,#555);';
        mkDefInput.value = _mkDefault != null ? String(_mkDefault) : '';
        mkDefInput.placeholder = mergeKey;
        mkDefInput.addEventListener('change', (function (mk) { return function () {
          setMergeDefault(mk, mkDefInput.value);
          saveStateDebounced();
        }; })(mergeKey));
        mkDefRow.appendChild(mkDefInput);
        mergeSection.appendChild(mkDefRow);
        var mergeVals = buildMergeValuesForInject();
        var resolvedVal = mergeVals[mergeKey] !== undefined ? mergeVals[mergeKey]
          : mergeVals[String(mergeKey).toUpperCase().replace(/\s+/g, '_')];
        var isMedia = obj.type === 'image' || !!obj.cfsVideoSrc;

        var mvRow = document.createElement('div');
        mvRow.style.cssText = 'font-size:11px;display:flex;flex-direction:column;gap:3px;';
        var mvLabel = document.createElement('div');
        mvLabel.style.cssText = 'font-weight:600;color:var(--gen-muted,#888);';
        mvLabel.textContent = 'Merge value:';
        mvRow.appendChild(mvLabel);

        if (isMedia) {
          var mediaInputWrap = document.createElement('div');
          mediaInputWrap.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap;';
          var urlInput = document.createElement('input');
          urlInput.type = 'text';
          urlInput.placeholder = 'URL or pick file';
          urlInput.style.cssText = 'flex:1;min-width:0;max-width:180px;font-size:11px;padding:2px 4px;border:1px solid var(--gen-border,#ccc);border-radius:3px;';
          var currentVal = (resolvedVal != null ? String(resolvedVal) : '');
          urlInput.value = (currentVal.indexOf('data:') === 0 || currentVal.indexOf('blob:') === 0) ? '[local file]' : currentVal;
          urlInput.title = currentVal;
          var browseBtn = document.createElement('button');
          browseBtn.type = 'button';
          browseBtn.textContent = 'Browse';
          browseBtn.className = 'cfs-btn-secondary';
          browseBtn.style.cssText = 'font-size:10px;padding:2px 6px;';
          var clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.textContent = 'Clear';
          clearBtn.className = 'cfs-btn-secondary';
          clearBtn.style.cssText = 'font-size:10px;padding:2px 6px;';
          mediaInputWrap.appendChild(urlInput);
          mediaInputWrap.appendChild(browseBtn);
          mediaInputWrap.appendChild(clearBtn);
          mvRow.appendChild(mediaInputWrap);
          var previewEl = document.createElement('div');
          previewEl.style.cssText = 'max-width:160px;max-height:90px;overflow:hidden;border-radius:4px;border:1px solid var(--gen-border,#ddd);background:var(--gen-surface,#f9f9f9);';
          if (currentVal && currentVal !== '[local file]') {
            var previewImg = document.createElement('img');
            previewImg.src = currentVal;
            previewImg.style.cssText = 'max-width:100%;max-height:88px;display:block;object-fit:contain;';
            previewImg.onerror = function () { previewEl.innerHTML = '<span style="font-size:10px;color:var(--gen-muted,#888);padding:4px;">No preview</span>'; };
            previewEl.appendChild(previewImg);
          } else {
            previewEl.innerHTML = '<span style="font-size:10px;color:var(--gen-muted,#888);padding:4px;">No preview</span>';
          }
          mvRow.appendChild(previewEl);

          function applyMergeUrl(newVal) {
            if (linkedField && typeof options.setValue === 'function') {
              options.setValue(linkedField.id, newVal);
            } else if (typeof options.setValue === 'function') {
              options.setValue(mergeKey, newVal);
            }
            var _cv = canvas;
            var _imgTarget = obj;
            var _savedLeft = obj.left;
            var _savedTop = obj.top;
            var _savedVisW = (obj.width || 1) * (obj.scaleX || 1);
            var _savedVisH = (obj.height || 1) * (obj.scaleY || 1);
            if (typeof obj.setSrc === 'function') {
              _imgTarget._cfsSavedVisW = _savedVisW;
              _imgTarget._cfsSavedVisH = _savedVisH;
              var _onLoaded = function () {
                fitNewImageToCurrentBounds(_imgTarget);
                if (_savedLeft != null) _imgTarget.set('left', _savedLeft);
                if (_savedTop != null) _imgTarget.set('top', _savedTop);
                if (_imgTarget.setCoords) _imgTarget.setCoords();
                if (_cv && _cv.renderAll) _cv.renderAll();
                refreshPropertyPanel();
              };
              var result = obj.setSrc(newVal, _onLoaded, { crossOrigin: 'anonymous' });
              if (result && typeof result.then === 'function') {
                result.then(_onLoaded).catch(function (e) { console.warn('[CFS] Merge image load failed', e); });
              }
            } else if (obj.set) {
              obj.set('src', newVal);
              canvas.renderAll();
              refreshPropertyPanel();
            }
            urlInput.value = newVal.indexOf('data:') === 0 ? '[local file]' : newVal;
            urlInput.title = newVal;
            previewEl.innerHTML = '';
            if (newVal) {
              var pi = document.createElement('img');
              pi.src = newVal;
              pi.style.cssText = 'max-width:100%;max-height:88px;display:block;object-fit:contain;';
              pi.onerror = function () { previewEl.innerHTML = '<span style="font-size:10px;color:var(--gen-muted,#888);padding:4px;">No preview</span>'; };
              previewEl.appendChild(pi);
            } else {
              previewEl.innerHTML = '<span style="font-size:10px;color:var(--gen-muted,#888);padding:4px;">No preview</span>';
            }
          }

          urlInput.addEventListener('change', function () {
            var v = urlInput.value.trim();
            if (!v || v === '[local file]') return;
            applyMergeUrl(v);
            saveStateDebounced();
          });
          browseBtn.addEventListener('click', function () {
            var fi = document.createElement('input');
            fi.type = 'file';
            fi.accept = obj.cfsVideoSrc ? 'video/*' : 'image/*';
            fi.onchange = function () {
              var file = fi.files && fi.files[0];
              if (!file) return;
              var reader = new FileReader();
              reader.onload = function (ev) {
                var dataUrl = ev.target && ev.target.result;
                if (dataUrl) applyMergeUrl(dataUrl);
              };
              reader.readAsDataURL(file);
            };
            fi.click();
          });
          clearBtn.addEventListener('click', function () {
            if (linkedField && typeof options.setValue === 'function') {
              options.setValue(linkedField.id, '');
            } else if (typeof options.setValue === 'function') {
              options.setValue(mergeKey, '');
            }
            urlInput.value = '';
            urlInput.title = '';
            previewEl.innerHTML = '<span style="font-size:10px;color:var(--gen-muted,#888);padding:4px;">No preview</span>';
          });
        } else {
          var textInput = document.createElement('input');
          textInput.type = 'text';
          textInput.style.cssText = 'width:100%;max-width:200px;font-size:11px;padding:2px 4px;border:1px solid var(--gen-border,#ccc);border-radius:3px;';
          textInput.value = resolvedVal != null ? String(resolvedVal) : '';
          textInput.placeholder = 'Enter value for ' + mergeKey;
          textInput.addEventListener('change', function () {
            var v = textInput.value;
            if (linkedField && typeof options.setValue === 'function') {
              options.setValue(linkedField.id, v);
            } else if (typeof options.setValue === 'function') {
              options.setValue(mergeKey, v);
            }
            if (coreScene && coreScene.injectMergeData && canvas) {
              var vals = buildMergeValuesForInject();
              vals[mergeKey] = v;
              var upper = String(mergeKey).toUpperCase().replace(/\s+/g, '_');
              vals[upper] = v;
              coreScene.injectMergeData(canvas, vals);
              canvas.renderAll();
            }
            saveStateDebounced();
          });
          mvRow.appendChild(textInput);
        }

        mergeSection.appendChild(mvRow);
        form.appendChild(mergeSection);
      })();
      var shotstackOpts = global.__CFS_shotstackOptions;
      if (shotstackOpts && (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'image' || obj.type === 'rect' || obj.cfsVideoSrc || obj.cfsShapeLine)) {
        function addSelectRow(label, options, currentValue, onSelect) {
          var row = document.createElement('div');
          row.className = 'cfs-prop-row';
          var lab = document.createElement('label');
          lab.textContent = label + ': ';
          var sel = document.createElement('select');
          sel.style.maxWidth = '160px';
          (options || []).forEach(function (opt) {
            var o = document.createElement('option');
            o.value = opt.value != null ? opt.value : '';
            o.textContent = opt.label != null ? opt.label : opt.value;
            sel.appendChild(o);
          });
          sel.value = currentValue != null ? currentValue : '';
          sel.addEventListener('change', function () { if (onSelect) onSelect(sel.value); canvas.renderAll(); refreshTimeline(); saveStateDebounced(); });
          row.appendChild(lab);
          row.appendChild(sel);
          form.appendChild(row);
        }
        var trans = obj.cfsTransition && typeof obj.cfsTransition === 'object' ? obj.cfsTransition : {};
        addSelectRow('Transition in', shotstackOpts.transitions, trans.in || '', function (v) {
          var t = obj.get('cfsTransition') && typeof obj.get('cfsTransition') === 'object' ? Object.assign({}, obj.get('cfsTransition')) : { in: '', out: '' };
          t.in = v || undefined;
          obj.set('cfsTransition', t);
        });
        addSelectRow('Transition out', shotstackOpts.transitions, trans.out || '', function (v) {
          var t = obj.get('cfsTransition') && typeof obj.get('cfsTransition') === 'object' ? Object.assign({}, obj.get('cfsTransition')) : { in: '', out: '' };
          t.out = v || undefined;
          obj.set('cfsTransition', t);
        });
        addSelectRow('Effect', shotstackOpts.effects, obj.cfsEffect != null ? obj.cfsEffect : '', function (v) { obj.set('cfsEffect', v || undefined); });
        if ((obj.type === 'image' && !obj.cfsSvgSrc && !obj.cfsShapeLine) || obj.cfsVideoSrc) {
          addSelectRow('Fit', shotstackOpts.fit, obj.cfsFit != null ? obj.cfsFit : 'contain', function (v) { obj.set('cfsFit', v || 'contain'); });
        }
      }
      var alignRow = document.createElement('div');
      alignRow.className = 'cfs-prop-row cfs-prop-align';
      alignRow.innerHTML = '<span class="cfs-prop-label">Align:</span>';
      var alignLeft = document.createElement('button');
      alignLeft.type = 'button';
      alignLeft.className = 'cfs-btn-align';
      alignLeft.textContent = 'Left';
      alignLeft.title = 'Align left';
      alignLeft.addEventListener('click', function () { alignObject('left'); });
      var alignCenter = document.createElement('button');
      alignCenter.type = 'button';
      alignCenter.className = 'cfs-btn-align';
      alignCenter.textContent = 'Center';
      alignCenter.title = 'Align horizontal center';
      alignCenter.addEventListener('click', function () { alignObject('center'); });
      var alignRight = document.createElement('button');
      alignRight.type = 'button';
      alignRight.className = 'cfs-btn-align';
      alignRight.textContent = 'Right';
      alignRight.title = 'Align right';
      alignRight.addEventListener('click', function () { alignObject('right'); });
      var alignTop = document.createElement('button');
      alignTop.type = 'button';
      alignTop.className = 'cfs-btn-align';
      alignTop.textContent = 'Top';
      alignTop.title = 'Align top';
      alignTop.addEventListener('click', function () { alignObject('top'); });
      var alignMiddle = document.createElement('button');
      alignMiddle.type = 'button';
      alignMiddle.className = 'cfs-btn-align';
      alignMiddle.textContent = 'Mid';
      alignMiddle.title = 'Align vertical middle';
      alignMiddle.addEventListener('click', function () { alignObject('middle'); });
      var alignBottom = document.createElement('button');
      alignBottom.type = 'button';
      alignBottom.className = 'cfs-btn-align';
      alignBottom.textContent = 'Bottom';
      alignBottom.title = 'Align bottom';
      alignBottom.addEventListener('click', function () { alignObject('bottom'); });
      alignRow.appendChild(alignLeft);
      alignRow.appendChild(alignCenter);
      alignRow.appendChild(alignRight);
      alignRow.appendChild(alignTop);
      alignRow.appendChild(alignMiddle);
      alignRow.appendChild(alignBottom);
      form.appendChild(alignRow);
      var btnRow = document.createElement('div');
      btnRow.className = 'cfs-prop-row cfs-prop-buttons';
      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'cfs-btn-delete';
      deleteBtn.addEventListener('click', function () { removeSelectedObject(); });
      var duplicateBtn = document.createElement('button');
      duplicateBtn.type = 'button';
      duplicateBtn.textContent = 'Duplicate';
      duplicateBtn.className = 'cfs-btn-secondary';
      duplicateBtn.addEventListener('click', function () { duplicateSelectedObject(); });
      var groupBtn = document.createElement('button');
      groupBtn.type = 'button';
      groupBtn.textContent = 'Group';
      groupBtn.className = 'cfs-btn-secondary';
      groupBtn.title = 'Group selected objects (e.g. SVG paths)';
      groupBtn.addEventListener('click', function () { groupSelectedObjects(); });
      var ungroupBtn = document.createElement('button');
      ungroupBtn.type = 'button';
      ungroupBtn.textContent = 'Ungroup';
      ungroupBtn.className = 'cfs-btn-secondary';
      ungroupBtn.title = 'Ungroup into separate objects';
      ungroupBtn.addEventListener('click', function () { ungroupSelectedObject(); });
      var canGroup = fabric && fabric.ActiveSelection && obj instanceof fabric.ActiveSelection && typeof obj.getObjects === 'function' && obj.getObjects().length >= 2;
      var canUngroup = obj && obj.type === 'group' && typeof obj.getObjects === 'function' && obj.getObjects().length > 0;
      groupBtn.disabled = !canGroup;
      ungroupBtn.disabled = !canUngroup;
      var frontBtn = document.createElement('button');
      frontBtn.type = 'button';
      frontBtn.textContent = 'Front';
      frontBtn.className = 'cfs-btn-secondary';
      frontBtn.title = 'Bring to front';
      frontBtn.addEventListener('click', function () { layerOrder('front'); });
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.textContent = 'Back';
      backBtn.className = 'cfs-btn-secondary';
      backBtn.title = 'Send to back';
      backBtn.addEventListener('click', function () { layerOrder('back'); });
      var upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = 'Up';
      upBtn.className = 'cfs-btn-secondary';
      upBtn.title = 'Move layer up';
      upBtn.addEventListener('click', function () { layerOrder('forward'); });
      var downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = 'Down';
      downBtn.className = 'cfs-btn-secondary';
      downBtn.title = 'Move layer down';
      downBtn.addEventListener('click', function () { layerOrder('backward'); });
      btnRow.appendChild(duplicateBtn);
      btnRow.appendChild(groupBtn);
      btnRow.appendChild(ungroupBtn);
      btnRow.appendChild(upBtn);
      btnRow.appendChild(downBtn);
      btnRow.appendChild(frontBtn);
      btnRow.appendChild(backBtn);
      btnRow.appendChild(deleteBtn);
      form.appendChild(btnRow);
      wrap.appendChild(form);
      propertyPanel.appendChild(wrap);
    }

    function fitNewImageToCurrentBounds(imgObj) {
      var el = imgObj.getElement ? imgObj.getElement() : (imgObj._element || null);
      if (!el) return;
      var natW = el.naturalWidth || el.width || 1;
      var natH = el.naturalHeight || el.height || 1;
      if (natW <= 1 || natH <= 1) return;
      var curVisW = (imgObj._cfsSavedVisW != null) ? imgObj._cfsSavedVisW : ((imgObj.width || 1) * (imgObj.scaleX || 1));
      var curVisH = (imgObj._cfsSavedVisH != null) ? imgObj._cfsSavedVisH : ((imgObj.height || 1) * (imgObj.scaleY || 1));
      if (curVisW <= 0) curVisW = 48;
      if (curVisH <= 0) curVisH = 48;
      var s = Math.max(curVisW / natW, curVisH / natH);
      var cropW = Math.min(natW, Math.round(curVisW / s));
      var cropH = Math.min(natH, Math.round(curVisH / s));
      var cropX = Math.max(0, (natW - cropW) / 2);
      var cropY = Math.max(0, (natH - cropH) / 2);
      imgObj.set('cropX', cropX);
      imgObj.set('cropY', cropY);
      imgObj.set('width', cropW);
      imgObj.set('height', cropH);
      imgObj.set('scaleX', s);
      imgObj.set('scaleY', s);
      delete imgObj._cfsSavedVisW;
      delete imgObj._cfsSavedVisH;
      if (imgObj.setCoords) imgObj.setCoords();
    }

    function removeSelectedObject() {
      if (!canvas) return;
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) {
        if (selectedAudioClip) { deleteSelectedAudioClip(); return; }
        return;
      }
      canvas.remove(obj);
      canvas.discardActiveObject();
      canvas.renderAll();
      refreshTimeline();
      refreshLayersPanel();
      refreshPropertyPanel();
    }

    function deleteSelectedAudioClip() {
      if (!selectedAudioClip || !template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      var ti = selectedAudioClip.templateTrackIndex;
      var ci = selectedAudioClip.templateClipIndex;
      var tr = template.timeline.tracks[ti];
      if (!tr || !Array.isArray(tr.clips) || ci < 0 || ci >= tr.clips.length) return;
      tr.clips.splice(ci, 1);
      if (tr.clips.length === 0) {
        template.timeline.tracks.splice(ti, 1);
      }
      selectedAudioClip = null;
      saveStateDebounced();
      refreshTimeline();
      refreshLayersPanel();
      refreshPropertyPanel();
    }

    function duplicateSelectedObject() {
      if (!canvas || !fabric) return;
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) return;
      function addClone(clone) {
        if (!clone) return;
        clone.set({ left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
        if (obj.name) clone.set('name', obj.name + '_copy');
        if (obj.cfsVideoSrc != null) clone.set('cfsVideoSrc', obj.cfsVideoSrc);
        if (obj.cfsVideoWidth != null) clone.set('cfsVideoWidth', obj.cfsVideoWidth);
        if (obj.cfsVideoHeight != null) clone.set('cfsVideoHeight', obj.cfsVideoHeight);
        if (obj.cfsVideoMetadata != null) clone.set('cfsVideoMetadata', obj.cfsVideoMetadata);
        if (obj.cfsSvgSrc != null) clone.set('cfsSvgSrc', obj.cfsSvgSrc);
        if (obj.cfsStart !== undefined) clone.set('cfsStart', obj.cfsStart);
        if (obj.cfsLength !== undefined) clone.set('cfsLength', obj.cfsLength);
        if (obj.cfsLengthWasEnd !== undefined) clone.set('cfsLengthWasEnd', obj.cfsLengthWasEnd);
        if (obj.cfsLengthAuto !== undefined) clone.set('cfsLengthAuto', obj.cfsLengthAuto);
        if (obj.cfsTrackIndex !== undefined) clone.set('cfsTrackIndex', obj.cfsTrackIndex);
        if (obj.cfsClipOpacity !== undefined) clone.set('cfsClipOpacity', obj.cfsClipOpacity);
        canvas.add(clone);
        canvas.setActiveObject(clone);
        canvas.renderAll();
        refreshTimeline();
        refreshLayersPanel();
        refreshPropertyPanel();
      }
      if (typeof obj.clone === 'function') obj.clone(addClone);
    }

    function groupSelectedObjects() {
      if (!canvas || !fabric || !fabric.Group) return;
      var active = canvas.getActiveObject && canvas.getActiveObject();
      if (!active) return;
      var objs = (fabric.ActiveSelection && active instanceof fabric.ActiveSelection && active.getObjects) ? active.getObjects().slice() : null;
      if (!objs || objs.length < 2) return;
      var bounds = (typeof active.getBoundingRect === 'function' && active.getBoundingRect()) || { left: 0, top: 0, width: 0, height: 0 };
      var groupLeft = bounds.left + (bounds.width != null ? bounds.width / 2 : 0);
      var groupTop = bounds.top + (bounds.height != null ? bounds.height / 2 : 0);
      canvas.discardActiveObject();
      objs.forEach(function (o) { canvas.remove(o); });
      var group = new fabric.Group(objs, { left: groupLeft, top: groupTop, subTargetCheck: true, name: 'group_' + Date.now() });
      if (objs[0] && (objs[0].cfsStart !== undefined || objs[0].cfsLength !== undefined)) {
        if (objs[0].cfsStart !== undefined) group.set('cfsStart', objs[0].cfsStart);
        if (objs[0].cfsLength !== undefined) group.set('cfsLength', objs[0].cfsLength);
        if (objs[0].cfsLengthWasEnd !== undefined) group.set('cfsLengthWasEnd', objs[0].cfsLengthWasEnd);
        if (objs[0].cfsLengthAuto !== undefined) group.set('cfsLengthAuto', objs[0].cfsLengthAuto);
        if (objs[0].cfsTrackIndex !== undefined) group.set('cfsTrackIndex', objs[0].cfsTrackIndex);
        if (objs[0].cfsClipOpacity !== undefined) group.set('cfsClipOpacity', objs[0].cfsClipOpacity);
      }
      canvas.add(group);
      canvas.setActiveObject(group);
      canvas.renderAll();
      refreshTimeline();
      refreshLayersPanel();
      refreshPropertyPanel();
    }

    function ungroupSelectedObject() {
      if (!canvas || !fabric) return;
      var active = canvas.getActiveObject && canvas.getActiveObject();
      if (!active || active.type !== 'group' || typeof active.getObjects !== 'function') return;
      var objs = active.getObjects().slice();
      if (!objs.length) return;
      var groupLeft = active.left != null ? active.left : 0;
      var groupTop = active.top != null ? active.top : 0;
      var cfsStart = active.cfsStart;
      var cfsLength = active.cfsLength;
      var cfsTrackIndex = active.cfsTrackIndex;
      canvas.remove(active);
      objs.forEach(function (obj) {
        if (obj.set) {
          obj.set('left', groupLeft + (obj.left != null ? obj.left : 0));
          obj.set('top', groupTop + (obj.top != null ? obj.top : 0));
          if (cfsStart !== undefined) obj.set('cfsStart', cfsStart);
          if (cfsLength !== undefined) obj.set('cfsLength', cfsLength);
          if (cfsTrackIndex !== undefined) obj.set('cfsTrackIndex', cfsTrackIndex);
        }
        canvas.add(obj);
      });
      canvas.renderAll();
      refreshTimeline();
      refreshLayersPanel();
      refreshPropertyPanel();
    }

    function alignObject(where) {
      if (!canvas) return;
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) return;
      var cw = canvas.getWidth();
      var ch = canvas.getHeight();
      var w = obj.getScaledWidth ? obj.getScaledWidth() : (obj.width * (obj.scaleX || 1));
      var h = obj.getScaledHeight ? obj.getScaledHeight() : (obj.height * (obj.scaleY || 1));
      if (where === 'left') obj.set('left', 0);
      else if (where === 'center') obj.set('left', (cw - w) / 2);
      else if (where === 'right') obj.set('left', cw - w);
      else if (where === 'top') obj.set('top', 0);
      else if (where === 'middle') obj.set('top', (ch - h) / 2);
      else if (where === 'bottom') obj.set('top', ch - h);
      canvas.renderAll();
      refreshPropertyPanel();
      saveStateDebounced();
    }

    function layerOrder(direction) {
      if (!canvas) return;
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) return;
      if (direction === 'front') {
        if (canvas.bringObjectToFront) canvas.bringObjectToFront(obj);
        else if (obj.bringToFront) obj.bringToFront();
      } else if (direction === 'back') {
        if (canvas.sendObjectToBack) canvas.sendObjectToBack(obj);
        else if (obj.sendToBack) obj.sendToBack();
      } else if (direction === 'forward') {
        if (canvas.bringObjectForward) canvas.bringObjectForward(obj);
        else if (obj.bringForward) obj.bringForward();
      } else if (direction === 'backward') {
        if (canvas.sendObjectBackwards) canvas.sendObjectBackwards(obj);
        else if (obj.sendBackwards) obj.sendBackwards();
      }
      canvas.renderAll();
      refreshLayersPanel();
    }

    function copyObject() {
      if (!canvas) return;
      var obj = canvas.getActiveObject && canvas.getActiveObject();
      if (!obj) return;
      try {
        var objJson = obj.toObject ? obj.toObject(CFS_RESPONSIVE_KEYS) : {};
        var str = JSON.stringify(objJson);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(str);
      } catch (err) { console.warn('Copy failed', err); }
    }

    function pasteObject() {
      if (!canvas || !fabric) return;
      var read = navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.resolve('');
      read.then(function (str) {
        if (!str || str.trim().length === 0) return;
        var data = JSON.parse(str);
        var objs = Array.isArray(data) ? data : [data];
        if (!objs.length) return;
        var wrapper = { version: (fabric.Canvas && fabric.Canvas.VERSION) || '4.0', objects: objs };
        var tempEl = document.createElement('canvas');
        tempEl.width = 1;
        tempEl.height = 1;
        var tempCanvas = new fabric.Canvas(tempEl);
        tempCanvas.loadFromJSON(wrapper, function () {
          fixTextBaseline(tempCanvas);
          /* Determine target track: use selected object's track, or last track, or 0 */
          var targetTrack = 0;
          var activeObj = canvas.getActiveObject && canvas.getActiveObject();
          if (activeObj && activeObj.cfsTrackIndex != null) {
            targetTrack = activeObj.cfsTrackIndex;
          } else if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
            targetTrack = template.timeline.tracks.length - 1;
          }
          /* Deselect and force-reset Fabric internal drag state */
          canvas.discardActiveObject();
          if (canvas.__currentTransform) canvas.__currentTransform = null;
          if (canvas._currentTransform) canvas._currentTransform = null;
          canvas._isMouseDown = false;
          /* Fire synthetic mouseup on Fabric's upper canvas to fully clear drag state */
          var upperCanvas = canvas.upperCanvasEl || (canvas.wrapperEl && canvas.wrapperEl.querySelector('.upper-canvas'));
          if (upperCanvas) {
            try { upperCanvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch (_) {}
          }
          var toAdd = tempCanvas.getObjects();
          toAdd.forEach(function (o, i) {
            o.set({ left: (o.left || 0) + 20 * (i + 1), top: (o.top || 0) + 20 * (i + 1) });
            var pastedName = (o.name || 'pasted') + '_copy';
            o.set('name', pastedName);
            /* Ensure the pasted object is selectable and shows handles */
            o.set({ selectable: true, evented: true, hasControls: true, hasBorders: true });
            /* Assign to target track so it appears in Layers */
            o.set('cfsTrackIndex', targetTrack);
            canvas.add(o);
            /* Add a clip entry to the template timeline track so Layers can show it */
            if (template && template.timeline && Array.isArray(template.timeline.tracks) && template.timeline.tracks[targetTrack]) {
              var clips = template.timeline.tracks[targetTrack].clips;
              if (!clips) { clips = []; template.timeline.tracks[targetTrack].clips = clips; }
              var newClip = {
                asset: {
                  type: (o.type === 'image' ? 'image' : o.cfsVideoSrc ? 'video' : 'title'),
                  text: o.text || '',
                  src: o.src || o.cfsVideoSrc || ''
                },
                start: o.cfsStart || 0,
                length: o.cfsLength || 5
              };
              clips.push(newClip);
              o.set('cfsOriginalClip', newClip);
            }
          });
          if (toAdd.length) {
            pushUndo();
            /* Don't auto-select — avoids Fabric stuck-to-cursor drag state bug.
               User can click the pasted object to select it. */
            refreshLayersPanel();
            refreshPropertyPanel();
            refreshTimeline();
          }
          invalidateFabricTextLayout(canvas);
          canvas.requestRenderAll();
          tempCanvas.dispose();
        });
      }).catch(function (e) { console.warn('Paste failed', e); });
    }

    function onEditorKeydown(e) {
      if (!canvas) return;
      var activeEl = document.activeElement;
      /* The editor is "focused" when the event target or activeElement is inside the editor root,
         inside any of the external sidebar containers, or when nothing specific has focus (body/document)
         and the editor root is visible in the DOM. This ensures undo/redo shortcuts work after
         interacting with the canvas (which doesn't hold focus) or sidebar panels. */
      var isEditorFocused = root.contains(e.target) || (activeEl && root.contains(activeEl));
      if (!isEditorFocused) {
        var containers = [options.layersContainer, options.propertyPanelContainer, options.addContentContainer, options.toolbarContainer];
        for (var ci = 0; ci < containers.length; ci++) {
          if (containers[ci] && (containers[ci].contains(e.target) || (activeEl && containers[ci].contains(activeEl)))) {
            isEditorFocused = true;
            break;
          }
        }
      }
      if (!isEditorFocused && (!activeEl || activeEl === document.body || activeEl === document.documentElement) && root.offsetParent !== null) {
        isEditorFocused = true;
      }
      if (!isEditorFocused) return;
      stateRef._snapDisabled = !!e.altKey;
      var key = (e.key || '').toLowerCase();
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var _ael = document.activeElement;
      if (_ael && (_ael.tagName === 'TEXTAREA' || _ael.tagName === 'INPUT')) return;
      var active = canvas && canvas.getActiveObject();
      var isTextEditing = active && (active.type === 'textbox' || active.type === 'i-text') && active.isEditing;
      if (isTextEditing) {
        if (e.key === 'Escape') {
          active.exitEditing();
          canvas.renderAll();
          refreshLayersPanel();
          refreshPropertyPanel();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
          e.preventDefault();
          active.exitEditing();
          if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
          else undo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && key === 's') {
          e.preventDefault();
          editEvents.emit('save:requested', {});
          return;
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (key === 's') {
          e.preventDefault();
          editEvents.emit('save:requested', {});
          return;
        }
        if (key === 'z' || key === 'y') {
          e.preventDefault();
          if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
          else undo();
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          if (canvas && canvas.getObjects) {
            var objs = canvas.getObjects();
            if (objs.length === 0) return;
            if (objs.length === 1) canvas.setActiveObject(objs[0]);
            else if (fabric.ActiveSelection) {
              var sel = new fabric.ActiveSelection(objs, { canvas: canvas });
              canvas.setActiveObject(sel);
            } else {
              canvas.setActiveObject(objs[objs.length - 1]);
            }
            canvas.renderAll();
            refreshLayersPanel();
            refreshPropertyPanel();
          }
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          duplicateSelectedObject();
          return;
        }
        if (key === 'c') {
          copyObject();
          return;
        }
        if (key === 'v') {
          e.preventDefault();
          pasteObject();
          return;
        }
      }
      if (key === 'escape') {
        if (canvas && canvas.getActiveObject()) {
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshLayersPanel();
          refreshPropertyPanel();
        }
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) !== -1 && canvas && canvas.getActiveObject()) {
        e.preventDefault();
        if (!fabricHead) pushUndo();
        var nudge = e.shiftKey ? 1 : 5;
        var activeObj = canvas.getActiveObject();
        var dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
        var dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
        if (activeObj.set) {
          activeObj.set('left', (activeObj.left || 0) + dx);
          activeObj.set('top', (activeObj.top || 0) + dy);
        }
        canvas.renderAll();
        saveStateDebounced();
        refreshPropertyPanel();
        return;
      }
      if (key !== 'delete' && key !== 'backspace') return;
      if (canvas.getActiveObject()) {
        e.preventDefault();
        removeSelectedObject();
        return;
      }
      if (selectedAudioClip) {
        e.preventDefault();
        deleteSelectedAudioClip();
        return;
      }
    }

    function initBookPages() {
      pages = [{ objects: [], width: width, height: height, background: '#ffffff' }];
      currentPageIndex = 0;
      renderBookCurrentPage();
      renderBookPanel();
    }

    function renderBookCurrentPage() {
      fabricHead = null;
      undoPatches.length = 0;
      redoPatches.length = 0;
      updateUndoRedoButtons();
      canvasWrap.innerHTML = '';
      const dim = getCanvasDimensions();
      const page = pages[currentPageIndex] || pages[0];
      const pair = createFabricCanvas(page.width || dim.w, page.height || dim.h, page.background);
      const pageDiv = document.createElement('div');
      pageDiv.className = 'cfs-editor-canvas-page';
      const breakLine = document.createElement('div');
      breakLine.className = 'page-break-line';
      breakLine.title = 'Page break';
      pageDiv.appendChild(pair.wrapperEl || pair.el);
      pageDiv.appendChild(breakLine);
      canvasWrap.appendChild(pageDiv);
      canvas = pair.canvas;
      if (canvas) {
        setCanvasZoom(canvasZoom);
        if (canvas.on) {
          if (typeof attachObjectModifiedRefresh === 'function') attachObjectModifiedRefresh(canvas);
          canvas.on('selection:created', function () { refreshLayersPanel(); refreshPropertyPanel(); });
          canvas.on('selection:updated', function () { refreshLayersPanel(); refreshPropertyPanel(); });
          canvas.on('selection:cleared', function () {
            refreshLayersPanel();
            /* Skip property panel rebuild if a non-visual clip is actively selected,
               because the clip's click handler will rebuild it with the correct content. */
            if (!selectedTtsClip && !selectedAudioClip && !selectedCaptionClip && !selectedHtmlClip && !selectedLumaClip && !selectedTextToImageClip && !selectedImageToVideoClip) {
              refreshPropertyPanel();
            }
          });
          canvas.on('object:added', refreshLayersPanel);
          canvas.on('object:removed', refreshLayersPanel);
          canvas.on('text:editing:entered', function () {
            if (canvas && typeof canvas.calcOffset === 'function') { try { canvas.calcOffset(); } catch (_) {} }
          });
          canvas.on('text:editing:exited', function (opt) {
            var obj = opt && opt.target;
            if (obj) {
              var raw = String(obj.text || '');
              obj.set('cfsRawText', raw.replace(/\n/g, ' ').replace(/ {2,}/g, ' '));
            }
            refreshPropertyPanel();
            saveStateDebounced();
          });
        }
        setupPanWhenZoomed();
        if (page.objects && page.objects.length) {
          canvas.loadFromJSON({ version: '4.0', objects: page.objects, background: page.background }, function () {
            fixTextBaseline(canvas);
            invalidateFabricTextLayout(canvas);
            canvas.renderAll();
            refreshLayersPanel();
            refreshPropertyPanel();
          });
        } else {
          refreshLayersPanel();
          refreshPropertyPanel();
        }
      }
    }

    function saveCurrentPageToState() {
      if (outputType !== 'book' || !canvas) return;
      const state = canvas.toJSON(CFS_RESPONSIVE_KEYS);
      pages[currentPageIndex] = {
        objects: state.objects || [],
        width: canvas.getWidth(),
        height: canvas.getHeight(),
        background: canvas.backgroundColor || '#ffffff',
      };
    }

    function renderBookPanel() {
      bookPanel.innerHTML = '';
      const bookSettings = extension.bookSettings || {};
      if (Object.keys(bookSettings).length) {
        const layoutParts = [];
        if (bookSettings.screenshotPosition) layoutParts.push('screenshot ' + bookSettings.screenshotPosition);
        if (bookSettings.fontFamily || bookSettings.fontSizePt) layoutParts.push((bookSettings.fontSizePt || 11) + 'pt ' + (bookSettings.fontFamily || 'Georgia').split(',')[0].trim());
        if (layoutParts.length) {
          const hint = document.createElement('div');
          hint.className = 'cfs-editor-book-layout-hint';
          hint.style.cssText = 'font-size:11px;color:var(--gen-muted,#888);margin-bottom:6px;';
          hint.textContent = 'Layout: ' + layoutParts.join(', ');
          bookPanel.appendChild(hint);
        }
      }
      const label = document.createElement('span');
      label.textContent = 'Page ';
      label.style.color = 'var(--gen-muted)';
      bookPanel.appendChild(label);
      const pagesDiv = document.createElement('div');
      pagesDiv.className = 'cfs-editor-book-pages';
      pages.forEach(function (_, i) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cfs-editor-book-page-btn' + (i === currentPageIndex ? ' active' : '');
        btn.textContent = i + 1;
        btn.addEventListener('click', function () {
          saveCurrentPageToState();
          currentPageIndex = i;
          renderBookCurrentPage();
          renderBookPanel();
        });
        pagesDiv.appendChild(btn);
      });
      bookPanel.appendChild(pagesDiv);
      const addPageBtn = document.createElement('button');
      addPageBtn.type = 'button';
      addPageBtn.textContent = '+ Page';
      addPageBtn.addEventListener('click', function () {
        saveCurrentPageToState();
        pages.push({ objects: [], width: width, height: height, background: '#ffffff' });
        currentPageIndex = pages.length - 1;
        renderBookCurrentPage();
        renderBookPanel();
      });
      bookPanel.appendChild(addPageBtn);
      const exportGroup = document.createElement('div');
      exportGroup.className = 'cfs-editor-export-group';
      ['HTML', 'DOC', 'PDF'].forEach(function (fmt) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Export ' + fmt;
        b.addEventListener('click', function () {
          exportBook(fmt.toLowerCase());
        });
        exportGroup.appendChild(b);
      });
      bookPanel.appendChild(exportGroup);
    }

    function renderPageToDataUrl(page) {
      return new Promise(function (resolve) {
        var w = page.width || 800;
        var h = page.height || 600;
        var bg = page.background || '#ffffff';
        if (!fabric) { resolve(null); return; }
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var fc = new fabric.StaticCanvas(c, { width: w, height: h, backgroundColor: bg });
        if (!page.objects || !page.objects.length) {
          fc.renderAll();
          resolve(fc.toDataURL({ format: 'png' }));
          return;
        }
        fc.loadFromJSON({ objects: page.objects, background: page.background }, function () {
          fc.renderAll();
          resolve(fc.toDataURL({ format: 'png' }));
        });
      });
    }

    function exportBook(format) {
      saveCurrentPageToState();
      var pagePromises = pages.map(function (page) { return renderPageToDataUrl(page); });
      Promise.all(pagePromises).then(function (dataUrls) {
        var htmlParts = ['<!DOCTYPE html><html><head><meta charset="utf-8"><title>Book</title><style>body{font-family:Georgia,serif;margin:0;padding:40px;} .page{page-break-after:always;min-height:80vh;}.page:last-child{page-break-after:auto;} @media print{.page{page-break-after:always;}}</style></head><body>'];
        pages.forEach(function (page, i) {
          htmlParts.push('<div class="page" data-page="' + (i + 1) + '">');
          if (dataUrls[i]) {
            htmlParts.push('<img src="' + dataUrls[i] + '" alt="Page ' + (i + 1) + '" style="max-width:100%;height:auto;">');
          } else {
            htmlParts.push('<p>Page ' + (i + 1) + '</p>');
          }
          htmlParts.push('</div>');
        });
        htmlParts.push('</body></html>');
        var html = htmlParts.join('');
        if (format === 'html') {
          var blob = new Blob([html], { type: 'text/html' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'book.html';
          a.click();
          URL.revokeObjectURL(url);
        } else if (format === 'doc') {
          var docHtml = html.replace('<html>', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
          var blob = new Blob([docHtml], { type: 'application/msword' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'book.doc';
          a.click();
          URL.revokeObjectURL(url);
        } else if (format === 'pdf') {
          var win = window.open('', '_blank');
          win.document.write(html);
          win.document.close();
          win.setTimeout(function () {
            win.print();
            win.close();
          }, 500);
        }
      });
    }

    function addText() {
      if (!canvas) return;
      var cw = canvas.getWidth ? canvas.getWidth() : 1080;
      var wrapWidth = Math.min(400, Math.max(200, cw - 160));
      var opts = {
        left: 80,
        top: 80,
        width: wrapWidth,
        minWidth: 50,
        maxWidth: Math.max(wrapWidth, cw - 100),
        fontSize: 24,
        fill: '#000000',
        fontFamily: 'sans-serif',
        name: 'text_' + Date.now(),
        textBaseline: 'alphabetic',
        cfsWrapText: true,
      };
      if (outputTypeSelect.value === 'video' || outputTypeSelect.value === 'audio') {
        opts.cfsStart = 0;
        opts.cfsLength = getTimelineEnd() || 5;
        opts.cfsTrackIndex = getNextTrackIndex();
      }
      const t = new fabric.Textbox('New text', opts);
      t.set('cfsRawText', 'New text');
      canvas.add(t);
      canvas.setActiveObject(t);
      if (typeof t.initDimensions === 'function') t.initDimensions();
      canvas.requestRenderAll();
      refreshTimeline();
    }

    function addImage() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = function () {
        const file = input.files && input.files[0];
        if (!file || !canvas) return;
        const reader = new FileReader();
        reader.onload = function (e) {
          fabric.Image.fromURL(e.target.result, function (img) {
            if (!img) return;
            var imgOpts = { left: 80, top: 80, name: 'image_' + Date.now() };
            if (outputTypeSelect.value === 'video' || outputTypeSelect.value === 'audio') {
              imgOpts.cfsStart = 0;
              imgOpts.cfsLength = getTimelineEnd() || 5;
              imgOpts.cfsTrackIndex = getNextTrackIndex();
            }
            img.set(imgOpts);
            if (img.width > 400 || img.height > 400) img.scale(400 / Math.max(img.width, img.height));
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.renderAll();
            refreshTimeline();
          }, { crossOrigin: 'anonymous' });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }

    function addShape() {
      if (!canvas) return;
      var choice = prompt('Shape type?\n1 = Rectangle (default)\n2 = Circle\n3 = Line', '1');
      var stamp = Date.now();
      var isVideo = outputTypeSelect.value === 'video' || outputTypeSelect.value === 'audio';
      var timeProps = {};
      if (isVideo) { timeProps.cfsStart = 0; timeProps.cfsLength = getTimelineEnd() || 5; timeProps.cfsTrackIndex = getNextTrackIndex(); }
      var obj;
      if (choice === '3') {
        obj = new fabric.Rect(Object.assign({ left: 100, top: 200, width: 200, height: 4, fill: '#000000', name: 'line_' + stamp, cfsShapeLine: true, cfsLineLength: 200, cfsLineThickness: 4 }, timeProps));
      } else if (choice === '2') {
        obj = new fabric.Circle(Object.assign({ left: 100, top: 100, radius: 60, fill: '#6366f1', name: 'circle_' + stamp }, timeProps));
      } else {
        obj = new fabric.Rect(Object.assign({ left: 100, top: 100, width: 120, height: 80, fill: '#6366f1', name: 'shape_' + stamp }, timeProps));
      }
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();
      refreshTimeline();
    }

    /**
     * Get video metadata (duration, width, height) via HTML5 <video> element.
     * Sets dimensions and length so we can avoid "auto" when possible.
     * @param {string} src - Video URL or blob URL
     * @returns {Promise<{ width?: number, height?: number, duration?: number, metadata?: object }>}
     */
    function getVideoMetadata(src) {
      return new Promise(function (resolve) {
        var out = { width: 0, height: 0, duration: 0 };
        var video = document.createElement('video');
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        var done = function () {
          video.removeEventListener('loadedmetadata', onLoad);
          video.removeEventListener('error', onErr);
          if (video.src && (video.videoWidth || video.videoHeight || (video.duration && isFinite(video.duration)))) {
            out.width = video.videoWidth || 0;
            out.height = video.videoHeight || 0;
            var d = (video.duration != null && isFinite(video.duration)) ? video.duration : 0;
            if (d > 0) out.duration = d;
          }
          if (out.width || out.height || out.duration) {
            out.metadata = { width: out.width, height: out.height, duration: out.duration };
          }
          if (video.src && video.src.indexOf('blob:') === 0) URL.revokeObjectURL && URL.revokeObjectURL(video.src);
          resolve(out);
        };
        var onLoad = function () { done(); };
        var onErr = function () { done(); };
        video.addEventListener('loadedmetadata', onLoad);
        video.addEventListener('error', onErr);
        video.src = src;
        setTimeout(done, 8000);
      });
    }

    /**
     * Create a Fabric.Image backed by a <canvas> intermediary that is
     * continuously updated from a hidden <video> element.
     *
     * Why a canvas intermediary?
     *  • Setting crossOrigin on the video can block loading if the CDN
     *    doesn't send CORS headers.  Without crossOrigin, drawing the video
     *    taints the canvas — but Fabric never calls toDataURL on it because
     *    we set objectCaching:false on both the Image and the Group.
     *  • Fabric Groups cache children rendering.  By redrawing the
     *    intermediary canvas ourselves each frame and dirtying the group,
     *    we guarantee every rAF shows the latest video frame.
     *
     * cb(fabricImage, videoEl, intermediaryCanvas) — called once ready.
     */
    function createLiveVideoImage(src, w, h, cb) {
      var video = document.createElement('video');
      /* Do NOT set crossOrigin — allows loading from any CDN without CORS */
      video.muted = true;
      video.preload = 'auto';
      video.playsInline = true;
      video.loop = false;
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);

      var intermediary = document.createElement('canvas');
      intermediary.width = w;
      intermediary.height = h;
      var ctx = intermediary.getContext('2d');
      /* Fill black initially */
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, w, h);

      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        if (!ok) {
          try { video.pause(); document.body.removeChild(video); } catch(_){}
          cb(null, null, null);
          return;
        }
        video.pause();
        video.currentTime = 0;
        /* Draw first frame */
        try { ctx.drawImage(video, 0, 0, w, h); } catch(_){}

        var img = new fabric.Image(intermediary, {
          left: 0, top: 0,
          objectCaching: false
        });
        cb(img, video, intermediary);
      }
      video.addEventListener('loadeddata', function () { finish(true); });
      video.addEventListener('error', function () {
        console.warn('[CFS] Live video load failed for', src);
        finish(false);
      });
      video.src = src;
      video.load();
      setTimeout(function () { finish(false); }, 15000);
    }

    /**
     * Global render loop that redraws each live video's intermediary canvas
     * from the <video> element, then marks the Fabric group dirty so the
     * canvas re-renders with the latest frame.
     */
    var _cfsVideoRafId = null;
    function startVideoRenderLoop() {
      if (_cfsVideoRafId) return;
      function tick() {
        if (!canvas || !canvas.getObjects) { _cfsVideoRafId = null; return; }
        var hasVideo = false;
        canvas.getObjects().forEach(function (obj) {
          if (!obj._cfsLiveVideoEl || !obj._cfsIntermediaryCanvas) return;
          hasVideo = true;
          var video = obj._cfsLiveVideoEl;
          var ic = obj._cfsIntermediaryCanvas;
          /* Redraw the intermediary canvas from the video element */
          try {
            var ictx = ic.getContext('2d');
            ictx.drawImage(video, 0, 0, ic.width, ic.height);
          } catch(_){}
          /* Mark the Fabric.Image and Group as dirty so Fabric re-renders */
          if (obj._cfsLiveVideoImg) {
            obj._cfsLiveVideoImg.dirty = true;
            if (obj._cfsLiveVideoImg.setCoords) obj._cfsLiveVideoImg.setCoords();
          }
          obj.dirty = true;
          obj.set('objectCaching', false);
        });
        if (hasVideo) {
          canvas.requestRenderAll();
          _cfsVideoRafId = requestAnimationFrame(tick);
        } else {
          _cfsVideoRafId = null;
        }
      }
      _cfsVideoRafId = requestAnimationFrame(tick);
    }

    /**
     * Sync all live video elements to a specific timeline time.
     * Accounts for:
     *  - cfsStart  : when this clip starts on the timeline
     *  - cfsLength : how long the clip is active
     *  - cfsTrim   : skip the first N seconds of the source video
     *  - cfsSpeed  : playback speed multiplier (default 1)
     * Also dims the video group when the playhead is outside its active range.
     */
    function syncVideosToTime(timeSec) {
      if (!canvas || !canvas.getObjects) return;
      canvas.getObjects().forEach(function (obj) {
        if (!obj._cfsLiveVideoEl) return;
        var videoStart = typeof obj.cfsStart === 'number' ? obj.cfsStart : 0;
        var videoLen = typeof obj.cfsLength === 'number' ? obj.cfsLength : Infinity;
        var origClip = obj.cfsOriginalClip && typeof obj.cfsOriginalClip === 'object' ? obj.cfsOriginalClip : {};
        var origAsset = origClip.asset || {};
        var trim = typeof obj.cfsTrim === 'number' ? obj.cfsTrim
                 : (origAsset.trim != null ? Math.max(0, Number(origAsset.trim)) : 0);
        var speed = typeof obj.cfsSpeed === 'number' && obj.cfsSpeed > 0 ? obj.cfsSpeed
                  : (origAsset.speed != null && Number(origAsset.speed) > 0 ? Number(origAsset.speed) : 1);
        var rel = timeSec - videoStart;
        var active = (rel >= 0 && rel <= videoLen);
        /* Dim the group when the playhead is outside the clip range */
        if (!active) {
          if (obj.opacity !== 0.15) { obj.set('opacity', 0.15); obj.dirty = true; }
          return;
        } else {
          if (obj.opacity !== 1) { obj.set('opacity', 1); obj.dirty = true; }
        }
        /* Map timeline-relative time to source video time:
           sourceTime = trim + (rel * speed) */
        var target = Math.max(0, trim + rel * speed);
        var dur = obj._cfsLiveVideoEl.duration;
        if (dur && isFinite(dur)) target = Math.min(target, dur);
        if (obj._cfsLiveVideoEl.playbackRate !== speed) obj._cfsLiveVideoEl.playbackRate = speed;
        if (Math.abs(obj._cfsLiveVideoEl.currentTime - target) > 0.05) {
          obj._cfsLiveVideoEl.currentTime = target;
        }
      });
    }

    function addAudioClip() {
      if (!template) return;
      if (!template.timeline) template.timeline = {};
      if (!Array.isArray(template.timeline.tracks)) template.timeline.tracks = [];
      var audioUrl = '';
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'audio/*';
      fileInput.style.display = 'none';
      fileInput.onchange = function () {
        var file = fileInput.files && fileInput.files[0];
        if (file) { audioUrl = URL.createObjectURL(file); insertAudioClip(audioUrl); }
      };
      var promptUrl = null;
      try { promptUrl = window.prompt('Enter audio URL, or click Cancel to choose a file.'); } catch (_) {}
      if (promptUrl != null && promptUrl.trim() !== '') {
        audioUrl = promptUrl.trim();
        insertAudioClip(audioUrl);
      } else if (promptUrl === null) {
        /* prompt returned null — either user cancelled or prompt was blocked.
           Try the inline modal first; if the user picks a file from there, great.
           If the prompt simply wasn't blocked, this acts as the file picker fallback. */
        showIframePrompt('Enter audio URL, or choose a file.', 'audio/*', function (result) {
          if (result.url) { insertAudioClip(result.url); }
          else if (result.file) { insertAudioClip(URL.createObjectURL(result.file)); }
        });
      }
      function insertAudioClip(src) {
        var start = 0;
        /* Always create a new track for each audio clip — one element per track */
        template.timeline.tracks.push({ clips: [] });
        var audioTrackIdx = template.timeline.tracks.length - 1;
        template.timeline.tracks[audioTrackIdx].clips.push({
          asset: { type: 'audio', src: src || '{{ AUDIO_URL }}', volume: 1 },
          start: start,
          length: getTimelineEnd() || 10
        });
        saveStateDebounced();
        refreshTimeline();
        refreshPropertyPanel();
      }
    }

    function addVideo() {
      if (!canvas) return;
      var promptUrl = null;
      var promptBlocked = false;
      var t0 = Date.now();
      try { promptUrl = window.prompt('Enter video URL, or click Cancel to choose a file.'); } catch (_) { promptBlocked = true; }
      /* If prompt returned null in under 10ms, it was likely blocked by the browser
         (cross-origin iframe policy).  Real user interaction takes longer. */
      if (!promptBlocked && promptUrl === null && (Date.now() - t0) < 10) promptBlocked = true;
      if (promptUrl != null && promptUrl.trim() !== '') {
        placeVideoOnCanvas(promptUrl.trim());
      } else if (promptBlocked) {
        /* Prompt was blocked — show inline modal as fallback */
        showIframePrompt('Enter video URL, or choose a file.', 'video/*', function (result) {
          if (result.url) { placeVideoOnCanvas(result.url); }
          else if (result.file) { placeVideoOnCanvas(URL.createObjectURL(result.file)); }
        });
      } else {
        /* User cancelled prompt — show file picker */
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.style.display = 'none';
        input.onchange = function () {
          var file = input.files && input.files[0];
          if (file) placeVideoOnCanvas(URL.createObjectURL(file));
        };
        input.click();
      }
      function placeVideoOnCanvas(src) {
        if (!src || !canvas) return;
        var defaultW = 320;
        var defaultH = 180;
        var rect = new fabric.Rect({ width: defaultW, height: defaultH, fill: '#2d3748', left: 0, top: 0 });
        var label = new fabric.Text('Video…', { fontSize: 18, fill: '#e2e8f0', originX: 'center', originY: 'center', left: defaultW / 2, top: defaultH / 2 });
        var group = new fabric.Group([rect, label], { left: 80, top: 80, name: 'video_' + Date.now(), selectable: true, evented: true });
        group.set('cfsVideoSrc', src);
        group.set('cfsStart', 0);
        var clipLen = getTimelineEnd() || 5;
        group.set('cfsLength', clipLen);
        var trackIdx = getNextTrackIndex();
        group.set('cfsTrackIndex', trackIdx);
        /* Ensure template.timeline.tracks has an entry for this track so the
           layers panel (which reads from template tracks, not canvas) shows it */
        if (template) {
          if (!template.timeline) template.timeline = {};
          if (!Array.isArray(template.timeline.tracks)) template.timeline.tracks = [];
          while (template.timeline.tracks.length <= trackIdx) {
            template.timeline.tracks.push({ clips: [] });
          }
          template.timeline.tracks[trackIdx].clips.push({
            asset: { type: 'video', src: src },
            start: 0,
            length: clipLen
          });
        }
        canvas.add(group);
        canvas.setActiveObject(group);
        canvas.renderAll();
        refreshTimeline();
        refreshLayersPanel();
        refreshPropertyPanel();
        getVideoMetadata(src).then(function (meta) {
          if (!group.canvas || !canvas) return;
          if (meta.duration > 0) {
            group.set('cfsLength', Math.round(meta.duration * 10) / 10);
          }
          if (meta.width > 0 && meta.height > 0) {
            group.set('cfsVideoWidth', meta.width);
            group.set('cfsVideoHeight', meta.height);
            var maxW = 400;
            var maxH = 280;
            var scale = Math.min(maxW / meta.width, maxH / meta.height, 1);
            var w = Math.round(meta.width * scale);
            var h = Math.round(meta.height * scale);
            if (w < 80) w = 80;
            if (h < 60) h = 60;
            var groupLeft = group.left;
            var groupTop = group.top;
            var groupName = group.name;
            var cfsProps = {};
            ['cfsVideoSrc', 'cfsStart', 'cfsLength', 'cfsLengthWasEnd', 'cfsLengthAuto',
             'cfsTrackIndex', 'cfsVideoWidth', 'cfsVideoHeight', 'cfsVideoVolume',
             'cfsTrim', 'cfsSpeed',
             'cfsFadeIn', 'cfsFadeOut', 'cfsMergeKey', 'cfsOriginalClip',
             'cfsVideoMetadata', 'cfsFit', 'cfsScale', 'cfsTransition', 'cfsEffect',
             'cfsChromaKey', 'cfsFlip', 'cfsFilter'].forEach(function (k) {
              if (group[k] != null) cfsProps[k] = group[k];
            });
            /* Create a live video Fabric.Image so the user can see actual
               video frames in the canvas, synced to the timeline position. */
            createLiveVideoImage(src, w, h, function (fabricImg, videoEl, intermediaryCanvas) {
              if (!canvas) return;
              canvas.remove(group);
              var bgElement;
              if (fabricImg && videoEl && intermediaryCanvas) {
                bgElement = fabricImg;
              } else {
                bgElement = new fabric.Rect({ width: w, height: h, fill: '#2d3748', left: 0, top: 0 });
              }
              var newLabel = new fabric.Text('▶ Video', { fontSize: 16, fill: '#fff', opacity: 0.35, originX: 'center', originY: 'center', left: w / 2, top: h / 2 });
              var newGroup = new fabric.Group([bgElement, newLabel], {
                left: groupLeft, top: groupTop, name: groupName,
                selectable: true, evented: true,
                objectCaching: false
              });
              Object.keys(cfsProps).forEach(function (k) { newGroup.set(k, cfsProps[k]); });
              if (meta.metadata) newGroup.set('cfsVideoMetadata', meta.metadata);
              if (videoEl && intermediaryCanvas) {
                newGroup._cfsLiveVideoEl = videoEl;
                newGroup._cfsLiveVideoImg = fabricImg;
                newGroup._cfsIntermediaryCanvas = intermediaryCanvas;
              }
              canvas.add(newGroup);
              canvas.setActiveObject(newGroup);
              group = newGroup;
              canvas.renderAll();
              refreshTimeline();
              refreshLayersPanel();
              refreshPropertyPanel();
              if (videoEl) startVideoRenderLoop();
            });
          } else {
            if (meta.metadata) group.set('cfsVideoMetadata', meta.metadata);
            canvas.renderAll();
            refreshTimeline();
            refreshPropertyPanel();
          }
        }).catch(function () {
          try { label.set('text', 'Video'); } catch(_){}
          if (canvas) canvas.renderAll();
        });
      }
    }

    function importSvg() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/svg+xml,.svg';
      input.onchange = function () {
        const file = input.files && input.files[0];
        if (!file || !canvas) return;
        const reader = new FileReader();
        reader.onload = function (e) {
          const svg = e.target.result;
          var blob = new Blob([svg], { type: 'image/svg+xml' });
        var url = URL.createObjectURL(blob);
        function done(imgOrGroup) {
          URL.revokeObjectURL(url);
          if (!imgOrGroup) return;
          var svgOpts = { left: 80, top: 80, name: 'svg_' + Date.now() };
          if (outputTypeSelect.value === 'video' || outputTypeSelect.value === 'audio') {
            svgOpts.cfsStart = 0;
            svgOpts.cfsLength = getTimelineEnd() || 5;
            svgOpts.cfsTrackIndex = getNextTrackIndex();
          }
          imgOrGroup.set(svgOpts);
          canvas.add(imgOrGroup);
          canvas.setActiveObject(imgOrGroup);
          canvas.renderAll();
          refreshTimeline();
        }
        if (fabric.loadSVGFromURL) {
          fabric.loadSVGFromURL(url, function (objs, opts) {
            if (!objs || !objs.length) { done(null); return; }
            var obj = objs.length === 1 ? objs[0] : new fabric.Group(objs);
            done(obj);
          });
        } else {
          fabric.Image.fromURL(url, done, { crossOrigin: 'anonymous' });
        }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function importJson() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          var jsonStr = e.target && e.target.result;
          if (!jsonStr) return;
          var parsed;
          try { parsed = JSON.parse(jsonStr); } catch (err) { window.alert('Invalid JSON: ' + (err.message || err)); return; }
          if (!parsed || !parsed.timeline) {
            window.alert('Not a valid ShotStack-style template (expected timeline).');
            return;
          }
          if (typeof options.onImportJsonNoTemplate === 'function') {
            options.onImportJsonNoTemplate(parsed);
            return;
          }
          if (!canvas || !coreScene || !coreScene.shotstackToFabricStructure) return;
          /* Full template replace: update template from file and reload canvas (resize + structure). */
          template.timeline = parsed.timeline;
          template.output = parsed.output || template.output;
          template.merge = parsed.merge || template.merge;
          var g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {};
          if (typeof g.__CFS_ensureMergeEntriesForTimelinePlaceholders === 'function') {
            g.__CFS_ensureMergeEntriesForTimelinePlaceholders(template);
          }
          /* Update canvas dimensions from the imported template's output size and switch to "Custom" preset. */
          var importDims = coreScene.getOutputDimensions && coreScene.getOutputDimensions(template.output);
          if (importDims && importDims.width > 0 && importDims.height > 0) {
            width = importDims.width;
            height = importDims.height;
            if (presetSelect) {
              presetSelect.value = 'custom';
              presetSelect.dataset.previousPreset = 'custom';
            }
            if (customWidthInput) customWidthInput.value = width;
            if (customHeightInput) customHeightInput.value = height;
            updateCustomDimsVisibility();
          }
          loadTemplateIntoCanvas(canvas, function () {
            refreshTimeline();
            if (typeof options.onTemplateReplaced === 'function') options.onTemplateReplaced(parsed);
          });
        };
        reader.readAsText(file);
      };
      input.click();
    }

    var SHOTSTACK_VALID_RATIOS = { '16:9': true, '9:16': true, '1:1': true, '4:5': true, '4:3': true };
    function toShotstackAspectRatio(w, h) {
      if (!w || !h || w <= 0 || h <= 0) return undefined;
      function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
      var d = gcd(Math.round(w), Math.round(h));
      var ratio = (Math.round(w) / d) + ':' + (Math.round(h) / d);
      return SHOTSTACK_VALID_RATIOS[ratio] ? ratio : undefined;
    }

    function getShotstackTemplate() {
      if (!canvas) return null;
      if (coreScene && coreScene.restoreAllBaseStates) coreScene.restoreAllBaseStates(canvas);
      saveCurrentPageToState();
      const state = outputType === 'book' ? (pages[0] || {}) : canvas.toJSON(CFS_RESPONSIVE_KEYS);
      const dim = getCanvasDimensions();
      var mergeLookup = {};
      if (template && Array.isArray(template.merge)) {
        template.merge.forEach(function (m) {
          if (!m) return;
          var mk = m.find != null ? m.find : m.search;
          var mv = m.replace != null ? m.replace : m.value;
          if (mk == null) return;
          mergeLookup[String(mk)] = mv;
          mergeLookup[String(mk).toUpperCase().replace(/\s+/g, '_')] = mv;
        });
      }
      var currentMergeValues = (options.getMergeValues && options.getMergeValues()) || options.values || {};
      var normalizedMergeValues = buildMergeValuesFrom(currentMergeValues);
      Object.keys(normalizedMergeValues || {}).forEach(function (k) { mergeLookup[k] = normalizedMergeValues[k]; });
      var toShotstack = (typeof fabricToShotstack === 'function') ? fabricToShotstack : (typeof global !== 'undefined' && global.__CFS_fabricToShotstack);
      if (typeof toShotstack !== 'function') throw new Error('fabricToShotstack not loaded. Ensure editor/fabric-to-timeline.js is loaded before unified-editor.js.');
      let shotstack = toShotstack(
        outputType === 'book' ? { width: dim.w, height: dim.h, objects: state.objects || [], background: state.background } : state,
        {
          width: dim.w,
          height: dim.h,
          format: outputType === 'video' ? 'mp4' : 'png',
          resolution: (template && template.output && template.output.resolution) || 'hd',
          aspectRatio: (template && template.output && template.output.aspectRatio) || toShotstackAspectRatio(dim.w, dim.h),
          fps: (template && template.output && template.output.fps != null) ? template.output.fps : 25,
          mergeLookup: mergeLookup,
        }
      );
      /* Preserve original ShotStack template fields when present (e.g. after Import JSON) for round-trip export. */
      if (template && template.timeline) {
        var timelineFonts = (template.timeline.fonts && Array.isArray(template.timeline.fonts)) ? template.timeline.fonts : null;
        var outTracks = null;
        /* Merge original tracks with Fabric-derived tracks: preserve text-to-speech, caption, text-to-image, luma, html; keep order. */
        if (Array.isArray(template.timeline.tracks)) {
          var preservedTypes = ['audio', 'text-to-speech', 'caption', 'rich-caption', 'text-to-image', 'luma', 'image-to-video'];
          var fabricTypes = ['title', 'rich-text', 'text', 'image', 'video', 'rect', 'circle', 'svg', 'shape'];
          function isPreservedType(type) { return type && preservedTypes.indexOf(type) !== -1; }
          function isFabricType(type) { return type && (fabricTypes.indexOf(type) !== -1); }
          var origTracks = template.timeline.tracks;
          var fabricTracks = (shotstack.timeline && shotstack.timeline.tracks) ? shotstack.timeline.tracks : [];
          outTracks = [];
          var maxLen = Math.max(origTracks.length, fabricTracks.length);
          for (var i = 0; i < maxLen; i++) {
            var orig = origTracks[i];
            var fabric = fabricTracks[i];
            var origClips = (orig && orig.clips) ? orig.clips : [];
            var fabricClips = (fabric && fabric.clips) ? fabric.clips : [];
            var allPreserved = origClips.length > 0 && origClips.every(function (c) { return isPreservedType((c.asset || {}).type); });
            var hasFabricType = origClips.some(function (c) { return isFabricType((c.asset || {}).type); });
            if (allPreserved && orig) {
              outTracks.push(orig);
            } else if (fabricClips.length && hasFabricType) {
              var mergedClips = fabricClips.slice();
              origClips.forEach(function (c) {
                if (isPreservedType((c.asset || {}).type)) mergedClips.push(c);
              });
              outTracks.push({ clips: mergedClips });
            } else if (fabricClips.length) {
              outTracks.push(fabric);
            } else if (orig && origClips.length) {
              outTracks.push(orig);
            }
          }
        }
        /* Deduplicate clips by alias across tracks. ShotStack requires unique aliases;
           duplicates cause merge fields to resolve unpredictably (some clips render blank). */
        if (outTracks && outTracks.length) {
          var seenAliases = {};
          outTracks.forEach(function (track) {
            if (!track || !Array.isArray(track.clips)) return;
            track.clips = track.clips.filter(function (clip) {
              var a = clip && clip.alias;
              if (!a) return true;
              if (seenAliases[a]) return false;
              seenAliases[a] = true;
              return true;
            });
          });
          outTracks = outTracks.filter(function (track) { return track.clips && track.clips.length > 0; });
        }
        /* Rebuild timeline with canonical key order: fonts first (if present), then background, then tracks. */
        var tl = shotstack.timeline || {};
        if (outTracks && outTracks.length) tl.tracks = outTracks;
        var newTimeline = {};
        if (timelineFonts && timelineFonts.length) newTimeline.fonts = timelineFonts;
        newTimeline.background = tl.background != null ? tl.background : '#FFFFFF';
        if (tl.tracks && tl.tracks.length) newTimeline.tracks = tl.tracks;
        if (template.timeline.soundtrack && typeof template.timeline.soundtrack === 'object') newTimeline.soundtrack = template.timeline.soundtrack;
        Object.keys(template.timeline).forEach(function (k) {
          if (k !== 'tracks' && k !== 'fonts' && k !== 'background' && newTimeline[k] === undefined && template.timeline[k] != null) newTimeline[k] = template.timeline[k];
        });
        shotstack.timeline = newTimeline;
      }
      if (template && template.output && typeof template.output === 'object') {
        shotstack.output = Object.assign({}, template.output, shotstack.output || {});
        shotstack.output.size = { width: Math.round(dim.w), height: Math.round(dim.h) };
        shotstack.output.aspectRatio = toShotstackAspectRatio(dim.w, dim.h) || shotstack.output.aspectRatio;
        /* Don't add output keys the template didn't have (round-trip fidelity). */
        if (template.output.resolution === undefined) delete shotstack.output.resolution;
      }
      if (template && template.merge && Array.isArray(template.merge) && template.merge.length) {
        const fromCanvas = {};
        (shotstack.merge || []).forEach(function (m) {
          var f = m.find != null ? m.find : m.search;
          var r = m.replace != null ? m.replace : m.value;
          if (f != null) fromCanvas[f] = r != null ? r : '';
        });
        var sidebarValues = (options.getMergeValues && typeof options.getMergeValues === 'function' && options.getMergeValues()) || {};
        Object.keys(sidebarValues).forEach(function (k) { if (k) fromCanvas[k] = sidebarValues[k]; });
        const templateFindSet = {};
        template.merge.forEach(function (m) { templateFindSet[m.find != null ? m.find : m.search] = true; });
        const merged = template.merge.map(function (m) {
          var findKey = m.find != null ? m.find : m.search;
          var templateReplace = m.replace != null ? m.replace : m.value;
          var canvasVal = fromCanvas[findKey];
          var placeholderMatch = typeof canvasVal === 'string' && canvasVal.match(/^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/);
          var isPlaceholder = placeholderMatch && placeholderMatch[1].toUpperCase() === findKey;
          return { find: findKey, replace: (canvasVal !== undefined && !isPlaceholder) ? canvasVal : (templateReplace != null ? templateReplace : '') };
        });
        Object.keys(fromCanvas).forEach(function (k) {
          if (!templateFindSet[k]) merged.push({ find: k, replace: fromCanvas[k] });
        });
        shotstack.merge = merged;
      }
      /* Always expose merge as an array of { find, replace } (ShotStack format). */
      if (!Array.isArray(shotstack.merge)) shotstack.merge = [];
      shotstack.merge = stripCfsMetaFromMerge(shotstack.merge);
      shotstack.merge = shotstack.merge.map(function (m) {
        var findKey = m.find != null ? m.find : (m.search != null ? m.search : '');
        var replaceVal = m.replace != null ? m.replace : (m.value != null ? m.value : '');
        return { find: String(findKey), replace: replaceVal != null ? String(replaceVal) : '' };
      }).filter(function (m) { return m.find !== ''; });
      var metaEntries = serializeEditorMeta(extension);
      if (metaEntries.length) {
        shotstack.merge = shotstack.merge.concat(metaEntries);
      }
      /* Optional: scale to target resolution so font sizes and dimensions are proportional. */
      var scaleOpts = exportScaleResolution || (options.getShotstackScaleResolution && options.getShotstackScaleResolution()) || (typeof global !== 'undefined' && global.__CFS_shotstackScaleResolution) || (typeof window !== 'undefined' && window.__CFS_shotstackScaleResolution);
      if (scaleOpts && (scaleOpts.targetWidth > 0 || scaleOpts.targetHeight > 0)) {
        shotstack = scaleShotstackToResolution(shotstack, scaleOpts.targetWidth, scaleOpts.targetHeight);
      }
      /* Strip Fabric-only properties that ShotStack API rejects as unknown. */
      if (shotstack && shotstack.timeline && Array.isArray(shotstack.timeline.tracks)) {
        shotstack.timeline.tracks.forEach(function (track) {
          if (!track || !Array.isArray(track.clips)) return;
          track.clips.forEach(function (clip) {
            if (clip && clip.asset) delete clip.asset.textAlign;
          });
        });
      }
      return shotstack;
    }

    /** Scale timeline dimensions and font sizes proportionally to target resolution. */
    function scaleShotstackToResolution(shotstack, targetWidth, targetHeight) {
      if (!shotstack || !shotstack.timeline) return shotstack;
      var out = shotstack.output || {};
      var size = out.size || {};
      var cw = Number(size.width) || 1920;
      var ch = Number(size.height) || 1080;
      if (cw <= 0 || ch <= 0) return shotstack;
      targetWidth = Number(targetWidth) || cw;
      targetHeight = Number(targetHeight) || ch;
      var scaleX = targetWidth / cw;
      var scaleY = targetHeight / ch;
      var scale = (Math.abs(scaleX - scaleY) < 1e-6) ? scaleX : Math.min(scaleX, scaleY);
      if (scale <= 0 || Math.abs(scale - 1) < 1e-6) return shotstack;
      shotstack = JSON.parse(JSON.stringify(shotstack));
      shotstack.output = shotstack.output || {};
      shotstack.output.size = { width: Math.round(targetWidth), height: Math.round(targetHeight) };
      var tracks = shotstack.timeline.tracks || [];
      function scaleNum(n) { return (typeof n === 'number' && !isNaN(n)) ? Math.round(n * scale) : n; }
      function scaleOffset(o) {
        if (!o || typeof o !== 'object') return;
        if (typeof o.x === 'number') o.x = o.x * scale;
        if (typeof o.y === 'number') o.y = o.y * scale;
      }
      tracks.forEach(function (track) {
        (track.clips || []).forEach(function (clip) {
          if (clip.offset) scaleOffset(clip.offset);
          if (typeof clip.width === 'number') clip.width = scaleNum(clip.width);
          if (typeof clip.height === 'number') clip.height = scaleNum(clip.height);
          var asset = clip.asset || {};
          if (typeof asset.width === 'number') asset.width = scaleNum(asset.width);
          if (typeof asset.height === 'number') asset.height = scaleNum(asset.height);
          if (typeof asset.left === 'number') asset.left = scaleNum(asset.left);
          if (typeof asset.top === 'number') asset.top = scaleNum(asset.top);
          if (typeof asset.radius === 'number') asset.radius = scaleNum(asset.radius);
          var font = asset.font;
          if (font && typeof font.size === 'number') font.size = scaleNum(font.size);
          var line = asset.line;
          if (line) {
            if (typeof line.length === 'number') line.length = scaleNum(line.length);
            if (typeof line.thickness === 'number') line.thickness = scaleNum(line.thickness);
          }
          var style = asset.style;
          if (style && typeof style.letterSpacing === 'number') style.letterSpacing = scaleNum(style.letterSpacing);
        });
      });
      return shotstack;
    }

    function saveShotstackJson() {
      const shotstack = getShotstackTemplate();
      if (!shotstack) return;
      const str = JSON.stringify(shotstack, null, 2);
      if (options.onSaveTemplate) options.onSaveTemplate(shotstack, str);
      else {
        const blob = new Blob([str], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'template.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    }

    function _autoSaveGeneration(blob, source, format, outputType) {
      var storage = global.__CFS_generationStorage;
      if (!storage || !blob) return;
      var projectId = global.__CFS_generatorProjectId;
      if (!projectId) return;
      storage.getProjectFolderHandle().then(function (handle) {
        if (!handle) return;
        var mergeValues = null;
        try { mergeValues = (options.getMergeValues && options.getMergeValues()) || null; } catch (_) {}
        var outputSize = null;
        try {
          var tpl = (typeof getShotstackTemplate === 'function' && getShotstackTemplate()) || {};
          if (tpl.output && tpl.output.size) outputSize = { width: tpl.output.size.width, height: tpl.output.size.height };
        } catch (_) {}
        var iface = global.__CFS_generatorInterface;
        var current = iface && iface.getCurrentPlugin ? iface.getCurrentPlugin() : null;
        storage.saveGeneration(handle, projectId, {
          templateId: (current && current.id) || extension.id || 'unknown',
          templateName: (current && current.meta && current.meta.name) || extension.name || '',
          source: source,
          outputType: outputType,
          format: format,
          mergeValues: mergeValues,
          outputSize: outputSize,
        }, blob);
      }).catch(function (e) { console.warn('[CFS] autoSaveGeneration failed:', e); });
    }

    function exportPng() {
      if (!canvas) return;
      saveCurrentPageToState();
      const c = canvas;
      var otExport = outputTypeSelect && outputTypeSelect.value;
      var savedPlayheadForPng = currentPlayheadSec;
      applySeekForOutputPreview(c);
      var savedVpt = c.viewportTransform ? c.viewportTransform.slice() : null;
      if (typeof c.setViewportTransform === 'function') {
        c.setViewportTransform([1, 0, 0, 1, 0, 0]);
      }
      const dataUrl = c.toDataURL({ format: 'png', quality: 1, multiplier: 1 });
      if (savedVpt && typeof c.setViewportTransform === 'function') {
        c.setViewportTransform(savedVpt);
      }
      if (otExport === 'image' && typeof setPlayheadTime === 'function') {
        setPlayheadTime(savedPlayheadForPng);
        applySeekForOutputPreview(c);
      }
      if (options.onExportImage) options.onExportImage(dataUrl);
      else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'export.png';
        a.click();
      }
      try {
        fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
          _autoSaveGeneration(blob, 'local', 'png', 'image');
        }).catch(function () {});
      } catch (_) {}
    }

    function exportVideo() {
      var shotstack = (typeof getShotstackTemplate === 'function' && getShotstackTemplate()) || null;
      if (!shotstack || !shotstack.timeline) {
        window.alert('No timeline to export. Save as JSON or load a template first.');
        return;
      }
      /* Pre-export: ensure captions exist for any TTS clips */
      if (ensureCaptionsForTts(shotstack)) {
        /* Captions were just generated — refresh so user sees them */
        refreshTimeline();
        refreshLayersPanel();
      }
      var engine = global.__CFS_templateEngine;
      if (!engine || typeof engine.renderTimelineToVideoBlob !== 'function') {
        window.alert('Video export requires the template engine and PixiJS. Ensure pixi.min.js and pixi-timeline-player.js are loaded.');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        window.alert('Video export requires the MediaRecorder API, which is not available in this browser.');
        return;
      }
      var values = (options.getMergeValues && options.getMergeValues()) || options.values || {};
      var merge = (engine.buildMerge && engine.buildMerge(extension, values, shotstack)) || [];
      var mergedTemplate = engine.applyMergeToTemplate(shotstack, merge);
      var statusEl = root.querySelector('.cfs-recording-status');
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'cfs-recording-status';
        root.appendChild(statusEl);
      }
      statusEl.textContent = 'Loading...';
      statusEl.style.display = 'block';
      engine.renderTimelineToVideoBlob(mergedTemplate, {
        onProgress: function (elapsed, totalSeconds) {
          statusEl.textContent = 'Recording... ' + Math.floor(elapsed) + 's / ' + Math.round(totalSeconds) + 's';
        }
      }).then(function (webmBlob) {
        if (!webmBlob) { statusEl.style.display = 'none'; return; }

        function finishExport(blob, ext) {
          statusEl.style.display = 'none';
          root._cfsLastExportedVideoBlob = blob;
          if (editEvents) editEvents.emit('export:video', blob);
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'export.' + ext;
          a.click();
          _autoSaveGeneration(blob, 'local', ext, 'video');
        }

        if (global.FFmpegLocal && global.FFmpegLocal.convertToMp4) {
          statusEl.textContent = 'Converting to MP4...';
          global.FFmpegLocal.convertToMp4(webmBlob, function (msg) {
            statusEl.textContent = msg;
          }).then(function (result) {
            if (result.ok) {
              finishExport(result.blob, 'mp4');
            } else {
              console.warn('[CFS] Local MP4 conversion failed, using WebM:', result.error);
              finishExport(webmBlob, 'webm');
            }
          });
        } else {
          finishExport(webmBlob, 'webm');
        }
      }).catch(function (err) {
        statusEl.style.display = 'none';
        var msg = err && err.message ? err.message : String(err);
        if (/fetch|network|cors|failed to load/i.test(msg)) msg = msg + ' (Check that media URLs are accessible and support CORS.)';
        window.alert('Video export failed: ' + msg);
      });
    }

    if (options.addContentContainer) {
      options.addContentContainer.innerHTML = '';
      /* --- Row 1: Undo / Redo | Copy / Paste --- */
      var editRow = document.createElement('div');
      editRow.className = 'gen-tool-row';
      var _iconUndo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6.69 3L3 13"/></svg>';
      var _iconRedo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016.69 3L21 13"/></svg>';
      var _iconCopy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      var _iconPaste = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/></svg>';
      undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'gen-tool-icon-btn';
      undoBtn.title = 'Undo';
      undoBtn.innerHTML = _iconUndo;
      undoBtn.disabled = true;
      undoBtn.addEventListener('click', function () { undo(); refreshLayersPanel(); refreshPropertyPanel(); refreshTimeline(); });
      editRow.appendChild(undoBtn);
      redoBtn = document.createElement('button');
      redoBtn.type = 'button';
      redoBtn.className = 'gen-tool-icon-btn';
      redoBtn.title = 'Redo';
      redoBtn.innerHTML = _iconRedo;
      redoBtn.disabled = true;
      redoBtn.addEventListener('click', function () { redo(); refreshLayersPanel(); refreshPropertyPanel(); refreshTimeline(); });
      editRow.appendChild(redoBtn);
      var sep1 = document.createElement('div');
      sep1.className = 'gen-tool-separator';
      editRow.appendChild(sep1);
      var copySidebarBtn = document.createElement('button');
      copySidebarBtn.type = 'button';
      copySidebarBtn.className = 'gen-tool-icon-btn';
      copySidebarBtn.title = 'Copy';
      copySidebarBtn.innerHTML = _iconCopy;
      copySidebarBtn.addEventListener('click', function () { copyObject(); refreshLayersPanel(); refreshPropertyPanel(); });
      editRow.appendChild(copySidebarBtn);
      var pasteSidebarBtn = document.createElement('button');
      pasteSidebarBtn.type = 'button';
      pasteSidebarBtn.className = 'gen-tool-icon-btn';
      pasteSidebarBtn.title = 'Paste';
      pasteSidebarBtn.innerHTML = _iconPaste;
      pasteSidebarBtn.addEventListener('click', function () { pasteObject(); refreshLayersPanel(); refreshPropertyPanel(); refreshTimeline(); });
      editRow.appendChild(pasteSidebarBtn);
      options.addContentContainer.appendChild(editRow);
      /* --- Divider --- */
      var divider = document.createElement('hr');
      divider.className = 'gen-tool-divider';
      options.addContentContainer.appendChild(divider);
      /* --- Row 2: Add Text, Image, Shape, Video, Audio, Captions, SVG, HTML --- */
      var addRow = document.createElement('div');
      addRow.className = 'gen-tool-row';
      var _addIcons = [
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
      ];
      var _addLabels = ['Add Text', 'Add Image', 'Add Shape', 'Add Video', 'Add Audio', 'Add Captions', 'Import SVG', 'Add HTML'];
      var _addFns = [addText, addImage, addShape, addVideo, addAudioClip, typeof addCaptionClip === 'function' ? addCaptionClip : importSvg, importSvg, typeof addHtmlClip === 'function' ? addHtmlClip : importJson];
      _addIcons.forEach(function (icon, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gen-tool-icon-btn';
        btn.title = _addLabels[i];
        btn.innerHTML = icon;
        btn.addEventListener('click', function () { if (_addFns[i]) _addFns[i](); refreshLayersPanel(); refreshPropertyPanel(); refreshTimeline(); });
        addRow.appendChild(btn);
      });
      options.addContentContainer.appendChild(addRow);
    }
    addToolbarBtn('Save as JSON', saveShotstackJson);
    function updateExportVideoVisibility() {
      var isVideo = outputTypeSelect.value === 'video';
      if (resolutionScaleSelect) resolutionScaleSelect.style.display = isVideo ? 'inline-block' : 'none';
    }
    outputTypeSelect.addEventListener('change', updateExportVideoVisibility);
    updateExportVideoVisibility();

    resolutionScaleSelect.addEventListener('change', function () {
      var v = resolutionScaleSelect.value;
      if (v === '1080') exportScaleResolution = { targetWidth: 1920, targetHeight: 1080 };
      else exportScaleResolution = null;
    });
    if (options.onBackToPreview) addToolbarBtn('Back to preview', options.onBackToPreview);

    /** Returns { scriptInlined, configJson } or null when workflow missing/invalid. Used by generator Export and renderWalkthroughPanel. */
    function getWalkthroughExportData() {
      var values = (options.getMergeValues && options.getMergeValues()) || options.values || {};
      var workflowRaw = (values.workflowJson != null ? values.workflowJson : '').toString().trim();
      if (!workflowRaw) return null;
      var CFS = global.CFS_walkthroughExport;
      if (!CFS || !CFS.buildWalkthroughConfig || !CFS.buildWalkthroughRunnerScript) return null;
      var wf;
      try {
        wf = JSON.parse(workflowRaw);
      } catch (e) {
        return null;
      }
      var includeQuiz = !!(values.includeQuiz);
      var reportUrl = (values.reportUrl != null ? values.reportUrl : '').toString().trim();
      var config = CFS.buildWalkthroughConfig(wf, { includeCommentParts: true, includeQuiz: includeQuiz });
      if (reportUrl) {
        config.reportUrl = reportUrl;
        config.reportEvents = ['step_completed', 'walkthrough_completed', 'walkthrough_closed', 'step_viewed'];
      }
      var scriptInlined = CFS.buildWalkthroughRunnerScript(config);
      var configJson = JSON.stringify(config, null, 2);
      return { scriptInlined: scriptInlined, configJson: configJson };
    }
    function renderWalkthroughPanel() {
      walkthroughPanel.innerHTML = '';
      var values = (options.getMergeValues && options.getMergeValues()) || options.values || {};
      var workflowRaw = (values.workflowJson != null ? values.workflowJson : '').toString().trim();
      var includeQuiz = !!(values.includeQuiz);
      var reportUrl = (values.reportUrl != null ? values.reportUrl : '').toString().trim();
      var CFS = global.CFS_walkthroughExport;
      if (!CFS || !CFS.buildWalkthroughConfig || !CFS.buildWalkthroughRunnerScript) {
        walkthroughPanel.innerHTML = '<p class="cfs-editor-hint">Paste workflow JSON in the sidebar (Workflow JSON), then switch back here. Walkthrough export runs in the generator context.</p>';
        return;
      }
      if (!workflowRaw) {
        walkthroughPanel.innerHTML = '<p class="cfs-editor-hint">Paste workflow JSON in the sidebar under "Workflow JSON" to generate the embed script and config.</p>';
        return;
      }
      var wf;
      try {
        wf = JSON.parse(workflowRaw);
      } catch (e) {
        walkthroughPanel.innerHTML = '<p class="cfs-editor-hint error">Invalid workflow JSON: ' + (e && e.message ? e.message : String(e)) + '</p>';
        return;
      }
      var config = CFS.buildWalkthroughConfig(wf, { includeCommentParts: true, includeQuiz: includeQuiz });
      if (reportUrl) {
        config.reportUrl = reportUrl;
        config.reportEvents = ['step_completed', 'walkthrough_completed', 'walkthrough_closed', 'step_viewed'];
      }
      var scriptInlined = CFS.buildWalkthroughRunnerScript(config);
      var scriptExternal = CFS.buildWalkthroughRunnerScript(null, '__CFS_WALKTHROUGH_CONFIG');
      var configJson = JSON.stringify(config, null, 2);

      var actions = (wf.analyzed && wf.analyzed.actions) ? wf.analyzed.actions : (wf.actions || []);
      var editWrap = document.createElement('div');
      editWrap.className = 'cfs-walkthrough-edit-section';
      editWrap.innerHTML = '<h4>Edit step content</h4><p class="cfs-editor-hint">Change text and add image/video/audio URLs per step. Click "Apply to workflow JSON" to write back to the sidebar; then Refresh to regenerate the script.</p>';
      var stepsList = document.createElement('div');
      stepsList.className = 'cfs-walkthrough-edit-steps';
      function escapeHtml(str) {
        if (str == null) return '';
        var s = String(str);
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      for (var si = 0; si < actions.length; si++) {
        var ac = actions[si];
        var comm = ac.comment || {};
        var stepDiv = document.createElement('div');
        stepDiv.className = 'cfs-walkthrough-edit-step';
        stepDiv.dataset.stepIndex = String(si);
        var textVal = (typeof CFS_stepComment !== 'undefined' && CFS_stepComment.getStepCommentFullText)
          ? String(CFS_stepComment.getStepCommentFullText(comm) || '').trim()
          : (comm.text != null ? comm.text : '').toString().trim();
        var imageLines = [];
        if (comm.images && Array.isArray(comm.images)) {
          comm.images.forEach(function(im) { imageLines.push((im.url || '') + (im.alt ? ', ' + im.alt : '')); });
        }
        if (comm.items && comm.items.length) {
          for (var ix = 0; ix < comm.items.length; ix++) {
            var imx = comm.items[ix];
            if (imx && imx.type === 'image' && imx.url) imageLines.push((imx.url || '') + (imx.alt ? ', ' + imx.alt : ''));
          }
        }
        var imagesVal = imageLines.join('\n');
        var videoVal = (comm.video && (comm.video.url || comm.video.src)) ? (comm.video.url || comm.video.src) : '';
        var audioVal = '';
        if (comm.audio) {
          if (Array.isArray(comm.audio) && comm.audio[0]) audioVal = comm.audio[0].url || comm.audio[0].src || '';
          else if (comm.audio.url || comm.audio.src) audioVal = comm.audio.url || comm.audio.src;
        }
        if (Array.isArray(comm.items) && comm.items.length) {
          for (var ii = 0; ii < comm.items.length; ii++) {
            var cit = comm.items[ii];
            if (!cit || !cit.url) continue;
            if (!videoVal && cit.type === 'video') videoVal = cit.url;
            if (!audioVal && cit.type === 'audio') audioVal = cit.url;
          }
        }
        stepDiv.innerHTML =
          '<label>Step ' + (si + 1) + '</label>' +
          '<textarea data-edit="text" rows="2" placeholder="Step text">' + escapeHtml(textVal) + '</textarea>' +
          '<textarea data-edit="imageUrls" rows="1" placeholder="Image URLs (one per line, or url, alt)">' + escapeHtml(imagesVal) + '</textarea>' +
          '<input type="text" data-edit="videoUrl" placeholder="Video URL" value="' + escapeHtml(videoVal) + '">' +
          '<input type="text" data-edit="audioUrl" placeholder="Audio URL" value="' + escapeHtml(audioVal) + '">';
        stepsList.appendChild(stepDiv);
      }
      editWrap.appendChild(stepsList);
      var applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-outline btn-small';
      applyBtn.textContent = 'Apply to workflow JSON';
      applyBtn.onclick = function () {
        for (var si = 0; si < actions.length; si++) {
          var stepDiv = stepsList.querySelector('[data-step-index="' + si + '"]');
          if (!stepDiv) continue;
          var ac = actions[si];
          if (!ac.comment) ac.comment = {};
          var textEl = stepDiv.querySelector('[data-edit="text"]');
          var imageEl = stepDiv.querySelector('[data-edit="imageUrls"]');
          var videoEl = stepDiv.querySelector('[data-edit="videoUrl"]');
          var audioEl = stepDiv.querySelector('[data-edit="audioUrl"]');
          var newText = (textEl && textEl.value != null) ? String(textEl.value).trim() : '';
          if (Array.isArray(ac.comment.items) && ac.comment.items.length) {
            var tIdx = -1;
            for (var tx = 0; tx < ac.comment.items.length; tx++) {
              if (ac.comment.items[tx] && ac.comment.items[tx].type === 'text') { tIdx = tx; break; }
            }
            if (tIdx >= 0) ac.comment.items[tIdx].text = newText;
            else if (newText) {
              var nid = (typeof CFS_stepComment !== 'undefined' && CFS_stepComment.shortId) ? CFS_stepComment.shortId() : ('sc_' + Date.now());
              ac.comment.items.unshift({ id: nid, type: 'text', text: newText });
            }
            delete ac.comment.text;
          } else {
            ac.comment.text = newText;
          }
          var imageLines = (imageEl && imageEl.value != null) ? String(imageEl.value).trim().split('\n').map(function(s) { return s.trim(); }).filter(Boolean) : [];
          var parsedImages = imageLines.map(function(line) {
            var idx = line.indexOf(',');
            if (idx >= 0) return { url: line.slice(0, idx).trim(), alt: line.slice(idx + 1).trim() };
            return { url: line, alt: '' };
          });
          var vUrl = (videoEl && videoEl.value) ? videoEl.value.trim() : '';
          var aUrl = (audioEl && audioEl.value) ? audioEl.value.trim() : '';
          if (Array.isArray(ac.comment.items) && ac.comment.items.length) {
            var sid = (typeof CFS_stepComment !== 'undefined' && CFS_stepComment.shortId) ? function() { return CFS_stepComment.shortId(); } : function() { return 'sc_' + Date.now(); };
            var nonImg = ac.comment.items.filter(function(x) { return x && x.type !== 'image'; });
            var newItems = nonImg.concat(parsedImages.map(function(pi) {
              return { id: sid(), type: 'image', url: pi.url, alt: pi.alt || undefined };
            }));
            ac.comment.items = newItems;
            delete ac.comment.images;
            var vItem = ac.comment.items.find(function(x) { return x && x.type === 'video'; });
            var aItem = ac.comment.items.find(function(x) { return x && x.type === 'audio'; });
            if (vItem) vItem.url = vUrl;
            else if (vUrl) ac.comment.items.push({ id: sid(), type: 'video', url: vUrl });
            if (aItem) aItem.url = aUrl;
            else if (aUrl) ac.comment.items.push({ id: sid(), type: 'audio', url: aUrl });
            ac.comment.mediaOrder = ['items'];
            delete ac.comment.video;
            delete ac.comment.audio;
          } else {
            ac.comment.images = parsedImages;
            ac.comment.video = vUrl ? { url: vUrl } : undefined;
            ac.comment.audio = aUrl ? { url: aUrl } : undefined;
          }
        }
        var newJson = JSON.stringify(wf, null, 2);
        if (options.setValue) options.setValue('workflowJson', newJson);
        renderWalkthroughPanel();
      };
      editWrap.appendChild(applyBtn);
      walkthroughPanel.appendChild(editWrap);

      function addSection(title, content, isCode, filename) {
        var section = document.createElement('div');
        section.className = 'cfs-walkthrough-section';
        var h = document.createElement('h4');
        h.textContent = title;
        section.appendChild(h);
        var pre = document.createElement('pre');
        pre.className = 'cfs-walkthrough-code';
        pre.textContent = content;
        section.appendChild(pre);
        var btnRow = document.createElement('div');
        btnRow.className = 'cfs-walkthrough-actions';
        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-outline btn-small';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = function () {
          try { navigator.clipboard.writeText(content); copyBtn.textContent = 'Copied!'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); } catch (e) {}
        };
        var downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn btn-outline btn-small';
        downloadBtn.textContent = 'Download';
        downloadBtn.onclick = function () {
          var a = document.createElement('a');
          a.href = 'data:application/' + (isCode ? 'javascript' : 'json') + ';charset=utf-8,' + encodeURIComponent(content);
          a.download = filename || (isCode ? 'walkthrough-runner.js' : 'walkthrough-config.json');
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        btnRow.appendChild(copyBtn);
        btnRow.appendChild(downloadBtn);
        section.appendChild(btnRow);
        walkthroughPanel.appendChild(section);
      }
      addSection('1. Runner script (single file – config inlined)', scriptInlined, true, 'walkthrough-runner.js');
      addSection('2. Runner script (use with separate config)', scriptExternal, true, 'walkthrough-runner.js');
      addSection('3. Config JSON (set window.__CFS_WALKTHROUGH_CONFIG before loading script)', configJson, false, 'walkthrough-config.json');
      var instr = document.createElement('div');
      instr.className = 'cfs-editor-hint';
      instr.innerHTML = '<p><strong>Add to your site:</strong></p><ul><li><strong>Single file:</strong> Use script (1). Add it inline or as a &lt;script src="..."&gt;. Then call <code>__CFS_walkthrough.start()</code>.</li><li><strong>Two files:</strong> Set <code>window.__CFS_WALKTHROUGH_CONFIG =</code> the config (3), then load script (2). Call <code>__CFS_walkthrough.start()</code>.</li></ul>';
      walkthroughPanel.appendChild(instr);
    }
    function repopulatePresetSelect(forOutputType) {
      var presetsApi = global.__CFS_outputPresets;
      var list = (presetsApi && presetsApi.listPresetsForOutputType) ? presetsApi.listPresetsForOutputType(forOutputType) : [];
      var currentId = presetSelect.value;
      presetSelect.innerHTML = '';
      list.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label || p.id;
        presetSelect.appendChild(opt);
      });
      if (presetSelect.options.length) {
        var hasCurrent = Array.prototype.some.call(presetSelect.options, function (o) { return o.value === currentId; });
        presetSelect.value = hasCurrent ? currentId : presetSelect.options[0].value;
        presetSelect.dataset.previousPreset = presetSelect.value;
      }
    }

    var _lastOutputType = outputType;
    outputTypeSelect.addEventListener('change', function () {
      var newType = outputTypeSelect.value;
      var prevType = _lastOutputType;
      _lastOutputType = newType;
      root.dataset.outputType = newType;
      var showCanvas = isCanvasOutputType(newType);
      var hideForAudio = (newType === 'audio');
      canvasRow.style.display = showCanvas ? '' : 'none';
      if (presetLabel) presetLabel.style.display = hideForAudio ? 'none' : '';
      presetSelect.style.display = hideForAudio ? 'none' : '';
      if (saveFrameBtn) saveFrameBtn.style.display = hideForAudio ? 'none' : '';
      zoomLabel.style.display = hideForAudio ? 'none' : '';
      zoomSelect.style.display = hideForAudio ? 'none' : '';
      dimensionsEl.style.display = hideForAudio ? 'none' : '';
      customDimsWrap.style.display = hideForAudio ? 'none' : (presetSelect.value === 'custom' ? '' : 'none');
      resLabel.style.display = hideForAudio ? 'none' : '';
      resolutionScaleSelect.style.display = hideForAudio ? 'none' : '';
      resAspRow.style.display = hideForAudio ? 'none' : '';
      _cfgUpdateVideoOnlyFields();
      timelineWrap.style.display = (newType === 'video' || newType === 'audio') ? 'block' : 'none';
      bookPanel.style.display = newType === 'book' ? 'flex' : 'none';
      walkthroughPanel.style.display = newType === 'walkthrough' ? 'block' : 'none';
      if (newType === 'walkthrough') renderWalkthroughPanel();
      canvasWrap.classList.toggle('book-mode', newType === 'book');

      var isVideoAudioSwitch = (prevType === 'video' && newType === 'audio') || (prevType === 'audio' && newType === 'video');
      if (isVideoAudioSwitch) {
        refreshTimeline();
        refreshPropertyPanel();
        updateDimensionsDisplay();
        updateCustomDimsVisibility();
        var dim = getCanvasDimensions();
        editEvents.emit('output:resized', { width: dim.w, height: dim.h });
        return;
      }

      if (outputType === 'book') saveCurrentPageToState();
      var savedState = null;
      if (canvas && canvas.getObjects && canvas.getObjects().length > 0 && showCanvas && newType !== 'book') {
        savedState = getCanvasStateForPresetSwitch(canvas);
        if (savedState) {
          savedState.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || savedState.width);
          savedState.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || savedState.height);
          enrichSavedStateWithResponsiveProps(canvas, savedState);
        }
        if (!savedState || !savedState.objects || !savedState.objects.length) savedState = null;
      }
      fabricHead = null;
      undoPatches.length = 0;
      redoPatches.length = 0;
      updateUndoRedoButtons();
      if (newType === 'book') initBookPages();
      else if (showCanvas) {
        canvas = null;
        if (newType === 'video' || newType === 'audio') setPlayheadTime(0);
        repopulatePresetSelect(newType);
        var needTrackAssign = (newType === 'video' || newType === 'audio');
        initSingleCanvas(savedState, needTrackAssign ? function () {
          assignSeparateTracksForVideo();
          refreshTimeline();
        } : undefined);
        refreshTimeline();
        if (zoomSelect) zoomSelect.value = 'fit';
        setTimeout(function () {
          syncCanvasToPresetDimensions();
          if (typeof zoomToFit === 'function') zoomToFit();
          if (typeof resetViewportAndScroll === 'function') setTimeout(resetViewportAndScroll, 100);
        }, 50);
        setTimeout(function () {
          syncCanvasToPresetDimensions();
          if (typeof zoomToFit === 'function') zoomToFit();
        }, 200);
      }
      updateDimensionsDisplay();
      updateCustomDimsVisibility();
      var dim = getCanvasDimensions();
      editEvents.emit('output:resized', { width: dim.w, height: dim.h });
    });

    presetSelect.addEventListener('change', function () {
      updateCustomDimsVisibility();
      if (presetSelect.value === 'custom') {
        var d = getCanvasDimensions();
        width = d.w;
        height = d.h;
        if (options.getMergeValues) {
          var v = options.getMergeValues() || {};
          if (Number(v.outputWidth) > 0) width = Number(v.outputWidth);
          if (Number(v.outputHeight) > 0) height = Number(v.outputHeight);
        }
      }
      var hasContent = canvas && canvas.getObjects && canvas.getObjects().length > 0;
      var savedState = null;
      if (hasContent && outputTypeSelect.value !== 'book') {
        savedState = getCanvasStateForPresetSwitch(canvas);
        if (savedState) {
          savedState.width = canvas.getWidth ? canvas.getWidth() : (canvas.width || savedState.width);
          savedState.height = canvas.getHeight ? canvas.getHeight() : (canvas.height || savedState.height);
          enrichSavedStateWithResponsiveProps(canvas, savedState);
        }
        if (!savedState || !savedState.objects || !savedState.objects.length) savedState = null;
      }
      if (hasContent && !savedState && !window.confirm('Changing preset will reset the canvas. Continue?')) {
        presetSelect.value = presetSelect.dataset.previousPreset || presetSelect.value;
        return;
      }
      presetSelect.dataset.previousPreset = presetSelect.value;
      const dim = getCanvasDimensions();
      width = dim.w;
      height = dim.h;
      updateDimensionsDisplay();
      if (outputTypeSelect.value === 'book') renderBookCurrentPage();
      else initSingleCanvas(savedState);
      if (zoomSelect) zoomSelect.value = 'fit';
      setTimeout(function () {
        syncCanvasToPresetDimensions();
        if (canvas) { applyResponsivePositions(canvas); refreshTextboxWrapping(canvas); applySeekForOutputPreview(canvas); canvas.requestRenderAll && canvas.requestRenderAll(); }
        if (typeof zoomToFit === 'function') zoomToFit();
        if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
      }, 50);
      setTimeout(function () {
        syncCanvasToPresetDimensions();
        if (canvas) { applyResponsivePositions(canvas); refreshTextboxWrapping(canvas); applySeekForOutputPreview(canvas); canvas.requestRenderAll && canvas.requestRenderAll(); }
        if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
        if (typeof zoomToFit === 'function') zoomToFit();
        updateCanvasWrapAlignment();
      }, 150);
      setTimeout(function () {
        syncCanvasToPresetDimensions();
        if (canvas) { applyResponsivePositions(canvas); refreshTextboxWrapping(canvas); applySeekForOutputPreview(canvas); canvas.requestRenderAll && canvas.requestRenderAll(); }
        if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
        updateCanvasWrapAlignment();
      }, 400);
      setTimeout(function () {
        requestAnimationFrame(function () {
          syncCanvasToPresetDimensions();
          if (canvas) { applyResponsivePositions(canvas); refreshTextboxWrapping(canvas); applySeekForOutputPreview(canvas); canvas.requestRenderAll && canvas.requestRenderAll(); }
          if (typeof resetViewportAndScroll === 'function') resetViewportAndScroll();
          updateCanvasWrapAlignment();
        });
      }, 600);
      presetSelect.dataset.previousPreset = presetSelect.value;
      editEvents.emit('output:resized', { width: dim.w, height: dim.h });
    });

    function resetViewportAndScroll() {
      if (!canvas || !canvasWrap) return;
      var vpt = canvas.viewportTransform;
      if (vpt && vpt.length >= 6) {
        var m = vpt.slice ? vpt.slice() : [vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]];
        m[4] = 0;
        m[5] = 0;
        if (typeof canvas.setViewportTransform === 'function') canvas.setViewportTransform(m);
      }
      _cfsScrollSyncing = true;
      canvasWrap.scrollLeft = 0;
      canvasWrap.scrollTop = 0;
      if (container) {
        container.scrollLeft = 0;
        container.scrollTop = 0;
      }
      _cfsScrollSyncing = false;
      updateCanvasWrapAlignment();
      if (canvas.requestRenderAll) canvas.requestRenderAll();
    }

    function zoomToFit() {
      if (!canvas || !canvasWrap) return;
      var d = getCanvasDimensions();
      if (!d.w || !d.h) return;
      var cw = canvasWrap.clientWidth || 1;
      var ch = canvasWrap.clientHeight || 1;
      var pad = 32;
      if (zoomSelect) zoomSelect.value = 'fit';
      /* Fit must not use viewport zoom: a scaled vpt + full-size CSS canvas (see scaleFrameToFit) left
       * frame (~510px) mismatched with upper canvas CSS (~1080px), breaking getPointer and IText textarea (logs: hta fs 1px). */
      setCanvasZoom(1);
      scaleFrameToFit();
      resetViewportAndScroll();
      syncZoomScrollArea();
    }

    /** Scale the canvas frame to fit viewport so 16:9 etc never extend past visible area.
     *  Uses Fabric cssOnly dimensions (with viewport scale 1) so frame, wrapper, and canvas CSS match — required for correct pointers and IText. */
    function scaleFrameToFit() {
      if (!canvasFrameEl || !canvasWrap) return;
      var d = getCanvasDimensions();
      if (!d.w || !d.h) return;
      var cw = canvasWrap.clientWidth || 1;
      var ch = canvasWrap.clientHeight || 1;
      var pad = 32;
      var fitScale = Math.min((cw - pad) / d.w, (ch - pad) / d.h, 1);
      fitScale = Math.max(0.1, Math.min(1, fitScale));
      var displayW = Math.round(d.w * fitScale);
      var displayH = Math.round(d.h * fitScale);
      /* Frame uses fitted display size so it never extends past viewport */
      canvasFrameEl.style.width = displayW + 'px';
      canvasFrameEl.style.height = displayH + 'px';
      canvasFrameEl.style.maxWidth = displayW + 'px';
      canvasFrameEl.style.maxHeight = displayH + 'px';
      canvasFrameEl.style.transform = '';
      var dpx = displayW + 'px';
      var dpy = displayH + 'px';
      var wrapper = canvas && (canvas.wrapperEl || (canvas.lowerCanvas && canvas.lowerCanvas.parentNode) || (canvasFrameEl && canvasFrameEl.firstChild));
      if (wrapper && wrapper.style) {
        wrapper.style.transform = '';
        wrapper.style.transformOrigin = '';
        wrapper.style.width = dpx;
        wrapper.style.height = dpy;
        wrapper.style.maxWidth = dpx;
        wrapper.style.maxHeight = dpy;
      }
      /* Fabric 5: cssOnly skips i+="px", so numeric values never become valid CSS — canvas stayed ~1080px inside a ~510px frame (clipped). Pass strings with units. */
      if (canvas && typeof canvas.setDimensions === 'function') {
        try {
          canvas.setDimensions({ width: dpx, height: dpy }, { cssOnly: true });
        } catch (_) {}
      }
      if (canvas && typeof canvas.calcOffset === 'function') {
        try { canvas.calcOffset(); } catch (_) {}
      }
      if (canvas && canvas.requestRenderAll) canvas.requestRenderAll();
    }

    function resetFrameScale() {
      if (!canvasFrameEl || !canvas) return;
      var d = getCanvasDimensions();
      if (!d.w || !d.h) return;
      canvasFrameEl.style.width = d.w + 'px';
      canvasFrameEl.style.height = d.h + 'px';
      canvasFrameEl.style.maxWidth = d.w + 'px';
      canvasFrameEl.style.maxHeight = d.h + 'px';
      var pxw = d.w + 'px';
      var pxh = d.h + 'px';
      var wrapper = canvas.wrapperEl || (canvas.lowerCanvas && canvas.lowerCanvas.parentNode) || (canvasFrameEl && canvasFrameEl.firstChild);
      if (wrapper && wrapper.style) {
        wrapper.style.transform = '';
        wrapper.style.transformOrigin = '';
        wrapper.style.width = pxw;
        wrapper.style.height = pxh;
        wrapper.style.maxWidth = pxw;
        wrapper.style.maxHeight = pxh;
      }
      if (typeof canvas.setDimensions === 'function') {
        try {
          canvas.setDimensions({ width: pxw, height: pxh }, { cssOnly: true });
        } catch (_) {}
      }
      if (typeof canvas.calcOffset === 'function') {
        try { canvas.calcOffset(); } catch (_) {}
      }
    }

    zoomSelect.addEventListener('change', function () {
      if (zoomSelect.value === 'fit') {
        zoomToFit();
        return;
      }
      resetFrameScale();
      canvasZoom = parseFloat(zoomSelect.value, 10) || 1;
      setCanvasZoom(canvasZoom);
    });

    function showContextMenu(e) {
      if (!root.contains(e.target)) return;
      e.preventDefault();
      var existing = document.getElementById('cfs-editor-context-menu');
      if (existing) existing.remove();
      var menu = document.createElement('div');
      menu.id = 'cfs-editor-context-menu';
      menu.className = 'cfs-editor-context-menu';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      var hasObj = canvas && canvas.getActiveObject && canvas.getActiveObject();
      function item(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', function () { fn(); closeMenu(); });
        menu.appendChild(b);
      }
      if (hasObj) {
        item('Duplicate', duplicateSelectedObject);
        item('Delete', removeSelectedObject);
        item('Copy', copyObject);
        var active = canvas.getActiveObject();
        var canGroup = fabric && fabric.ActiveSelection && active instanceof fabric.ActiveSelection && typeof active.getObjects === 'function' && active.getObjects().length >= 2;
        var canUngroup = active && active.type === 'group' && typeof active.getObjects === 'function' && active.getObjects().length > 0;
        if (canGroup) item('Group', groupSelectedObjects);
        if (canUngroup) item('Ungroup', ungroupSelectedObject);
      }
      item('Paste', pasteObject);
      if (hasObj) {
        item('Bring to front', function () { layerOrder('front'); });
        item('Send to back', function () { layerOrder('back'); });
      }
      document.body.appendChild(menu);
      function closeMenu() {
        if (menu.parentNode) menu.remove();
        document.removeEventListener('click', closeMenu);
      }
      setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
    }

    canvasWrap.addEventListener('contextmenu', showContextMenu);

    var canvasRow = document.createElement('div');
    canvasRow.className = 'cfs-editor-canvas-row';
    var layersTarget = options.layersContainer || rightColumn;
    var propertyTarget = options.propertyPanelContainer || rightColumn;
    layersTarget.appendChild(layersPanel);
    propertyTarget.appendChild(propertyPanel);
    canvasRow.appendChild(canvasWrap);
    if (!options.layersContainer && !options.propertyPanelContainer) {
      canvasRow.appendChild(rightColumn);
    }
    if (options.toolbarContainer) {
      toolbar.classList.add('cfs-toolbar-in-preview');
      options.toolbarContainer.insertBefore(toolbar, options.toolbarContainer.firstChild);
      if (typeof options.onOutputTypeChange === 'function') {
        outputTypeSelect.addEventListener('change', function () { options.onOutputTypeChange(outputTypeSelect.value); });
      }
    } else {
      root.appendChild(toolbar);
    }
    root.appendChild(canvasRow);
    root.appendChild(timelineWrap);
    root.appendChild(bookPanel);
    root.appendChild(walkthroughPanel);

    var timelineContainer = document.createElement('div');
    timelineContainer.className = 'cfs-editor-timeline';
    var timelineScale = 80;
    var timelineArea = document.createElement('div');
    timelineArea.className = 'cfs-editor-timeline-area';
    timelineArea.style.position = 'relative';
    var playheadEl = document.createElement('div');
    playheadEl.className = 'cfs-editor-playhead';
    playheadEl.style.cssText = 'position:absolute;left:0;top:0;width:2px;background:#e11;z-index:10;cursor:ew-resize;pointer-events:auto;';
    var playheadHandle = document.createElement('div');
    playheadHandle.style.cssText = 'position:absolute;top:-2px;left:-5px;width:12px;height:12px;background:#e11;border-radius:2px;cursor:ew-resize;';
    playheadEl.appendChild(playheadHandle);
    var timelineToolbar = document.createElement('div');
    timelineToolbar.className = 'cfs-editor-timeline-toolbar';
    timelineToolbar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    var isTimelinePlaying = false;
    var timelinePlayStartTime = 0;
    var timelinePlayStartWall = 0;
    var timelinePlayRaf = null;
    var currentPlayheadSec = 0;
    function getTrackLabelWidth() {
      /* Measure actual offset from container to the first clip or track area */
      if (timelineContainer) {
        var firstTrack = timelineContainer.querySelector('.cfs-editor-track');
        if (firstTrack) {
          var containerRect = timelineContainer.getBoundingClientRect();
          var trackRect = firstTrack.getBoundingClientRect();
          return trackRect.left - containerRect.left;
        }
      }
      var panel = global.__CFS_timelinePanel;
      return (panel && panel.TRACK_LABEL_WIDTH) || 52;
    }

    function setPlayheadTime(t) {
      currentPlayheadSec = t;
      if (playheadEl) playheadEl.style.left = (t * timelineScale + getTrackLabelWidth()) + 'px';
      syncVideosToTime(t);
      editEvents.emit('playback:time', { time: t });
    }
    function updatePlayheadExtent() {
      if (!playheadEl || !timelineContainer) return;
      var rows = timelineContainer.querySelectorAll('.cfs-editor-track-row');
      if (!rows.length) return;
      var first = rows[0];
      var last = rows[rows.length - 1];
      var topOffset = first.offsetTop;
      var totalHeight = last.offsetTop + last.offsetHeight - topOffset;
      playheadEl.style.top = topOffset + 'px';
      playheadEl.style.height = totalHeight + 'px';
    }

    stateRef.getPlaybackTime = function () { return currentPlayheadSec; };
    stateRef.isPlaying = function () { return isTimelinePlaying; };
    stateRef.getSelectedObject = function () { return canvas && canvas.getActiveObject ? canvas.getActiveObject() : null; };
    stateRef.getEdit = function () { return getShotstackTemplate ? getShotstackTemplate() : null; };
    stateRef._snapDisabled = false;

    (function initPlayheadScrub() {
      var isScrubbing = false;

      function timeFromMouseEvent(e) {
        var scrollParent = timelineResizeWrap || timelineArea.parentNode;
        var scrollLeft = scrollParent ? scrollParent.scrollLeft : 0;
        var areaRect = timelineArea.getBoundingClientRect();
        var x = e.clientX - areaRect.left + scrollLeft - getTrackLabelWidth();
        return Math.max(0, x / timelineScale);
      }

      function seekTo(t) {
        if (isTimelinePlaying) {
          isTimelinePlaying = false;
          if (timelinePlayRaf != null) { cancelAnimationFrame(timelinePlayRaf); timelinePlayRaf = null; }
          if (playBtn) playBtn.textContent = 'Play';
          editEvents.emit('playback:pause', {});
        }
        setPlayheadTime(t);
        if (coreScene && coreScene.seekToTime && canvas) coreScene.seekToTime(canvas, t);
        if (canvas && canvas.renderAll) canvas.renderAll();
        editEvents.emit('playback:seek', { time: t });
      }

      function onScrubMove(e) {
        if (!isScrubbing) return;
        e.preventDefault();
        seekTo(timeFromMouseEvent(e));
      }

      function onScrubUp() {
        isScrubbing = false;
        document.removeEventListener('mousemove', onScrubMove);
        document.removeEventListener('mouseup', onScrubUp);
      }

      playheadEl.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isScrubbing = true;
        document.addEventListener('mousemove', onScrubMove);
        document.addEventListener('mouseup', onScrubUp);
      });

      timelineArea.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var target = e.target;
        while (target && target !== timelineArea) {
          if (target.classList && (target.classList.contains('cfs-editor-clip') || target.classList.contains('cfs-editor-timeline-resize-handle'))) return;
          target = target.parentNode;
        }
        e.preventDefault();
        isScrubbing = true;
        seekTo(timeFromMouseEvent(e));
        document.addEventListener('mousemove', onScrubMove);
        document.addEventListener('mouseup', onScrubUp);
      });
    })();

    var _previewAudioEls = []; /* Active Audio elements for preview playback */
    function stopTimelinePlay() {
      isTimelinePlaying = false;
      if (timelinePlayRaf != null) {
        cancelAnimationFrame(timelinePlayRaf);
        timelinePlayRaf = null;
      }
      /* Stop all preview audio */
      _previewAudioEls.forEach(function (a) {
        try { a.pause(); a.currentTime = 0; } catch (_) {}
        try { if (a._cfsBlobUrl) URL.revokeObjectURL(a._cfsBlobUrl); } catch (_) {}
      });
      _previewAudioEls = [];
      /* Stop any speechSynthesis utterances from preview */
      try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (_) {}
      editEvents.emit('playback:pause', {});
    }
    function playTimelinePreview() {
      if (isTimelinePlaying) {
        stopTimelinePlay();
        if (playBtn) playBtn.textContent = 'Play';
        return;
      }
      editEvents.emit('playback:play', {});
      if (playBtn) playBtn.textContent = '⏳ Generating…';

      /* ── Build per-chunk audio segments from TTS clips ── */
      var ttsGenerate = typeof window.__CFS_ttsGenerate === 'function' ? window.__CFS_ttsGenerate : null;
      var ttsPromises = [];

      if (canvas && canvas.getObjects && ttsGenerate) {
        /* Build caption words lookup keyed by clip start time */
        var captionWordsMap = {};
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsIsCaption && obj.cfsCaptionWords && obj.cfsCaptionWords.length) {
            captionWordsMap[obj.cfsStart != null ? obj.cfsStart : 0] = {
              words: obj.cfsCaptionWords,
              display: obj.cfsCaptionDisplay || {}
            };
          } else if (obj.cfsOriginalClip && obj.cfsOriginalClip.asset) {
            var oa = obj.cfsOriginalClip.asset;
            if ((oa.type === 'caption' || oa.type === 'rich-caption') && Array.isArray(oa.words) && oa.words.length) {
              captionWordsMap[obj.cfsStart != null ? obj.cfsStart : 0] = {
                words: oa.words,
                display: oa.display || {}
              };
            }
          }
        });

        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsAudioType !== 'text-to-speech' || !obj.cfsTtsText) return;
          var fullText = String(obj.cfsTtsText).trim();
          if (!fullText) return;
          var voiceName = obj.cfsTtsLocalVoice || obj.cfsTtsVoice || '';
          /* If voice is not a Kokoro voice ID (e.g. legacy "Amy"), fall back to af_heart */
          var isKokoro = /^[a-z]{2}_[a-z]/i.test(voiceName);
          if (!isKokoro) voiceName = 'af_heart';

          var clipStart = obj.cfsStart != null ? obj.cfsStart : 0;

          /* Find matching caption words */
          var capInfo = captionWordsMap[clipStart];
          var words = capInfo ? capInfo.words : null;
          var capDisplay = capInfo ? capInfo.display : {};
          var wpl = capDisplay.wordsPerLine || 4;
          var numLines = capDisplay.lines || 2;
          var chunkSize = wpl * numLines;

          /* Split text into chunks using word timings or simple word split */
          var textWords = fullText.split(/\s+/).filter(Boolean);
          var chunks = [];
          if (words && words.length) {
            for (var ci = 0; ci < words.length; ci += chunkSize) {
              var chunkWords = words.slice(ci, ci + chunkSize);
              var chunkText = chunkWords.map(function (w) { return w.text; }).join(' ');
              chunks.push({
                text: chunkText,
                timeStart: chunkWords[0].start,
                timeEnd: chunkWords[chunkWords.length - 1].end,
                wordStart: ci,
                wordEnd: Math.min(ci + chunkSize - 1, words.length - 1)
              });
            }
          } else {
            /* No word timings — split text into equal-sized chunks */
            var estDuration = Math.max(2, textWords.length / 2.5);
            var estChunkDur = estDuration / Math.ceil(textWords.length / chunkSize);
            for (var ci2 = 0; ci2 < textWords.length; ci2 += chunkSize) {
              var chunkIdx = ci2 / chunkSize;
              chunks.push({
                text: textWords.slice(ci2, ci2 + chunkSize).join(' '),
                timeStart: chunkIdx * estChunkDur,
                timeEnd: (chunkIdx + 1) * estChunkDur,
                wordStart: ci2,
                wordEnd: Math.min(ci2 + chunkSize - 1, textWords.length - 1)
              });
            }
          }

          /* Check cache — only regenerate chunks whose text changed */
          var cached = obj._cfsTtsChunks || [];
          var cachedVoice = obj._cfsTtsCachedVoice || '';
          var needsRegen = cachedVoice !== voiceName || cached.length !== chunks.length;
          if (!needsRegen) {
            for (var cci = 0; cci < chunks.length; cci++) {
              if (!cached[cci] || cached[cci].text !== chunks[cci].text) { needsRegen = true; break; }
            }
          }

          if (!needsRegen) return; /* all cached */

          /* Generate audio for each chunk sequentially */
          var voice = voiceName || 'af_heart';
          var ttsCache = global.__CFS_ttsAudioCache || null;
          var ttsCacheProjRoot = null;
          var ttsCacheProjId = (global.__CFS_generatorProjectId || '').toString().trim();
          var ttsCacheTemplateId = (extension.id || '').toString().trim();
          var ttsCacheReady = (ttsCache && ttsCacheProjId && ttsCacheTemplateId);
          var ttsCacheLoadRoot = ttsCacheReady
            ? (global.__CFS_generationStorage && global.__CFS_generationStorage.getProjectFolderHandle
              ? global.__CFS_generationStorage.getProjectFolderHandle()
              : Promise.resolve(null))
            : Promise.resolve(null);

          function genChunksSequential(idx, results, projRoot) {
            if (idx >= chunks.length) return Promise.resolve(results);
            var chunk = chunks[idx];
            /* 1. Reuse in-memory cached blob if text AND voice unchanged */
            if (cachedVoice === voice && cached[idx] && cached[idx].text === chunk.text && cached[idx].blob) {
              chunk.blob = cached[idx].blob;
              chunk.duration = cached[idx].duration;
              chunk.sttWords = cached[idx].sttWords || null;
              chunk.cacheKey = cached[idx].cacheKey || null;
              results.push(chunk);
              return genChunksSequential(idx + 1, results, projRoot);
            }
            /* 2. Try disk cache */
            var diskPromise;
            if (ttsCache && projRoot && ttsCacheProjId && ttsCacheTemplateId) {
              var key = ttsCache.getChunkKey(voice, chunk.text);
              diskPromise = ttsCache.loadTtsChunk(projRoot, ttsCacheProjId, ttsCacheTemplateId, key).then(function (hit) {
                if (hit && hit.blob) {
                  chunk.blob = hit.blob;
                  chunk.duration = hit.duration || 0;
                  chunk.cacheKey = key;
                  /* Carry cached word timings so STT can be skipped */
                  if (hit.words && hit.words.length) chunk.sttWords = hit.words;
                  console.log('[TTS cache] Loaded chunk ' + idx + ' from disk: ' + key + (hit.words ? ' (with words)' : ''));
                  results.push(chunk);
                  return genChunksSequential(idx + 1, results, projRoot);
                }
                return null; /* miss */
              }).catch(function () { return null; });
            } else {
              diskPromise = Promise.resolve(null);
            }
            return diskPromise.then(function (handled) {
              if (handled != null) return handled; /* disk cache hit returned the chain */
              /* 3. Generate fresh via TTS engine */
              return ttsGenerate(chunk.text, { voice: voice }).then(function (blob) {
                if (!blob || blob.size < 100) {
                  results.push(chunk);
                  return genChunksSequential(idx + 1, results, projRoot);
                }
                /* 3b. Trim leading/trailing silence */
                var trimPromise = (ttsCache && ttsCache.trimSilence)
                  ? ttsCache.trimSilence(blob)
                  : Promise.resolve({ blob: blob, duration: 0 });
                return trimPromise.then(function (trimResult) {
                  chunk.blob = trimResult.blob;
                  chunk.duration = trimResult.duration;
                  /* If trimSilence couldn't determine duration, measure via Audio element */
                  if (!chunk.duration) {
                    return new Promise(function (resolve) {
                      var url = URL.createObjectURL(chunk.blob);
                      var a = new Audio(url);
                      a.addEventListener('loadedmetadata', function () {
                        chunk.duration = a.duration;
                        URL.revokeObjectURL(url);
                        resolve();
                      });
                      a.addEventListener('error', function () { URL.revokeObjectURL(url); resolve(); });
                      a.load();
                    });
                  }
                }).then(function () {
                  /* 4. Save to disk cache */
                  if (ttsCache && projRoot && ttsCacheProjId && ttsCacheTemplateId && chunk.blob) {
                    var saveKey = ttsCache.getChunkKey(voice, chunk.text);
                    chunk.cacheKey = saveKey;
                    return ttsCache.saveTtsChunk(projRoot, ttsCacheProjId, ttsCacheTemplateId, voice, chunk.text, chunk.blob, chunk.duration).then(function () {
                      console.log('[TTS cache] Saved chunk ' + idx + ' to disk: ' + saveKey);
                    }).catch(function () {}).then(function () {
                      results.push(chunk);
                      return genChunksSequential(idx + 1, results, projRoot);
                    });
                  }
                  results.push(chunk);
                  return genChunksSequential(idx + 1, results, projRoot);
                });
              }).catch(function () {
                results.push(chunk);
                return genChunksSequential(idx + 1, results, projRoot);
              });
            });
          }

          var p = ttsCacheLoadRoot.then(function (projRoot) {
            ttsCacheProjRoot = projRoot;
            return genChunksSequential(0, [], projRoot);
          }).then(function (results) {
            obj._cfsTtsChunks = results;
            obj._cfsTtsCachedVoice = voice;
            /* Compute total TTS duration from chunk durations */
            var totalDur = 0;
            results.forEach(function (c) { totalDur += (c.duration || 0); });
            obj._cfsTtsDuration = totalDur;

            /* ── Get exact word timings via STT on each audio chunk ── */
            var sttGenerate = typeof global.__CFS_sttGenerate === 'function' ? global.__CFS_sttGenerate : null;
            if (!capInfo || !capInfo.words || !capInfo.words.length || !results.length || !global.__CFS_chunkUtils) {
              return;
            }
            var capChunks = global.__CFS_chunkUtils.buildCaptionChunks(capInfo.words, capDisplay);
            if (capChunks.length !== results.length) return;

            /* Run STT on each chunk sequentially, then update word timings */
            function sttChunkSequential(idx, runningOffset) {
              if (idx >= results.length) return Promise.resolve();
              var chunk = capChunks[idx];
              var audioChunk = results[idx];
              var realDur = audioChunk.duration || 0;
              var numWordsInChunk = chunk.wordEndIdx - chunk.wordStartIdx + 1;

              if (numWordsInChunk <= 0 || realDur <= 0) {
                return sttChunkSequential(idx + 1, runningOffset + realDur);
              }

              /* Try STT if we have an audio blob and STT is available */
              var sttPromise;
              if (audioChunk.sttWords && audioChunk.sttWords.length) {
                /* Reuse cached STT words from a previous run */
                console.log('[CFS STT] Chunk ' + idx + ': reusing ' + audioChunk.sttWords.length + ' cached STT words');
                sttPromise = Promise.resolve(audioChunk.sttWords);
              } else if (sttGenerate && audioChunk.blob && audioChunk.blob.size > 100) {
                console.log('[CFS STT] Chunk ' + idx + ': running STT on ' + audioChunk.blob.size + ' byte blob...');
                sttPromise = sttGenerate(audioChunk.blob, {}).then(function (sttResult) {
                  if (sttResult && sttResult.words && sttResult.words.length) {
                    console.log('[CFS STT] Chunk ' + idx + ': got ' + sttResult.words.length + ' STT words (need ' + numWordsInChunk + ')');
                    audioChunk.sttWords = sttResult.words;
                    return sttResult.words;
                  }
                  console.warn('[CFS STT] Chunk ' + idx + ': STT returned no words, falling back to even distribution');
                  return null;
                }).catch(function (err) {
                  console.warn('[CFS STT] Chunk ' + idx + ': STT failed (' + (err && err.message || err) + '), falling back to even distribution');
                  return null;
                });
              } else {
                console.warn('[CFS STT] Chunk ' + idx + ': no STT available (sttGenerate=' + !!sttGenerate + ', blob=' + !!(audioChunk.blob) + ')');
                sttPromise = Promise.resolve(null);
              }

              return sttPromise.then(function (sttWords) {
                if (sttWords && sttWords.length) {
                  /* Map STT words to caption words. If counts match, 1:1 mapping.
                     Otherwise, distribute STT timings across caption words proportionally. */
                  if (sttWords.length === numWordsInChunk) {
                    /* Perfect match — use STT timings directly */
                    for (var wi = 0; wi < numWordsInChunk; wi++) {
                      var cw = capInfo.words[chunk.wordStartIdx + wi];
                      cw.start = Math.round((runningOffset + sttWords[wi].start) * 1000) / 1000;
                      cw.end = Math.round((runningOffset + sttWords[wi].end) * 1000) / 1000;
                    }
                  } else {
                    /* Word count differs — map by time proportion.
                       Use STT total span to scale caption word boundaries. */
                    var sttSpan = sttWords[sttWords.length - 1].end - sttWords[0].start;
                    if (sttSpan > 0) {
                      /* For each caption word, find the matching STT word by position ratio */
                      for (var wi2 = 0; wi2 < numWordsInChunk; wi2++) {
                        var ratio = wi2 / numWordsInChunk;
                        var ratioEnd = (wi2 + 1) / numWordsInChunk;
                        /* Find bounding STT words */
                        var sttIdxStart = Math.min(Math.floor(ratio * sttWords.length), sttWords.length - 1);
                        var sttIdxEnd = Math.min(Math.floor(ratioEnd * sttWords.length), sttWords.length - 1);
                        var cw2 = capInfo.words[chunk.wordStartIdx + wi2];
                        cw2.start = Math.round((runningOffset + sttWords[sttIdxStart].start) * 1000) / 1000;
                        cw2.end = Math.round((runningOffset + sttWords[sttIdxEnd].end) * 1000) / 1000;
                      }
                    } else {
                      /* Fallback: character-proportional distribution */
                      distributeByCharLength(capInfo.words, chunk.wordStartIdx, numWordsInChunk, runningOffset, realDur);
                    }
                  }
                } else {
                  /* No STT result — fallback: character-proportional distribution.
                     Longer words get more time than shorter ones. */
                  distributeByCharLength(capInfo.words, chunk.wordStartIdx, numWordsInChunk, runningOffset, realDur);
                }

                return sttChunkSequential(idx + 1, runningOffset + realDur);
              });
            }

            /* Distribute word timings proportional to character length within a chunk */
            function distributeByCharLength(words, startIdx, count, offset, duration) {
              var totalChars = 0;
              for (var i = 0; i < count; i++) {
                totalChars += Math.max(1, (words[startIdx + i].text || '').replace(/[^a-zA-Z0-9]/g, '').length);
              }
              if (totalChars <= 0) totalChars = count; /* safety */
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

            return sttChunkSequential(0, 0).then(function () {
              /* Update TTS chunk timeStart/timeEnd so timeline chunk bars align */
              var chunkOffset = 0;
              for (var rci2 = 0; rci2 < results.length; rci2++) {
                results[rci2].timeStart = chunkOffset;
                results[rci2].timeEnd = chunkOffset + (results[rci2].duration || 0);
                chunkOffset += (results[rci2].duration || 0);
              }
              /* Extend the last word's end time to cover the full TTS duration
                 so the caption track doesn't end before the audio finishes */
              if (capInfo.words.length && chunkOffset > 0) {
                var lastWord = capInfo.words[capInfo.words.length - 1];
                if (lastWord.end < chunkOffset) {
                  lastWord.end = Math.round(chunkOffset * 1000) / 1000;
                }
              }
              console.log('[CFS STT] Final word timing range: 0 → ' +
                (capInfo.words.length ? capInfo.words[capInfo.words.length - 1].end : '?') +
                's (' + capInfo.words.length + ' words), TTS total: ' + chunkOffset + 's');
              /* Update the canvas caption object's words too */
              canvas.getObjects().forEach(function (cObj) {
                if (cObj.cfsIsCaption && cObj.cfsCaptionWords) {
                  cObj.cfsCaptionWords = capInfo.words;
                }
                /* Also update original clip reference so export picks up new timings */
                if (cObj.cfsIsCaption && cObj.cfsOriginalClip && cObj.cfsOriginalClip.asset) {
                  cObj.cfsOriginalClip.asset.words = capInfo.words;
                }
              });
              /* Update the template's caption asset words too */
              if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
                template.timeline.tracks.forEach(function (tr) {
                  (tr.clips || []).forEach(function (cl) {
                    var a = cl.asset || {};
                    if ((a.type === 'caption' || a.type === 'rich-caption') && a.words) {
                      a.words = capInfo.words;
                    }
                  });
                });
              }
              /* ── Persist word timings per-chunk to the disk cache manifest ── */
              if (ttsCache && ttsCache.updateChunkWords && ttsCacheProjRoot && ttsCacheProjId && ttsCacheTemplateId) {
                var _wordRoot = ttsCacheProjRoot;
                /* Serialize updates to avoid manifest write races */
                var chain = Promise.resolve();
                results.forEach(function (rc) {
                  var ck = rc.cacheKey || (ttsCache.getChunkKey ? ttsCache.getChunkKey(voiceName, rc.text) : '');
                  if (!ck) return;
                  /* Extract the words belonging to this chunk */
                  var chunkWords = capInfo.words.slice(rc.wordStart, rc.wordEnd + 1);
                  if (!chunkWords.length) return;
                  /* Store relative to chunk start (offset = 0) */
                  var chunkStart = chunkWords[0].start || 0;
                  var relWords = chunkWords.map(function (w) {
                    return { text: w.text, start: Math.round((w.start - chunkStart) * 1000) / 1000, end: Math.round((w.end - chunkStart) * 1000) / 1000 };
                  });
                  chain = chain.then(function () {
                    return ttsCache.updateChunkWords(_wordRoot, ttsCacheProjId, ttsCacheTemplateId, ck, relWords)
                      .then(function () { console.log('[TTS cache] Saved word timings for ' + ck); })
                      .catch(function () {});
                  });
                });
                chain.catch(function () {});
              }
            });
          });
          ttsPromises.push(p);
        });
      }

      (ttsPromises.length > 0 ? Promise.all(ttsPromises) : Promise.resolve()).then(function () {
        /* ── Prune unused TTS cache files ── */
        if (global.__CFS_ttsAudioCache && canvas && canvas.getObjects) {
          var activeKeys = [];
          canvas.getObjects().forEach(function (obj) {
            if (obj._cfsTtsChunks && obj._cfsTtsChunks.length) {
              obj._cfsTtsChunks.forEach(function (c) {
                if (c.cacheKey) activeKeys.push(c.cacheKey);
              });
            }
          });
          var _pruneCache = global.__CFS_ttsAudioCache;
          var _prunePid = (global.__CFS_generatorProjectId || '').toString().trim();
          var _pruneTid = (extension.id || '').toString().trim();
          if (_prunePid && _pruneTid && activeKeys.length) {
            (global.__CFS_generationStorage && global.__CFS_generationStorage.getProjectFolderHandle
              ? global.__CFS_generationStorage.getProjectFolderHandle()
              : Promise.resolve(null)
            ).then(function (root) {
              if (root) {
                _pruneCache.pruneUnusedChunks(root, _prunePid, _pruneTid, activeKeys).then(function (removed) {
                  if (removed) console.log('[TTS cache] Pruned ' + removed + ' unused chunk(s)');
                }).catch(function () {});
              }
            }).catch(function () {});
          }
        }
        if (!canvas) return;

        var total = (coreScene && coreScene.getTimelineFromCanvas && canvas) ? coreScene.getTimelineFromCanvas(canvas).durationSec : 10;
        var clips = (global.__CFS_timelinePanel && global.__CFS_timelinePanel.buildClipsFromCanvas) ? global.__CFS_timelinePanel.buildClipsFromCanvas(canvas, 5) : [];
        if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
          var tClips = global.__CFS_timelinePanel && global.__CFS_timelinePanel.buildClipsFromTemplate ? global.__CFS_timelinePanel.buildClipsFromTemplate(template) : [];
          tClips.filter(function (c) { return c.type === 'audio'; }).forEach(function (c) { clips.push(c); });
        }
        clips.forEach(function (c) { total = Math.max(total, (c.start || 0) + (typeof c.length === 'number' ? c.length : 5)); });

        /* ── Auto-extend: use real TTS chunk durations + caption word timings ── */
        if (canvas && canvas.getObjects) {
          canvas.getObjects().forEach(function (obj) {
            var objStart = obj.cfsStart != null ? obj.cfsStart : 0;
            /* Sum of chunk durations */
            if (obj._cfsTtsChunks && obj._cfsTtsChunks.length) {
              var lastChunk = obj._cfsTtsChunks[obj._cfsTtsChunks.length - 1];
              if (lastChunk.timeEnd) {
                total = Math.max(total, objStart + lastChunk.timeEnd + 0.3);
              }
              if (obj._cfsTtsDuration > 0) {
                total = Math.max(total, objStart + obj._cfsTtsDuration + 0.3);
              }
            }
            /* Caption word timings */
            var capWords = obj.cfsCaptionWords || (obj.cfsOriginalClip && obj.cfsOriginalClip.asset && Array.isArray(obj.cfsOriginalClip.asset.words) ? obj.cfsOriginalClip.asset.words : null);
            if (capWords && capWords.length) {
              total = Math.max(total, objStart + (capWords[capWords.length - 1].end || 0) + 0.5);
            }
          });
        }

        /* ── Auto-extend template clip lengths to match total duration ── */
        if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
          template.timeline.tracks.forEach(function (tr) {
            (tr.clips || []).forEach(function (clip) {
              if (typeof clip.length === 'number' && clip.length < total) {
                clip.length = Math.ceil(total * 10) / 10;
              }
            });
          });
          /* Also extend canvas object lengths */
          if (canvas && canvas.getObjects) {
            canvas.getObjects().forEach(function (obj) {
              if (typeof obj.cfsLength === 'number' && obj.cfsLength < total) {
                obj.cfsLength = Math.ceil(total * 10) / 10;
              }
            });
          }
        }

        /* Refresh timeline to show extended durations */
        refreshTimeline();

        if (total < 1) total = 5;
        timelinePlayStartTime = currentPlayheadSec;
        if (timelinePlayStartTime >= total) timelinePlayStartTime = 0;
        timelinePlayStartWall = Date.now();
        isTimelinePlaying = true;
        if (playBtn) playBtn.textContent = 'Pause';
        setPlayheadTime(timelinePlayStartTime);
        if (coreScene && coreScene.seekToTime && canvas) coreScene.seekToTime(canvas, timelinePlayStartTime);
        canvas.renderAll();

        /* ── Schedule per-chunk audio playback ── */
        if (canvas && canvas.getObjects) {
          canvas.getObjects().forEach(function (obj) {
            if (obj.cfsAudioType !== 'text-to-speech' || !obj._cfsTtsChunks) return;
            var clipStart = obj.cfsStart != null ? obj.cfsStart : 0;
            var chunks = obj._cfsTtsChunks;

            chunks.forEach(function (chunk, ci) {
              if (!chunk.blob) return;
              /* Absolute time when this chunk should start playing */
              var chunkAbsStart = clipStart + chunk.timeStart;
              var chunkAbsEnd = clipStart + chunk.timeEnd;
              var now = timelinePlayStartTime;

              if (now >= chunkAbsEnd) return; /* playhead past this chunk */

              function playChunk() {
                if (!isTimelinePlaying) return;
                /* Stop previous chunk audio to prevent overlap */
                if (obj._cfsCurrentChunkAudio) {
                  try {
                    obj._cfsCurrentChunkAudio.pause();
                    obj._cfsCurrentChunkAudio.currentTime = 0;
                    if (obj._cfsCurrentChunkAudio._cfsBlobUrl) {
                      URL.revokeObjectURL(obj._cfsCurrentChunkAudio._cfsBlobUrl);
                    }
                  } catch (_) {}
                }
                var url = URL.createObjectURL(chunk.blob);
                var audio = new Audio(url);
                audio._cfsBlobUrl = url;
                obj._cfsCurrentChunkAudio = audio;
                _previewAudioEls.push(audio);
                audio.play().catch(function () {});
              }

              if (now < chunkAbsStart) {
                /* Schedule for later */
                var delayMs = (chunkAbsStart - now) * 1000;
                setTimeout(function () { if (isTimelinePlaying) playChunk(); }, delayMs);
              } else {
                /* Playhead is within this chunk — play immediately */
                playChunk();
              }
            });
          });
        }

        /* ── Schedule audio clip + soundtrack playback ── */
        (function scheduleNonTtsAudio() {
          if (!template || !template.timeline) return;
          var entries = [];
          (template.timeline.tracks || []).forEach(function (track) {
            (track.clips || []).forEach(function (clip) {
              var asset = clip.asset || {};
              var type = (asset.type || '').toLowerCase();
              if (type !== 'audio') return;
              var src = asset.src || asset.url || '';
              if (!src || src.indexOf('{{') !== -1) return;
              var clipStart = typeof clip.start === 'number' ? clip.start : 0;
              var clipLength = clip.length === 'end' || clip.length === 'auto'
                ? Math.max(0, total - clipStart)
                : (typeof clip.length === 'number' ? clip.length : 5);
              var vol = typeof asset.volume === 'number' ? asset.volume : 1;
              if (vol > 1 && vol <= 100) vol = vol / 100;
              entries.push({ src: src, start: clipStart, length: clipLength, volume: Math.max(0, Math.min(4, vol)) });
            });
          });
          var soundtrack = template.timeline.soundtrack;
          if (soundtrack && soundtrack.src) {
            var stSrc = soundtrack.src;
            if (stSrc && stSrc.indexOf('{{') === -1) {
              var stDur = typeof soundtrack.duration === 'number' ? soundtrack.duration : total;
              var stVol = typeof soundtrack.volume === 'number' ? soundtrack.volume : 1;
              if (stVol > 1 && stVol <= 100) stVol = stVol / 100;
              entries.push({ src: stSrc, start: 0, length: stDur, volume: Math.max(0, Math.min(4, stVol)) });
            }
          }
          if (!entries.length) return;
          entries.forEach(function (entry) {
            var entryEnd = entry.start + entry.length;
            if (timelinePlayStartTime >= entryEnd) return;
            function playEntry() {
              if (!isTimelinePlaying) return;
              var srcUrl = entry.src;
              (srcUrl.startsWith('blob:') || srcUrl.startsWith('data:')
                ? Promise.resolve(srcUrl)
                : fetch(srcUrl, { mode: 'cors' }).then(function (r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.blob();
                  }).then(function (blob) { return URL.createObjectURL(blob); })
                  .catch(function () {
                    var proxyBase = (typeof location !== 'undefined' && location.origin) || '';
                    if (proxyBase) {
                      return fetch(proxyBase + '/api/media-proxy?url=' + encodeURIComponent(srcUrl))
                        .then(function (pr) { if (!pr.ok) throw new Error('Proxy ' + pr.status); return pr.blob(); })
                        .then(function (b) { return URL.createObjectURL(b); })
                        .catch(function () { return srcUrl; });
                    }
                    return srcUrl;
                  })
              ).then(function (url) {
                if (!isTimelinePlaying) return;
                var audio = new Audio(url);
                if (url !== srcUrl && url.startsWith('blob:')) audio._cfsBlobUrl = url;
                audio.volume = Math.min(1, entry.volume);
                if (timelinePlayStartTime > entry.start) audio.currentTime = timelinePlayStartTime - entry.start;
                _previewAudioEls.push(audio);
                audio.play().catch(function () {});
              });
            }
            if (timelinePlayStartTime < entry.start) {
              var delay = (entry.start - timelinePlayStartTime) * 1000;
              setTimeout(function () { if (isTimelinePlaying) playEntry(); }, delay);
            } else {
              playEntry();
            }
          });
        })();

        function tick() {
          if (!isTimelinePlaying) return;
          var elapsed = (Date.now() - timelinePlayStartWall) / 1000;
          var t = timelinePlayStartTime + elapsed;
          if (t >= total) {
            stopTimelinePlay();
            currentPlayheadSec = 0;
            setPlayheadTime(0);
            if (coreScene && coreScene.seekToTime && canvas) coreScene.seekToTime(canvas, 0);
            if (playBtn) playBtn.textContent = 'Play';
            return;
          }
          setPlayheadTime(t);
          if (coreScene && coreScene.seekToTime && canvas) coreScene.seekToTime(canvas, t);
          canvas.renderAll();
          timelinePlayRaf = requestAnimationFrame(tick);
        }
        timelinePlayRaf = requestAnimationFrame(tick);
      }).catch(function () {
        if (playBtn) playBtn.textContent = 'Play';
      });
    }
    var playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', playTimelinePreview);
    timelineToolbar.appendChild(playBtn);

    var saveFrameBtn = document.createElement('button');
    saveFrameBtn.type = 'button';
    saveFrameBtn.textContent = 'Save Frame';
    saveFrameBtn.title = 'Export current frame as PNG';
    saveFrameBtn.addEventListener('click', function () {
      if (!canvas) return;
      var dataUrl = null;
      if (coreScene && coreScene.captureFrameAt) {
        dataUrl = coreScene.captureFrameAt(canvas, currentPlayheadSec, { format: 'png' });
      } else if (canvas.toDataURL) {
        dataUrl = canvas.toDataURL({ format: 'png', quality: 1 });
      }
      if (!dataUrl) return;
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'frame-' + currentPlayheadSec.toFixed(2) + 's.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    if (outputType === 'audio') saveFrameBtn.style.display = 'none';
    timelineToolbar.appendChild(saveFrameBtn);

    /* ── Split / Delete / Razor ── */

    /**
     * Split ALL clips spanning the playhead across ALL tracks (skip locked tracks).
     * TTS/caption clips snap to the nearest word boundary using 50% threshold.
     */
    function splitAllAtPlayhead(timeSec) {
      if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      var chunkUtils = global.__CFS_chunkUtils;
      if (!chunkUtils || !chunkUtils.findWordBoundary) { console.warn('[CFS Split] chunk-utils not loaded'); return; }
      var tracks = template.timeline.tracks;
      var ttsClipsToRegen = [];
      /* Track indices already split by sibling logic to prevent double-splitting */
      var alreadySplitTracks = new Set();

      for (var ti = 0; ti < tracks.length; ti++) {
        if (lockedTracks.has(ti)) continue;
        if (alreadySplitTracks.has(ti)) continue;
        var trackClips = tracks[ti].clips;
        if (!trackClips) continue;
        for (var ci = trackClips.length - 1; ci >= 0; ci--) {
          var clip = trackClips[ci];
          var clipStart = typeof clip.start === 'number' ? clip.start : 0;
          var clipLength = typeof clip.length === 'number' ? clip.length : 5;
          if (clip.length === 'end') clipLength = Math.max(0.1, (lastTotalDuration || 10) - clipStart);
          var clipEnd = clipStart + clipLength;
          /* Only split if playhead strictly inside the clip */
          if (timeSec <= clipStart || timeSec >= clipEnd) continue;

          var localTime = timeSec - clipStart;
          var asset = clip.asset || {};
          var assetType = asset.type || '';

          /* Determine if word-aware split needed */
          var isWordAware = (assetType === 'text-to-speech' || assetType === 'caption' || assetType === 'rich-caption');

          if (isWordAware) {
            /* Find words source */
            var words = null;
            if (assetType === 'caption' || assetType === 'rich-caption') {
              words = asset.words;
            } else if (assetType === 'text-to-speech') {
              /* Look for sibling caption's words */
              words = findSiblingCaptionWords(tracks, asset.text);
            }

            if (words && words.length) {
              var boundary = chunkUtils.findWordBoundary(words, localTime);
              if (boundary.splitAfterIndex < 0 || boundary.splitAfterIndex >= words.length - 1) continue; /* nothing to split */

              if (assetType === 'text-to-speech') {
                /* Split TTS clip at word boundary */
                var rightClip = JSON.parse(JSON.stringify(clip));
                rightClip.start = clipStart + boundary.snapTime;
                rightClip.length = clipEnd - rightClip.start;
                rightClip.asset.text = boundary.rightText;
                clip.length = boundary.snapTime;
                clip.asset.text = boundary.leftText;
                trackClips.splice(ci + 1, 0, rightClip);
                ttsClipsToRegen.push({ trackIndex: ti, clipIndex: ci });
                ttsClipsToRegen.push({ trackIndex: ti, clipIndex: ci + 1 });

                /* Also split sibling caption at same boundary — mark its track so we don't split it again */
                var siblingTrackIdx = splitSiblingCaption(tracks, asset, clipStart, boundary, lockedTracks);
                if (siblingTrackIdx >= 0) alreadySplitTracks.add(siblingTrackIdx);
              } else {
                /* Caption clip — but check if a TTS sibling already split us */
                /* Split caption clip at word boundary */
                var rightCapClip = JSON.parse(JSON.stringify(clip));
                rightCapClip.start = clipStart + boundary.snapTime;
                rightCapClip.length = clipEnd - rightCapClip.start;
                /* Deep-copy words for right half and rebase timings */
                var rightWords = JSON.parse(JSON.stringify(boundary.rightWords));
                chunkUtils.rebaseWordTimings(rightWords, boundary.snapTime);
                rightCapClip.asset.words = rightWords;
                /* Left half keeps original words up to split point */
                clip.length = boundary.snapTime;
                clip.asset.words = JSON.parse(JSON.stringify(boundary.leftWords));
                trackClips.splice(ci + 1, 0, rightCapClip);
                /* Also split sibling TTS at same boundary */
                var sibTtsTrackIdx = splitSiblingTts(tracks, boundary, clipStart, clipEnd, lockedTracks);
                if (sibTtsTrackIdx >= 0) {
                  alreadySplitTracks.add(sibTtsTrackIdx);
                  ttsClipsToRegen.push({ trackIndex: sibTtsTrackIdx, clipIndex: 0 });
                }
              }
            } else {
              /* No words — fall back to exact time split */
              splitClipExact(trackClips, ci, clip, clipStart, clipEnd, timeSec);
            }
          } else {
            /* Visual/audio clip — exact time split */
            splitClipExact(trackClips, ci, clip, clipStart, clipEnd, timeSec);
          }
        }
      }

      /* Invalidate TTS caches on canvas objects */
      if (canvas && canvas.getObjects) {
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsAudioType === 'text-to-speech') {
            obj._cfsTtsChunks = null;
            obj._cfsTtsCachedVoice = null;
            obj._cfsTtsDuration = null;
          }
        });
      }

      saveStateDebounced();
      selectedClipIndices.clear();
      refreshTimeline();
      refreshPropertyPanel();
      refreshLayersPanel();

      /* Queue TTS auto-regeneration for split clips */
      if (ttsClipsToRegen.length) {
        console.log('[CFS Split] Queuing TTS regeneration for ' + ttsClipsToRegen.length + ' clip(s)');
        /* Regeneration happens automatically on next Play — the TTS cache is now invalidated */
      }
    }

    /** Simple exact-time split for non-word-aware clips */
    function splitClipExact(trackClips, ci, clip, clipStart, clipEnd, timeSec) {
      var rightClip = JSON.parse(JSON.stringify(clip));
      rightClip.start = timeSec;
      rightClip.length = clipEnd - timeSec;
      clip.length = timeSec - clipStart;
      trackClips.splice(ci + 1, 0, rightClip);
    }

    /** Find sibling caption words matching TTS text */
    function findSiblingCaptionWords(tracks, ttsText) {
      if (!ttsText) return null;
      for (var si = 0; si < tracks.length; si++) {
        var sCl = tracks[si].clips || [];
        for (var sci = 0; sci < sCl.length; sci++) {
          var sa = sCl[sci].asset || {};
          if ((sa.type === 'caption' || sa.type === 'rich-caption') && sa.words && sa.words.length) {
            return sa.words;
          }
        }
      }
      return null;
    }

    /** Split sibling caption clip at the same word boundary as a TTS split.
     *  Returns the track index of the caption that was split, or -1 if none found. */
    function splitSiblingCaption(tracks, ttsAsset, ttsClipStart, boundary, locked) {
      var chunkUtils = global.__CFS_chunkUtils;
      for (var si = 0; si < tracks.length; si++) {
        if (locked.has(si)) continue;
        var sCl = tracks[si].clips || [];
        for (var sci = 0; sci < sCl.length; sci++) {
          var sa = sCl[sci].asset || {};
          if ((sa.type === 'caption' || sa.type === 'rich-caption') && sa.words && sa.words.length) {
            var capClip = sCl[sci];
            var capStart = typeof capClip.start === 'number' ? capClip.start : 0;
            var capLength = typeof capClip.length === 'number' ? capClip.length : 5;
            var capEnd = capStart + capLength;
            /* Split caption at same word boundary */
            var rightCapClip = JSON.parse(JSON.stringify(capClip));
            rightCapClip.start = capStart + boundary.snapTime;
            rightCapClip.length = capEnd - rightCapClip.start;
            var rightWords = JSON.parse(JSON.stringify(boundary.rightWords));
            if (chunkUtils) chunkUtils.rebaseWordTimings(rightWords, boundary.snapTime);
            rightCapClip.asset.words = rightWords;
            capClip.length = boundary.snapTime;
            capClip.asset.words = JSON.parse(JSON.stringify(boundary.leftWords));
            sCl.splice(sci + 1, 0, rightCapClip);
            return si; /* return track index so caller can mark it as handled */
          }
        }
      }
      return -1;
    }

    /** Split sibling TTS clip at the same word boundary as a caption split.
     *  Returns the track index of the TTS that was split, or -1 if none found. */
    function splitSiblingTts(tracks, boundary, capClipStart, capClipEnd, locked) {
      for (var si = 0; si < tracks.length; si++) {
        if (locked.has(si)) continue;
        var sCl = tracks[si].clips || [];
        for (var sci = 0; sci < sCl.length; sci++) {
          var sa = sCl[sci].asset || {};
          if (sa.type === 'text-to-speech' && sa.text) {
            var ttsClip = sCl[sci];
            var ttsStart = typeof ttsClip.start === 'number' ? ttsClip.start : 0;
            var ttsLength = typeof ttsClip.length === 'number' ? ttsClip.length : 5;
            var ttsEnd = ttsStart + ttsLength;
            /* Split TTS at same word boundary */
            var rightTts = JSON.parse(JSON.stringify(ttsClip));
            rightTts.start = ttsStart + boundary.snapTime;
            rightTts.length = ttsEnd - rightTts.start;
            rightTts.asset.text = boundary.rightText;
            ttsClip.length = boundary.snapTime;
            ttsClip.asset.text = boundary.leftText;
            sCl.splice(sci + 1, 0, rightTts);
            return si;
          }
        }
      }
      return -1;
    }

    /**
     * Delete all selected clips (skip locked tracks).
     * Sibling TTS↔caption clips are deleted together.
     * Ripple editing: close gaps on tracks that have no other content in the deleted region.
     */
    function deleteSelectedClips() {
      if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      if (!selectedClipIndices.size) { console.log('[CFS Delete] No clips selected'); return; }
      var clips = lastRenderedClips;
      if (!clips || !clips.length) { console.log('[CFS Delete] No rendered clips'); return; }
      console.log('[CFS Delete] selected:', Array.from(selectedClipIndices), 'of', clips.length, 'clips');

      var toDeleteTemplate = []; /* { ti, ci } for template track removal */
      var canvasObjsToRemove = []; /* canvas object references to remove */

      selectedClipIndices.forEach(function (idx) {
        var clip = clips[idx];
        if (!clip) return;
        if (clip.isSubClip || clip.isParentClip) return;
        if (lockedTracks.has(clip.trackIndex != null ? clip.trackIndex : 0)) return;

        if (clip.templateTrackIndex != null && clip.templateClipIndex != null) {
          /* Template-originated clip (TTS, caption, audio) */
          toDeleteTemplate.push({ ti: clip.templateTrackIndex, ci: clip.templateClipIndex });
          console.log('[CFS Delete] template clip: track=' + clip.templateTrackIndex + ' clip=' + clip.templateClipIndex + ' (' + clip.label + ')');
        } else if (clip.canvasIndex != null && canvas && canvas.getObjects) {
          /* Canvas-originated clip (text, shape, image, video) */
          var objs = canvas.getObjects();
          if (objs[clip.canvasIndex]) {
            canvasObjsToRemove.push(objs[clip.canvasIndex]);
            console.log('[CFS Delete] canvas object: canvasIndex=' + clip.canvasIndex + ' (' + clip.label + ')');
            /* Also find and remove its template track entry if one exists */
            var obj = objs[clip.canvasIndex];
            var tracks = template.timeline.tracks;
            for (var ti = 0; ti < tracks.length; ti++) {
              var tClips = tracks[ti].clips || [];
              for (var ci = tClips.length - 1; ci >= 0; ci--) {
                var tc = tClips[ci];
                if (tc && tc.asset && obj.name && tc.asset.src === obj.name) {
                  toDeleteTemplate.push({ ti: ti, ci: ci });
                }
              }
            }
          }
        }
      });

      if (!toDeleteTemplate.length && !canvasObjsToRemove.length) {
        console.log('[CFS Delete] Nothing to delete');
        return;
      }

      /* Also find and mark sibling TTS↔caption for deletion */
      var siblingDeletes = [];
      toDeleteTemplate.forEach(function (d) {
        var tr = template.timeline.tracks[d.ti];
        if (!tr || !tr.clips || !tr.clips[d.ci]) return;
        var asset = tr.clips[d.ci].asset || {};
        var assetType = asset.type || '';
        if (assetType === 'text-to-speech') {
          for (var si = 0; si < template.timeline.tracks.length; si++) {
            if (lockedTracks.has(si)) continue;
            var sCl = template.timeline.tracks[si].clips || [];
            for (var sci = 0; sci < sCl.length; sci++) {
              var sa = sCl[sci].asset || {};
              if ((sa.type === 'caption' || sa.type === 'rich-caption') && sa.words && sa.words.length) {
                siblingDeletes.push({ ti: si, ci: sci });
              }
            }
          }
        } else if (assetType === 'caption' || assetType === 'rich-caption') {
          for (var si2 = 0; si2 < template.timeline.tracks.length; si2++) {
            if (lockedTracks.has(si2)) continue;
            var sCl2 = template.timeline.tracks[si2].clips || [];
            for (var sci2 = 0; sci2 < sCl2.length; sci2++) {
              var sa2 = sCl2[sci2].asset || {};
              if (sa2.type === 'text-to-speech') {
                siblingDeletes.push({ ti: si2, ci: sci2 });
              }
            }
          }
        }
      });

      /* Merge, dedupe, sort descending for safe splicing */
      var allDels = toDeleteTemplate.concat(siblingDeletes);
      var delMap = {};
      allDels.forEach(function (d) { delMap[d.ti + ':' + d.ci] = d; });
      var uniqueDels = Object.keys(delMap).map(function (k) { return delMap[k]; });
      uniqueDels.sort(function (a, b) { return a.ti === b.ti ? b.ci - a.ci : b.ti - a.ti; });

      /* Delete from template tracks */
      uniqueDels.forEach(function (d) {
        var tr = template.timeline.tracks[d.ti];
        if (!tr || !tr.clips || !tr.clips[d.ci]) return;
        var delClip = tr.clips[d.ci];
        var delStart = typeof delClip.start === 'number' ? delClip.start : 0;
        var delLength = typeof delClip.length === 'number' ? delClip.length : 0;
        tr.clips.splice(d.ci, 1);
        if (delLength > 0) {
          rippleTrackAfterDelete(tr, delStart, delLength);
        }
      });

      /* Remove canvas objects */
      canvasObjsToRemove.forEach(function (obj) {
        if (canvas && canvas.remove) {
          canvas.remove(obj);
        }
      });

      selectedClipIndices.clear();
      if (canvas && canvas.getObjects) {
        canvas.getObjects().forEach(function (obj) {
          if (obj.cfsAudioType === 'text-to-speech') {
            obj._cfsTtsChunks = null;
            obj._cfsTtsCachedVoice = null;
          }
        });
        if (canvas.renderAll) canvas.renderAll();
      }
      console.log('[CFS Delete] Done. Removed ' + uniqueDels.length + ' template clips + ' + canvasObjsToRemove.length + ' canvas objects');
      saveStateDebounced();
      refreshTimeline();
      refreshPropertyPanel();
      refreshLayersPanel();
    }

    /** Ripple edit: shift subsequent clips left if no overlap exists */
    function rippleTrackAfterDelete(track, delStart, delLength) {
      var clips = track.clips || [];
      var delEnd = delStart + delLength;
      /* Check if any remaining clip overlaps the deleted region */
      var overlapping = clips.some(function (c) {
        var s = typeof c.start === 'number' ? c.start : 0;
        var l = typeof c.length === 'number' ? c.length : 5;
        return s < delEnd && s + l > delStart;
      });
      if (overlapping) return;
      /* Shift all clips after the deleted region left */
      clips.forEach(function (c) {
        if (typeof c.start === 'number' && c.start >= delEnd) {
          c.start = Math.max(0, c.start - delLength);
        }
      });
    }

    /* ── Toolbar buttons: Split, Delete, Razor ── */
    var splitBtn = document.createElement('button');
    splitBtn.type = 'button';
    splitBtn.textContent = '✂️ Split';
    splitBtn.title = 'Split all clips at playhead (S)';
    splitBtn.addEventListener('click', function () { splitAllAtPlayhead(currentPlayheadSec); });
    timelineToolbar.appendChild(splitBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '🗑 Delete';
    deleteBtn.title = 'Delete selected clip(s) (Delete)';
    deleteBtn.addEventListener('click', function () { deleteSelectedClips(); });
    timelineToolbar.appendChild(deleteBtn);

    /* Keyboard shortcuts for split/delete */
    function handleTimelineKeydown(e) {
      /* Ignore when typing in form controls */
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
      if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        splitAllAtPlayhead(currentPlayheadSec);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey) {
        if (selectedClipIndices.size) {
          e.preventDefault();
          deleteSelectedClips();
        }
      }
    }
    document.addEventListener('keydown', handleTimelineKeydown);

    function addAudioTrack() {
      if (!template) return;
      if (!template.timeline) template.timeline = {};
      if (!Array.isArray(template.timeline.tracks)) template.timeline.tracks = [];
      var srcUrl = '';
      try { srcUrl = (window.prompt('Audio URL (leave blank for merge placeholder):') || '').trim(); } catch (_) {}
      var audioSrc = srcUrl || '{{ AUDIO_URL }}';
      template.timeline.tracks.unshift({
        clips: [{ asset: { type: 'audio', src: audioSrc, volume: 1 }, start: 0, length: 10 }],
      });
      selectedAudioClip = { templateTrackIndex: 0, templateClipIndex: 0 };
      if (canvas && canvas.discardActiveObject) canvas.discardActiveObject();
      saveStateDebounced();
      refreshTimeline();
      refreshLayersPanel();
      refreshPropertyPanel();
    }
    /* Add Audio Track and Soundtrack buttons removed from toolbar —
       these functions are available via Canvas Tools (♫ and Soundtrack icons). */

    timelineWrap.appendChild(timelineToolbar);
    var timelineResizeWrap = document.createElement('div');
    timelineResizeWrap.className = 'cfs-editor-timeline-resize-wrap';
    var timelineAreaHeight = 200;
    timelineResizeWrap.style.height = timelineAreaHeight + 'px';
    timelineResizeWrap.style.minHeight = '80px';
    timelineResizeWrap.style.position = 'relative';
    timelineResizeWrap.style.overflowX = 'auto';
    timelineResizeWrap.style.overflowY = 'auto';
    timelineArea.appendChild(timelineContainer);
    timelineArea.appendChild(playheadEl);
    timelineResizeWrap.appendChild(timelineArea);
    var timelineResizeHandle = document.createElement('div');
    timelineResizeHandle.className = 'cfs-editor-timeline-resize-handle';
    timelineResizeHandle.setAttribute('aria-label', 'Resize timeline');
    timelineResizeHandle.title = 'Drag to resize timeline';
    timelineResizeHandle.style.cssText = 'position:absolute;top:0;left:0;right:0;height:5px;cursor:ns-resize;background:transparent;z-index:5;transition:background 150ms;';
    timelineResizeHandle.addEventListener('mouseenter', function () { timelineResizeHandle.style.background = 'var(--gen-accent, #3b82f6)'; });
    timelineResizeHandle.addEventListener('mouseleave', function () { if (!timelineResizeHandle._dragging) timelineResizeHandle.style.background = 'transparent'; });
    (function () {
      var startY = 0, startH = 0;
      function onMove(e) {
        var dy = e.clientY - startY;
        /* Dragging up = larger timeline (dy is negative when moving up) */
        var newH = Math.max(80, Math.min(500, startH - dy));
        timelineResizeWrap.style.height = newH + 'px';
        timelineAreaHeight = newH;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        timelineResizeHandle._dragging = false;
        timelineResizeHandle.style.background = 'transparent';
        editEvents.emit('timeline:resized', { height: timelineAreaHeight });
      }
      timelineResizeHandle.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        timelineResizeHandle._dragging = true;
        timelineResizeHandle.style.background = 'var(--gen-accent, #3b82f6)';
        startY = e.clientY;
        startH = parseInt(timelineResizeWrap.style.height, 10) || 200;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    })();
    timelineResizeWrap.appendChild(timelineResizeHandle);
    timelineWrap.appendChild(timelineResizeWrap);

    function getTimelineEnd() {
      if (!coreScene || !coreScene.getTimelineFromCanvas || !canvas) return 0;
      return coreScene.getTimelineFromCanvas(canvas).durationSec || 0;
    }

    var TRACK_DEFAULT_DURATION = 5;

    function extendClipLengthForAnimation(obj) {
      if (!obj || !obj.set) return;
      var anim = (obj.get ? obj.get('cfsAnimation') : null) || obj.cfsAnimation;
      if (!anim || !anim.preset || anim.preset === 'none') return;
      var animDur = typeof anim.duration === 'number' ? anim.duration : 2;
      var minLen = animDur + 0.5;
      var curLen = typeof obj.cfsLength === 'number' ? obj.cfsLength : (obj.get ? Number(obj.get('cfsLength')) || 0 : 0);
      if (curLen > 0 && curLen < minLen) {
        obj.set('cfsLength', minLen);
      }
    }

    /** Compute the next available track index so each new element gets its own track. */
    /**
     * Inline modal prompt that works in cross-origin iframes where
     * window.prompt() is silently blocked.  Accepts a URL text input
     * or a file picker, then calls cb({ url, file }).
     */
    function showIframePrompt(message, fileAccept, cb) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px 28px;min-width:360px;max-width:480px;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
      var title = document.createElement('div');
      title.textContent = message || 'Enter URL or choose a file';
      title.style.cssText = 'font-size:15px;margin-bottom:14px;font-weight:500;';
      var urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.placeholder = 'https://...';
      urlInput.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:14px;margin-bottom:12px;outline:none;';
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
      var fileBtn = document.createElement('button');
      fileBtn.textContent = 'Choose File';
      fileBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #475569;background:#334155;color:#e2e8f0;cursor:pointer;font-size:13px;';
      var okBtn = document.createElement('button');
      okBtn.textContent = 'Use URL';
      okBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;font-weight:600;';
      var cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid #475569;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px;';
      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(fileBtn);
      btnRow.appendChild(okBtn);
      box.appendChild(title);
      box.appendChild(urlInput);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      urlInput.focus();
      function cleanup() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
      cancelBtn.onclick = function () { cleanup(); };
      overlay.onclick = function (e) { if (e.target === overlay) cleanup(); };
      okBtn.onclick = function () {
        var val = urlInput.value.trim();
        cleanup();
        if (val) cb({ url: val });
      };
      urlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { okBtn.click(); }
        if (e.key === 'Escape') { cleanup(); }
      });
      fileBtn.onclick = function () {
        var fi = document.createElement('input');
        fi.type = 'file';
        fi.accept = fileAccept || '*/*';
        fi.onchange = function () {
          var file = fi.files && fi.files[0];
          cleanup();
          if (file) cb({ file: file });
        };
        fi.click();
      };
    }

    function getNextTrackIndex() {
      var maxTrack = -1;
      if (canvas && canvas.getObjects) {
        canvas.getObjects().forEach(function (obj) {
          var ti = obj.cfsTrackIndex != null ? obj.cfsTrackIndex : -1;
          if (ti > maxTrack) maxTrack = ti;
        });
      }
      if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
        maxTrack = Math.max(maxTrack, template.timeline.tracks.length - 1);
      }
      return maxTrack + 1;
    }

    function assignSeparateTracksForVideo() {
      if (!canvas || !canvas.getObjects) return;
      var objs = canvas.getObjects();
      if (!objs || !objs.length) return;
      var allOnTrackZero = objs.every(function (o) { return (o.cfsTrackIndex == null || o.cfsTrackIndex === 0); });
      if (!allOnTrackZero) return;
      var maxMediaEnd = 0;
      var maxAnimDuration = 0;
      objs.forEach(function (obj) {
        if (!obj) return;
        var isMedia = obj.cfsVideoSrc || (obj.get && obj.get('cfsVideoSrc')) ||
                      obj.cfsAudioType || (obj.get && obj.get('cfsAudioType'));
        if (isMedia) {
          var s = typeof obj.cfsStart === 'number' ? obj.cfsStart : (obj.get ? Number(obj.get('cfsStart')) || 0 : 0);
          var l = typeof obj.cfsLength === 'number' ? obj.cfsLength : (obj.get ? Number(obj.get('cfsLength')) || 0 : 0);
          maxMediaEnd = Math.max(maxMediaEnd, s + l);
        }
        var anim = (obj.get ? obj.get('cfsAnimation') : null) || obj.cfsAnimation;
        if (anim && anim.preset && anim.preset !== 'none') {
          var dur = typeof anim.duration === 'number' ? anim.duration : 2;
          maxAnimDuration = Math.max(maxAnimDuration, dur);
        }
      });
      var trackLen = maxMediaEnd > 0 ? maxMediaEnd : (maxAnimDuration > 0 ? maxAnimDuration + 0.5 : TRACK_DEFAULT_DURATION);
      var trackIdx = 0;
      objs.forEach(function (obj) {
        if (!obj || !obj.set) return;
        obj.set('cfsStart', 0);
        obj.set('cfsLength', trackLen);
        obj.set('cfsTrackIndex', trackIdx);
        trackIdx++;
      });
      if (canvas.renderAll) canvas.renderAll();
    }

    function addClip() {
      if (!canvas || !template || !template.timeline || !Array.isArray(template.timeline.tracks)) return;
      var start = Math.max(getTimelineEnd(), lastTotalDuration || 0);
      var clipKind = 'text';
      try {
        var entered = window.prompt('Clip type: text, subtitle, tts, audio, luma, or html', 'text');
        clipKind = (entered || 'text').toString().trim().toLowerCase();
      } catch (_) {}
      if (!clipKind) clipKind = 'text';
      if (clipKind === 'caption' || clipKind === 'subtitles') clipKind = 'subtitle';
      if (clipKind === 'text-to-speech') clipKind = 'tts';
      if (clipKind === 'audio') {
        addAudioClip();
        return;
      }
      if (clipKind === 'luma') {
        if (!template.timeline.tracks.length) template.timeline.tracks.push({ clips: [] });
        var lumaTrackIdx = template.timeline.tracks.length - 1;
        template.timeline.tracks[lumaTrackIdx].clips.push({
          start: start,
          length: 5,
          asset: { type: 'luma', src: '{{ LUMA_URL }}' }
        });
        saveStateDebounced();
        refreshTimeline();
        refreshPropertyPanel();
        return;
      }
      if (clipKind === 'html') {
        if (!template.timeline.tracks.length) template.timeline.tracks.push({ clips: [] });
        var htmlTrackIdx = template.timeline.tracks.length - 1;
        template.timeline.tracks[htmlTrackIdx].clips.push({
          start: start,
          length: 5,
          asset: { type: 'html', html: '<p>New HTML clip</p>', css: '', width: 400, height: 300 }
        });
        saveStateDebounced();
        refreshTimeline();
        refreshPropertyPanel();
        return;
      }
      if (clipKind === 'subtitle' || clipKind === 'tts') {
        if (!template.timeline.tracks.length) template.timeline.tracks.push({ clips: [] });
        var targetTrack = template.timeline.tracks.length - 1;
        if (!template.timeline.tracks[targetTrack] || !Array.isArray(template.timeline.tracks[targetTrack].clips)) {
          template.timeline.tracks[targetTrack] = { clips: [] };
        }
        if (clipKind === 'subtitle') {
          /* Captions always get their own dedicated track (topmost = index 0 in ShotStack convention) */
          template.timeline.tracks.unshift({
            clips: [{
              start: start,
              length: 5,
              position: 'bottom',
              width: Math.max(240, (canvas.getWidth ? canvas.getWidth() : 1080) - 120),
              asset: {
                type: 'rich-caption',
                font: { family: 'Open Sans', size: 32, color: '#ffffff', weight: 700 },
                stroke: { width: 2, color: '#000000', opacity: 1 },
                animation: { style: 'karaoke' },
                align: { vertical: 'bottom' },
                active: { font: { color: '#efbf04' } }
              }
            }]
          });
          /* Auto-populate the new caption track from TTS in the background */
          autoPopulateCaptionFromTts(template);
        } else {
          template.timeline.tracks[targetTrack].clips.push({
            start: start,
            length: 5,
            asset: { type: 'text-to-speech', text: 'New narration', voice: '' }
          });
        }
        saveStateDebounced();
        refreshTimeline();
        refreshPropertyPanel();
        return;
      }
      var cw = canvas.getWidth ? canvas.getWidth() : 1080;
      var wrapWidth = Math.min(400, Math.max(200, cw - 160));
      var t = new fabric.Textbox('New clip', {
        left: 80,
        top: 80,
        width: wrapWidth,
        minWidth: 50,
        maxWidth: Math.max(wrapWidth, cw - 100),
        fontSize: 24,
        fill: '#000000',
        fontFamily: 'sans-serif',
        name: 'clip_' + Date.now(),
        cfsStart: start,
        cfsLength: 5,
        cfsTrackIndex: getNextTrackIndex(),
        cfsWrapText: true,
        textBaseline: 'alphabetic'
      });
      t.set('cfsRawText', 'New clip');
      canvas.add(t);
      canvas.setActiveObject(t);
      if (typeof t.initDimensions === 'function') t.initDimensions();
      canvas.renderAll();
      refreshTimeline();
      refreshPropertyPanel();
    }

    function refreshTimeline() {
      var panel = global.__CFS_timelinePanel;
      if (!panel || !panel.render) return;
      function numericStart(clip) {
        if (!clip) return 0;
        if (typeof clip.displayStart === 'number') return clip.displayStart;
        if (typeof clip.start === 'number') return clip.start;
        if (clip.start === 'auto') return 0;
        return Number(clip.start) || 0;
      }
      function numericLength(clip, totalHint) {
        if (!clip) return 5;
        if (typeof clip.displayLength === 'number') return clip.displayLength;
        if (typeof clip.length === 'number') return clip.length;
        if (clip.length === 'end') return Math.max(0.1, (totalHint || 10) - numericStart(clip));
        if (clip.length === 'auto') return 3;
        return Number(clip.length) || 5;
      }
      var clips = panel.buildClipsFromTemplate(template);
      if (canvas && canvas.getObjects) {
         var fromCanvas = panel.buildClipsFromCanvas(canvas, 5);
        if (fromCanvas.length) {
          var templateClips = panel.buildClipsFromTemplate(template);
          var preservedNonCanvas = templateClips.filter(function (c) {
            return c.type === 'audio' || c.type === 'caption' || c.type === 'rich-caption' || c.type === 'text-to-speech' || c.type === 'text-to-image' || c.type === 'image-to-video' || c.type === 'luma' || c.type === 'html' || c.type === 'caption-chunk' || c.type === 'tts-chunk' || c.isSubClip || c.isParentClip;
          });
          clips = fromCanvas.concat(preservedNonCanvas);
          // Filter out canvas placeholder objects that duplicate template entries (caption + TTS rects)
          var canvasObjects = canvas.getObjects();
          var hasPreservedCaption = preservedNonCanvas.some(function (c) { return c.type === 'rich-caption' || c.type === 'caption' || c.type === 'caption-chunk'; });
          var hasPreservedTTS = preservedNonCanvas.some(function (c) { return c.type === 'text-to-speech' || c.type === 'tts-chunk'; });
          if (hasPreservedCaption || hasPreservedTTS) {
            clips = fromCanvas.filter(function (c, idx) {
              var obj = canvasObjects[idx];
              if (!obj) return true;
              if (hasPreservedCaption && obj.cfsIsCaption) return false;
              if (hasPreservedTTS && obj.cfsAudioType === 'text-to-speech') return false;
              return true;
            }).concat(preservedNonCanvas);
          }
        }
      }
      var total = (coreScene && canvas && coreScene.getTimelineFromCanvas) ? coreScene.getTimelineFromCanvas(canvas).durationSec : 5;
      if (total < 1) total = 5;
      clips.forEach(function (c) {
        var s = numericStart(c);
        var l = numericLength(c, total);
        total = Math.max(total, s + l);
      });
      if (template && template.timeline && template.timeline.soundtrack && typeof template.timeline.soundtrack.length === 'number') {
        total = Math.max(total, template.timeline.soundtrack.length);
      }
      /* Also check caption word timings and TTS chunk durations for total */
      if (canvas && canvas.getObjects) {
        canvas.getObjects().forEach(function (obj) {
          var objStart = obj.cfsStart != null ? obj.cfsStart : 0;
          var capWords = obj.cfsCaptionWords || (obj.cfsOriginalClip && obj.cfsOriginalClip.asset && Array.isArray(obj.cfsOriginalClip.asset.words) ? obj.cfsOriginalClip.asset.words : null);
          if (capWords && capWords.length) {
            total = Math.max(total, objStart + (capWords[capWords.length - 1].end || 0) + 0.5);
          }
          if (obj._cfsTtsChunks && obj._cfsTtsChunks.length) {
            var lastCh = obj._cfsTtsChunks[obj._cfsTtsChunks.length - 1];
            if (lastCh.timeEnd) total = Math.max(total, objStart + lastCh.timeEnd + 0.3);
            if (obj._cfsTtsDuration > 0) total = Math.max(total, objStart + obj._cfsTtsDuration + 0.3);
          }
        });
      }
      /* Auto-extend template clip lengths to match total */
      if (template && template.timeline && Array.isArray(template.timeline.tracks)) {
        var roundedTotal = Math.ceil(total * 10) / 10;
        template.timeline.tracks.forEach(function (tr) {
          (tr.clips || []).forEach(function (clip) {
            if (typeof clip.length === 'number' && clip.length < roundedTotal) {
              clip.length = roundedTotal;
            }
          });
        });
        if (canvas && canvas.getObjects) {
          canvas.getObjects().forEach(function (obj) {
            if (typeof obj.cfsLength === 'number' && obj.cfsLength < roundedTotal) {
              obj.cfsLength = roundedTotal;
            }
          });
        }
      }
      total = Math.ceil(total);
      function onClipSelect(index) {
        if (!canvas) return;
        var clip = clips[index];
        if (!clip) return;

        /* Clear all non-visual clip selections first */
        selectedAudioClip = null;
        selectedLumaClip = null;
        selectedCaptionClip = null;
        selectedTtsClip = null;
        selectedHtmlClip = null;
        selectedTextToImageClip = null;
        selectedImageToVideoClip = null;

        /* Determine clip type and handle accordingly */
        var clipType = clip.type || '';

        if (clipType === 'text-to-speech') {
          selectedTtsClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecTts = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecTts);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'audio') {
          selectedAudioClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSec = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSec);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'luma') {
          selectedLumaClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecLuma = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecLuma);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'caption' || clipType === 'rich-caption') {
          selectedCaptionClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecCap = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecCap);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'html') {
          selectedHtmlClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecHtml = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecHtml);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'text-to-image') {
          selectedTextToImageClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecTti = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecTti);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else if (clipType === 'image-to-video') {
          selectedImageToVideoClip = (clip.templateTrackIndex != null && clip.templateClipIndex != null) ? { templateTrackIndex: clip.templateTrackIndex, templateClipIndex: clip.templateClipIndex } : null;
          var timeSecItv = numericStart(clip) + numericLength(clip, total) / 2;
          if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecItv);
          canvas.discardActiveObject();
          canvas.renderAll();
          refreshPropertyPanel();
        } else {
          /* Visual canvas object — find matching object by clip name or canvas index */
          var objs = canvas.getObjects();
          var matchObj = null;
          if (clip.name) {
            for (var oi = 0; oi < objs.length; oi++) {
              if (objs[oi].name === clip.name) { matchObj = objs[oi]; break; }
            }
          }
          if (!matchObj && clip.canvasIndex != null && objs[clip.canvasIndex]) {
            matchObj = objs[clip.canvasIndex];
          }
          if (!matchObj && objs[index]) {
            matchObj = objs[index];
          }
          if (matchObj) {
            canvas.setActiveObject(matchObj);
            var timeSecObj = numericStart(clip) + numericLength(clip, total) / 2;
            if (coreScene && coreScene.seekToTime) coreScene.seekToTime(canvas, timeSecObj);
            canvas.renderAll();
            refreshLayersPanel();
            refreshPropertyPanel();
          }
        }
      }
      function onClipMove(index, newStartSec) {
        var clip = clips[index];
        if (clip && clip.templateTrackIndex != null && clip.templateClipIndex != null && template && template.timeline && Array.isArray(template.timeline.tracks)) {
          var tr = template.timeline.tracks[clip.templateTrackIndex];
          if (tr && tr.clips && tr.clips[clip.templateClipIndex]) {
            tr.clips[clip.templateClipIndex].start = newStartSec;
            saveStateDebounced();
            refreshTimeline();
            /* If this is a TTS/audio/video clip, captions may need updating */
            if (isCaptionInvalidatingType(clip.type)) debouncedRegenerateCaptions();
            return;
          }
        }
        if (!canvas) return;
        var objs = canvas.getObjects();
        var obj = objs[index];
        if (obj && obj.set) {
          obj.set('cfsStart', newStartSec);
          canvas.renderAll();
          saveStateDebounced();
          refreshTimeline();
          refreshPropertyPanel();
          refreshLayersPanel();
        }
      }
      function onClipTrackChange(index, newTrackIndex) {
        var clip = clips[index];
        if (clip && clip.templateTrackIndex != null && clip.templateClipIndex != null && template && template.timeline && Array.isArray(template.timeline.tracks)) {
          var tracks = template.timeline.tracks;
          var tr = tracks[clip.templateTrackIndex];
          if (tr && tr.clips && tr.clips[clip.templateClipIndex]) {
            var clipData = tr.clips.splice(clip.templateClipIndex, 1)[0];
            while (tracks.length <= newTrackIndex) tracks.push({ clips: [] });
            if (!tracks[newTrackIndex].clips) tracks[newTrackIndex].clips = [];
            tracks[newTrackIndex].clips.push(clipData);
            saveStateDebounced();
            refreshTimeline();
            return;
          }
        }
        if (!canvas) return;
        var objs = canvas.getObjects();
        var obj = objs[index];
        if (obj && obj.set) {
          obj.set('cfsTrackIndex', newTrackIndex);
          canvas.renderAll();
          saveStateDebounced();
          refreshTimeline();
          refreshPropertyPanel();
          refreshLayersPanel();
        }
      }
      function onClipResize(index, newStartSec, newLengthSec) {
        var clip = clips[index];
        if (clip && clip.templateTrackIndex != null && clip.templateClipIndex != null && template && template.timeline && Array.isArray(template.timeline.tracks)) {
          var tr = template.timeline.tracks[clip.templateTrackIndex];
          if (tr && tr.clips && tr.clips[clip.templateClipIndex]) {
            tr.clips[clip.templateClipIndex].start = newStartSec;
            tr.clips[clip.templateClipIndex].length = newLengthSec;
            saveStateDebounced();
            refreshTimeline();
            /* If this is a TTS/audio/video clip, captions may need updating */
            if (isCaptionInvalidatingType(clip.type)) debouncedRegenerateCaptions();
            return;
          }
        }
        if (!canvas) return;
        var objs = canvas.getObjects();
        var obj = objs[index];
        if (obj && obj.set) {
          obj.set('cfsStart', newStartSec);
          obj.set('cfsLength', newLengthSec);
          canvas.renderAll();
          saveStateDebounced();
          refreshTimeline();
          refreshPropertyPanel();
          refreshLayersPanel();
        }
      }
      lastTotalDuration = total;
      lastClips = clips.slice ? clips.slice() : clips;
      editEvents.emit('duration:changed', { duration: total });
      editEvents.emit('timeline:updated', { clips: lastClips, duration: total });
      function onChunkSelect(parentClipIndex, chunkIndex, templateTrackIndex, templateClipIndex, chunkType) {
        /* Seek playhead to the chunk's start time */
        var parentClip = clips[parentClipIndex];
        if (!parentClip) return;
        /* Find the actual caption/TTS asset to read word timings */
        var tplAsset = null;
        if (template && template.timeline && Array.isArray(template.timeline.tracks) && templateTrackIndex != null && templateClipIndex != null) {
          var tr = template.timeline.tracks[templateTrackIndex];
          if (tr && tr.clips && tr.clips[templateClipIndex]) {
            tplAsset = tr.clips[templateClipIndex].asset;
          }
        }
        /* Compute chunk start time */
        var chunkStart = 0;
        if (tplAsset && tplAsset.words && global.__CFS_chunkUtils) {
          var chunks = global.__CFS_chunkUtils.buildCaptionChunks(tplAsset.words, tplAsset.display);
          if (chunks[chunkIndex]) chunkStart = chunks[chunkIndex].timeStart;
        }
        var clipStart = (typeof parentClip.displayStart === 'number') ? parentClip.displayStart : (typeof parentClip.start === 'number' ? parentClip.start : 0);
        var seekTime = clipStart + chunkStart;
        if (typeof setPlayheadTime === 'function') setPlayheadTime(seekTime);
        if (coreScene && coreScene.seekToTime && canvas) coreScene.seekToTime(canvas, seekTime);
        if (canvas) { canvas.discardActiveObject(); canvas.renderAll(); }
        /* Select the parent caption/TTS clip for property panel */
        selectedAudioClip = null;
        selectedLumaClip = null;
        selectedHtmlClip = null;
        selectedTextToImageClip = null;
        selectedImageToVideoClip = null;
        if (chunkType === 'caption-chunk') {
          selectedCaptionClip = { templateTrackIndex: templateTrackIndex, templateClipIndex: templateClipIndex, selectedChunkIndex: chunkIndex };
          selectedTtsClip = null;
        } else {
          selectedTtsClip = { templateTrackIndex: templateTrackIndex, templateClipIndex: templateClipIndex, selectedChunkIndex: chunkIndex };
          selectedCaptionClip = null;
        }
        refreshPropertyPanel();
      }
      lastRenderedClips = clips; /* Store for delete/selection index matching */
      panel.render(timelineContainer, { template: template, canvas: canvas, clips: clips, totalDuration: total, minTracks: timelineMinTracks, selectedClipIndices: selectedClipIndices, lockedTracks: lockedTracks, razorMode: razorMode, onAddClip: addClip, onClipSelect: onClipSelect, onClipMove: onClipMove, onClipTrackChange: onClipTrackChange, onClipResize: onClipResize, onChunkSelect: onChunkSelect, onClipSplit: function (clipIdx, splitTime) { splitAllAtPlayhead(splitTime); }, onTrackLockToggle: function (ti, locked) { if (locked) lockedTracks.add(ti); else lockedTracks.delete(ti); refreshTimeline(); }, onSelectionChange: function (indices) { selectedClipIndices.clear(); indices.forEach(function (i) { selectedClipIndices.add(i); }); /* Update CSS classes directly instead of full re-render to preserve indices */ var clipEls = timelineContainer.querySelectorAll('.cfs-editor-clip[data-object-index]'); clipEls.forEach(function (el) { var oi = parseInt(el.getAttribute('data-object-index'), 10); if (selectedClipIndices.has(oi)) el.classList.add('cfs-editor-clip-selected'); else el.classList.remove('cfs-editor-clip-selected'); }); }, onAddTrack: function () { timelineMinTracks++; refreshTimeline(); }, snapGridSec: 0.5, allClipsForSnap: clips, getSnapDisabled: function () { return stateRef._snapDisabled || false; } });
      updatePlayheadExtent();
      setPlayheadTime(currentPlayheadSec);
    }

    if (outputType === 'book') initBookPages();
    else if (isCanvasOutputType(outputType)) initSingleCanvas();
    if (_savedUndoHistory && _savedUndoHistory.fabricHead && cfsJsonPatch) {
      setTimeout(function () {
        if (!canvas) return;
        isUndoRedo = true;
        try {
          canvas.loadFromJSON(_savedUndoHistory.fabricHead, function () {
            ensureCanvasObjectsSelectable(canvas);
            fixTextBaseline(canvas);
            applyResponsivePositions(canvas);
            refreshTextboxWrapping(canvas);
            constrainToBounds(canvas);
            canvas.renderAll();
            refreshLayersPanel();
            refreshPropertyPanel();
            invalidateFabricTextLayout(canvas);
            fabricHead = _savedUndoHistory.fabricHead;
            undoPatches = Array.isArray(_savedUndoHistory.patches) ? _savedUndoHistory.patches : [];
            if (_savedUndoHistory.mergeHead) { _mergeHead = _savedUndoHistory.mergeHead; restoreMergeState(_savedUndoHistory.mergeHead); }
            redoPatches.length = 0;
            updateUndoRedoButtons();
            _savedUndoHistory = null;
          });
        } finally {
          setTimeout(function () { isUndoRedo = false; }, 0);
        }
      }, 300);
    }
    refreshTimeline();
    updateDimensionsDisplay();
    updateCustomDimsVisibility();
    if (outputType === 'audio') {
      canvasRow.style.display = 'none';
      if (presetLabel) presetLabel.style.display = 'none';
      presetSelect.style.display = 'none';
      zoomLabel.style.display = 'none';
      zoomSelect.style.display = 'none';
      dimensionsEl.style.display = 'none';
      resLabel.style.display = 'none';
      resolutionScaleSelect.style.display = 'none';
    }
    var initialNonCanvas = (outputType === 'walkthrough');
    if (initialNonCanvas) {
      canvasRow.style.display = 'none';
      walkthroughPanel.style.display = 'block';
      renderWalkthroughPanel();
    }
    addToolbarBtn('Refresh', function () {
      var t = outputTypeSelect.value;
      if (t === 'walkthrough') renderWalkthroughPanel();
    });

    function attachObjectModifiedRefresh(c) {
      if (c && c.on) {
        c.on('object:modified', function () {
          refreshTimeline();
          refreshPropertyPanel();
        });
      }
    }
    attachObjectModifiedRefresh(canvas);

    var editorApi = global.__CFS_editorExtensionsApi && global.__CFS_editorExtensionsApi.createEditorApi ? global.__CFS_editorExtensionsApi.createEditorApi() : null;
    if (editorApi && editorApi._setRefs) {
      editorApi._setRefs({
        getCanvas: function () { return canvas; },
        getTemplate: function () { return template; },
        getExtension: function () { return extension; },
        getValues: function () { return (options.getMergeValues && options.getMergeValues()) || options.values || {}; },
        setValue: options.setValue || function () {},
        refreshPreview: options.refreshPreview || function () {},
        getPlaybackTime: function () { return stateRef.getPlaybackTime ? stateRef.getPlaybackTime() : 0; },
        isPlaying: function () { return stateRef.isPlaying ? stateRef.isPlaying() : false; },
        getSelectedObject: function () { return stateRef.getSelectedObject ? stateRef.getSelectedObject() : null; },
        getTotalDuration: function () { return stateRef.getTotalDuration ? stateRef.getTotalDuration() : 10; },
        getClips: function () { return stateRef.getClips ? stateRef.getClips() : []; },
        getEdit: function () { return stateRef.getEdit ? stateRef.getEdit() : null; },
        events: editEvents,
      });
    }
    var extensionHandlers = {};
    if (editorApi && global.__CFS_editorExtensionsLoader) {
      global.__CFS_editorExtensionsLoader.loadExtensions(editorApi, extension, function (loadErr) {
        if (loadErr) console.warn('Editor extension load issue:', loadErr.message || loadErr);
        var buttons = editorApi._getToolbarButtons ? editorApi._getToolbarButtons() : [];
        buttons.forEach(function (b) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = b.label;
          btn.className = 'cfs-btn-extension';
          if (b.onClick) {
            btn.addEventListener('click', function () {
              var position = stateRef.getPlaybackTime ? stateRef.getPlaybackTime() : 0;
              var selectedClip = stateRef.getSelectedObject ? stateRef.getSelectedObject() : null;
              b.onClick({ position: position, selectedClip: selectedClip });
            });
          }
          toolbar.appendChild(btn);
        });
        extensionHandlers = editorApi._getExportHandlers ? editorApi._getExportHandlers() : {};

        var stepUIs = global.__CFS_stepGeneratorUIs || {};
        Object.keys(stepUIs).forEach(function (sid) {
          try {
            if (typeof stepUIs[sid] === 'function') stepUIs[sid](editorApi);
          } catch (e) {
            console.warn('Step generator UI error:', sid, e);
          }
        });

        var sidebarSections = editorApi._getSidebarSections ? editorApi._getSidebarSections() : [];
        var sectionsContainer = document.getElementById('stepGeneratorSections');
        if (sectionsContainer) sectionsContainer.innerHTML = '';
        if (sectionsContainer && sidebarSections.length) {
          sidebarSections.forEach(function (renderFn) {
            var sDiv = document.createElement('div');
            sDiv.className = 'gen-step-section';
            try { renderFn(sDiv); } catch (e) { console.warn('Sidebar section render error:', e); }
            if (sDiv.childNodes.length) sectionsContainer.appendChild(sDiv);
          });
        }

        var stepButtons = editorApi._getToolbarButtons ? editorApi._getToolbarButtons() : [];
        stepButtons.slice(buttons.length).forEach(function (b) {
          var sbtn = document.createElement('button');
          sbtn.type = 'button';
          sbtn.textContent = b.label;
          sbtn.className = 'cfs-btn-extension';
          if (b.onClick) {
            sbtn.addEventListener('click', function () {
              var position = stateRef.getPlaybackTime ? stateRef.getPlaybackTime() : 0;
              var selectedClip = stateRef.getSelectedObject ? stateRef.getSelectedObject() : null;
              b.onClick({ position: position, selectedClip: selectedClip });
            });
          }
          toolbar.appendChild(sbtn);
        });
        extensionHandlers = editorApi._getExportHandlers ? editorApi._getExportHandlers() : {};
      });
    }

    function exportViaExtension(outputType) {
      var handlers = extensionHandlers[outputType];
      if (!handlers || !handlers.length) return Promise.resolve(null);
      var values = (options.getMergeValues && options.getMergeValues()) || options.values || {};
      return Promise.resolve(handlers[0](values));
    }

    function exportAudio() {
      var shotstack = (typeof getShotstackTemplate === 'function' && getShotstackTemplate()) || null;
      var engine = global.__CFS_templateEngine;
      if (shotstack && shotstack.timeline && engine && typeof engine.renderTimelineToAudioBlob === 'function') {
        var values = (options.getMergeValues && options.getMergeValues()) || options.values || {};
        var merge = (engine.buildMerge && engine.buildMerge(extension, values, shotstack)) || [];
        var mergedTemplate = engine.applyMergeToTemplate(shotstack, merge);
        return engine.renderTimelineToAudioBlob(mergedTemplate).then(function (rawBlob) {
          if (!rawBlob) return false;

          function finishAudioExport(blob, ext) {
            root._cfsLastExportedAudioBlob = blob;
            if (editEvents) editEvents.emit('export:audio', blob);
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'audio-export.' + ext;
            a.click();
            _autoSaveGeneration(blob, 'local', ext, 'audio');
          }

          if (global.FFmpegLocal && global.FFmpegLocal.convertToM4a) {
            return global.FFmpegLocal.convertToM4a(rawBlob).then(function (result) {
              if (result.ok) {
                finishAudioExport(result.blob, 'm4a');
              } else {
                console.warn('[CFS] Local M4A conversion failed, using WAV:', result.error);
                finishAudioExport(rawBlob, 'wav');
              }
              return true;
            });
          }
          finishAudioExport(rawBlob, 'wav');
          return true;
        }).catch(function (e) {
          console.warn('Audio export via timeline failed, falling back to extension handler:', e);
          return exportViaExtension('audio').then(function (result) {
            if (result && (result.data || result.url) && global.__CFS_genOutputs && global.__CFS_genOutputs.export) {
              global.__CFS_genOutputs.export('audio', result.data || result.url);
              return true;
            }
            return false;
          });
        });
      }
      return exportViaExtension('audio').then(function (result) {
        if (result && (result.data || result.url) && global.__CFS_genOutputs && global.__CFS_genOutputs.export) {
          global.__CFS_genOutputs.export('audio', result.data || result.url);
          return true;
        }
        return false;
      }).catch(function (e) { console.warn('Export audio failed', e); return false; });
    }

    container.innerHTML = '';
    container.appendChild(root);

    function injectMergeValues(sidebarValues) {
      if (!canvas || !coreScene || !coreScene.injectMergeData) return;
      var mergeData = buildMergeValuesFrom(sidebarValues || {});
      coreScene.injectMergeData(canvas, mergeData);
      if (typeof refreshTextboxWrapping === 'function') refreshTextboxWrapping(canvas);
      canvas.requestRenderAll && canvas.requestRenderAll();
      if (!canvas.requestRenderAll) canvas.renderAll();
      var fields = Object.keys(mergeData);
      if (fields.length) editEvents.emit('mergefield:changed', { fields: fields });
    }

    function exportWalkthrough() {
      var data = getWalkthroughExportData();
      if (!data) return false;
      function download(content, filename, mime) {
        var a = document.createElement('a');
        a.href = 'data:' + (mime || 'application/octet-stream') + ';charset=utf-8,' + encodeURIComponent(content);
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      try {
        download(data.scriptInlined, 'walkthrough-runner.js', 'application/javascript');
        download(data.configJson, 'walkthrough-config.json', 'application/json');
      } catch (e) {
        return false;
      }
      return true;
    }

    var exporter = {
      exportPng: exportPng,
      exportVideo: exportVideo,
      exportAudio: exportAudio,
      exportBook: exportBook,
      getDuration: function () { return stateRef.getTotalDuration ? stateRef.getTotalDuration() : 10; },
      getCanvas: function () { return canvas; },
      getEdit: function () { return getShotstackTemplate ? getShotstackTemplate() : null; },
    };

    var instance = {
      root: root,
      getCanvas: function () { return canvas; },
      getPages: function () { return pages; },
      getOutputType: function () { return outputTypeSelect.value; },
      getShotstackTemplate: getShotstackTemplate,
      getMergeValuesFromCanvas: getMergeValuesFromCanvas,
      getWalkthroughExport: getWalkthroughExportData,
      exportBook: exportBook,
      saveShotstackJson: saveShotstackJson,
      exportPng: exportPng,
      exportVideo: exportVideo,
      exportAudio: exportAudio,
      exportWalkthrough: exportWalkthrough,
      exportViaExtension: exportViaExtension,
      injectMergeValues: injectMergeValues,
      addText: addText,
      addImage: addImage,
      addShape: addShape,
      importSvg: importSvg,
      events: editEvents,
      getPlaybackTime: function () { return stateRef.getPlaybackTime ? stateRef.getPlaybackTime() : 0; },
      isPlaying: function () { return stateRef.isPlaying ? stateRef.isPlaying() : false; },
      getSelectedObject: function () { return stateRef.getSelectedObject ? stateRef.getSelectedObject() : null; },
      getTotalDuration: function () { return stateRef.getTotalDuration ? stateRef.getTotalDuration() : 10; },
      getClips: function () { return stateRef.getClips ? stateRef.getClips() : []; },
      getEdit: function () { return stateRef.getEdit ? stateRef.getEdit() : null; },
      exporter: exporter,
      getDraftState: function () {
        try { return getShotstackTemplate(); } catch (_) { return null; }
      },
      hasPendingChanges: function () {
        if (!canvas) return false;
        try {
          var fp = JSON.stringify(canvas.toJSON(CFS_RESPONSIVE_KEYS));
          return lastSavedFingerprint != null && fp !== lastSavedFingerprint;
        } catch (_) { return false; }
      },
      markSaved: function () {
        if (!canvas) return;
        try { lastSavedFingerprint = JSON.stringify(canvas.toJSON(CFS_RESPONSIVE_KEYS)); } catch (_) {}
        editEvents.emit('save:completed', {});
      },
      getUndoHistory: function () {
        return { fabricHead: fabricHead, patches: undoPatches, mergeHead: _mergeHead };
      },
      setUndoHistory: function (history) {
        if (!history) return;
        if (history.fabricHead) fabricHead = history.fabricHead;
        if (Array.isArray(history.patches)) undoPatches = history.patches;
        if (history.mergeHead) { _mergeHead = history.mergeHead; restoreMergeState(history.mergeHead); }
        redoPatches.length = 0;
        updateUndoRedoButtons();
      },
      markSavePoint: function () {
        if (undoPatches.length) undoPatches[0].isSave = true;
      },
      getUndoPatches: function () { return undoPatches; },
      restoreState: restoreState,
    };
    if (container) container._cfsEditor = instance;
    return instance;
  }

  global.__CFS_unifiedEditor = {
    create: create,
    serializeEditorMeta: serializeEditorMeta,
    deserializeEditorMeta: deserializeEditorMeta,
    stripCfsMetaFromMerge: stripCfsMetaFromMerge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
