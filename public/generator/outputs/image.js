(function() {
  'use strict';
  if (typeof window.__CFS_genOutputs === 'undefined') return;
  window.__CFS_genOutputs.register('image',
    function(container, data) {
      container.innerHTML = '';
      if (!data) return;
      const img = document.createElement('img');
      img.src = typeof data === 'string' ? data : (data.dataUrl || data.url);
      img.alt = 'Generated';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      container.appendChild(img);
    },
    function(data) {
      const url = typeof data === 'string' ? data : (data && (data.dataUrl || data.url));
      if (!url) return;
      const a = document.createElement('a');
      a.download = 'content-export.png';
      a.href = url;
      a.click();
    }
  );
})();
