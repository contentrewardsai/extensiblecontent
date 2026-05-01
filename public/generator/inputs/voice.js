/**
 * Voice: select from speechSynthesis.getVoices() for Text-to-Speech.
 */
(function() {
  'use strict';
  if (typeof window.__CFS_genInputs === 'undefined') return;
  window.__CFS_genInputs.register('voice', function(container, field, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'gen-variable-item';
    wrap.dataset.varId = field.id;
    const label = document.createElement('label');
    label.textContent = field.label || field.id;
    wrap.appendChild(label);
    const sel = document.createElement('select');
    sel.id = 'var_' + field.id;

    function fillVoices() {
      const voices = speechSynthesis.getVoices();
      const currentVal = sel.value || value;
      sel.innerHTML = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '— Default voice —';
      sel.appendChild(empty);
      (voices || []).forEach(function(voice) {
        const o = document.createElement('option');
        o.value = voice.name;
        o.textContent = voice.name + (voice.lang ? ' (' + voice.lang + ')' : '');
        if (voice.name === currentVal) o.selected = true;
        sel.appendChild(o);
      });
      if (!currentVal && voices.length) sel.selectedIndex = 0;
    }
    fillVoices();
    speechSynthesis.onvoiceschanged = fillVoices;

    sel.addEventListener('change', function() { onChange(field.id, sel.value); });
    wrap.appendChild(sel);
    container.appendChild(wrap);
    return wrap;
  });
})();
