(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('number', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'var_' + field.id;
    input.value = value != null ? value : (field.default != null ? field.default : 0);
    input.addEventListener('input', function() { var v = input.valueAsNumber; onChange(field.id, isNaN(v) ? (Number(field.default) || 0) : v); });
    wrap.appendChild(input);
    container.appendChild(wrap);
    return wrap;
  });
})();
