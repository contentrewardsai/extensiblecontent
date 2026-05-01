(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('hidden', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item gen-variable-item-hidden';
    wrap.dataset.varId = field.id;
    wrap.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = 'var_' + field.id;
    input.value = value != null ? String(value) : (field.default != null ? String(field.default) : '');
    wrap.appendChild(input);
    container.appendChild(wrap);
    return wrap;
  });
})();
