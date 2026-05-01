(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('textarea', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const input = document.createElement('textarea');
    input.id = 'var_' + field.id;
    input.rows = Number(field.rows) > 0 ? Number(field.rows) : 8;
    input.value = value != null ? value : (field.default != null ? field.default : '');
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener('input', function() { onChange(field.id, input.value); });
    wrap.appendChild(input);
    container.appendChild(wrap);
    return wrap;
  });
})();
