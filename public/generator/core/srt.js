/**
 * SRT / VTT parser and generator for rich-caption assets.
 *
 * Provides:
 *   window.__CFS_parseSrt(srtText)   → { text, words[] }
 *   window.__CFS_parseVtt(vttText)   → { text, words[] }
 *   window.__CFS_wordsToSrt(words[]) → SRT string
 *   window.__CFS_wordsToVtt(words[]) → VTT string
 *
 * SRT format:
 *   1
 *   00:00:01,000 --> 00:00:04,000
 *   Hello world
 *
 * VTT format:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:04.000
 *   Hello world
 */
(function (global) {
  'use strict';

  /* ── helpers ── */

  /** Parse a timestamp string to seconds. Accepts HH:MM:SS,mmm or HH:MM:SS.mmm or MM:SS.mmm */
  function parseTimestamp(ts) {
    if (!ts || typeof ts !== 'string') return 0;
    ts = ts.trim().replace(',', '.');
    var parts = ts.split(':');
    if (parts.length === 3) {
      return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return Number(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
  }

  /** Format seconds to SRT timestamp HH:MM:SS,mmm */
  function toSrtTimestamp(sec) {
    sec = Math.max(0, sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec - Math.floor(sec)) * 1000);
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
  }

  /** Format seconds to VTT timestamp HH:MM:SS.mmm */
  function toVttTimestamp(sec) {
    return toSrtTimestamp(sec).replace(',', '.');
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  /* ── parse cue blocks (shared between SRT and VTT) ── */

  function parseCueBlocks(text) {
    if (!text || typeof text !== 'string') return [];
    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Split by double newline (blank line separates cues)
    var blocks = text.split(/\n\n+/).filter(function (b) { return b.trim(); });
    var cues = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      // Find the line with the --> arrow
      var arrowIdx = -1;
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf('-->') !== -1) { arrowIdx = j; break; }
      }
      if (arrowIdx === -1) continue; // Not a cue block (could be WEBVTT header, NOTE, etc.)
      var timeParts = lines[arrowIdx].split('-->');
      if (timeParts.length < 2) continue;
      var startSec = parseTimestamp(timeParts[0]);
      var endSec = parseTimestamp(timeParts[1]);
      // Everything after the arrow line is the text
      var cueText = lines.slice(arrowIdx + 1).join(' ').trim();
      // Strip HTML tags (VTT can have <b>, <i>, etc.)
      cueText = cueText.replace(/<[^>]+>/g, '');
      if (cueText) {
        cues.push({ start: startSec, end: endSec, text: cueText });
      }
    }
    return cues;
  }

  /**
   * Convert cues to word-level timing.
   * Distributes words within each cue proportionally by spoken-character count,
   * so longer words get proportionally more time than short ones.
   * The cue's real start/end times anchor the distribution, meaning long pauses
   * between cues (silence, music, etc.) are naturally preserved.
   */
  function cuesToWords(cues) {
    var INTER_WORD_GAP = 0.02; /* tiny gap between words to prevent boundary overlap */
    var words = [];
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var tokens = cue.text.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      var cueDuration = Math.max(0.01, cue.end - cue.start);

      /* Calculate spoken-character weight for each token */
      var weights = [];
      var totalWeight = 0;
      for (var j = 0; j < tokens.length; j++) {
        /* Weight = number of spoken characters (strip punctuation).
           Minimum weight of 1 so even single-char words get some time. */
        var clean = tokens[j].replace(/[^\w]/g, '');
        var w = Math.max(1, clean.length);
        weights.push(w);
        totalWeight += w;
      }

      /* Total gap time to deduct from speaking time */
      var totalGapTime = tokens.length > 1 ? INTER_WORD_GAP * (tokens.length - 1) : 0;
      var speakingTime = Math.max(cueDuration * 0.5, cueDuration - totalGapTime);

      /* Distribute speaking time proportionally by character weight */
      var t = cue.start;
      for (var k = 0; k < tokens.length; k++) {
        var wordDur = (weights[k] / totalWeight) * speakingTime;
        var ws = t;
        var we = t + wordDur;
        words.push({
          text: tokens[k],
          start: Number(ws.toFixed(3)),
          end: Number(we.toFixed(3))
        });
        t = we + (k < tokens.length - 1 ? INTER_WORD_GAP : 0);
      }
    }
    return words;
  }

  /* ── public API ── */

  /** Parse SRT text into { text, words[] } */
  function parseSrt(srtText) {
    var cues = parseCueBlocks(srtText);
    var words = cuesToWords(cues);
    var fullText = cues.map(function (c) { return c.text; }).join(' ');
    return { text: fullText, words: words, cues: cues };
  }

  /** Parse VTT text into { text, words[] } — same logic, just skips the WEBVTT header */
  function parseVtt(vttText) {
    return parseSrt(vttText);
  }

  /** Convert words array to SRT string. Groups words into ~3-second cues. */
  function wordsToSrt(words, maxCueDuration) {
    if (!Array.isArray(words) || !words.length) return '';
    maxCueDuration = maxCueDuration || 3;
    var cues = [];
    var currentWords = [];
    var cueStart = words[0].start;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      currentWords.push(w.text);
      var cueEnd = w.end;
      var nextStart = (i + 1 < words.length) ? words[i + 1].start : Infinity;
      // Break cue when: duration exceeds max, or there's a >0.5s pause, or end of words
      if (cueEnd - cueStart >= maxCueDuration || nextStart - cueEnd > 0.5 || i === words.length - 1) {
        cues.push({
          start: cueStart,
          end: cueEnd,
          text: currentWords.join(' ')
        });
        currentWords = [];
        if (i + 1 < words.length) cueStart = words[i + 1].start;
      }
    }
    var lines = [];
    for (var c = 0; c < cues.length; c++) {
      lines.push(String(c + 1));
      lines.push(toSrtTimestamp(cues[c].start) + ' --> ' + toSrtTimestamp(cues[c].end));
      lines.push(cues[c].text);
      lines.push('');
    }
    return lines.join('\n');
  }

  /** Convert words array to VTT string. */
  function wordsToVtt(words, maxCueDuration) {
    if (!Array.isArray(words) || !words.length) return '';
    maxCueDuration = maxCueDuration || 3;
    var srt = wordsToSrt(words, maxCueDuration);
    // Convert SRT to VTT: add header, replace comma timestamps with dots, remove cue numbers
    var lines = srt.split('\n');
    var vttLines = ['WEBVTT', ''];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Skip cue number lines (just a number on its own)
      if (/^\d+$/.test(line.trim()) && i + 1 < lines.length && lines[i + 1].indexOf('-->') !== -1) continue;
      // Convert SRT timestamps (comma) to VTT (dot)
      if (line.indexOf('-->') !== -1) {
        line = line.replace(/,/g, '.');
      }
      vttLines.push(line);
    }
    return vttLines.join('\n');
  }

  /* ── exports ── */
  global.__CFS_parseSrt = parseSrt;
  global.__CFS_parseVtt = parseVtt;
  global.__CFS_wordsToSrt = wordsToSrt;
  global.__CFS_wordsToVtt = wordsToVtt;

})(typeof window !== 'undefined' ? window : globalThis);
