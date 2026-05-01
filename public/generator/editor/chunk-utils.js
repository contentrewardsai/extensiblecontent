/**
 * Shared utility: split an array of word-timing objects into SRT-style caption chunks.
 * Used by scene.js, pixi-timeline-player.js, unified-editor.js, and timeline-panel.js.
 */
(function (global) {
  'use strict';

  /**
   * Build SRT-style caption chunks from word timing data.
   * @param {Array} words - Array of { text, start, end } objects
   * @param {Object} [display] - { wordsPerLine: 4, lines: 2 }
   * @returns {Array} chunks - [{ words: [...], text: string, timeStart: number, timeEnd: number, wordStartIdx: number, wordEndIdx: number }, ...]
   */
  function buildCaptionChunks(words, display) {
    if (!Array.isArray(words) || !words.length) return [];
    display = display || {};
    var wordsPerLine = display.wordsPerLine || 4;
    var numLines = display.lines || 2;
    var chunkSize = wordsPerLine * numLines;
    var chunks = [];
    for (var i = 0; i < words.length; i += chunkSize) {
      var end = Math.min(i + chunkSize, words.length);
      var chunkWords = words.slice(i, end);
      var text = chunkWords.map(function (w) { return w && w.text != null ? String(w.text) : ''; }).join(' ');
      var timeStart = (chunkWords[0] && chunkWords[0].start != null) ? Number(chunkWords[0].start) : 0;
      var timeEnd = (chunkWords[chunkWords.length - 1] && chunkWords[chunkWords.length - 1].end != null)
        ? Number(chunkWords[chunkWords.length - 1].end)
        : (timeStart + 1);
      chunks.push({
        words: chunkWords,
        text: text,
        timeStart: timeStart,
        timeEnd: timeEnd,
        wordStartIdx: i,
        wordEndIdx: end - 1
      });
    }
    /* Close gaps: each chunk starts where the previous ends so timeline
       blocks render back-to-back without visual gaps. */
    for (var ci = 1; ci < chunks.length; ci++) {
      if (chunks[ci].timeStart > chunks[ci - 1].timeEnd) {
        chunks[ci].timeStart = chunks[ci - 1].timeEnd;
      }
    }
    return chunks;
  }

  /**
   * Find the word boundary nearest to a time, using 50% word-duration threshold.
   * If the cut is MORE than halfway into a word → that word stays with the LEFT half.
   * If the cut is LESS than halfway into a word → that word goes to the RIGHT half.
   *
   * @param {Array} words - [{ text, start, end }, ...]
   * @param {number} timeSec - Cut time (relative to clip start)
   * @returns {{ splitAfterIndex: number, snapTime: number,
   *             leftWords: Array, rightWords: Array,
   *             leftText: string, rightText: string }}
   *   splitAfterIndex: last word index in the left half (-1 = everything goes right)
   */
  function findWordBoundary(words, timeSec) {
    if (!Array.isArray(words) || !words.length) {
      return { splitAfterIndex: -1, snapTime: timeSec, leftWords: [], rightWords: [], leftText: '', rightText: '' };
    }
    /* If cut is before the first word starts, everything goes right */
    if (timeSec <= (words[0].start || 0)) {
      var allText = words.map(function (w) { return w.text || ''; }).join(' ');
      return { splitAfterIndex: -1, snapTime: words[0].start || 0, leftWords: [], rightWords: words.slice(), leftText: '', rightText: allText };
    }
    /* If cut is after the last word ends, everything goes left */
    var lastWord = words[words.length - 1];
    if (timeSec >= (lastWord.end || lastWord.start || 0)) {
      var allTextL = words.map(function (w) { return w.text || ''; }).join(' ');
      return { splitAfterIndex: words.length - 1, snapTime: lastWord.end || 0, leftWords: words.slice(), rightWords: [], leftText: allTextL, rightText: '' };
    }
    /* Find split point using 50% threshold */
    var splitAfter = -1;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var wStart = w.start || 0;
      var wEnd = w.end || wStart;
      var midpoint = (wStart + wEnd) / 2;
      if (timeSec >= midpoint) {
        splitAfter = i; /* this word goes LEFT */
      } else {
        break; /* this word and all after go RIGHT */
      }
    }
    /* Compute snap time: midpoint of the gap between left's last word end and right's first word start */
    var snapTime;
    if (splitAfter < 0) {
      snapTime = words[0].start || 0;
    } else if (splitAfter >= words.length - 1) {
      snapTime = lastWord.end || 0;
    } else {
      var leftEnd = words[splitAfter].end || 0;
      var rightStart = words[splitAfter + 1].start || leftEnd;
      snapTime = (leftEnd + rightStart) / 2;
    }
    var leftWords = words.slice(0, splitAfter + 1);
    var rightWords = words.slice(splitAfter + 1);
    var leftText = leftWords.map(function (w) { return w.text || ''; }).join(' ');
    var rightText = rightWords.map(function (w) { return w.text || ''; }).join(' ');
    return {
      splitAfterIndex: splitAfter,
      snapTime: Math.round(snapTime * 1000) / 1000,
      leftWords: leftWords,
      rightWords: rightWords,
      leftText: leftText,
      rightText: rightText
    };
  }

  /**
   * Re-zero word timings: subtract an offset so the first word starts near 0.
   * Used when the right half of a split becomes its own clip.
   * @param {Array} words - [{ text, start, end }, ...] — mutated in place
   * @param {number} offsetSec - Amount to subtract from each timing
   * @returns {Array} the same words array (for chaining)
   */
  function rebaseWordTimings(words, offsetSec) {
    if (!Array.isArray(words) || !offsetSec) return words;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (typeof w.start === 'number') w.start = Math.max(0, Math.round((w.start - offsetSec) * 1000) / 1000);
      if (typeof w.end === 'number') w.end = Math.max(0, Math.round((w.end - offsetSec) * 1000) / 1000);
    }
    return words;
  }

  global.__CFS_chunkUtils = {
    buildCaptionChunks: buildCaptionChunks,
    findWordBoundary: findWordBoundary,
    rebaseWordTimings: rebaseWordTimings
  };
})(typeof window !== 'undefined' ? window : globalThis);
