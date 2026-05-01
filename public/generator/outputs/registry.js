/**
 * Registry for generator output display/export. Each output type (image, video, text)
 * can show result in a container and optionally export.
 */
(function() {
  'use strict';
  window.__CFS_genOutputs = window.__CFS_genOutputs || {};
  window.__CFS_genOutputs.register = function(type, showFn, exportFn) {
    window.__CFS_genOutputs[type] = { show: showFn, export: exportFn };
  };
  window.__CFS_genOutputs.show = function(type, container, data) {
    const reg = window.__CFS_genOutputs[type];
    if (reg && reg.show) reg.show(container, data);
  };
  window.__CFS_genOutputs.export = function(type, data) {
    const reg = window.__CFS_genOutputs[type];
    if (reg && reg.export) return reg.export(data);
  };
})();
