/**
 * Shared manifest loading utilities.
 * Used by generator/load-from-manifest.js and potentially steps/loader.js.
 * Fetches JSON manifests and optionally loads scripts in order.
 */
(function(global) {
  'use strict';

  var SUPPORTED_VERSIONS = { steps: '1', generatorInputs: '1', generatorOutputs: '1', templates: '1', workflows: '1' };

  function checkManifestVersion(data, kind) {
    if (!data || !data.version) return;
    var supported = SUPPORTED_VERSIONS[kind];
    if (supported && data.version !== supported) {
      try { console.warn('[CFS] manifest version mismatch:', kind, 'has', data.version, 'expected', supported); } catch (_) {}
    }
  }

  function fetchManifestJson(url) {
    return fetch(url).then(function(r) { return r.ok ? r.json() : {}; }).catch(function() { return {}; });
  }

  /**
   * Load a script by URL. Resolves on load or on error (does not reject).
   * @param {string} src - script URL
   * @param {Document} doc - document to append to (default: document)
   * @returns {Promise<void>}
   */
  function loadScript(src, doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return Promise.resolve();
    return new Promise(function(resolve) {
      var s = doc.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { try { console.warn('[CFS] Failed to load script:', src); } catch (_) {} resolve(); };
      doc.body.appendChild(s);
    });
  }

  /**
   * Load scripts sequentially from paths.
   * @param {string} baseUrl - base URL for relative paths
   * @param {string[]} paths - script paths (relative to baseUrl)
   * @param {Document} doc - optional document
   * @returns {Promise<void>}
   */
  function loadScriptsInOrder(baseUrl, paths, doc) {
    paths = Array.isArray(paths) ? paths : [];
    return paths.reduce(function(p, path) {
      return p.then(function() { return loadScript(baseUrl + path, doc); });
    }, Promise.resolve());
  }

  if (typeof global !== 'undefined') {
    global.CFS_manifestLoader = {
      fetchManifestJson: fetchManifestJson,
      loadScript: loadScript,
      loadScriptsInOrder: loadScriptsInOrder,
      checkManifestVersion: checkManifestVersion,
      SUPPORTED_VERSIONS: SUPPORTED_VERSIONS,
    };
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
