(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('select', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const sel = document.createElement('select');
    sel.id = 'var_' + field.id;
    (field.options || []).forEach(function(opt) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === (value != null ? value : field.default)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function() { onChange(field.id, sel.value); });
    wrap.appendChild(sel);
    container.appendChild(wrap);
    return wrap;
  });
})();
