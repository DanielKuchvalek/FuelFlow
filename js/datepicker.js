// js/datepicker.js – vlastní kalendář nad skrytým <input type="date">
// Input zůstává zdrojem pravdy (hodnota YYYY-MM-DD), kalendář ho jen zobrazuje a nastavuje.
import { toISODate, todayISO } from './utils.js?v=7.0';
import { positionPopover, trackPopover, observeValue, guardRequired } from './ui.js?v=7.0';

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTHS_SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const CAL_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
const ARROW = (dir) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="${dir === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'}"></polyline></svg>`;

const parseISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function formatHuman(iso) {
  const date = parseISO(iso);
  const weekday = date.toLocaleDateString('cs-CZ', { weekday: 'short' });
  return `${weekday} ${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
}

// options.max: 'today' nebo YYYY-MM-DD; options.clearable: zobrazit „Vymazat“
export function enhanceDateInput(input, { max = null, clearable = false, placeholder = 'Vyberte datum', requiredMessage = 'Vyberte datum.' } = {}) {
  if (!input || input.dataset.enhanced) return;
  input.dataset.enhanced = 'true';

  const wrap = document.createElement('div');
  wrap.className = 'date-field';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.classList.add('native-select');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  wrap.insertAdjacentHTML('beforeend', `
    <button type="button" class="date-trigger" aria-haspopup="dialog" aria-expanded="false">
      <span class="date-trigger-icon">${CAL_ICON}</span>
      <span class="date-trigger-text"></span>
    </button>`);
  const trigger = wrap.querySelector('.date-trigger');
  const text = wrap.querySelector('.date-trigger-text');

  if (input.id) {
    trigger.id = `${input.id}-trigger`;
    document.querySelectorAll(`label[for="${input.id}"]`).forEach(l => { l.htmlFor = trigger.id; });
  }

  const panel = document.createElement('div');
  panel.className = 'datepicker';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Výběr data');
  panel.innerHTML = `
    <div class="dp-head">
      <button type="button" class="dp-nav" data-nav="-1" aria-label="Předchozí">${ARROW('prev')}</button>
      <button type="button" class="dp-title"></button>
      <button type="button" class="dp-nav" data-nav="1" aria-label="Další">${ARROW('next')}</button>
    </div>
    <div class="dp-body"></div>
    <div class="dp-foot">
      <button type="button" class="dp-link" data-action="today">Dnes</button>
      ${clearable ? '<button type="button" class="dp-link is-muted" data-action="clear">Vymazat</button>' : ''}
    </div>`;
  document.body.appendChild(panel);

  const title = panel.querySelector('.dp-title');
  const body = panel.querySelector('.dp-body');

  let view = 'days';       // 'days' | 'months'
  let cursor = new Date(); // zobrazený měsíc
  let focusISO = null;     // den zvýrazněný klávesnicí

  const maxISO = () => (max === 'today' ? todayISO() : max);
  const isDisabled = (iso) => Boolean(maxISO()) && iso > maxISO();
  const isOpen = () => panel.classList.contains('is-open');

  const renderTrigger = () => {
    const value = input.value;
    text.textContent = value ? formatHuman(value) : placeholder;
    wrap.classList.toggle('is-placeholder', !value);
  };

  const renderDays = (direction = 0) => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    title.textContent = `${MONTHS[m]} ${y}`;

    // Mřížka začíná pondělím týdne, ve kterém je 1. den měsíce
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(y, m, 1 - offset);
    const selected = input.value;
    const today = todayISO();

    const cells = Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toISODate(day);
      const classes = ['dp-day'];
      if (day.getMonth() !== m) classes.push('is-outside');
      if (iso === today) classes.push('is-today');
      if (iso === selected) classes.push('is-selected');
      if (iso === focusISO) classes.push('is-focus');
      const disabled = isDisabled(iso);
      return `<button type="button" class="${classes.join(' ')}" data-date="${iso}"${disabled ? ' disabled' : ''} aria-label="${day.getDate()}. ${MONTHS[day.getMonth()]} ${day.getFullYear()}"${iso === selected ? ' aria-pressed="true"' : ''}>${day.getDate()}</button>`;
    }).join('');

    body.innerHTML = `
      <div class="dp-weekdays">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="dp-grid${direction ? (direction > 0 ? ' slide-next' : ' slide-prev') : ''}">${cells}</div>`;
  };

  const renderMonths = () => {
    const y = cursor.getFullYear();
    title.textContent = String(y);
    const current = input.value ? parseISO(input.value) : null;
    const maxDate = maxISO() ? parseISO(maxISO()) : null;
    body.innerHTML = `<div class="dp-months">${MONTHS_SHORT.map((name, i) => {
      const disabled = maxDate && (y > maxDate.getFullYear() || (y === maxDate.getFullYear() && i > maxDate.getMonth()));
      const active = current && current.getFullYear() === y && current.getMonth() === i;
      return `<button type="button" class="dp-month${active ? ' is-selected' : ''}" data-month="${i}"${disabled ? ' disabled' : ''}>${name}</button>`;
    }).join('')}</div>`;
  };

  const render = (direction = 0) => {
    panel.dataset.view = view;
    if (view === 'days') renderDays(direction);
    else renderMonths();
  };

  const setValue = (iso) => {
    input.value = iso;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    renderTrigger();
  };

  const open = () => {
    if (isOpen()) return;
    cursor = input.value ? parseISO(input.value) : new Date();
    focusISO = input.value || todayISO();
    view = 'days';
    render();
    panel.classList.add('is-open');
    wrap.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    trackPopover(panel, trigger, isOpen);
  };

  const close = (returnFocus = true) => {
    if (!isOpen()) return;
    panel.classList.remove('is-open');
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  };

  const shift = (step) => {
    if (view === 'days') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
    else cursor = new Date(cursor.getFullYear() + step, cursor.getMonth(), 1);
    render(step);
    positionPopover(panel, trigger);
  };

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));

  panel.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return shift(Number(nav.dataset.nav));

    if (e.target.closest('.dp-title')) {
      view = view === 'days' ? 'months' : 'days';
      render();
      positionPopover(panel, trigger);
      return;
    }

    const month = e.target.closest('[data-month]');
    if (month && !month.disabled) {
      cursor = new Date(cursor.getFullYear(), Number(month.dataset.month), 1);
      view = 'days';
      render();
      positionPopover(panel, trigger);
      return;
    }

    const day = e.target.closest('[data-date]');
    if (day && !day.disabled) {
      setValue(day.dataset.date);
      close();
      return;
    }

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'today') {
      setValue(todayISO());
      close();
    } else if (action === 'clear') {
      setValue('');
      close();
    }
  });

  // Ovládání klávesnicí: šipky po dnech/týdnech, PageUp/PageDown po měsících
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (view !== 'days') return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (moves[e.key] || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const base = parseISO(focusISO || todayISO());
      if (moves[e.key]) base.setDate(base.getDate() + moves[e.key]);
      else base.setMonth(base.getMonth() + (e.key === 'PageDown' ? 1 : -1));
      const direction = base.getMonth() !== cursor.getMonth() ? (base > cursor ? 1 : -1) : 0;
      focusISO = toISODate(base);
      cursor = new Date(base.getFullYear(), base.getMonth(), 1);
      render(direction);
      panel.querySelector(`[data-date="${focusISO}"]`)?.focus();
    }
  });

  trigger.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !isOpen()) {
      e.preventDefault();
      open();
      panel.querySelector('.dp-day.is-focus, .dp-day.is-selected')?.focus();
    } else if (e.key === 'Escape' && isOpen()) {
      e.stopPropagation();
      close();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !wrap.contains(e.target) && !panel.contains(e.target)) close(false);
  });

  observeValue(input, HTMLInputElement.prototype, renderTrigger);
  input.addEventListener('change', renderTrigger);
  guardRequired(input, trigger, wrap, requiredMessage);
  renderTrigger();
}
