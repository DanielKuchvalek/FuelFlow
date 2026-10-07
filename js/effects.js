// js/effects.js – vizuální efekty: tekuté přepínače, plynulý scroll, animace při scrollu

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lenis = null;
let revealStarted = false;
const pendingNumbers = new Map();

export function initEffects() {
  if (!reduceMotion) document.documentElement.classList.add('fx');

  document.querySelectorAll('.liquid-group').forEach(initLiquidGroup);
  initSmoothScroll();
  initSectionNav();
  initGlowCards();
  initNavShadow();
  initModalScrollLock();
}

// --- TEKUTÉ PŘEPÍNAČE ---
// Dvě kapky (hlavní a opožděná) projdou SVG filtrem #goo, takže se při
// přesunu k aktivní položce protáhnou a slijí jako kapalina.
function initLiquidGroup(group) {
  const track = document.createElement('div');
  track.className = 'liquid-track';
  track.setAttribute('aria-hidden', 'true');
  track.innerHTML = '<span class="liquid-blob"></span><span class="liquid-blob trail"></span>';
  group.prepend(track);

  const blobs = track.querySelectorAll('.liquid-blob');
  const items = group.querySelectorAll('.liquid-item');

  const place = (animate) => {
    const active = group.querySelector('.liquid-item.active');
    if (!active || !active.offsetWidth) return; // skupina je skrytá, počkáme na ResizeObserver

    if (!animate) group.classList.add('no-anim');
    blobs.forEach(blob => {
      blob.style.setProperty('--x', `${active.offsetLeft}px`);
      blob.style.setProperty('--y', `${active.offsetTop}px`);
      blob.style.setProperty('--w', `${active.offsetWidth}px`);
      blob.style.setProperty('--h', `${active.offsetHeight}px`);
    });
    if (!animate) {
      void group.offsetWidth; // vynutí přepočet, aby se skok neanimoval
      requestAnimationFrame(() => group.classList.remove('no-anim'));
    }
    group.classList.add('is-ready');
  };

  // Aktivní položku přepíná existující kód (třída .active) – kapka ji jen sleduje
  const observer = new MutationObserver(() => place(true));
  items.forEach(item => observer.observe(item, { attributes: true, attributeFilter: ['class'] }));

  new ResizeObserver(() => place(false)).observe(group);
  document.fonts?.ready.then(() => place(false));
  place(false);
}

// --- PLYNULÝ SCROLL (Lenis) ---
function initSmoothScroll() {
  if (reduceMotion || typeof window.Lenis !== 'function') return;

  lenis = new window.Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true
  });

  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

function scrollToElement(el, onDone) {
  const offset = -(document.querySelector('.top-nav')?.offsetHeight ?? 0) - 36;
  if (lenis) {
    // Skok na sekci je častá akce – krátký dojezd, žádné dlouhé plachtění
    lenis.scrollTo(el, { offset, duration: 0.75, onComplete: onDone });
  } else {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + offset, behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(onDone, 700);
  }
}

// --- NAVIGACE PO SEKCÍCH + SCROLL-SPY ---
function initSectionNav() {
  const nav = document.getElementById('sectionNav');
  if (!nav) return;

  const links = [...nav.querySelectorAll('.nav-link')];
  const sections = links.map(link => document.getElementById(link.dataset.section)).filter(Boolean);
  let spyLocked = false;

  const setActive = (id) => {
    links.forEach(link => link.classList.toggle('active', link.dataset.section === id));
  };

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(link.dataset.section);
      if (!target) return;
      setActive(link.dataset.section);
      spyLocked = true;
      scrollToElement(target, () => { spyLocked = false; });
    });
  });

  let ticking = false;
  const spy = () => {
    ticking = false;
    if (spyLocked || !sections.length || !sections[0].offsetParent) return;

    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = sections[0];
    if (atBottom) {
      current = sections[sections.length - 1];
    } else {
      const line = window.innerHeight * 0.35;
      sections.forEach(section => {
        if (section.getBoundingClientRect().top <= line) current = section;
      });
    }
    setActive(current.id);
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(spy);
    }
  }, { passive: true });
}

