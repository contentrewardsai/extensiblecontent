/**
 * Load output presets (aspect ratios, dimensions, platforms) for the generator.
 * Used by templates and the core engine to resolve outputPresetId to width/height/aspectRatio.
 */
(function (global) {
  'use strict';

  let presetsCache = null;

  function getPresetsUrl(baseUrl) {
    if (!baseUrl) baseUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('') : (global.location && global.location.origin ? global.location.origin + '/' : '');
    return baseUrl + 'generator/templates/presets/output-presets.json';
  }

  function loadPresets(baseUrl) {
    if (presetsCache) return Promise.resolve(presetsCache);
    const url = getPresetsUrl(baseUrl);
    return fetch(url)
      .then(function (res) { return res.ok ? res.json() : { presets: [], defaultVideoPresetId: 'youtube_16_9', defaultImagePresetId: 'instagram_square', defaultBookPresetId: 'book_letter' }; })
      .then(function (data) {
        presetsCache = data;
        return data;
      })
      .catch(function () {
        presetsCache = { presets: [], defaultVideoPresetId: 'youtube_16_9', defaultImagePresetId: 'instagram_square', defaultBookPresetId: 'book_letter' };
        return presetsCache;
      });
  }

  function getPreset(presetId) {
    if (!presetsCache || !presetsCache.presets) return null;
    return presetsCache.presets.find(function (p) { return p.id === presetId; }) || null;
  }

  function getDefaultPresetForOutputType(outputType) {
    if (!presetsCache) return null;
    const key = outputType === 'video' ? 'defaultVideoPresetId' : outputType === 'image' ? 'defaultImagePresetId' : outputType === 'book' ? 'defaultBookPresetId' : outputType === 'audio' ? 'defaultAudioPresetId' : null;
    const id = key ? presetsCache[key] : null;
    return id ? getPreset(id) : null;
  }

  function listPresetsForOutputType(outputType) {
    if (!presetsCache || !presetsCache.presets) return [];
    return presetsCache.presets.filter(function (p) {
      return !p.outputTypes || p.outputTypes.length === 0 || p.outputTypes.indexOf(outputType) !== -1;
    });
  }

  global.__CFS_outputPresets = {
    load: loadPresets,
    getPreset: getPreset,
    getDefaultPresetForOutputType: getDefaultPresetForOutputType,
    listPresetsForOutputType: listPresetsForOutputType,
    getPresetsUrl: getPresetsUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
