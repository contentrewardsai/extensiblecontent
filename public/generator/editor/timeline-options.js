/**
 * ShotStack Edit API: supported transition (in/out) and effect options for clips.
 * Used by the unified editor for dropdowns when editing/creating layers.
 * @see https://shotstack.io/docs/api/ https://shotstack.io/learn/slide-carousel-zoom-transitions-release/
 */
(function (global) {
  'use strict';

  var TRANSITION_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'fade', label: 'Fade' },
    { value: 'fadeSlow', label: 'Fade (slow)' },
    { value: 'fadeFast', label: 'Fade (fast)' },
    { value: 'wipeLeft', label: 'Wipe left' },
    { value: 'wipeRight', label: 'Wipe right' },
    { value: 'wipeUp', label: 'Wipe up' },
    { value: 'wipeDown', label: 'Wipe down' },
    { value: 'slideLeft', label: 'Slide left' },
    { value: 'slideRight', label: 'Slide right' },
    { value: 'slideUp', label: 'Slide up' },
    { value: 'slideDown', label: 'Slide down' },
    { value: 'slideLeftSlow', label: 'Slide left (slow)' },
    { value: 'slideRightSlow', label: 'Slide right (slow)' },
    { value: 'slideUpSlow', label: 'Slide up (slow)' },
    { value: 'slideDownSlow', label: 'Slide down (slow)' },
    { value: 'zoomIn', label: 'Zoom in' },
    { value: 'zoomOut', label: 'Zoom out' },
    { value: 'zoomInSlow', label: 'Zoom in (slow)' },
    { value: 'zoomOutSlow', label: 'Zoom out (slow)' },
    { value: 'carouselLeft', label: 'Carousel left' },
    { value: 'carouselRight', label: 'Carousel right' },
    { value: 'carouselUp', label: 'Carousel up' },
    { value: 'carouselDown', label: 'Carousel down' },
    { value: 'carouselDownSlow', label: 'Carousel down (slow)' },
    { value: 'shuffle', label: 'Shuffle' }
  ];

  var EFFECT_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'zoomIn', label: 'Zoom in' },
    { value: 'zoomOut', label: 'Zoom out' },
    { value: 'zoomInSlow', label: 'Zoom in (slow)' },
    { value: 'zoomOutSlow', label: 'Zoom out (slow)' },
    { value: 'slideLeft', label: 'Slide left' },
    { value: 'slideRight', label: 'Slide right' },
    { value: 'slideUp', label: 'Slide up' },
    { value: 'slideDown', label: 'Slide down' },
    { value: 'slideLeftSlow', label: 'Slide left (slow)' },
    { value: 'slideRightSlow', label: 'Slide right (slow)' },
    { value: 'slideUpSlow', label: 'Slide up (slow)' },
    { value: 'slideDownSlow', label: 'Slide down (slow)' }
  ];

  var FIT_OPTIONS = [
    { value: 'contain', label: 'Contain' },
    { value: 'cover', label: 'Cover' },
    { value: 'crop', label: 'Crop' },
    { value: 'none', label: 'None' }
  ];

  global.__CFS_shotstackOptions = {
    transitions: TRANSITION_OPTIONS,
    effects: EFFECT_OPTIONS,
    fit: FIT_OPTIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
