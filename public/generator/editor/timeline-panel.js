/**
 * Timeline panel: shows tracks and clips from template or from canvas objects (cfsStart, cfsLength).
 * Allows adding tracks and clips for video/audio output.
 * Supports per-chunk sub-clips for caption and TTS clips.
 */
(function (global) {
  'use strict';

  function getChunkUtils() { return global.__CFS_chunkUtils; }

  function buildClipsFromTemplate(template) {
    var clips = [];
    if (!template || !template.timeline || !Array.isArray(template.timeline.tracks)) return clips;
    var tracks = template.timeline.tracks;
    tracks.forEach(function (track, ti) {
      var trackCursor = 0;
      (track.clips || []).forEach(function (clip, cIdx) {
        var asset = clip.asset || {};
        var type = asset.type || 'title';
        var label = type === 'audio' ? 'Audio' : (type === 'text-to-speech' ? 'TTS' : ((type === 'caption' || type === 'rich-caption') ? 'Caption' : (type === 'text-to-image' ? 'Text-to-image' : (type === 'image-to-video' ? 'Image-to-video' : (type === 'luma' ? 'Luma' : (type === 'html' ? 'HTML' : (type === 'shape' ? 'Line' : (type === 'title' && asset.text ? String(asset.text).slice(0, 20) : (type === 'image' ? 'Image' : (type === 'video' ? 'Video' : 'Clip'))))))))));
        var startVal = clip.start;
        var lengthVal = clip.length;
        var displayStart = (typeof startVal === 'number') ? startVal : ((startVal === 'auto') ? trackCursor : 0);
        var displayLength = (typeof lengthVal === 'number') ? lengthVal : ((lengthVal === 'end' || lengthVal === 'auto') ? 3 : 5);
        trackCursor = Math.max(trackCursor, displayStart + displayLength);

        /* Emit the parent clip */
        var parentEntry = {
          trackIndex: ti,
          start: clip.start != null ? clip.start : displayStart,
          length: clip.length != null ? clip.length : displayLength,
          displayStart: displayStart,
          displayLength: displayLength,
          label: label,
          type: type,
          templateTrackIndex: ti,
          templateClipIndex: cIdx,
        };

        /* For caption and TTS clips, also emit sub-chips */
        var isCaption = (type === 'caption' || type === 'rich-caption');
        var isTTS = (type === 'text-to-speech');
        if ((isCaption || isTTS) && getChunkUtils() && getChunkUtils().buildCaptionChunks) {
          var words = asset.words;
          var display = asset.display || {};
          /* For TTS clips, use sibling caption's words for aligned chunking */
          if (isTTS && (!words || !words.length)) {
            /* Look for a caption track's words in the same template */
            for (var si = 0; si < tracks.length; si++) {
              var sCl = (tracks[si].clips || []); 
              for (var sci = 0; sci < sCl.length; sci++) {
                var sa = sCl[sci].asset || {};
                if ((sa.type === 'caption' || sa.type === 'rich-caption') && sa.words && sa.words.length) {
                  words = sa.words;
                  if (sa.display) display = sa.display;
                  break;
                }
              }
              if (words && words.length) break;
            }
            /* Fallback: estimate from text */
            if ((!words || !words.length) && asset.text) {
              var estimateWords = global.__CFS_estimateWords;
              var estimateSpan = global.__CFS_estimateWordsInSpan;
              var ttsLen = Number(clip.length) || 0;
              if (ttsLen > 0 && estimateSpan) {
                words = estimateSpan(asset.text, 0, ttsLen);
              } else if (estimateWords) {
                words = estimateWords(asset.text, 0);
              }
            }
          }
          if (words && words.length) {
            var chunks = getChunkUtils().buildCaptionChunks(words, display);
            parentEntry.isParentClip = true;
            parentEntry._subClipCount = chunks.length;
            clips.push(parentEntry);
            /* Emit sub-clips */
            for (var ci = 0; ci < chunks.length; ci++) {
              var chunk = chunks[ci];
              var chunkLabel = chunk.text.length > 18 ? chunk.text.slice(0, 18) + '…' : chunk.text;
              clips.push({
                trackIndex: ti,
                start: displayStart + chunk.timeStart,
                length: Math.max(0.1, chunk.timeEnd - chunk.timeStart),
                displayStart: displayStart + chunk.timeStart,
                displayLength: Math.max(0.1, chunk.timeEnd - chunk.timeStart),
                label: chunkLabel,
                type: isCaption ? 'caption-chunk' : 'tts-chunk',
                isSubClip: true,
                parentClipIndex: clips.length - 1, /* index of the parent we just pushed */
                chunkIndex: ci,
                templateTrackIndex: ti,
                templateClipIndex: cIdx,
              });
            }
            return; /* don't push parentEntry again */
          }
        }
        clips.push(parentEntry);
      });
    });
    return clips;
  }

  function buildClipsFromCanvas(canvas, defaultDuration) {
    defaultDuration = defaultDuration || 5;
    var clips = [];
    if (!canvas || !canvas.getObjects) return clips;
    var objects = canvas.getObjects();
    var time = 0;
    objects.forEach(function (obj) {
      var start = obj.cfsStart != null ? obj.cfsStart : time;
      var length = obj.cfsLength != null ? obj.cfsLength : defaultDuration;
      if (typeof start === 'number' && typeof length === 'number') {
        time = Math.max(time, start + length);
      } else {
        time = Math.max(time, time + (typeof length === 'number' ? length : defaultDuration));
      }
      var label = (obj.name || obj.id || obj.type || 'Object').toString().slice(0, 20);
      if (obj.cfsVideoSrc) label = 'Video';
      else if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') label = (obj.text || 'Text').toString().slice(0, 20);
      var trackIndex = obj.cfsTrackIndex != null ? obj.cfsTrackIndex : 0;
      clips.push({ trackIndex: trackIndex, start: start, length: length, label: label, type: obj.type || 'object', canvasIndex: clips.length });
    });
    return clips;
  }

  /** Snap time to grid and/or other clip edges. Returns snapped value or original if snap disabled. */
  function snapTime(sec, options, excludeClipIndex) {
    if (options.getSnapDisabled && options.getSnapDisabled()) return sec;
    var grid = options.snapGridSec;
    var allClips = options.allClipsForSnap || [];
    var threshold = 0.25;
    var candidates = [];
    if (typeof grid === 'number' && grid > 0) {
      for (var t = 0; t <= (options.totalDuration || 60); t += grid) candidates.push(t);
    }
    allClips.forEach(function (c, i) {
      if (i === excludeClipIndex) return;
      var s = typeof c.start === 'number' ? c.start : 0;
      var len = typeof c.length === 'number' ? c.length : 5;
      candidates.push(s);
      candidates.push(s + len);
    });
    var best = sec;
    var bestDist = threshold;
    candidates.forEach(function (t) {
      var d = Math.abs(t - sec);
      if (d < bestDist) { bestDist = d; best = t; }
    });
    return Math.round(best * 100) / 100;
  }

  function render(container, options) {
    options = options || {};
    var template = options.template;
    var canvas = options.canvas;
    var totalDuration = options.totalDuration || 10;
    var clips = options.clips || [];
    if (!clips.length && template) clips = buildClipsFromTemplate(template);
    if (!clips.length && canvas) clips = buildClipsFromCanvas(canvas, 5);
    if (!clips.length) totalDuration = Math.max(totalDuration, 10);

    /* Selection + locking state (passed in from editor, mutated via callbacks) */
    var selectedIndices = options.selectedClipIndices || new Set();
    var lockedTracks = options.lockedTracks || new Set();
    var razorMode = !!options.razorMode;
    var lastClickedIndex = options._lastClickedIndex != null ? options._lastClickedIndex : -1;

    var maxTrackIdx = 0;
    clips.forEach(function (c) { if ((c.trackIndex || 0) > maxTrackIdx) maxTrackIdx = c.trackIndex || 0; });
    var minTracks = options.minTracks != null ? options.minTracks : 2;
    var numTracks = Math.max(minTracks, maxTrackIdx + 2, 2);

    var tracksMap = {};
    clips.forEach(function (clip, objectIndex) {
      var ti = clip.trackIndex != null ? clip.trackIndex : 0;
      if (!tracksMap[ti]) tracksMap[ti] = [];
      tracksMap[ti].push({ clip: clip, objectIndex: objectIndex });
    });

    container.innerHTML = '';
    var label = document.createElement('div');
    label.className = 'cfs-editor-timeline';
    var _isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    var selCount = selectedIndices.size || 0;
    if (selCount > 0) {
      label.textContent = selCount + ' clip' + (selCount > 1 ? 's' : '') + ' selected — press Delete to remove, or ' + (_isMac ? '⌘' : 'Ctrl') + '+click to toggle selection';
      label.style.color = '#93c5fd';
    } else {
      label.textContent = 'Click a clip to select • ' + (_isMac ? '⌘' : 'Ctrl') + '+click for multi-select • S to split at playhead';
    }
    container.appendChild(label);

    var scale = 80;
    var trackLabelWidth = 60; /* lock(20) + gap(4) + label(32) + gap(4) */
    var ruler = document.createElement('div');
    ruler.className = 'cfs-editor-timeline-ruler';
    ruler.style.display = 'flex';
    ruler.style.paddingLeft = trackLabelWidth + 'px';
    ruler.style.minWidth = (totalDuration * scale + trackLabelWidth) + 'px';
    for (var t = 0; t <= totalDuration; t += 1) {
      var tick = document.createElement('span');
      tick.style.cssText = 'flex-shrink:0;width:' + scale + 'px;text-align:left;font-size:10px;color:var(--gen-muted);';
      tick.textContent = t + 's';
      ruler.appendChild(tick);
    }
    container.appendChild(ruler);

    function getTrackIndexAt(clientY) {
      var rows = container.querySelectorAll('.cfs-editor-track-row');
      for (var r = 0; r < rows.length; r++) {
        var rect = rows[r].getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return parseInt(rows[r].getAttribute('data-track-index'), 10);
      }
      return 0;
    }

    for (var trackIdx = 0; trackIdx < numTracks; trackIdx++) {
      var isLocked = lockedTracks.has(trackIdx);
      var trackRow = document.createElement('div');
      trackRow.className = 'cfs-editor-track-row' + (isLocked ? ' cfs-editor-track-locked' : '');
      trackRow.setAttribute('data-track-index', trackIdx);
      trackRow.style.cssText = 'display:flex;align-items:center;gap:4px;min-height:36px;margin-top:4px;';
      /* Lock toggle */
      var lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'cfs-editor-track-lock-btn';
      lockBtn.title = isLocked ? 'Unlock track ' + trackIdx : 'Lock track ' + trackIdx;
      lockBtn.textContent = isLocked ? '🔒' : '🔓';
      lockBtn.style.cssText = 'flex-shrink:0;width:20px;height:20px;padding:0;border:none;background:transparent;cursor:pointer;font-size:12px;line-height:20px;text-align:center;opacity:' + (isLocked ? '1' : '0.4') + ';';
      lockBtn.setAttribute('data-track-index', trackIdx);
      lockBtn.addEventListener('click', (function (ti) {
        return function () {
          if (options.onTrackLockToggle) options.onTrackLockToggle(ti, !lockedTracks.has(ti));
        };
      })(trackIdx));
      trackRow.appendChild(lockBtn);
      var trackLabel = document.createElement('span');
      trackLabel.className = 'cfs-editor-track-label';
      trackLabel.style.cssText = 'flex-shrink:0;width:32px;font-size:10px;color:var(--gen-muted);';
      trackLabel.textContent = 'T' + trackIdx;
      trackRow.appendChild(trackLabel);
      var trackDiv = document.createElement('div');
      trackDiv.className = 'cfs-editor-track';
      trackDiv.style.cssText = 'flex:1;min-width:' + (totalDuration * scale) + 'px;height:36px;display:flex;align-items:center;gap:0;position:relative;';
      var items = tracksMap[trackIdx] || [];
      items.forEach(function (item) {
        var clip = item.clip;
        var objectIndex = item.objectIndex;
        var el = document.createElement('div');

        /* Determine CSS modifier class */
        var clipMod = '';
        if (clip.isSubClip && clip.type === 'caption-chunk') clipMod = ' cfs-editor-clip-caption-chunk';
        else if (clip.isSubClip && clip.type === 'tts-chunk') clipMod = ' cfs-editor-clip-tts-chunk';
        else if (clip.type === 'audio') clipMod = ' cfs-editor-clip-audio';
        else if (clip.type === 'text-to-speech') clipMod = ' cfs-editor-clip-tts';
        else if (clip.type === 'caption' || clip.type === 'rich-caption') clipMod = ' cfs-editor-clip-caption';
        else if (clip.type === 'text-to-image') clipMod = ' cfs-editor-clip-tti';
        else if (clip.type === 'image-to-video') clipMod = ' cfs-editor-clip-itv';
        else if (clip.type === 'luma') clipMod = ' cfs-editor-clip-luma';
        else if (clip.type === 'html') clipMod = ' cfs-editor-clip-html';
        else if (clip.type === 'shape') clipMod = ' cfs-editor-clip-shape';

        var isSelected = selectedIndices.has(objectIndex);
        el.className = 'cfs-editor-clip' + (clipMod || '') + (isSelected ? ' cfs-editor-clip-selected' : '');
        el.setAttribute('data-object-index', objectIndex);
        if (clip.type) el.setAttribute('data-clip-type', clip.type);
        if (clip.isSubClip) el.setAttribute('data-chunk-index', clip.chunkIndex);

        /* Parent clips render as thin background bars behind sub-clips */
        if (clip.isParentClip) {
          el.style.opacity = '0.3';
          el.style.height = '12px';
          el.style.top = '12px';
          el.style.zIndex = '0';
        }
        if (clip.isSubClip) {
          el.style.zIndex = '1';
          el.style.fontSize = '9px';
        }

        var displayStart = (typeof clip.displayStart === 'number') ? clip.displayStart : (typeof clip.start === 'number' ? clip.start : 0);
        var displayLength = (typeof clip.displayLength === 'number')
          ? clip.displayLength
          : ((clip.length === 'end') ? Math.max(1, totalDuration - displayStart) : (clip.length === 'auto' ? 3 : (typeof clip.length === 'number' ? clip.length : 3)));
        var clipWidth = Math.max(clip.isSubClip ? 20 : 40, displayLength * scale);
        var startPx = displayStart * scale;
        el.style.width = clipWidth + 'px';
        el.style.position = 'absolute';
        el.style.left = startPx + 'px';
        el.style.top = clip.isParentClip ? '12px' : '0';
        el.style.height = clip.isParentClip ? '12px' : '100%';
        el.style.boxSizing = 'border-box';
        el.style.display = 'flex';
        el.style.alignItems = 'stretch';
        el.style.userSelect = 'none';
        el.style.webkitUserSelect = 'none';
        var labelSpan = document.createElement('span');
        labelSpan.textContent = clip.label;
        labelSpan.style.flex = '1';
        labelSpan.style.overflow = 'hidden';
        labelSpan.style.padding = '0 4px';
        labelSpan.style.pointerEvents = 'auto';
        if (clip.isSubClip) {
          labelSpan.style.whiteSpace = 'nowrap';
          labelSpan.style.textOverflow = 'ellipsis';
        }
        var timingTip = (clip.start === 'auto' || clip.length === 'auto' || clip.length === 'end') ? ' (Smart Clip: ' + (clip.start === 'auto' ? 'auto start' : clip.start) + ', ' + (clip.length === 'end' ? 'end' : clip.length) + ' length)' : (' (' + displayStart.toFixed(2) + 's – ' + (displayStart + displayLength).toFixed(2) + 's)');
        el.title = clip.label + timingTip + (clip.isSubClip ? ' [chunk ' + clip.chunkIndex + ']' : '') + '. Drag for start/track; drag edges to trim.';

        /* Sub-clips: click only (no drag/resize for now) */
        if (clip.isSubClip) {
          el.appendChild(labelSpan);
          el.style.cursor = razorMode ? 'crosshair' : 'pointer';
          el.addEventListener('click', function (e) {
            if (razorMode && options.onClipSplit) {
              var rect = el.parentNode.getBoundingClientRect();
              var splitTime = (e.clientX - rect.left) / scale;
              options.onClipSplit(clip.parentClipIndex != null ? clip.parentClipIndex : objectIndex, splitTime);
              return;
            }
            if (options.onChunkSelect) {
              options.onChunkSelect(clip.parentClipIndex, clip.chunkIndex, clip.templateTrackIndex, clip.templateClipIndex, clip.type);
            } else if (options.onClipSelect) {
              options.onClipSelect(objectIndex);
            }
          });
          trackDiv.appendChild(el);
          return;
        }

        var canResize = clip.type === 'audio' || clip.type === 'image' || clip.type === 'video' || clip.type === 'text' || clip.type === 'textbox' || clip.type === 'i-text' || clip.type === 'rich-text' || clip.type === 'title' || clip.type === 'object' || clip.type === 'text-to-speech' || clip.type === 'caption' || clip.type === 'rich-caption' || clip.type === 'text-to-image' || clip.type === 'image-to-video' || clip.type === 'luma' || clip.type === 'html' || clip.type === 'shape';
        if (canResize && options.onClipResize) {
          var leftHandle = document.createElement('div');
          leftHandle.className = 'cfs-editor-clip-resize cfs-editor-clip-resize-left';
          leftHandle.title = 'Trim start';
          var rightHandle = document.createElement('div');
          rightHandle.className = 'cfs-editor-clip-resize cfs-editor-clip-resize-right';
          rightHandle.title = 'Trim end';
          el.appendChild(leftHandle);
          el.appendChild(labelSpan);
          el.appendChild(rightHandle);
          function handleResize(isRight, e) {
            e.preventDefault();
            e.stopPropagation();
            var trackRect = trackDiv.getBoundingClientRect();
            var startSec = typeof clip.start === 'number' ? clip.start : 0;
            var lengthSec = (clip.length === 'end') ? (totalDuration - startSec) : (typeof clip.length === 'number' ? clip.length : 5);
            var minLen = 0.1;
            var lastStart = startSec;
            var lastLength = lengthSec;
            function onResizeMove(ev) {
              var snapDisabledNow = ev.altKey;
              var x = ev.clientX - trackRect.left;
              var newStart = startSec;
              var newLength = lengthSec;
              if (isRight) {
                newLength = Math.max(minLen, x / scale - startPx / scale);
              } else {
                newStart = Math.max(0, Math.min(startSec + lengthSec - minLen, x / scale));
                newLength = startSec + lengthSec - newStart;
              }
              if (!snapDisabledNow && (options.snapGridSec || (options.allClipsForSnap && options.allClipsForSnap.length))) {
                if (!isRight) {
                  lastStart = snapTime(newStart, options, objectIndex);
                  lastLength = startSec + lengthSec - lastStart;
                } else {
                  var endSnap = snapTime(newStart + newLength, options, objectIndex);
                  lastLength = Math.max(minLen, endSnap - newStart);
                  lastStart = newStart;
                }
              } else {
                lastStart = newStart;
                lastLength = newLength;
              }
              el.style.left = (lastStart * scale) + 'px';
              el.style.width = Math.max(40, lastLength * scale) + 'px';
            }
            function onResizeUp() {
              document.removeEventListener('mousemove', onResizeMove);
              document.removeEventListener('mouseup', onResizeUp);
              if (options.onClipResize) options.onClipResize(objectIndex, lastStart, lastLength);
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
          }
          leftHandle.addEventListener('mousedown', function (e) { if (e.button === 0) handleResize(false, e); });
          rightHandle.addEventListener('mousedown', function (e) { if (e.button === 0) handleResize(true, e); });
        } else {
          el.appendChild(labelSpan);
        }
        if (canvas) {
          el.style.cursor = 'grab';
          var dragStartX = null;
          var dragStartY = null;
          var dragStartLeft = null;
          var didDragH = false;
          var didDragV = false;
          function onClipMouseDown(e) {
            if (e.button !== 0) return;
            e.preventDefault();
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartLeft = parseInt(el.style.left || '0', 10);
            didDragH = false;
            didDragV = false;
            el.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onDocMouseMove);
            document.addEventListener('mouseup', onDocMouseUp);
          }
          function onDocMouseMove(e) {
            if (dragStartX == null) return;
            var dx = e.clientX - dragStartX;
            var dy = e.clientY - dragStartY;
            if (Math.abs(dx) > 4) didDragH = true;
            if (Math.abs(dy) > 4) didDragV = true;
            var newLeft = Math.max(0, dragStartLeft + dx);
            el.style.left = newLeft + 'px';
          }
          function onDocMouseUp(e) {
            document.removeEventListener('mousemove', onDocMouseMove);
            document.removeEventListener('mouseup', onDocMouseUp);
            el.style.cursor = 'grab';
            var idx = parseInt(el.getAttribute('data-object-index'), 10);
            if (didDragH && options.onClipMove) {
              var newLeft = parseInt(el.style.left || '0', 10);
              var newStartSec = Math.round((newLeft / scale) * 10) / 10;
              if (!e.altKey && (options.snapGridSec || (options.allClipsForSnap && options.allClipsForSnap.length))) {
                newStartSec = snapTime(newStartSec, options, idx);
              }
              options.onClipMove(idx, newStartSec);
            }
            var newTrack = getTrackIndexAt(e.clientY);
            var currentTrack = clip.trackIndex != null ? clip.trackIndex : 0;
            if (didDragV && options.onClipTrackChange && newTrack !== currentTrack && newTrack >= 0) {
              options.onClipTrackChange(idx, newTrack);
            }
            dragStartX = null;
            dragStartY = null;
          }
          if (isLocked) {
            el.style.cursor = 'not-allowed';
          } else {
            el.addEventListener('mousedown', function (e) {
              if (e.button !== 0 || isLocked) return;
              e.preventDefault();
              if (razorMode && options.onClipSplit) {
                var rect = el.parentNode.getBoundingClientRect();
                var splitTime = (e.clientX - rect.left) / scale;
                options.onClipSplit(objectIndex, splitTime);
                return;
              }
              dragStartX = e.clientX;
              dragStartY = e.clientY;
              dragStartLeft = parseInt(el.style.left || '0', 10);
              didDragH = false;
              didDragV = false;
              el.style.cursor = 'grabbing';
              document.addEventListener('mousemove', onDocMouseMove);
              document.addEventListener('mouseup', function onUp(e) {
                document.removeEventListener('mousemove', onDocMouseMove);
                document.removeEventListener('mouseup', onUp);
                el.style.cursor = 'grab';
                var idx = parseInt(el.getAttribute('data-object-index'), 10);
                if (didDragH && options.onClipMove) {
                  var newLeft = parseInt(el.style.left || '0', 10);
                  var newStartSec = Math.round((newLeft / scale) * 10) / 10;
                  if (!e.altKey && (options.snapGridSec || (options.allClipsForSnap && options.allClipsForSnap.length))) {
                    newStartSec = snapTime(newStartSec, options, idx);
                  }
                  options.onClipMove(idx, newStartSec);
                }
                var newTrack = getTrackIndexAt(e.clientY);
                var currentTrack = clip.trackIndex != null ? clip.trackIndex : 0;
                if (didDragV && options.onClipTrackChange && newTrack !== currentTrack && newTrack >= 0) {
                  options.onClipTrackChange(idx, newTrack);
                }
                /* If no drag occurred, treat as a click for selection */
                if (!didDragH && !didDragV) {
                  handleClipClick(objectIndex, e, clips);
                }
                dragStartX = null;
                dragStartY = null;
              });
            });
          }
        } else {
          el.style.cursor = razorMode ? 'crosshair' : 'pointer';
          el.addEventListener('click', function (e) {
            if (isLocked) return;
            if (razorMode && options.onClipSplit) {
              var rect = el.parentNode.getBoundingClientRect();
              var splitTime = (e.clientX - rect.left) / scale;
              options.onClipSplit(objectIndex, splitTime);
              return;
            }
            handleClipClick(objectIndex, e, clips);
          });
        }
        trackDiv.appendChild(el);
      });
      trackRow.appendChild(trackDiv);
      container.appendChild(trackRow);
    }
    /* Add clip / Add track buttons removed — available via Canvas Tools and Layers panel */
    /* Multi-select click handler */
    function handleClipClick(idx, e, allClips) {
      var isMeta = e.metaKey || e.ctrlKey;
      var isShift = e.shiftKey;
      if (isMeta) {
        /* Toggle this clip in selection */
        if (selectedIndices.has(idx)) selectedIndices.delete(idx);
        else selectedIndices.add(idx);
      } else if (isShift && lastClickedIndex >= 0) {
        /* Range select: all non-sub-clip indices between lastClicked and idx on same track */
        var clickedTrack = (allClips[idx] && allClips[idx].trackIndex) || 0;
        var lo = Math.min(lastClickedIndex, idx);
        var hi = Math.max(lastClickedIndex, idx);
        for (var ri = lo; ri <= hi; ri++) {
          if (allClips[ri] && !allClips[ri].isSubClip && ((allClips[ri].trackIndex || 0) === clickedTrack)) {
            selectedIndices.add(ri);
          }
        }
      } else {
        /* Single select */
        selectedIndices.clear();
        selectedIndices.add(idx);
        if (options.onClipSelect) options.onClipSelect(idx);
      }
      options._lastClickedIndex = idx;
      if (options.onSelectionChange) options.onSelectionChange(Array.from(selectedIndices));
    }

    /* Razor guideline overlay */
    if (razorMode) {
      var razorLine = document.createElement('div');
      razorLine.className = 'cfs-editor-razor-line';
      razorLine.style.cssText = 'position:absolute;top:0;width:1px;height:100%;border-left:2px dashed #e11d48;pointer-events:none;z-index:20;display:none;';
      container.style.position = 'relative';
      container.appendChild(razorLine);
      container.addEventListener('mousemove', function (e) {
        var rect = container.getBoundingClientRect();
        var x = e.clientX - rect.left;
        razorLine.style.left = x + 'px';
        razorLine.style.display = '';
      });
      container.addEventListener('mouseleave', function () {
        razorLine.style.display = 'none';
      });
    }
  }

  var TRACK_LABEL_WIDTH = 60;
  var TRACK_ROW_HEIGHT = 40;

  global.__CFS_timelinePanel = {
    render: render,
    buildClipsFromTemplate: buildClipsFromTemplate,
    buildClipsFromCanvas: buildClipsFromCanvas,
    TRACK_LABEL_WIDTH: TRACK_LABEL_WIDTH,
    TRACK_ROW_HEIGHT: TRACK_ROW_HEIGHT,
  };
})(typeof window !== 'undefined' ? window : globalThis);

