/**
 * Step comment helpers for workflow steps.
 * Use when rendering or exporting step descriptions (generator, tutorial export, tooltips).
 *
 * Primary model: ordered comment.items[] with types text | video | audio | image | link.
 * Legacy: single text / video / audio buckets, comment.images[], comment.urls[], mediaOrder.
 */
(function(global) {
  'use strict';

  var DEFAULT_MEDIA_ORDER = ['text', 'images', 'video', 'audio', 'urls'];
  var DEFAULT_MEDIA_ORDER_WITH_ITEMS = ['items'];
  var ITEM_TYPES = { text: 1, video: 1, audio: 1, image: 1, link: 1 };

  function shortId() {
    return 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  /**
   * Normalize a comment item for storage/UI.
   * @param {Object} it
   * @returns {{ id: string, type: string, text?: string, url?: string, alt?: string }}
   */
  function normalizeCommentItem(it) {
    if (!it || typeof it !== 'object') return { id: shortId(), type: 'text', text: '' };
    var id = (it.id && String(it.id).trim()) || shortId();
    var type = it.type;
    if (type === 'text' || !type || !ITEM_TYPES[type]) {
      return { id: id, type: 'text', text: String(it.text != null ? it.text : '') };
    }
    if (type === 'image') {
      var im = { id: id, type: 'image', url: String(it.url != null ? it.url : '') };
      if (it.alt != null && String(it.alt).trim()) im.alt = String(it.alt).trim();
      return im;
    }
    if (type === 'link') {
      return { id: id, type: 'link', url: String(it.url != null ? it.url : '') };
    }
    return { id: id, type: type, url: String(it.url != null ? it.url : '') };
  }

  function effectiveMediaOrder(comment) {
    var order = (comment.mediaOrder && Array.isArray(comment.mediaOrder) && comment.mediaOrder.length)
      ? comment.mediaOrder.slice()
      : DEFAULT_MEDIA_ORDER;
    var hasItems = Array.isArray(comment.items) && comment.items.length > 0;
    if (hasItems && order.indexOf('items') < 0) {
      return DEFAULT_MEDIA_ORDER_WITH_ITEMS.slice();
    }
    return order;
  }

  /**
   * Legacy-only: build items from buckets (no comment.items).
   * @param {Object} comment
   * @returns {Array}
   */
  function flattenLegacyBucketsToItems(comment) {
    var out = [];
    var order = effectiveMediaOrder(comment);
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      if (key === 'items') continue;
      if (key === 'text' && comment.text && String(comment.text).trim()) {
        out.push({ id: 'sc_legacy_text', type: 'text', text: String(comment.text).trim() });
      }
      if (key === 'video' && comment.video && (comment.video.url || comment.video.src)) {
        out.push({ id: 'sc_legacy_video', type: 'video', url: String(comment.video.url || comment.video.src) });
      }
      if (key === 'audio' && comment.audio) {
        var a = comment.audio;
        var aud = Array.isArray(a) ? a[0] : a;
        if (aud && (aud.url || aud.src)) {
          out.push({ id: 'sc_legacy_audio', type: 'audio', url: String(aud.url || aud.src) });
        }
      }
      if (key === 'images' && comment.images && comment.images.length) {
        for (var hi = 0; hi < comment.images.length; hi++) {
          var im = comment.images[hi];
          var u = (typeof im === 'string' ? im : (im && im.url)) || '';
          if (!String(u).trim()) continue;
          out.push({
            id: 'sc_legacy_img_' + hi,
            type: 'image',
            url: String(u).trim(),
            alt: (im && im.alt != null) ? String(im.alt).trim() : undefined,
          });
        }
      }
      if (key === 'urls' && comment.urls && comment.urls.length) {
        for (var ui = 0; ui < comment.urls.length; ui++) {
          var uu = comment.urls[ui];
          var us = (uu != null) ? String(uu).trim() : '';
          if (!us) continue;
          out.push({ id: 'sc_legacy_url_' + ui, type: 'link', url: us });
        }
      }
    }
    return out;
  }

  /**
   * Items for editor: comment.items (normalized), merged with trailing legacy images/urls once.
   * @param {Object} comment
   * @returns {Array}
   */
  function getCommentItemsForEdit(comment) {
    if (!comment || typeof comment !== 'object') return [];
    var base = [];
    if (Array.isArray(comment.items) && comment.items.length) {
      base = comment.items.map(normalizeCommentItem);
      var seenImg = base.some(function(it) { return it && it.type === 'image'; });
      var seenLink = base.some(function(it) { return it && it.type === 'link'; });
      if (comment.images && comment.images.length && !seenImg) {
        for (var hi = 0; hi < comment.images.length; hi++) {
          var im = comment.images[hi];
          var u = (typeof im === 'string' ? im : (im && im.url)) || '';
          if (!String(u).trim()) continue;
          base.push(normalizeCommentItem({
            id: 'sc_mig_' + hi,
            type: 'image',
            url: String(u).trim(),
            alt: im && im.alt,
          }));
        }
      }
      if (comment.urls && comment.urls.length && !seenLink) {
        for (var ui = 0; ui < comment.urls.length; ui++) {
          var us = comment.urls[ui] != null ? String(comment.urls[ui]).trim() : '';
          if (!us) continue;
          base.push(normalizeCommentItem({ id: 'sc_mlnk_' + ui, type: 'link', url: us }));
        }
      }
      return base;
    }
    return flattenLegacyBucketsToItems(comment);
  }

  /**
   * Build canonical items + mediaOrder from legacy comment (non-mutating).
   * @param {Object} comment
   * @returns {{ items: Array, mediaOrder: string[] }|null}
   */
  function normalizeComment(comment) {
    if (!comment || typeof comment !== 'object') return null;
    if (Array.isArray(comment.items) && comment.items.length) {
      return {
        items: comment.items.map(normalizeCommentItem),
        mediaOrder: DEFAULT_MEDIA_ORDER_WITH_ITEMS.slice(),
      };
    }
    var items = flattenLegacyBucketsToItems(comment);
    if (!items.length) return null;
    return { items: items.map(function(it) {
      if (it.id && String(it.id).indexOf('sc_legacy_') === 0) {
        return normalizeCommentItem(Object.assign({}, it, { id: shortId() }));
      }
      return normalizeCommentItem(it);
    }), mediaOrder: DEFAULT_MEDIA_ORDER_WITH_ITEMS.slice() };
  }

  /**
   * All non-empty text segments (items + legacy single text).
   * @param {Object} comment
   * @returns {string[]}
   */
  function getStepCommentTextSegments(comment) {
    if (!comment || typeof comment !== 'object') return [];
    var segments = [];
    if (Array.isArray(comment.items) && comment.items.length) {
      for (var i = 0; i < comment.items.length; i++) {
        var it = comment.items[i];
        if (it && it.type === 'text' && it.text != null && String(it.text).trim()) {
          segments.push(String(it.text).trim());
        }
        if (it && it.type === 'link' && it.url && String(it.url).trim()) {
          segments.push(String(it.url).trim());
        }
      }
    }
    if ((!comment.items || !comment.items.length) && comment.text && String(comment.text).trim()) {
      segments.push(String(comment.text).trim());
    }
    return segments;
  }

  /**
   * Joined text for {{stepCommentText}} and similar.
   * @param {Object} comment
   * @returns {string}
   */
  function getStepCommentFullText(comment) {
    var parts = getStepCommentTextSegments(comment);
    return parts.join('\n\n');
  }

  function pushItemAsPart(out, it) {
    var norm = normalizeCommentItem(it);
    if (norm.type === 'text' && norm.text != null && String(norm.text).trim()) {
      out.push({ type: 'text', content: String(norm.text) });
      return;
    }
    if (norm.type === 'video' && norm.url) {
      out.push({ type: 'video', content: { url: String(norm.url) } });
      return;
    }
    if (norm.type === 'audio' && norm.url) {
      out.push({ type: 'audio', content: { url: String(norm.url) } });
      return;
    }
    if (norm.type === 'image' && norm.url) {
      out.push({ type: 'images', content: [{ url: String(norm.url), alt: norm.alt || undefined }] });
      return;
    }
    if (norm.type === 'link' && norm.url) {
      out.push({ type: 'urls', content: [String(norm.url)] });
    }
  }

  /**
   * Returns step comment content as an array of parts in display order.
   * With comment.items, order is exactly items[]. Legacy: mediaOrder buckets.
   * @param {Object} comment - step.comment (may be undefined)
   * @returns {Array<{ type: string, content: * }>}
   */
  function getStepCommentParts(comment) {
    if (!comment || typeof comment !== 'object') return [];
    if (Array.isArray(comment.items) && comment.items.length) {
      var out = [];
      for (var j = 0; j < comment.items.length; j++) {
        pushItemAsPart(out, comment.items[j]);
      }
      return out;
    }
    var order = effectiveMediaOrder(comment);
    var out2 = [];
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      if (!key) continue;
      var content = null;
      switch (key) {
        case 'items':
          break;
        case 'text':
          if (comment.text) content = comment.text;
          break;
        case 'images':
          if (comment.images && comment.images.length) content = comment.images;
          break;
        case 'video':
          if (comment.video && (comment.video.url || comment.video.src)) content = comment.video;
          break;
        case 'audio':
          if (comment.audio) {
            content = Array.isArray(comment.audio) ? comment.audio : (comment.audio.url || comment.audio.src ? comment.audio : null);
          }
          break;
        case 'urls':
          if (comment.urls && comment.urls.length) content = comment.urls;
          break;
        default:
          break;
      }
      if (content != null) out2.push({ type: key, content: content });
    }
    return out2;
  }

  /**
   * Returns a plain-text summary of the step comment (text only).
   * @param {Object} comment - step.comment
   * @param {number} maxLength - max length (default 120)
   * @returns {string}
   */
  function getStepCommentSummary(comment, maxLength) {
    var text = getStepCommentFullText(comment);
    if (!text) return '';
    if (maxLength != null && text.length > maxLength) return text.slice(0, maxLength) + '\u2026';
    return text;
  }

  var api = {
    getStepCommentParts: getStepCommentParts,
    getStepCommentSummary: getStepCommentSummary,
    getCommentItemsForEdit: getCommentItemsForEdit,
    normalizeComment: normalizeComment,
    normalizeCommentItem: normalizeCommentItem,
    getStepCommentFullText: getStepCommentFullText,
    getStepCommentTextSegments: getStepCommentTextSegments,
    shortId: shortId,
    DEFAULT_MEDIA_ORDER: DEFAULT_MEDIA_ORDER,
    DEFAULT_MEDIA_ORDER_WITH_ITEMS: DEFAULT_MEDIA_ORDER_WITH_ITEMS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CFS_stepComment = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
