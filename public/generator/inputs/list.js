(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('list', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const list = Array.isArray(value) ? value.slice() : (Array.isArray(field.default) ? field.default.slice() : []);
    const listDiv = document.createElement('div');
    listDiv.className = 'list-editor';
    function renderList() {
      listDiv.innerHTML = '';
      list.forEach(function(item, i) {
        const row = document.createElement('div');
        row.className = 'list-row';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = item;
        inp.placeholder = 'Item text';
        inp.addEventListener('input', function() { list[i] = inp.value; onChange(field.id, list); });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = '−';
        rm.addEventListener('click', function() { list.splice(i, 1); onChange(field.id, list); renderList(); });
        row.appendChild(inp);
        row.appendChild(rm);
        listDiv.appendChild(row);
      });
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'add-list-item';
      addBtn.textContent = '+ Add item';
      addBtn.addEventListener('click', function() { list.push(''); onChange(field.id, list); renderList(); });
      listDiv.appendChild(addBtn);
    }
    renderList();
    wrap.appendChild(listDiv);
    container.appendChild(wrap);
    return wrap;
  });
})();
