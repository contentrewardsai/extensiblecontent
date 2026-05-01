(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('checkbox', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const div = document.createElement('div');
    div.className = 'gen-checkbox-wrap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'var_' + field.id;
    input.checked = !!(value != null ? value : field.default);
    input.addEventListener('change', function() { onChange(field.id, input.checked); });
    div.appendChild(input);
    div.appendChild(document.createTextNode(' ' + (field.label || field.id)));
    wrap.appendChild(div);
    container.appendChild(wrap);
    return wrap;
  });
})();
