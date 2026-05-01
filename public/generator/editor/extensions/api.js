/**
 * Editor extension API. The unified editor creates an API object and passes it to each
 * loaded extension. Extensions use this to add toolbar buttons, export handlers, and
 * read/write editor state.
 */
(function (global) {
  'use strict';

  /**
   * Create the API object that the editor will pass to extensions.
   * Methods that need live refs (getCanvas, etc.) are set by the editor when it mounts.
   */
  function createEditorApi() {
    var toolbarButtons = [];
    var exportHandlers = {}; // outputType -> [fn]
    var sidebarSections = [];
    var getCanvasRef = function () { return null; };
    var getTemplateRef = function () { return {}; };
    var getExtensionRef = function () { return {}; };
    var getValuesRef = function () { return {}; };
    var setValueRef = function () {};
    var refreshPreviewRef = function () {};
    var getPlaybackTimeRef = function () { return 0; };
    var isPlayingRef = function () { return false; };
    var getSelectedObjectRef = function () { return null; };
    var getTotalDurationRef = function () { return 10; };
    var getClipsRef = function () { return []; };
    var getEditRef = function () { return null; };
    var eventsRef = null;

    var api = {
      /** Register a toolbar button. id: string, label: string, onClick: function({ position, selectedClip }). Called with current playhead time (s) and selected canvas object or null. */
      registerToolbarButton: function (id, label, onClick) {
        toolbarButtons.push({ id: id, label: label, onClick: onClick });
      },
      /** Register an export handler for an output type. outputType: 'image'|'audio'|'video'|'text'|'book', handler: function(values) -> Promise<{ type, data }> */
      registerExportHandler: function (outputType, handler) {
        if (!exportHandlers[outputType]) exportHandlers[outputType] = [];
        exportHandlers[outputType].push(handler);
      },
      /** Register a sidebar section. render(containerEl) is called when the editor mounts. */
      registerSidebarSection: function (renderFn) {
        sidebarSections.push(renderFn);
      },
      getCanvas: function () { return getCanvasRef(); },
      getTemplate: function () { return getTemplateRef(); },
      getExtension: function () { return getExtensionRef(); },
      getValues: function () { return getValuesRef(); },
      setValue: function (id, value) { setValueRef(id, value); },
      refreshPreview: function () { refreshPreviewRef(); },
      getPlaybackTime: function () { return getPlaybackTimeRef(); },
      isPlaying: function () { return isPlayingRef(); },
      getSelectedObject: function () { return getSelectedObjectRef(); },
      getTotalDuration: function () { return getTotalDurationRef(); },
      getClips: function () { return getClipsRef(); },
      getEdit: function () { return getEditRef(); },
      events: null,
      _getToolbarButtons: function () { return toolbarButtons; },
      _getExportHandlers: function () { return exportHandlers; },
      _getSidebarSections: function () { return sidebarSections; },
      _setRefs: function (refs) {
        if (refs.getCanvas) getCanvasRef = refs.getCanvas;
        if (refs.getTemplate) getTemplateRef = refs.getTemplate;
        if (refs.getExtension) getExtensionRef = refs.getExtension;
        if (refs.getValues) getValuesRef = refs.getValues;
        if (refs.setValue) setValueRef = refs.setValue;
        if (refs.refreshPreview) refreshPreviewRef = refs.refreshPreview;
        if (refs.getPlaybackTime) getPlaybackTimeRef = refs.getPlaybackTime;
        if (refs.isPlaying) isPlayingRef = refs.isPlaying;
        if (refs.getSelectedObject) getSelectedObjectRef = refs.getSelectedObject;
        if (refs.getTotalDuration) getTotalDurationRef = refs.getTotalDuration;
        if (refs.getClips) getClipsRef = refs.getClips;
        if (refs.getEdit) getEditRef = refs.getEdit;
        if (refs.events) api.events = refs.events;
      },
    };
    return api;
  }

  global.__CFS_editorExtensionsApi = { createEditorApi: createEditorApi };
})(typeof window !== 'undefined' ? window : globalThis);
