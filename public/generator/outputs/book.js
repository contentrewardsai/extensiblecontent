/**
 * Book output: multi-page content (e.g. PDF or image sequence). Show page previews; export downloads all page images (or single page). PDF/HTML from workflow-based book templates is handled by the generator UI.
 */
(function () {
  'use strict';
  if (typeof window.__CFS_genOutputs === 'undefined') return;
  window.__CFS_genOutputs.register('book',
    function (container, data) {
      container.innerHTML = '';
      if (!data) return;
      const pages = data.pages || (data.url ? [{ url: data.url }] : []);
      if (pages.length === 0) {
        const p = document.createElement('p');
        p.className = 'gen-preview-inline';
        p.textContent = 'No pages to display.';
        container.appendChild(p);
        return;
      }
      const wrap = document.createElement('div');
      wrap.className = 'gen-output-book';
      wrap.style.display = 'flex';
      wrap.style.flexWrap = 'wrap';
      wrap.style.gap = '8px';
      pages.forEach(function (page, i) {
        const el = (page.dataUrl || page.url) ? document.createElement('img') : document.createElement('div');
        if (el.tagName === 'IMG') {
          el.src = page.dataUrl || page.url;
          el.alt = 'Page ' + (i + 1);
        } else {
          el.textContent = 'Page ' + (i + 1);
          el.style.padding = '24px';
          el.style.background = '#f0f0f0';
          el.style.borderRadius = '4px';
        }
        el.style.maxWidth = '200px';
        el.style.height = 'auto';
        wrap.appendChild(el);
      });
      container.appendChild(wrap);
    },
    function (data) {
      const pages = (data && data.pages) || [];
      if (pages.length === 0) return;
      function downloadOne(page, index, delayMs) {
        const url = page.dataUrl || page.url;
        if (!url) return Promise.resolve();
        return new Promise(function (resolve) {
          setTimeout(function () {
            try {
              const a = document.createElement('a');
              a.download = 'content-export-page-' + (index + 1) + '.png';
              a.href = url;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } catch (_) {}
            resolve();
          }, delayMs);
        });
      }
      if (pages.length === 1) {
        downloadOne(pages[0], 0, 0);
        return;
      }
      var chain = downloadOne(pages[0], 0, 0);
      for (var i = 1; i < pages.length; i++) {
        chain = chain.then((function (pg, idx) {
          return function () { return downloadOne(pg, idx, 300); };
        })(pages[i], i));
      }
      chain.catch(function (err) { console.warn('[CFS] Book multi-page download error', err); });
    }
  );
})();
