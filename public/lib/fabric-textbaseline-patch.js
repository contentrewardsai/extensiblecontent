/**
 * Fabric.js 5 uses 'alphabetical'; Canvas API requires 'alphabetic'.
 * Patch context setter and Fabric text classes so the warning never fires.
 */
(function () {
  'use strict';
  try {
    var proto = CanvasRenderingContext2D.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'textBaseline');
    if (desc && desc.set) {
      var origSet = desc.set;
      desc.set = function (v) {
        if (v === 'alphabetical') v = 'alphabetic';
        return origSet.call(this, v);
      };
      Object.defineProperty(proto, 'textBaseline', desc);
    }
  } catch (_) {}
  if (typeof fabric !== 'undefined') {
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
  }
})();
