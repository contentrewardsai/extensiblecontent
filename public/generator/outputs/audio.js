/**
 * Audio output: show audio element, export as download.
 */
(function() {
  'use strict';
  if (typeof window.__CFS_genOutputs === 'undefined') return;
  window.__CFS_genOutputs.register('audio',
    function(container, data) {
      container.innerHTML = '';
      if (!data) return;
      const url = typeof data === 'string' ? data : (data.url || data.src);
      if (!url) return;
      const audio = document.createElement('audio');
      audio.src = url;
      audio.controls = true;
      audio.style.maxWidth = '100%';
      container.appendChild(audio);
    },
    function(data) {
      const url = typeof data === 'string' ? data : (data && (data.url || data.src));
      if (url && typeof url === 'string' && /^(data:|blob:|https?:)/i.test(url)) {
        const a = document.createElement('a');
        a.download = 'content-export.ogg';
        a.href = url;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      if (data != null && typeof data === 'string' && data.length > 0) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(data);
        }
      }
    }
  );
})();
