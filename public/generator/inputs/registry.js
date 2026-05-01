/**
 * Registry for generator input components. Each input type (text, dropdown, list, etc.)
 * registers a create(container, field, value, onChange) function.
 * Used by the main generator interface to build the sidebar form.
 */
(function() {
  'use strict';
  window.__CFS_genInputs = window.__CFS_genInputs || {};
  window.__CFS_genInputs.register = function(type, createFn) {
    window.__CFS_genInputs[type] = createFn;
  };
  window.__CFS_genInputs.create = function(type, container, field, value, onChange) {
    const fn = window.__CFS_genInputs[type];
    if (fn) return fn(container, field, value, onChange);
    return window.__CFS_genInputs.text(container, field, value, onChange);
  };
})();
