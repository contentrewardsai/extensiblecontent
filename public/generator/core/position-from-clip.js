/**
 * Shared positionFromClip: compute pixel position from ShotStack clip position/offset.
 * ShotStack offset.y is positive upward; canvas Y increases downward, so Y is negated.
 * offset values in (-1,1) are treated as fractions of canvas dimensions; otherwise pixels.
 * Empty/falsy position defaults to 'center'.
 *
 * For Fabric (scene.js): returns { left, top }
 * For Pixi (pixi-timeline-player.js): returns { x, y }
 *
 * Usage:
 *   var result = positionFromClip(canvasW, canvasH, clip, elemW, elemH);
 *   // result.x / result.y  — or equivalently result.left / result.top
 */
(function (global) {
  'use strict';

  function positionFromClip(canvasW, canvasH, clip, elemW, elemH) {
    var offset = clip.offset || {};
    var ox = offset.x != null ? Number(offset.x) : 0;
    var oy = offset.y != null ? Number(offset.y) : 0;
    var dx = Math.abs(ox) <= 1 ? ox * canvasW : ox;
    var dy = Math.abs(oy) <= 1 ? -oy * canvasH : -oy;
    var pos = (clip.position || '').toLowerCase();
    if (!pos) pos = 'center';
    var x, y;
    if (pos === 'center') { x = (canvasW - elemW) / 2 + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'top') { x = (canvasW - elemW) / 2 + dx; y = 0 + dy; }
    else if (pos === 'bottom') { x = (canvasW - elemW) / 2 + dx; y = canvasH - elemH + dy; }
    else if (pos === 'left') { x = 0 + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'right') { x = canvasW - elemW + dx; y = (canvasH - elemH) / 2 + dy; }
    else if (pos === 'topleft') { x = 0 + dx; y = 0 + dy; }
    else if (pos === 'topright') { x = canvasW - elemW + dx; y = 0 + dy; }
    else if (pos === 'bottomleft') { x = 0 + dx; y = canvasH - elemH + dy; }
    else if (pos === 'bottomright') { x = canvasW - elemW + dx; y = canvasH - elemH + dy; }
    else { x = (canvasW - elemW) / 2 + dx; y = (canvasH - elemH) / 2 + dy; }
    return { x: x, y: y, left: x, top: y };
  }

  global.__CFS_positionFromClip = positionFromClip;
})(typeof window !== 'undefined' ? window : globalThis);
