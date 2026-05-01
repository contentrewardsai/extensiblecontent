(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;

  function isMediaUrl(val) {
    return typeof val === 'string' && /^(https?:|blob:|data:)/i.test(val.trim());
  }

  function updatePreview(previewEl, value, accept) {
    if (!previewEl) return;
    previewEl.innerHTML = '';
    if (!value || !isMediaUrl(value)) {
      previewEl.style.display = 'none';
      return;
    }
    previewEl.style.display = 'block';
    if (/^(image|image\/)/i.test(accept || '') || /\.(png|jpe?g|gif|webp|svg|bmp)/i.test(value) || /^data:image/i.test(value)) {
      var img = document.createElement('img');
      img.src = value;
      img.style.cssText = 'max-width:100%;max-height:80px;border-radius:4px;object-fit:contain;';
      img.onerror = function () { previewEl.style.display = 'none'; };
      previewEl.appendChild(img);
    } else if (/video/i.test(accept || '') || /\.(mp4|webm|mov)/i.test(value) || /^data:video/i.test(value)) {
      var video = document.createElement('video');
      video.src = value;
      video.muted = true;
      video.style.cssText = 'max-width:100%;max-height:80px;border-radius:4px;object-fit:contain;';
      video.onerror = function () { previewEl.style.display = 'none'; };
      previewEl.appendChild(video);
    } else if (/audio/i.test(accept || '') || /\.(mp3|wav|ogg|m4a|aac)/i.test(value) || /^data:audio/i.test(value)) {
      var audio = document.createElement('audio');
      audio.src = value;
      audio.controls = true;
      audio.style.cssText = 'width:100%;height:32px;';
      previewEl.appendChild(audio);
    } else {
      var link = document.createElement('a');
      link.href = value;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Preview';
      link.style.cssText = 'font-size:11px;color:var(--gen-accent,#2563eb);';
      previewEl.appendChild(link);
    }
  }

  function createMediaInput(container, field, value, onChange, accept) {
    var wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;

    var label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);

    var previewEl = document.createElement('div');
    previewEl.className = 'merge-preview';
    previewEl.style.cssText = 'margin-bottom:4px;display:none;';
    wrap.appendChild(previewEl);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;';

    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'merge-url-input';
    urlInput.id = 'var_' + field.id;
    urlInput.placeholder = field.placeholder || 'Paste URL or choose file';
    urlInput.style.cssText = 'flex:1;padding:6px 8px;background:var(--gen-bg);border:1px solid var(--gen-border);border-radius:4px;color:var(--gen-text);font-size:12px;';
    if (value && typeof value === 'string') urlInput.value = value;

    var debounceTimer = null;
    urlInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        onChange(field.id, urlInput.value || '');
        updatePreview(previewEl, urlInput.value, accept);
      }, 400);
    });

    var fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.textContent = 'Browse';
    fileBtn.style.cssText = 'padding:6px 10px;font-size:11px;border:1px solid var(--gen-border);border-radius:4px;background:var(--gen-surface,#1a1a1f);color:var(--gen-text);cursor:pointer;white-space:nowrap;';
    fileBtn.addEventListener('click', function () {
      var fi = document.createElement('input');
      fi.type = 'file';
      fi.accept = accept || '*/*';
      fi.onchange = function () {
        var file = fi.files && fi.files[0];
        if (!file) return;
        if (/^audio/i.test(accept || '')) {
          var blobUrl = URL.createObjectURL(file);
          urlInput.value = blobUrl;
          onChange(field.id, blobUrl);
          updatePreview(previewEl, blobUrl, accept);
        } else {
          var reader = new FileReader();
          reader.onload = function () {
            urlInput.value = reader.result;
            onChange(field.id, reader.result);
            updatePreview(previewEl, reader.result, accept);
          };
          reader.readAsDataURL(file);
        }
      };
      fi.click();
    });

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '\u00D7';
    clearBtn.title = 'Clear';
    clearBtn.style.cssText = 'padding:4px 7px;font-size:14px;border:1px solid var(--gen-border);border-radius:4px;background:var(--gen-surface,#1a1a1f);color:var(--gen-muted,#6b7280);cursor:pointer;line-height:1;';
    clearBtn.addEventListener('click', function () {
      urlInput.value = '';
      onChange(field.id, '');
      updatePreview(previewEl, '', accept);
    });

    row.appendChild(urlInput);
    row.appendChild(fileBtn);
    row.appendChild(clearBtn);
    wrap.appendChild(row);
    container.appendChild(wrap);

    updatePreview(previewEl, value, accept);

    return wrap;
  }

  window.__CFS_genInputs.register('file', function(container, field, value, onChange) {
    return createMediaInput(container, field, value, onChange, field.accept || 'image/*');
  });

  window.__CFS_genInputs.register('file-video', function(container, field, value, onChange) {
    return createMediaInput(container, field, value, onChange, field.accept || 'video/*');
  });

  window.__CFS_genInputs.register('file-audio', function(container, field, value, onChange) {
    return createMediaInput(container, field, value, onChange, field.accept || 'audio/*');
  });

  window.__CFS_genInputs.updateMediaPreview = updatePreview;
  window.__CFS_genInputs.isMediaUrl = isMediaUrl;
})();
