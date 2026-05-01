(function() {
  'use strict';
  if (typeof window.__CFS_genOutputs === 'undefined') return;
  window.__CFS_genOutputs.register('video',
    function(container, data) {
      container.innerHTML = '';
      if (!data) return;
      const url = typeof data === 'string' ? data : (data.url || data.src);
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.style.maxWidth = '100%';
      container.appendChild(video);

      var toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;gap:6px;margin-top:6px;align-items:center;';
      var frameBtn = document.createElement('button');
      frameBtn.type = 'button';
      frameBtn.textContent = 'Save frame as PNG';
      frameBtn.style.cssText = 'font-size:12px;padding:4px 10px;cursor:pointer;border:1px solid var(--gen-border,#444);background:var(--gen-bg,#1e1e24);color:var(--gen-text,#eee);border-radius:4px;';
      frameBtn.addEventListener('click', function () {
        try {
          if (video.readyState < 2) return;
          var c = document.createElement('canvas');
          c.width = video.videoWidth || video.clientWidth || 1920;
          c.height = video.videoHeight || video.clientHeight || 1080;
          var ctx = c.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, c.width, c.height);
          var dataUrl = c.toDataURL('image/png');
          var a = document.createElement('a');
          a.download = 'frame-' + video.currentTime.toFixed(2) + 's.png';
          a.href = dataUrl;
          a.click();
        } catch (err) { console.warn('[CFS] Frame capture failed', err); }
      });
      toolbar.appendChild(frameBtn);
      container.appendChild(toolbar);
    },
    function(data) {
      try {
        const url = typeof data === 'string' ? data : (data && (data.url || data.src));
        if (!url) return;
        const a = document.createElement('a');
        a.download = 'content-export.webm';
        a.href = url;
        a.click();
      } catch (err) { console.warn('[CFS] Video download failed', err); }
    }
  );
})();
