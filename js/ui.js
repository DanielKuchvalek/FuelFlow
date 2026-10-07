// js/ui.js – notifikace, potvrzovací dialog a práce s modálními okny

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHEET_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// Kam by prvek „dojel“ setrvačností po puštění prstu (vzorec Applu, rychlost v px/ms)
function projectMomentum(velocity, deceleration = 0.998) {
  return velocity * deceleration / (1 - deceleration);
}

// Za hranicí prvek prstu následuje čím dál méně – měkký odpor místo tvrdé zarážky
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Rychlost z posledních ~100 ms pohybu (px/ms), ne jen ze dvou posledních bodů
function releaseVelocity(samples) {
  const last = samples[samples.length - 1];
  const first = samples.find(s => last.t - s.t <= 100) || samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

// Krátké cvaknutí při důležité akci (uložení, smazání). iOS vibrace nepodporuje – tiše přeskočí.
export function haptic(pattern = 10) {
  if (prefersReducedMotion()) return;
  try { navigator.vibrate?.(pattern); } catch { /* bez podpory */ }
}

// Nechá prvek odejít animací (.is-removing) a teprve pak pokračuje
export function animateOut(el, duration = 220) {
  if (!el || prefersReducedMotion()) return Promise.resolve();
  el.classList.add('is-removing');
  return new Promise(resolve => setTimeout(resolve, duration));
}

export function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  stack.appendChild(toast);

  let timer = 0;
  const remove = () => {
    toast.classList.add('toast-leave');
    setTimeout(() => toast.remove(), 220);
  };
  timer = setTimeout(remove, type === 'error' ? 5000 : 3000);
  // Držená notifikace nezmizí pod prstem; po vrácení dostane ještě chvíli
  enableToastSwipe(toast, {
    pause: () => clearTimeout(timer),
    resume: () => { timer = setTimeout(remove, 2000); }
  });
}

// Notifikaci jde stáhnout prstem (nebo myší) dolů – odejde stejnou cestou, kudy přišla
function enableToastSwipe(toast, { pause, resume }) {
  let startY = 0;
  let dy = 0;
  let samples = [];
  let dragging = false;

  toast.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    dy = 0;
    samples = [{ y: e.clientY, t: e.timeStamp }];
    toast.setPointerCapture(e.pointerId);
    toast.style.transition = 'none';
    pause();
  });

  toast.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 8) samples.shift();
    const y = dy >= 0 ? dy : -rubberband(-dy, toast.offsetHeight);
    toast.style.transform = `translateY(${y}px)`;
    toast.style.opacity = String(Math.max(0.3, 1 - Math.max(0, dy) / 120));
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    // Konečná poloha z pointerup – spolehlivější než poslední pointermove
    if (e.type === 'pointerup') {
      dy = e.clientY - startY;
      samples.push({ y: e.clientY, t: e.timeStamp });
    }
    const velocity = releaseVelocity(samples);
    const projected = dy + projectMomentum(velocity);
    if (projected > toast.offsetHeight * 0.6 && velocity >= 0) {
      toast.style.transition = `transform 0.2s ${SHEET_EASE}, opacity 0.2s ease-out`;
      toast.style.transform = `translateY(${toast.offsetHeight + 24}px)`;
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 220);
    } else {
      toast.style.transition = `transform 0.3s ${SHEET_EASE}, opacity 0.2s ease-out`;
      toast.style.transform = '';
      toast.style.opacity = '';
      resume();
    }
  };
  toast.addEventListener('pointerup', release);
  toast.addEventListener('pointercancel', release);
}

// --- MODÁLNÍ OKNA ---
// Zavření nejdřív přehraje odchodovou animaci (.is-closing) a až pak okno skryje.
// Znovuotevření během zavírání animaci přeruší.
export function openModal(modal) {
  if (!modal) return;
  clearTimeout(modal._closeTimer);
  modal.classList.remove('is-closing', 'is-dragged', 'hidden');
  resetSheet(modal);
}

export function closeModal(modal, { dragged = false } = {}) {
  if (!modal || modal.classList.contains('hidden') || modal.classList.contains('is-closing')) return;
  modal.classList.add('is-closing');
  modal.classList.toggle('is-dragged', dragged);
  clearTimeout(modal._closeTimer);
  modal._closeTimer = setTimeout(() => {
    modal.classList.remove('is-closing', 'is-dragged');
    modal.classList.add('hidden');
    resetSheet(modal);
  }, dragged ? 260 : 240);
}

function resetSheet(modal) {
  const card = modal.querySelector('.modal-card');
  if (!card) return;
  card.style.transform = '';
  card.style.transition = '';
}

// Zavření uživatelem (Esc, klik vedle, stažení dolů) – posluchači se dozví, že šlo o zrušení
function dismissModal(modal, options) {
  if (modal.classList.contains('is-closing')) return;
  closeModal(modal, options);
  modal.dispatchEvent(new Event('modal:close'));
}

