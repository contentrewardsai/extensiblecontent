/**
 * Loads generator-ui.js from each step folder listed in steps/manifest.json.
 * Each script registers a function via __CFS_registerStepGeneratorUI(id, fn).
 * The unified editor calls these functions with the editor API after it mounts.
 */
(function (global) {
  'use strict';

  global.__CFS_stepGeneratorUIs = global.__CFS_stepGeneratorUIs || {};

  global.__CFS_registerStepGeneratorUI = function (id, fn) {
    if (id && typeof fn === 'function') {
      global.__CFS_stepGeneratorUIs[id] = fn;
    }
  };

  function getBaseUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      return chrome.runtime.getURL('');
    if (typeof location !== 'undefined' && location.origin)
      return location.origin + '/';
    return '';
  }

  var base = getBaseUrl();
  var manifestUrl = base + 'steps/manifest.json';

  fetch(manifestUrl)
    .then(function (r) { return r.ok ? r.json() : { steps: [] }; })
    .then(function (data) {
      var steps = data.steps || [];
      steps.forEach(function (id) {
        var script = document.createElement('script');
        script.src = base + 'steps/' + encodeURIComponent(id) + '/generator-ui.js';
        script.onerror = function () {};
        document.head.appendChild(script);
      });
    })
    .catch(function () {});
})(typeof window !== 'undefined' ? window : globalThis);
