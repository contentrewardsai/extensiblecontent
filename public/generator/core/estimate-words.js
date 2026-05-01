/**
 * Shared estimateWords: split text into tokens with estimated start/end timings.
 * Used by STT modules to produce word-level timestamps when the backend doesn't provide them.
 *
 * Self-calibrating: when real word timings are available (from STT results or
 * speechSynthesis boundary events), call __CFS_calibrateFromWords(words) to learn
 * the actual per-character speaking rate. estimateWords then uses the learned rate
 * instead of the fixed defaults.
 *
 * Default timing model (used before calibration):
 *   - ~0.06s per spoken character (≈150 WPM for average 5-char words)
 *   - 0.08s natural gap between words
 *   - 0.25s pause after commas/semicolons/colons
 *   - 0.40s pause after sentence-ending punctuation (.!?)
 */
(function (global) {
  'use strict';

  /* ── Defaults (overridden by calibration) ── */
  var DEFAULT_CHAR_RATE = 0.06;     /* seconds per spoken character */
  var DEFAULT_WORD_GAP  = 0.08;     /* gap between words */
  var DEFAULT_COMMA_PAUSE = 0.25;   /* pause after , ; : */
  var DEFAULT_SENTENCE_PAUSE = 0.40;/* pause after . ! ? */
  var MIN_WORD_DUR = 0.25;
  var MAX_WORD_DUR = 0.8;

  /* Calibrated values — null means "use defaults" */
  var _cal = null;

  /**
   * Learn per-character rate and gap timings from real word-level timing data.
   * words: Array<{ text: string, start: number, end: number }>
   *
   * The algorithm groups words by their context (after punctuation vs normal)
   * and calculates separate rates for each.
   */
  function calibrateFromWords(words) {
    if (!Array.isArray(words) || words.length < 3) return;

    var charDurations = [];     /* per-char duration samples */
    var normalGaps = [];        /* gap to next word (no punctuation) */
    var commaGaps = [];         /* gap after ,;: */
    var sentenceGaps = [];      /* gap after .!? */

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || !w.text) continue;
      var s = Number(w.start);
      var e = Number(w.end);
      if (!isFinite(s) || !isFinite(e) || e <= s) continue;

      var clean = w.text.replace(/[^\w]/g, '');
      var charCount = clean.length || 1;
      var dur = e - s;

      /* Per-character duration for this word */
      if (dur > 0.05 && dur < 3.0) {
        charDurations.push(dur / charCount);
      }

      /* Gap to next word */
      if (i < words.length - 1) {
        var next = words[i + 1];
        if (next && isFinite(Number(next.start))) {
          var gap = Number(next.start) - e;
          if (gap >= 0 && gap < 3.0) {
            if (/[.!?]$/.test(w.text)) sentenceGaps.push(gap);
            else if (/[,;:]$/.test(w.text)) commaGaps.push(gap);
            else normalGaps.push(gap);
          }
        }
      }
    }

    /* Need at least a few samples to calibrate */
    if (charDurations.length < 3) return;

    /* Use median for robustness against outliers */
    function median(arr) {
      if (!arr.length) return null;
      var sorted = arr.slice().sort(function (a, b) { return a - b; });
      var mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }

    _cal = {
      charRate:      median(charDurations)  || DEFAULT_CHAR_RATE,
      wordGap:       median(normalGaps)     || DEFAULT_WORD_GAP,
      commaPause:    median(commaGaps)      || DEFAULT_COMMA_PAUSE,
      sentencePause: median(sentenceGaps)   || DEFAULT_SENTENCE_PAUSE,
      sampleCount:   charDurations.length
    };

    /* Clamp to sane ranges */
    _cal.charRate      = Math.max(0.02, Math.min(0.15, _cal.charRate));
    _cal.wordGap       = Math.max(0.02, Math.min(0.5,  _cal.wordGap));
    _cal.commaPause    = Math.max(0.05, Math.min(1.0,  _cal.commaPause));
    _cal.sentencePause = Math.max(0.1,  Math.min(1.5,  _cal.sentencePause));
  }

  /**
   * Return the current calibration (or null if not yet calibrated).
   */
  function getCalibration() {
    return _cal ? {
      charRate:      _cal.charRate,
      wordGap:       _cal.wordGap,
      commaPause:    _cal.commaPause,
      sentencePause: _cal.sentencePause,
      sampleCount:   _cal.sampleCount
    } : null;
  }

  /**
   * Estimate word-level start/end timings from text.
   * Uses calibrated rates if available, otherwise falls back to defaults.
   */
  function estimateWords(text, offset) {
    var tokens = (text || '').toString().trim().split(/\s+/).filter(Boolean);
    var t = offset || 0;

    var charRate      = _cal ? _cal.charRate      : DEFAULT_CHAR_RATE;
    var wordGap       = _cal ? _cal.wordGap       : DEFAULT_WORD_GAP;
    var commaPause    = _cal ? _cal.commaPause     : DEFAULT_COMMA_PAUSE;
    var sentencePause = _cal ? _cal.sentencePause   : DEFAULT_SENTENCE_PAUSE;

    return tokens.map(function (tok, idx) {
      var clean = tok.replace(/[^\w]/g, '');
      var dur = Math.max(MIN_WORD_DUR, Math.min(MAX_WORD_DUR, (clean.length || 3) * charRate));
      var out = { text: tok, start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)) };
      t += dur;
      /* Inter-word gap: longer pause after punctuation */
      if (/[.!?]$/.test(tok)) t += sentencePause;
      else if (/[,;:]$/.test(tok)) t += commaPause;
      else if (idx < tokens.length - 1) t += wordGap;
      return out;
    });
  }

  /**
   * Distribute word timings within a known time span [spanStart, spanEnd].
   * Each word's share of the span is proportional to its character count.
   *
   * Use this when you know the total duration (e.g., from an SRT cue, a TTS
   * clip length, or a measured audio segment) but need word-level boundaries.
   *
   * Example: estimateWordsInSpan("Hello wonderful world", 2.0, 4.5)
   *   → "Hello"     2.000 → 2.536   (5 chars → 5/22 of span)
   *   → "wonderful" 2.556 → 3.530   (9 chars → 9/22 of span)
   *   → "world"     3.550 → 4.086   (5 chars → 5/22 of span)
   */
  function estimateWordsInSpan(text, spanStart, spanEnd) {
    var tokens = (text || '').toString().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var totalSpan = Math.max(0.01, (spanEnd || 0) - (spanStart || 0));

    /* Character weight for each token */
    var weights = [];
    var totalWeight = 0;
    for (var i = 0; i < tokens.length; i++) {
      var clean = tokens[i].replace(/[^\w]/g, '');
      var w = Math.max(1, clean.length);
      weights.push(w);
      totalWeight += w;
    }

    /* Small inter-word gap */
    var GAP = 0.02;
    var totalGap = tokens.length > 1 ? GAP * (tokens.length - 1) : 0;
    var speakTime = Math.max(totalSpan * 0.5, totalSpan - totalGap);

    var t = spanStart || 0;
    return tokens.map(function (tok, idx) {
      var dur = (weights[idx] / totalWeight) * speakTime;
      var out = { text: tok, start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)) };
      t += dur + (idx < tokens.length - 1 ? GAP : 0);
      return out;
    });
  }

  global.__CFS_estimateWords = estimateWords;
  global.__CFS_estimateWordsInSpan = estimateWordsInSpan;
  global.__CFS_calibrateFromWords = calibrateFromWords;
  global.__CFS_getWordCalibration = getCalibration;
})(typeof window !== 'undefined' ? window : globalThis);