// Na telefonu je modál spodní panel: chytne se za hlavičku (nebo úchyt nahoře)
// a sleduje prst 1:1. Po puštění rozhodne rychlost a setrvačnost, jestli zajede dolů.
function enableSheetDrag(modal) {
  const card = modal.querySelector('.modal-card');
  if (!card) return;
  const isSheet = window.matchMedia('(max-width: 760px)');

  let startY = 0;
  let dy = 0;
  let samples = [];
  let dragging = false;

  card.addEventListener('pointerdown', (e) => {
    if (!isSheet.matches || e.pointerType === 'mouse' || e.button !== 0) return;
    const onHandle = e.target === card && e.clientY - card.getBoundingClientRect().top < 32;
    const onHead = e.target.closest('.modal-head') && !e.target.closest('button, input, select, a, label');
    if (!onHandle && !onHead) return;

    dragging = true;
    startY = e.clientY;
    dy = 0;
    samples = [{ y: e.clientY, t: e.timeStamp }];
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 8) samples.shift();
    const y = dy >= 0 ? dy : -rubberband(-dy, card.offsetHeight);
    card.style.transform = `translateY(${y}px)`;
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    // Konečná poloha z pointerup – spolehlivější než poslední pointermove
    if (e.type === 'pointerup') {
      dy = e.clientY - startY;
      samples.push({ y: e.clientY, t: e.timeStamp });
    }
    const velocity = releaseVelocity(samples);
    const projected = dy + projectMomentum(velocity);
    const shouldClose = velocity > 0.5 || (projected > card.offsetHeight * 0.45 && velocity >= 0);

    if (shouldClose && dy > 0) {
      // Dojede dolů z místa puštění, rychlostí odpovídající prstu
      const remaining = card.offsetHeight + 24 - dy;
      const duration = Math.min(0.26, Math.max(0.12, remaining / Math.max(velocity, 1) / 1000));
      card.style.transition = `transform ${duration}s ${SHEET_EASE}`;
      card.style.transform = `translateY(${card.offsetHeight + 24}px)`;
      dismissModal(modal, { dragged: true });
      haptic(8);
    } else {
      card.style.transition = `transform 0.35s ${SHEET_EASE}`;
      card.style.transform = '';
    }
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
}

// Náhrada za window.confirm() ve vzhledu aplikace; vrací Promise<boolean>
export function confirmDialog({ title, message, confirmText = 'Smazat' }) {
  const modal = document.getElementById('confirmModal');
  const okBtn = document.getElementById('confirmOkBtn');
  const cancelBtn = document.getElementById('confirmCancelBtn');

  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  okBtn.textContent = confirmText;
  openModal(modal);
  okBtn.focus();

  return new Promise(resolve => {
    const finish = (result) => {
      closeModal(modal);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('modal:close', onCancel);
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('modal:close', onCancel);
  });
}

// Zavření modálu klávesou Esc, kliknutím mimo kartu nebo stažením dolů (telefon)
export function setupModalDismiss() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) dismissModal(modal);
    });
    enableSheetDrag(modal);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal-overlay:not(.hidden):not(.is-closing)')];
    if (open.length) dismissModal(open[open.length - 1]);
  });
}

// Zablokuje tlačítko po dobu požadavku, aby dvojklik neuložil záznam dvakrát
export async function withBusyButton(button, task) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
}

// --- PLOVOUCÍ PANELY (výběry, kalendář) ---
// Panel se vykresluje do <body>, aby ho neořízl scrollující modál, a připne se
// k prvku. Když pod ním není místo, otevře se nahoru.
export function positionPopover(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const spaceBelow = window.innerHeight - rect.bottom - margin * 2;
  const spaceAbove = rect.top - margin * 2;

  panel.style.minWidth = `${rect.width}px`;
  panel.style.maxHeight = '';
  const naturalHeight = panel.scrollHeight;
  const openUp = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
  const available = Math.max(180, openUp ? spaceAbove : spaceBelow);
  panel.style.maxHeight = `${available}px`;

  const height = Math.min(naturalHeight, available);
  const width = panel.offsetWidth;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  panel.style.left = `${left}px`;
  panel.style.top = `${openUp ? rect.top - height - margin : rect.bottom + margin}px`;
  panel.classList.toggle('opens-up', openUp);
}

// Otevřený panel dorovnává polohu v každém snímku – drží se prvku i během
// animace okna, při scrollu modálu nebo změně rozložení stránky
export function trackPopover(panel, anchor, isOpen) {
  const tick = () => {
    if (!isOpen()) return;
    positionPopover(panel, anchor);
    requestAnimationFrame(tick);
  };
  positionPopover(panel, anchor);
  requestAnimationFrame(tick);
}

// Nativní setter hodnoty obalíme, aby se vlastní prvek překreslil i tehdy,
// když hodnotu nastaví kód (např. app.js při úpravě záznamu) bez události change
export function observeValue(el, proto, onChange) {
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); onChange(); }
  });
  el.form?.addEventListener('reset', () => setTimeout(onChange));
}

