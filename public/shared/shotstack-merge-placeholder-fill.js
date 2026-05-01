/**
 * Ensure template.merge has a row for each {{ MERGE_KEY }} placeholder found in the timeline
 * (and in merge replace strings), so injectMergeData / buildMergeValuesFrom can resolve values.
 */
(function (global) {
  'use strict';

  var PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

  function normFind(f) {
    return String(f == null ? '' : f)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '_');
  }

  /**
   * @param {object} template - ShotStack-style { timeline?, merge? }
   * @returns {object} template (mutated)
   */
  function ensureMergeEntriesForTimelinePlaceholders(template) {
    if (!template || typeof template !== 'object') return template;
    if (!Array.isArray(template.merge)) template.merge = [];
    var merge = template.merge;
    var existing = new Set();
    merge.forEach(function (m) {
      if (m && m.find != null) existing.add(normFind(m.find));
    });

    var scanParts = [];
    try {
      if (template.timeline) scanParts.push(JSON.stringify(template.timeline));
    } catch (_) {}
    merge.forEach(function (m) {
      if (m && m.replace != null && typeof m.replace === 'string' && m.replace.indexOf('{{') >= 0) {
        scanParts.push(m.replace);
      }
    });
    var blob = scanParts.join('\n');
    var m;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(blob)) !== null) {
      var raw = m[1];
      var norm = normFind(raw);
      if (!norm || norm.indexOf('__CFS_') === 0) continue;
      if (existing.has(norm)) continue;
      existing.add(norm);
      merge.push({ find: raw, replace: '' });
    }
    return template;
  }

  global.__CFS_ensureMergeEntriesForTimelinePlaceholders = ensureMergeEntriesForTimelinePlaceholders;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
