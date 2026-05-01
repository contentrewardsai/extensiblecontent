/**
 * Build walkthrough config and optional runner script from a workflow.
 * Used by "Export as walkthrough" to produce embeddable tutorial data + JS.
 * Uses CFS_stepComment when available (shared/step-comment.js); fallback when loaded standalone.
 */
(function(global) {
  'use strict';

  var stepComment = (global.CFS_stepComment || global);
  function getStepCommentSummary(comment, maxLength) {
    if (typeof stepComment.getStepCommentSummary === 'function') return stepComment.getStepCommentSummary(comment, maxLength);
    if (!comment || typeof comment !== 'object') return '';
    var parts = [];
    if (comment.items && comment.items.length) {
      for (var ti = 0; ti < comment.items.length; ti++) {
        if (comment.items[ti].type === 'text' && comment.items[ti].text) parts.push(String(comment.items[ti].text).trim());
      }
    }
    var text = parts.length ? parts.join('\n\n') : String(comment.text || '').trim();
    if (!text) return '';
    if (maxLength != null && text.length > maxLength) return text.slice(0, maxLength) + '\u2026';
    return text;
  }
  function getStepCommentParts(comment) {
    if (typeof stepComment.getStepCommentParts === 'function') return stepComment.getStepCommentParts(comment);
    if (!comment || typeof comment !== 'object') return [];
    var hasItems = Array.isArray(comment.items) && comment.items.length > 0;
    var order = (comment.mediaOrder && Array.isArray(comment.mediaOrder) && comment.mediaOrder.length)
      ? comment.mediaOrder.slice()
      : (hasItems ? ['items'] : ['text', 'images', 'video', 'audio', 'urls']);
    if (hasItems && order.indexOf('items') < 0) {
      order = ['items'].concat(order.filter(function(k) { return k !== 'text' && k !== 'video' && k !== 'audio' && k !== 'images' && k !== 'urls'; }));
    }
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      if (!key) continue;
      if (key === 'items' && hasItems) {
        for (var j = 0; j < comment.items.length; j++) {
          var it = comment.items[j];
          if (!it || !it.type) continue;
          if (it.type === 'text' && it.text != null && String(it.text).trim()) out.push({ type: 'text', content: String(it.text) });
          else if (it.type === 'video' && it.url) out.push({ type: 'video', content: { url: String(it.url) } });
          else if (it.type === 'audio' && it.url) out.push({ type: 'audio', content: { url: String(it.url) } });
          else if (it.type === 'image' && it.url) out.push({ type: 'images', content: [{ url: String(it.url), alt: it.alt || undefined }] });
          else if (it.type === 'link' && it.url) out.push({ type: 'urls', content: [String(it.url)] });
        }
        continue;
      }
      var content = null;
      switch (key) {
        case 'text': if (!hasItems && comment.text) content = comment.text; break;
        case 'images': if (comment.images && comment.images.length) content = comment.images; break;
        case 'video': if (!hasItems && comment.video && (comment.video.url || comment.video.src)) content = comment.video; break;
        case 'audio': if (!hasItems) content = comment.audio ? (Array.isArray(comment.audio) ? comment.audio : (comment.audio.url || comment.audio.src ? comment.audio : null)) : null; break;
        case 'urls': if (comment.urls && comment.urls.length) content = comment.urls; break;
        default: break;
      }
      if (content != null) out.push({ type: key, content: content });
    }
    return out;
  }

  /** Turn step selectors (mixed format) into an array of CSS selector strings. Uses CFS_selectors when available. */
  function selectorStrings(action) {
    if (global.CFS_selectors && typeof global.CFS_selectors.actionSelectorsToCssStrings === 'function') {
      return global.CFS_selectors.actionSelectorsToCssStrings(action || {});
    }
    var list = [].concat((action && action.selectors) || [], (action && action.fallbackSelectors) || []);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (typeof s === 'string' && s.trim()) { out.push(s.trim()); continue; }
      if (s && typeof s.value === 'string') { out.push(s.value.trim()); continue; }
      if (s && typeof s.selector === 'string') { out.push(s.selector.trim()); continue; }
    }
    return out;
  }

  /**
   * Build walkthrough config from a workflow.
   * @param {Object} workflow - { name, id, analyzed: { actions: [] } }
   * @param {Object} options - { includeCommentParts: boolean, includeQuiz: boolean }
   * @returns {{ name: string, steps: Array<{ index, type, selectors, tooltip, quizQuestion?, optional }> }}
   */
  function buildWalkthroughConfig(workflow, options) {
    options = options || {};
    var actions = (workflow && workflow.analyzed && workflow.analyzed.actions) ? workflow.analyzed.actions : [];
    var steps = [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var type = a.type || 'step';
      var selectors = selectorStrings(a);
      var tooltip = getStepCommentSummary(a.comment, 300) || (a.stepLabel || '').trim() || (type + ' ' + (i + 1));
      var step = {
        index: i + 1,
        type: type,
        selectors: selectors,
        tooltip: tooltip,
        optional: !!a.optional,
      };
      if (options.includeCommentParts && a.comment) {
        step.commentParts = getStepCommentParts(a.comment);
      }
      if (options.includeQuiz && selectors.length > 0) {
        step.quizQuestion = (tooltip && tooltip.length > 10) ? tooltip : 'What should you click or do next?';
      }
      steps.push(step);
    }
    return {
      name: (workflow && workflow.name) ? workflow.name : 'Walkthrough',
      workflowId: workflow && workflow.id,
      steps: steps,
    };
  }

  /**
   * Return a string of JS that can be embedded to run the walkthrough (highlight + tooltip + next/prev).
   * If config is provided, it is inlined so the script is self-contained. Otherwise uses window.__CFS_WALKTHROUGH_CONFIG.
   */
  function buildWalkthroughRunnerScript(config, configVarName) {
    var inlineConfig = typeof config === 'object' && config !== null;
    configVarName = configVarName || '__CFS_WALKTHROUGH_CONFIG';
    var s = '(function() {\n';
    if (inlineConfig) {
      try {
        s += '  var config = ' + JSON.stringify(config) + ';\n';
      } catch (e) {
        s += '  var config = window.' + configVarName + ' || {};\n';
      }
    } else {
      s += '  var config = window.' + configVarName + ' || {};\n';
    }
    s += '  var steps = config.steps || [];\n';
    s += '  var current = 0;\n';
    s += '  var overlay = null;\n';
    s += '  function reportProgress(evt, data) {\n';
    s += '    var payload = { event: evt, workflowId: config.workflowId, name: config.name, totalSteps: steps.length, timestamp: Date.now() };\n';
    s += '    if (data) { for (var k in data) payload[k] = data[k]; }\n';
    s += '    try { window.dispatchEvent(new CustomEvent("cfs-walkthrough-progress", { detail: payload })); } catch (e) {}\n';
    s += '    var url = config.reportUrl;\n';
    s += '    if (!url || typeof url !== "string") return;\n';
    s += '    var allowed = config.reportEvents;\n';
    s += '    if (Array.isArray(allowed) && allowed.indexOf(evt) === -1) return;\n';
    s += '    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(function() {});\n';
    s += '  }\n\n';
    s += '  var tooltipEl = null;\n';
    s += '  var quizEl = null;\n';
    s += '  var lastClickedElement = null;\n';
    s += '  var quizVerified = false;\n';
    s += '  function getSelectorStrings(step) { return step.selectors || []; }\n\n';
    s += '  function findElement(step) {\n';
    s += '    var sels = getSelectorStrings(step);\n';
    s += '    for (var i = 0; i < sels.length; i++) {\n';
    s += '      try {\n';
    s += '        var el = document.querySelector(sels[i]);\n';
    s += '        if (el) return el;\n';
    s += '      } catch (e) {}\n';
    s += '    }\n';
    s += '    return null;\n';
    s += '  }\n\n';
    s += '  function show() {\n';
    s += '    if (current < 0 || current >= steps.length) return;\n';
    s += '    reportProgress("step_viewed", { stepIndex: current, totalSteps: steps.length });\n';
    s += '    var step = steps[current];\n';
    s += '    var el = findElement(step);\n';
    s += '    if (!overlay) {\n';
    s += '      overlay = document.createElement("div");\n';
    s += '      overlay.id = "cfs-walkthrough-overlay";\n';
    s += '      overlay.style.cssText = "position:fixed;pointer-events:none;top:0;left:0;right:0;bottom:0;z-index:99998;box-sizing:border-box;";\n';
    s += '      document.body.appendChild(overlay);\n';
    s += '    }\n';
    s += '    if (!tooltipEl) {\n';
    s += '      tooltipEl = document.createElement("div");\n';
    s += '      tooltipEl.id = "cfs-walkthrough-tooltip";\n';
    s += '      tooltipEl.style.cssText = "position:fixed;z-index:99999;max-width:320px;padding:10px 12px;background:#1a1a1a;color:#eee;font:14px sans-serif;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;";\n';
    s += '      document.body.appendChild(tooltipEl);\n';
    s += '    }\n';
    s += '    overlay.innerHTML = "";\n';
    s += '    if (el) {\n';
    s += '      var r = el.getBoundingClientRect();\n';
    s += '      var box = document.createElement("div");\n';
    s += '      box.style.cssText = "position:fixed;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border:2px solid #4a9eff;border-radius:4px;pointer-events:none;";\n';
    s += '      overlay.appendChild(box);\n';
    s += '      var parts = step.commentParts || [];\n';
    s += '      tooltipEl.innerHTML = "";\n';
    s += '      if (parts.length > 0) {\n';
    s += '        for (var pi = 0; pi < parts.length; pi++) {\n';
    s += '          var p = parts[pi];\n';
    s += '          if (p.type === "text" && p.content) { var tx = document.createElement("div"); tx.textContent = p.content; tx.style.marginBottom = "8px"; tooltipEl.appendChild(tx); }\n';
    s += '          if (p.type === "images" && Array.isArray(p.content)) { for (var ji = 0; ji < p.content.length; ji++) { var im = document.createElement("img"); var it = p.content[ji]; im.src = (typeof it === "string" ? it : (it && it.url)) || ""; im.alt = (it && it.alt) || ""; im.style.maxWidth = "100%"; im.style.display = "block"; im.style.marginTop = "4px"; tooltipEl.appendChild(im); } }\n';
    s += '          if (p.type === "video" && p.content && (p.content.url || p.content.src)) { var v = document.createElement("video"); v.src = p.content.url || p.content.src; v.controls = true; v.style.maxWidth = "100%"; v.style.marginTop = "4px"; tooltipEl.appendChild(v); }\n';
    s += '          if (p.type === "audio" && p.content) { var a = document.createElement("audio"); var au = Array.isArray(p.content) ? p.content[0] : p.content; if (au) a.src = (au.url || au.src || (typeof au === "string" ? au : "")); a.controls = true; a.style.marginTop = "4px"; tooltipEl.appendChild(a); }\n';
    s += '          if (p.type === "urls" && Array.isArray(p.content)) { for (var ui = 0; ui < p.content.length; ui++) { var href = p.content[ui]; if (!href) continue; var lk = document.createElement("a"); lk.href = href; lk.textContent = href; lk.target = "_blank"; lk.rel = "noopener"; lk.style.display = "block"; lk.style.marginTop = "4px"; tooltipEl.appendChild(lk); } }\n';
    s += '        }\n';
    s += '      } else { var fallback = document.createElement("span"); fallback.textContent = step.tooltip || ("Step " + step.index); tooltipEl.appendChild(fallback); }\n';
    s += '      tooltipEl.style.left = (r.left + window.scrollX) + "px";\n';
    s += '      tooltipEl.style.top = (r.top + window.scrollY - 8) + "px";\n';
    s += '      tooltipEl.style.transform = "translateY(-100%)";\n';
    s += '    } else {\n';
    s += '      tooltipEl.innerHTML = "";\n';
    s += '      var parts2 = step.commentParts || [];\n';
    s += '      if (parts2.length > 0) {\n';
    s += '        for (var pi2 = 0; pi2 < parts2.length; pi2++) {\n';
    s += '          var p2 = parts2[pi2];\n';
    s += '          if (p2.type === "text" && p2.content) { var tx2 = document.createElement("div"); tx2.textContent = p2.content; tooltipEl.appendChild(tx2); }\n';
    s += '          if (p2.type === "images" && Array.isArray(p2.content)) { for (var ji2 = 0; ji2 < p2.content.length; ji2++) { var im2 = document.createElement("img"); var it2 = p2.content[ji2]; im2.src = (typeof it2 === "string" ? it2 : (it2 && it2.url)) || ""; im2.alt = (it2 && it2.alt) || ""; im2.style.maxWidth = "100%"; im2.style.marginTop = "4px"; tooltipEl.appendChild(im2); } }\n';
    s += '          if (p2.type === "video" && p2.content && (p2.content.url || p2.content.src)) { var v2 = document.createElement("video"); v2.src = p2.content.url || p2.content.src; v2.controls = true; tooltipEl.appendChild(v2); }\n';
    s += '          if (p2.type === "audio" && p2.content) { var a2 = document.createElement("audio"); var au2 = Array.isArray(p2.content) ? p2.content[0] : p2.content; if (au2) a2.src = (au2.url || au2.src || (typeof au2 === "string" ? au2 : "")); a2.controls = true; tooltipEl.appendChild(a2); }\n';
    s += '          if (p2.type === "urls" && Array.isArray(p2.content)) { for (var ui2 = 0; ui2 < p2.content.length; ui2++) { var href2 = p2.content[ui2]; if (!href2) continue; var lk2 = document.createElement("a"); lk2.href = href2; lk2.textContent = href2; lk2.target = "_blank"; lk2.rel = "noopener"; lk2.style.display = "block"; lk2.style.marginTop = "4px"; tooltipEl.appendChild(lk2); } }\n';
    s += '        }\n';
    s += '      } else { var fallback2 = document.createElement("span"); fallback2.textContent = (step.tooltip || "Step " + step.index) + " (element not found)"; tooltipEl.appendChild(fallback2); }\n';
    s += '      tooltipEl.style.left = "20px"; tooltipEl.style.top = "20px"; tooltipEl.style.transform = "none";\n';
    s += '    }\n';
    s += '    if (step.quizQuestion && step.selectors && step.selectors.length) {\n';
    s += '      quizVerified = false;\n';
    s += '      if (!quizEl) {\n';
    s += '        quizEl = document.createElement("div");\n';
    s += '        quizEl.id = "cfs-walkthrough-quiz";\n';
    s += '        quizEl.style.cssText = "position:fixed;z-index:99997;max-width:320px;padding:10px 12px;background:#2d3748;color:#eee;font:14px sans-serif;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;margin-top:8px;";\n';
    s += '        document.body.appendChild(quizEl);\n';
    s += '      }\n';
    s += '      quizEl.innerHTML = "";\n';
    s += '      var q = document.createElement("p"); q.textContent = "Q: " + (step.quizQuestion || ""); q.style.margin = "0 0 8px 0"; quizEl.appendChild(q);\n';
    s += '      var verifyBtn = document.createElement("button"); verifyBtn.setAttribute("data-cfs-verify", "1"); verifyBtn.textContent = "Verify"; verifyBtn.style.marginRight = "8px"; quizEl.appendChild(verifyBtn);\n';
    s += '      var skipBtn = document.createElement("button"); skipBtn.setAttribute("data-cfs-skip", "1"); skipBtn.textContent = "Skip"; quizEl.appendChild(skipBtn);\n';
    s += '      quizEl.style.display = "block"; quizEl.style.left = tooltipEl ? tooltipEl.style.left : "20px"; quizEl.style.top = (tooltipEl ? (parseInt(tooltipEl.style.top, 10) || 0) + (tooltipEl.offsetHeight || 60) : 80) + "px";\n';
    s += '      var nextBtn = bar ? bar.querySelector("[data-cfs-next]") : null; if (nextBtn) nextBtn.disabled = true;\n';
    s += '      verifyBtn.onclick = function() {\n';
    s += '        var s = steps[current]; if (!s || !lastClickedElement) { alert("Click the correct element on the page first."); return; }\n';
    s += '        var correct = false; for (var i = 0; i < (s.selectors || []).length; i++) { try { var list = document.querySelectorAll(s.selectors[i]); for (var j = 0; j < list.length; j++) if (list[j] === lastClickedElement) { correct = true; break; } } catch (e) {} if (correct) break; }\n';
    s += '        if (correct) { quizVerified = true; quizEl.style.display = "none"; var nb = bar ? bar.querySelector("[data-cfs-next]") : null; if (nb) nb.disabled = false; if (tooltipEl) tooltipEl.textContent = (s.tooltip || "Step " + s.index) + " — Correct!"; } else { alert("Not quite. Try clicking the element this step is about."); }\n';
    s += '      };\n';
    s += '      skipBtn.onclick = function() { quizVerified = true; quizEl.style.display = "none"; var nb = bar ? bar.querySelector("[data-cfs-next]") : null; if (nb) nb.disabled = false; };\n';
    s += '    } else { quizVerified = true; if (quizEl) quizEl.style.display = "none"; var nb = bar ? bar.querySelector("[data-cfs-next]") : null; if (nb) nb.disabled = false; }\n';
    s += '  }\n\n';
    s += '  function next() {\n';
    s += '    if (current >= steps.length) return;\n';
    s += '    var wasStep = current;\n';
    s += '    current++;\n';
    s += '    reportProgress("step_completed", { stepIndex: wasStep, totalSteps: steps.length });\n';
    s += '    if (current >= steps.length) { reportProgress("walkthrough_completed", { totalSteps: steps.length }); show(); updateButtons(); return; }\n';
    s += '    show(); updateButtons();\n';
    s += '  }\n';
  s += '  function prev() { if (current > 0) { current--; show(); updateButtons(); } }\n';
  s += '  var bar = null;\n';
  s += '  var keyHandler = function(e) {\n';
  s += '    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }\n';
  s += '    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }\n';
  s += '    else if (e.key === "Escape") { e.preventDefault(); destroy(); }\n';
  s += '  };\n';
  s += '  function updateButtons() {\n';
  s += '    if (!bar) return;\n';
  s += '    var prevBtn = bar.querySelector("[data-cfs-prev]");\n';
  s += '    var nextBtn = bar.querySelector("[data-cfs-next]");\n';
  s += '    var label = bar.querySelector("[data-cfs-label]");\n';
  s += '    if (prevBtn) prevBtn.disabled = current <= 0;\n';
  s += '    var step = steps[current];\n';
  s += '    if (nextBtn) nextBtn.disabled = (current >= steps.length - 1) || (step && step.quizQuestion && step.selectors && step.selectors.length && !quizVerified);\n';
  s += '    if (label) label.textContent = (current >= steps.length) ? "Complete" : "Step " + (current + 1) + " of " + steps.length;\n';
  s += '  }\n';
  s += '  function clickCapture(e) { if (e && e.target) lastClickedElement = e.target; }\n';
  s += '  function ensureBar() {\n';
  s += '    if (bar) return;\n';
  s += '    document.addEventListener("click", clickCapture, true);\n';
  s += '    bar = document.createElement("div");\n';
  s += '    bar.id = "cfs-walkthrough-bar";\n';
  s += '    bar.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1a1a1a;color:#eee;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font:14px sans-serif;";\n';
  s += '    var prevBtn = document.createElement("button");\n';
  s += '    prevBtn.setAttribute("data-cfs-prev", "1");\n';
  s += '    prevBtn.textContent = "Prev";\n';
  s += '    prevBtn.onclick = prev;\n';
  s += '    var nextBtn = document.createElement("button");\n';
  s += '    nextBtn.setAttribute("data-cfs-next", "1");\n';
  s += '    nextBtn.textContent = "Next";\n';
  s += '    nextBtn.onclick = next;\n';
  s += '    var label = document.createElement("span");\n';
  s += '    label.setAttribute("data-cfs-label", "1");\n';
  s += '    var closeBtn = document.createElement("button");\n';
  s += '    closeBtn.textContent = "Close";\n';
  s += '    closeBtn.onclick = destroy;\n';
  s += '    var hint = document.createElement("span");\n';
  s += '    hint.style.cssText = "margin-left:8px;font-size:11px;opacity:0.8;";\n';
  s += '    hint.textContent = "← → Esc";\n';
  s += '    hint.title = "Arrow keys: prev/next. Escape: close.";\n';
  s += '    bar.appendChild(prevBtn);\n';
  s += '    bar.appendChild(nextBtn);\n';
  s += '    bar.appendChild(label);\n';
  s += '    bar.appendChild(closeBtn);\n';
  s += '    bar.appendChild(hint);\n';
  s += '    document.body.appendChild(bar);\n';
  s += '    document.addEventListener("keydown", keyHandler);\n';
  s += '    updateButtons();\n';
  s += '  }\n';
  s += '  function destroy() {\n';
  s += '    reportProgress("walkthrough_closed", { lastStepIndex: current, totalSteps: steps.length });\n';
  s += '    document.removeEventListener("keydown", keyHandler);\n';
  s += '    document.removeEventListener("click", clickCapture, true);\n';
  s += '    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);\n';
  s += '    if (tooltipEl && tooltipEl.parentNode) tooltipEl.parentNode.removeChild(tooltipEl);\n';
  s += '    if (quizEl && quizEl.parentNode) quizEl.parentNode.removeChild(quizEl);\n';
  s += '    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);\n';
  s += '    overlay = null;\n';
  s += '    tooltipEl = null;\n';
  s += '    quizEl = null;\n';
  s += '    bar = null;\n';
  s += '  }\n';
  s += '  window.__CFS_walkthrough = { start: function() { current = 0; ensureBar(); show(); }, next: next, prev: prev, destroy: destroy };\n';
  s += '})();\n';
  return s;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildWalkthroughConfig: buildWalkthroughConfig, buildWalkthroughRunnerScript: buildWalkthroughRunnerScript, selectorStrings: selectorStrings };
  } else {
    global.CFS_walkthroughExport = {
      buildWalkthroughConfig: buildWalkthroughConfig,
      buildWalkthroughRunnerScript: buildWalkthroughRunnerScript,
      selectorStrings: selectorStrings,
    };
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