// Povinné pole je skryté, takže nativní validace prohlížeče by selhala.
// Kontrolu uděláme sami ještě před obsluhou odeslání v app.js (fáze capture).
export function guardRequired(el, trigger, wrap, message) {
  if (!el.required) return;
  el.required = false;
  el.form?.addEventListener('submit', (e) => {
    if (el.value) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    wrap.classList.remove('is-invalid');
    void wrap.offsetWidth;
    wrap.classList.add('is-invalid');
    trigger.focus();
    showToast(message, 'error');
  }, true);
  el.addEventListener('change', () => wrap.classList.remove('is-invalid'));
}

const CHEVRON = '<svg class="custom-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// Vlastní rozbalovací menu nad skrytým <select>. Select zůstává zdrojem pravdy –
// app.js ho dál plní, čte a poslouchá jeho 'change'; menu ho jen zobrazuje a ovládá.
// Filtr vozidel má markup připravený v HTML, ostatní selecty dostanou „polní“ vzhled.
export function enhanceSelect(select, { requiredMessage = 'Vyberte možnost ze seznamu.' } = {}) {
  if (!select || select.dataset.enhanced) return;
  select.dataset.enhanced = 'true';

  let wrap = select.closest('.custom-select');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'custom-select is-field';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    wrap.insertAdjacentHTML('beforeend', `
      <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-text"><span class="custom-select-label"></span></span>${CHEVRON}
      </button>
      <ul class="custom-select-panel" role="listbox" data-lenis-prevent></ul>`);
  }

  const trigger = wrap.querySelector('.custom-select-trigger');
  const label = wrap.querySelector('.custom-select-label');
  const icon = wrap.querySelector('.custom-select-icon');
  const panel = wrap.querySelector('.custom-select-panel');
  document.body.appendChild(panel);

  // Popisek <label for="…"> teď patří tlačítku
  if (select.id) {
    trigger.id = `${select.id}-trigger`;
    document.querySelectorAll(`label[for="${select.id}"]`).forEach(l => { l.htmlFor = trigger.id; });
  }

  let activeIndex = -1;
  const options = () => [...select.options].filter(o => !o.dataset.placeholder);
  const items = () => [...panel.querySelectorAll('.custom-option')];
  const isOpen = () => panel.classList.contains('is-open');

  const render = () => {
    const selected = select.options[select.selectedIndex];
    const isPlaceholder = !selected || selected.dataset.placeholder;
    label.textContent = selected ? selected.text : '';
    wrap.classList.toggle('is-placeholder', Boolean(isPlaceholder));

    const color = selected?.dataset.color;
    if (icon) {
      icon.style.setProperty('--dot', color || 'transparent');
      icon.style.setProperty('--dot-scale', color ? '1' : '0');
    }
    // Barevná tečka i ve spouštěči polního výběru (např. vybrané auto)
    wrap.style.setProperty('--dot', color || 'transparent');
    wrap.classList.toggle('has-dot', Boolean(color) && !icon);

    const withDots = options().some(o => o.dataset.color);
    panel.replaceChildren(...options().map((opt, i) => {
      const li = document.createElement('li');
      li.className = 'custom-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(opt.selected));
      li.dataset.value = opt.value;
      li.style.setProperty('--i', i);

      if (withDots) {
        const dot = document.createElement('span');
        dot.className = 'custom-option-dot';
        if (opt.dataset.color) dot.style.setProperty('--dot', opt.dataset.color);
        else dot.classList.add('is-all');
        li.append(dot);
      }

      const text = document.createElement('span');
      text.className = 'custom-option-text';
      text.textContent = opt.text;

      const check = document.createElement('span');
      check.className = 'custom-option-check';
      check.innerHTML = CHECK;

      li.append(text, check);
      return li;
    }));
  };

  const highlight = (index) => {
    const list = items();
    if (!list.length) return;
    activeIndex = (index + list.length) % list.length;
    list.forEach((li, i) => li.classList.toggle('is-active', i === activeIndex));
    list[activeIndex].scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    if (isOpen()) return;
    render();
    panel.classList.add('is-open');
    wrap.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    trackPopover(panel, trigger, isOpen);
    highlight(Math.max(0, options().findIndex(o => o.selected)));
  };

  const close = () => {
    panel.classList.remove('is-open');
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  };

  const choose = (value) => {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    render();
    close();
    trigger.focus();
  };

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));

  panel.addEventListener('click', (e) => {
    const li = e.target.closest('.custom-option');
    if (li) choose(li.dataset.value);
  });
  panel.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.custom-option');
    if (li) highlight(items().indexOf(li));
  });

  trigger.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen()) open();
        else highlight(activeIndex + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen() && activeIndex >= 0) choose(items()[activeIndex].dataset.value);
        else open();
        break;
      case 'Escape':
        if (isOpen()) {
          e.stopPropagation(); // Esc zavře jen menu, ne celé okno
          close();
        }
        break;
      case 'Tab':
        close();
        break;
    }
  });

  // Klik mimo menu ho zavře
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !wrap.contains(e.target) && !panel.contains(e.target)) close();
  });

  // app.js mění možnosti i hodnotu selectu – menu se překreslí samo
  new MutationObserver(render).observe(select, { childList: true });
  select.addEventListener('change', render);
  observeValue(select, HTMLSelectElement.prototype, render);
  guardRequired(select, trigger, wrap, requiredMessage);
  render();
}