function initNavShadow() {
  const topNav = document.querySelector('.top-nav');
  if (!topNav) return;
  const update = () => topNav.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// Otevřený modál zastaví plynulý scroll stránky pod ním
function initModalScrollLock() {
  if (!lenis) return;
  const modals = document.querySelectorAll('.modal-overlay');
  const sync = () => {
    const anyOpen = [...modals].some(m => !m.classList.contains('hidden'));
    anyOpen ? lenis.stop() : lenis.start();
  };
  const observer = new MutationObserver(sync);
  modals.forEach(m => observer.observe(m, { attributes: true, attributeFilter: ['class'] }));
}

// Zamkne scroll stránky pod překryvnou vrstvou (např. roční shrnutí)
export function setScrollLock(locked) {
  document.documentElement.classList.toggle('scroll-locked', locked);
  if (lenis) locked ? lenis.stop() : lenis.start();
}

// --- SVĚTLO SLEDUJÍCÍ KURZOR NA KARTÁCH ---
function initGlowCards() {
  if (reduceMotion) return;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return; // na dotyku není kurzor, za kterým by světlo šlo
    const card = e.target.closest?.('.glow-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, { passive: true });
}

// --- ODKRÝVÁNÍ PRVKŮ PŘI SCROLLU ---
// Spouští se až po zmizení úvodní animace, aby efekt nezůstal schovaný pod ní.
export function startReveal() {
  if (revealStarted) return;
  revealStarted = true;

  let pending = [...document.querySelectorAll('[data-reveal]')];
  if (!document.documentElement.classList.contains('fx')) {
    pending.forEach(el => el.removeAttribute('data-reveal'));
    flushPendingNumbers(document.body);
    return;
  }

  // Karty v jedné řadě se odkrývají postupně
  document.querySelectorAll('.kpi-row, .charts-row').forEach(row => {
    [...row.children].forEach((child, i) => child.style.setProperty('--reveal-delay', `${i * 60}ms`));
  });

  const reveal = (el) => {
    el.classList.add('is-visible');
    flushPendingNumbers(el);
    const delay = parseFloat(el.style.getPropertyValue('--reveal-delay')) || 0;
    setTimeout(() => {
      // Po animaci atribut odebereme, aby odkrývací pravidla nepřebíjela hover efekty
      el.removeAttribute('data-reveal');
      el.classList.remove('is-visible');
      el.style.removeProperty('--reveal-delay');
    }, 700 + delay);
  };

  // Pozici kontrolujeme sami (scroll, resize, krátký interval) místo IntersectionObserveru –
  // ten v některých prostředích nevystřelí a obsah by zůstal navždy skrytý.
  const check = () => {
    const limit = window.innerHeight * 0.94;
    pending = pending.filter(el => {
      const rect = el.getBoundingClientRect();
      const inView = rect.width > 0 && rect.top < limit && rect.bottom > 0;
      if (inView) reveal(el);
      return !inView;
    });
    if (!pending.length) {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      clearInterval(revealTimer);
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; check(); });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // Interval zachytí i okamžik, kdy se dashboard objeví po přihlášení
  const revealTimer = setInterval(check, 300);
  check();
}

// --- ANIMOVANÁ ČÍSLA ---
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

function formatNumber(value, decimals) {
  return value.toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function runNumber(el, to, decimals, duration) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  cancelAnimationFrame(el._numberFrame);

  if (reduceMotion || from === to) {
    el.textContent = formatNumber(to, decimals);
    return;
  }

  const start = performance.now();
  const step = () => {
    // Čas bereme z performance.now(): značka předaná z rAF může být starší než start
    const t = Math.max(0, Math.min(1, (performance.now() - start) / duration));
    el.textContent = formatNumber(from + (to - from) * easeOutExpo(t), decimals);
    if (t < 1) el._numberFrame = requestAnimationFrame(step);
  };
  el._numberFrame = requestAnimationFrame(step);
}

// Plynule „dopočítá“ číslo z předchozí hodnoty na novou. Dokud je prvek
// schovaný před odkrytím, animace počká, aby ji uživatel skutečně viděl.
export function animateNumber(el, to, { decimals = 0, duration = 1200 } = {}) {
  if (!el) return;
  const hiddenParent = el.closest('[data-reveal]:not(.is-visible)');
  if (hiddenParent && document.documentElement.classList.contains('fx')) {
    pendingNumbers.set(el, { to, decimals, duration });
    el.textContent = formatNumber(Number(el.dataset.value ?? 0), decimals);
    return;
  }
  pendingNumbers.delete(el);
  // Napoprvé se číslo napočítá celé; při přepínání filtrů jen krátce dorovná
  const isUpdate = Number(el.dataset.value ?? 0) !== 0;
  runNumber(el, to, decimals, isUpdate ? Math.min(duration, 450) : duration);
}

function flushPendingNumbers(container) {
  pendingNumbers.forEach(({ to, decimals, duration }, el) => {
    if (!container.contains(el)) return;
    pendingNumbers.delete(el);
    runNumber(el, to, decimals, duration);
  });
}
