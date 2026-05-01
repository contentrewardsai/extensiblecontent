/**
 * Audio file input: accept audio/*, value is data URL.
 */
(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('audio', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'var_' + field.id;
    input.accept = field.accept || 'audio/*';
    input.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function() { onChange(field.id, reader.result); };
        reader.readAsDataURL(file);
      } else { onChange(field.id, null); }
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
    return wrap;
  });
})();
