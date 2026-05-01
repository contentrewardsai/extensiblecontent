/**
 * Shared book builder: workflow → Markdown or HTML (print/DOC-ready).
 * Used by template-engine when workflow-based book templates are added.
 */
(function (global) {
  'use strict';

  var TRIM_PRESETS = {
    '5x8': { w: 5, h: 8, minPg: 24, maxPg: 828 },
    '5.06x7.81': { w: 5.06, h: 7.81, minPg: 24, maxPg: 828 },
    '5.25x8': { w: 5.25, h: 8, minPg: 24, maxPg: 828 },
    '5.5x8.5': { w: 5.5, h: 8.5, minPg: 24, maxPg: 828 },
    '6x9': { w: 6, h: 9, minPg: 24, maxPg: 828 },
    '6.14x9.21': { w: 6.14, h: 9.21, minPg: 24, maxPg: 828 },
    '7x10': { w: 7, h: 10, minPg: 24, maxPg: 828 },
    '8.5x11': { w: 8.5, h: 11, minPg: 24, maxPg: 590 },
    '8.27x11.69': { w: 8.27, h: 11.69, minPg: 24, maxPg: 780 },
    'custom': { w: null, h: null, minPg: 24, maxPg: 828 }
  };

  function commentFullText(comment) {
    if (global.CFS_stepComment && typeof global.CFS_stepComment.getStepCommentFullText === 'function') {
      return global.CFS_stepComment.getStepCommentFullText(comment || {});
    }
    if (comment && comment.text && String(comment.text).trim()) return String(comment.text).trim();
    return '';
  }

  function getStepCaption(a, i) {
    var full = commentFullText(a.comment);
    if (full) return full.split('\n')[0];
    if (a.stepLabel && String(a.stepLabel).trim()) return String(a.stepLabel).trim();
    return (a.type || 'Step') + ' ' + (i + 1);
  }

  function getStepBody(a) {
    var full = commentFullText(a.comment);
    if (full) return full;
    if (a.stepLabel && String(a.stepLabel).trim()) return String(a.stepLabel).trim();
    return '';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var t = String(s);
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseNum(val, def, min, max) {
    var n = parseFloat(String(val || '').trim(), 10);
    if (isNaN(n)) return def;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  }

  function getOptions(values) {
    values = values || {};
    var preset = (values.trimSizePreset != null ? values.trimSizePreset : '6x9').toString();
    var presetInfo = TRIM_PRESETS[preset] || TRIM_PRESETS['6x9'];
    var widthIn = preset === 'custom' ? parseNum(values.trimWidthIn, 6, 4, 8.5) : (presetInfo.w || 6);
    var heightIn = preset === 'custom' ? parseNum(values.trimHeightIn, 9, 6, 11.69) : (presetInfo.h || 9);
    return {
      trimWidthIn: widthIn,
      trimHeightIn: heightIn,
      minPages: presetInfo.minPg,
      maxPages: presetInfo.maxPg,
      marginInside: parseNum(values.marginInsideIn, 0.5, 0.25, 2),
      marginOutside: parseNum(values.marginOutsideIn, 0.5, 0.25, 2),
      marginTop: parseNum(values.marginTopIn, 0.75, 0.25, 2),
      marginBottom: parseNum(values.marginBottomIn, 0.75, 0.25, 2),
      screenshotPosition: (values.screenshotPosition || 'above').toString().toLowerCase(),
      keepStepTogether: values.keepStepTogether !== false && values.keepStepTogether !== 'false',
      fontFamily: String(values.fontFamily || 'Georgia, serif').trim() || 'Georgia, serif',
      fontSizePt: parseNum(values.fontSizePt, 11, 8, 24),
      fontColor: String(values.fontColor || '#222222').trim() || '#222222',
      headerText: String(values.headerText || '').trim(),
      footerText: String(values.footerText || '').trim(),
      footerPageNumbers: values.footerPageNumbers !== false && values.footerPageNumbers !== 'false'
    };
  }

  function buildMarkdown(wf, actions) {
    var title = wf.name || 'Workflow';
    var lines = ['# ' + title + '\n'];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var caption = getStepCaption(a, i);
      var body = getStepBody(a);
      lines.push('## Step ' + (i + 1) + ': ' + caption.replace(/\n/g, ' '));
      lines.push('');
      if (body) lines.push(body);
      lines.push('');
      lines.push('*[Add a screenshot for this step — e.g. step-' + (i + 1) + '.png]*');
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  function buildHtml(wf, actions, options, forPdf, forDoc) {
    var opts = options || getOptions({});
    var title = escapeHtml(wf.name || 'Workflow');
    var widthIn = opts.trimWidthIn;
    var heightIn = opts.trimHeightIn;
    var mt = opts.marginTop;
    var mb = opts.marginBottom;
    var mi = opts.marginInside;
    var mo = opts.marginOutside;
    var pos = opts.screenshotPosition;
    var keepTogether = opts.keepStepTogether;
    var font = escapeHtml(opts.fontFamily);
    var fontSize = opts.fontSizePt;
    var color = opts.fontColor.replace(/"/g, '');
    var headerText = escapeHtml(opts.headerText);
    var footerText = escapeHtml(opts.footerText);
    var pageNumbers = opts.footerPageNumbers;
    var stepClass = 'book-step' + (keepTogether ? ' book-keep-together' : '');
    var layoutDir = (pos === 'left' || pos === 'right') ? 'row' : 'column';
    var imageFirst = (pos === 'above' || pos === 'left');
    var imgOrder = imageFirst ? 0 : 1;
    var textOrder = imageFirst ? 1 : 0;
    var pageStyle = '@page { size: ' + widthIn + 'in ' + heightIn + 'in; margin: ' + mt + 'in ' + mo + 'in ' + mb + 'in ' + mi + 'in; } ';
    var headerFooterStyle = '';
    if (headerText || footerText || pageNumbers) {
      headerFooterStyle = '.book-header{ position:fixed; left:' + mi + 'in; right:' + mo + 'in; top:0; height:' + (mt - 0.2) + 'in; font:' + (fontSize - 1) + 'pt ' + font + '; color:' + color + '; opacity:0.8; } ' +
        '.book-footer{ position:fixed; left:' + mi + 'in; right:' + mo + 'in; bottom:0; height:' + (mb - 0.2) + 'in; font:' + (fontSize - 1) + 'pt ' + font + '; color:' + color + '; opacity:0.8; } ' +
        'body{ padding-top:' + (headerText ? (mt + 0.2) + 'in' : mt + 'in') + '; padding-bottom:' + (footerText || pageNumbers ? (mb + 0.2) + 'in' : mb + 'in') + '; padding-left:' + mi + 'in; padding-right:' + mo + 'in; } ';
    } else {
      headerFooterStyle = 'body{ padding:' + mt + 'in ' + mo + 'in ' + mb + 'in ' + mi + 'in; } ';
    }
    var css = pageStyle + ' body{ font-family:' + font + '; font-size:' + fontSize + 'pt; line-height:1.5; color:' + color + '; max-width:100%; box-sizing:border-box; } ' +
      'h1{ font-size:1.5em; border-bottom:1px solid #ccc; margin-bottom:0.5em; } ' +
      'h2{ font-size:1.2em; margin-top:1em; margin-bottom:0.4em; } ' +
      '.book-step{ margin-bottom:1.2em; } ' +
      (keepTogether ? '.book-keep-together{ page-break-inside:avoid; } ' : '') +
      '.book-step-inner{ display:flex; flex-direction:' + layoutDir + '; gap:1em; align-items:flex-start; } ' +
      '.book-step-text{ order:' + textOrder + '; flex:1; min-width:0; } ' +
      '.book-step-image{ order:' + imgOrder + '; min-height:100px; background:#f5f5f5; border:1px dashed #ccc; display:flex; align-items:center; justify-content:center; color:#666; font-size:' + (fontSize - 2) + 'pt; ' +
      (pos === 'left' || pos === 'right' ? 'min-width:180px; max-width:45%;' : 'width:100%;') + ' } ' +
      headerFooterStyle +
      '@media print{ .book-keep-together{ page-break-inside:avoid; } .book-pagenum::after{ content: counter(page); } .book-pagetotal::after{ content: counter(pages); } } ';
    var trimComment = '<!-- Trim: ' + widthIn + '" x ' + heightIn + '". Min–max pages for this size: ' + opts.minPages + '–' + opts.maxPages + '. Margins: inside ' + mi + '", outside ' + mo + '", top ' + mt + '", bottom ' + mb + '" -->';
    var docType = forDoc ? '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' : '<html lang="en">';
    var meta = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    if (forDoc) meta += '<meta name="ProgId" content="Word.Document"><meta name="Generator" content="Book Export">';
    var parts = ['<!DOCTYPE html>' + docType + '<head>' + meta + '<title>' + title + '</title>' + trimComment + '<style>' + css + '</style></head><body>'];
    if (headerText) parts.push('<div class="book-header">' + headerText + '</div>');
    if (footerText || pageNumbers) {
      var foot = footerText ? footerText : '';
      if (pageNumbers) foot += (foot ? ' | ' : '') + 'Page <span class="book-pagenum"></span> of <span class="book-pagetotal"></span>';
      parts.push('<div class="book-footer">' + foot + '</div>');
    }
    parts.push('<h1>' + title + '</h1>');
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var caption = escapeHtml(getStepCaption(a, i));
      var body = getStepBody(a);
      var bodyHtml = body ? ('<p>' + escapeHtml(body).replace(/\n/g, '</p><p>') + '</p>') : '';
      var imgDiv = '<div class="book-step-image" aria-label="Step ' + (i + 1) + ' image">Add screenshot (e.g. step-' + (i + 1) + '.png)</div>';
      var textBlock = '<div class="book-step-text"><h2>Step ' + (i + 1) + ': ' + caption + '</h2>' + bodyHtml + '</div>';
      var imageBlock = imgDiv;
      parts.push('<section class="' + stepClass + '"><div class="book-step-inner">' + (imageFirst ? imageBlock + textBlock : textBlock + imageBlock) + '</div></section>');
    }
    parts.push('</body></html>');
    return parts.join('');
  }

  /**
   * Generate book output from form values. Returns Promise<{ type: 'text', data: string }>.
   */
  function generateBookExport(values) {
    var workflowRaw = (values.workflowJson != null ? values.workflowJson : '').toString().trim();
    var stepText = (values.stepText != null ? values.stepText : '').toString().trim();
    var format = (values.outputFormat != null ? values.outputFormat : 'html').toString().toLowerCase();
    if (stepText) return Promise.resolve({ type: 'text', data: stepText });
    if (!workflowRaw) return Promise.resolve({ type: 'text', data: '' });
    try {
      var wf = JSON.parse(workflowRaw);
      var actions = (wf.analyzed && Array.isArray(wf.analyzed.actions)) ? wf.analyzed.actions : (Array.isArray(wf.actions) ? wf.actions : []);
      if (!actions.length) return Promise.resolve({ type: 'text', data: '# ' + (wf.name || 'Workflow') + '\n\nNo steps.' });
      var opts = getOptions(values);
      var forPdf = (format === 'pdf');
      var forDoc = (format === 'doc');
      var buildPromise = (format === 'markdown')
        ? Promise.resolve(buildMarkdown(wf, actions))
        : Promise.resolve(buildHtml(wf, actions, opts, forPdf, forDoc));
      return buildPromise.then(function (data) {
        if (format === 'pdf' && data && data.indexOf('<!DOCTYPE') === 0) {
          data = '<!-- Print this file (Ctrl/Cmd+P) and choose "Save as PDF". Trim: ' + opts.trimWidthIn + '" x ' + opts.trimHeightIn + '". -->\n' + data;
        }
        if (format === 'doc' && data && data.indexOf('<!DOCTYPE') === 0) {
          data = '<!-- Save with .doc extension to open in Word. -->\n' + data;
        }
        return { type: 'text', data: data };
      });
    } catch (e) {
      return Promise.resolve({ type: 'text', data: '# Error\n' + (e && e.message ? e.message : String(e)) });
    }
  }

  var api = {
    TRIM_PRESETS: TRIM_PRESETS,
    getOptions: getOptions,
    getStepCaption: getStepCaption,
    getStepBody: getStepBody,
    buildMarkdown: buildMarkdown,
    buildHtml: buildHtml,
    generateBookExport: generateBookExport
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__CFS_bookBuilder = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
