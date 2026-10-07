// js/wrapped.js – roční shrnutí ve stylu „Wrapped“ (příběhy, které se samy posouvají)
import { escapeHtml, safeColor } from './utils.js?v=7.0';
import { consumptionSegments, summarizeSegments } from './stats.js?v=7.0';
import { setScrollLock } from './effects.js?v=7.0';

const SLIDE_MS = 6500;
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTHS_SHORT = ['L', 'Ú', 'B', 'D', 'K', 'Č', 'Č', 'S', 'Z', 'Ř', 'L', 'P'];

const sum = (list, pick) => list.reduce((acc, item) => acc + Number(pick(item) || 0), 0);
const fmt = (value, decimals = 0) => Number(value).toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function plural(count, one, few, many) {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

export function availableYears(records) {
  return [...new Set(records.map(r => r.date.slice(0, 4)))].sort();
}

function computeStats(records, year) {
  const list = records.filter(r => r.date.startsWith(year));
  const withLitres = list.filter(r => Number(r.litres) > 0);
  const litres = sum(withLitres, r => r.litres);

  const months = Array(12).fill(0);
  list.forEach(r => { months[Number(r.date.slice(5, 7)) - 1] += Number(r.amount); });
  const topMonth = months.indexOf(Math.max(...months));
  const activeMonths = months.filter(v => v > 0).length || 1;

  const stations = new Map();
  list.forEach(r => {
    if (!r.station || r.station === 'Nezadáno') return;
    const s = stations.get(r.station) || { name: r.station, count: 0, amount: 0 };
    s.count++;
    s.amount += Number(r.amount);
    stations.set(r.station, s);
  });
  const favStation = [...stations.values()].sort((a, b) => b.count - a.count || b.amount - a.amount)[0] || null;

  const vehicles = new Map();
  list.forEach(r => {
    if (!r.vehicleName) return;
    const v = vehicles.get(r.vehicleId) || { name: r.vehicleName, color: safeColor(r.vehicleColor), count: 0, amount: 0 };
    v.count++;
    v.amount += Number(r.amount);
    vehicles.set(r.vehicleId, v);
  });
  const vehicleList = [...vehicles.values()].sort((a, b) => b.amount - a.amount);

  const priced = withLitres
    .filter(r => r.fuelType !== 'Elektro')
    .map(r => ({ ...r, price: Number(r.amount) / Number(r.litres) }))
    .sort((a, b) => a.price - b.price);

  // Spotřebu počítáme z celé historie (řetězec plná–plná může začít v minulém roce)
  const segments = consumptionSegments(records).filter(s => s.date.startsWith(year));
  const consumption = summarizeSegments(segments);

  const total = sum(list, r => r.amount);
  return {
    year,
    count: list.length,
    total,
    litres,
    avgPrice: litres > 0 ? sum(withLitres, r => r.amount) / litres : 0,
    avgFill: withLitres.length ? litres / withLitres.length : 0,
    avgAmount: list.length ? total / list.length : 0,
    months,
    topMonth,
    perMonth: list.length / activeMonths,
    favStation,
    stationCount: stations.size,
    vehicleList,
    cheapest: priced[0] || null,
    priciest: priced.length > 1 ? priced[priced.length - 1] : null,
    biggest: [...list].sort((a, b) => b.amount - a.amount)[0] || null,
    consumption
  };
}

function personality(st) {
  if (st.avgFill >= 45) {
    return { title: 'Plnou, prosím!', text: `Tankuješ zásadně pořádně – v průměru ${fmt(st.avgFill, 1)} l najednou.` };
  }
  if (st.perMonth >= 3) {
    return { title: 'Stálý host pump', text: `V průměru ${fmt(st.perMonth, 1)} tankování měsíčně. Obsluha tě zná jménem.` };
  }
  if (st.favStation && st.favStation.count / st.count >= 0.5) {
    return { title: `Věrný fanoušek ${st.favStation.name}`, text: 'Víc než polovina tankování na jednom místě.' };
  }
  return { title: 'Úsporný jezdec', text: `Tankuješ s rozmyslem – průměrně ${fmt(st.avgAmount)} Kč na jedno tankování.` };
}

// Číslo, které se po zobrazení snímku „napočítá“ od nuly
const count = (value, decimals = 0) =>
  `<span class="w-count" data-count="${value}" data-dec="${decimals}">${fmt(0, decimals)}</span>`;

function buildSlides(st, years) {
  const slides = [];
  const p = personality(st);

  slides.push({
    theme: 'intro',
    html: `
      <div class="w-kicker w-anim">Fuel Flow · Wrapped</div>
      <h2 class="w-title w-anim" style="--d:1">Tvůj rok<br><span class="w-year">${st.year}</span><br>na pumpě</h2>
      <p class="w-text w-anim" style="--d:2">Pojďme se podívat, kam letos tekly peníze za palivo.</p>
      ${years.length > 1 ? `<div class="w-years w-anim" style="--d:3">${years.map(y =>
        `<button type="button" class="w-year-chip${y === st.year ? ' active' : ''}" data-year="${y}">${y}</button>`).join('')}</div>` : ''}
      <div class="w-hint w-anim" style="--d:4">Klepni pro pokračování →</div>`
  });

  slides.push({
    theme: 'lime',
    html: `
      <div class="w-kicker w-anim">Celková útrata</div>
      <p class="w-text w-anim" style="--d:1">Letos tě palivo stálo</p>
      <div class="w-big w-anim" style="--d:2">${count(Math.round(st.total))}<small> Kč</small></div>
      <p class="w-text w-anim" style="--d:3">za <strong>${st.count} ${plural(st.count, 'tankování', 'tankování', 'tankování')}</strong>, v průměru <strong>${fmt(st.avgAmount)} Kč</strong> najednou.</p>
      ${st.biggest ? `<div class="w-pill w-anim" style="--d:4">Největší účet: ${fmt(st.biggest.amount)} Kč · ${formatDate(st.biggest.date)}</div>` : ''}`
  });

  if (st.litres > 0) {
    const cans = Math.round(st.litres / 20);
    slides.push({
      theme: 'turquoise',
      html: `
        <div class="w-kicker w-anim">Natankováno</div>
        <div class="w-big w-anim" style="--d:1">${count(Math.round(st.litres))}<small> l</small></div>
        <p class="w-text w-anim" style="--d:2">To je zhruba <strong>${fmt(cans)} ${plural(cans, 'kanystr', 'kanystry', 'kanystrů')}</strong> po 20 litrech.</p>
        <div class="w-cans w-anim" style="--d:3">${Array.from({ length: Math.min(cans, 40) }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
        ${st.consumption.distance > 0 ? `
          <div class="w-duo w-anim" style="--d:4">
            <div><strong>${count(Math.round(st.consumption.distance))}</strong><span>km najeto</span></div>
            <div><strong>${count(st.consumption.per100, 1)}</strong><span>l / 100 km</span></div>
          </div>` : ''}`
    });
  }

  const maxMonth = Math.max(...st.months, 1);
  slides.push({
    theme: 'violet',
    html: `
      <div class="w-kicker w-anim">Nejdražší měsíc</div>
      <h2 class="w-title w-anim" style="--d:1">${MONTHS[st.topMonth]}</h2>
      <p class="w-text w-anim" style="--d:2">V tomhle měsíci odteklo <strong>${fmt(st.months[st.topMonth])} Kč</strong>.</p>
      <div class="w-bars w-anim" style="--d:3">
        ${st.months.map((v, i) => `
          <div class="w-bar${i === st.topMonth ? ' is-top' : ''}">
            <span style="--h:${Math.max(4, (v / maxMonth) * 100)}%; --i:${i}"></span>
            <em>${MONTHS_SHORT[i]}</em>
          </div>`).join('')}
      </div>`
  });

  if (st.favStation) {
    slides.push({
      theme: 'orchid',
      html: `
        <div class="w-kicker w-anim">Oblíbená pumpa</div>
        <h2 class="w-title w-anim" style="--d:1">${escapeHtml(st.favStation.name)}</h2>
        <p class="w-text w-anim" style="--d:2"><strong>${st.favStation.count}× tankování</strong> a útrata <strong>${fmt(st.favStation.amount)} Kč</strong> – tady to znáš nejlíp.</p>
        <div class="w-pill w-anim" style="--d:3">Celkem ${st.stationCount} ${plural(st.stationCount, 'různá stanice', 'různé stanice', 'různých stanic')}</div>`
    });
  }

  if (st.cheapest && st.priciest) {
    slides.push({
      theme: 'carbon',
      html: `
        <div class="w-kicker w-anim">Cena za litr</div>
        <p class="w-text w-anim" style="--d:1">Průměrná cena za litr</p>
        <div class="w-big w-anim" style="--d:2">${count(st.avgPrice, 2)}<small> Kč/l</small></div>
        <div class="w-compare w-anim" style="--d:3">
          <div class="w-compare-row is-low"><span>Nejlevnější</span><strong>${fmt(st.cheapest.price, 2)} Kč/l</strong><em>${escapeHtml(st.cheapest.station || '')} · ${formatDate(st.cheapest.date)}</em></div>
          <div class="w-compare-row is-high"><span>Nejdražší</span><strong>${fmt(st.priciest.price, 2)} Kč/l</strong><em>${escapeHtml(st.priciest.station || '')} · ${formatDate(st.priciest.date)}</em></div>
        </div>`
    });
  }

  if (st.vehicleList.length) {
    const top = st.vehicleList[0];
    slides.push({
      theme: 'candy',
      html: `
        <div class="w-kicker w-anim">${st.vehicleList.length > 1 ? 'Nejžíznivější auto' : 'Tvůj parťák'}</div>
        <div class="w-car-dot w-anim" style="--d:1; --car:${top.color}"></div>
        <h2 class="w-title w-anim" style="--d:1">${escapeHtml(top.name)}</h2>
        <p class="w-text w-anim" style="--d:2">Vypilo za <strong>${fmt(top.amount)} Kč</strong> paliva při ${top.count} ${plural(top.count, 'tankování', 'tankováních', 'tankováních')}.</p>
        ${st.vehicleList.length > 1 ? `<div class="w-rank w-anim" style="--d:3">${st.vehicleList.slice(0, 4).map((v, i) => `
          <div class="w-rank-row"><b>${i + 1}</b><i style="background:${v.color}"></i><span>${escapeHtml(v.name)}</span><strong>${fmt(v.amount)} Kč</strong></div>`).join('')}</div>` : ''}`
    });
  }

  slides.push({
    theme: 'outro',
    html: `
      <div class="w-kicker w-anim">Tvůj rok ${st.year} v kostce</div>
      <div class="w-badge w-anim" style="--d:1">${escapeHtml(p.title)}</div>
      <p class="w-text w-anim" style="--d:2">${escapeHtml(p.text)}</p>
      <div class="w-summary w-anim" style="--d:3">
        <div><span>Útrata</span><strong>${fmt(st.total)} Kč</strong></div>
        <div><span>Tankování</span><strong>${st.count}×</strong></div>
        <div><span>Litry</span><strong>${fmt(st.litres)} l</strong></div>
        <div><span>Ø cena</span><strong>${st.avgPrice ? fmt(st.avgPrice, 2) + ' Kč/l' : '–'}</strong></div>
        ${st.consumption.distance > 0 ? `<div><span>Najeto</span><strong>${fmt(st.consumption.distance)} km</strong></div>
        <div><span>Spotřeba</span><strong>${fmt(st.consumption.per100, 1)} l/100</strong></div>` : ''}
      </div>
      <button type="button" class="w-close-btn w-anim" style="--d:4" data-close>Zavřít shrnutí</button>`
  });

  return slides;
}

function animateCounts(slide) {
  slide.querySelectorAll('.w-count').forEach(el => {
    const to = Number(el.dataset.count);
    const dec = Number(el.dataset.dec);
    const start = performance.now();
    const duration = 1400;
    const step = () => {
      const t = Math.max(0, Math.min(1, (performance.now() - start) / duration));
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt(to * eased, dec);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// Otevře shrnutí; vrací false, pokud nejsou žádná data
export function openWrapped(records, preferredYear) {
  const years = availableYears(records);
  if (!years.length) return false;

  const current = String(new Date().getFullYear());
  const year = years.includes(preferredYear) ? preferredYear : (years.includes(current) ? current : years[years.length - 1]);
  const slides = buildSlides(computeStats(records, year), years);
  const previousFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'wrapped-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Roční shrnutí ${year}`);
  overlay.setAttribute('data-lenis-prevent', '');
  overlay.innerHTML = `
    <div class="wrapped-stage" data-theme-slide="${slides[0].theme}">
      <div class="wrapped-bg" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="wrapped-progress">${slides.map(() => '<span><i></i></span>').join('')}</div>
      <button type="button" class="wrapped-close" aria-label="Zavřít" data-close>&times;</button>
      <div class="wrapped-slides">${slides.map((s, i) => `<section class="wrapped-slide" data-index="${i}">${s.html}</section>`).join('')}</div>
    </div>`;
  document.body.appendChild(overlay);
  setScrollLock(true);

  const stage = overlay.querySelector('.wrapped-stage');
  const slideEls = [...overlay.querySelectorAll('.wrapped-slide')];
  const bars = [...overlay.querySelectorAll('.wrapped-progress i')];
  let index = 0;
  let elapsed = 0;
  let lastTick = performance.now();
  let paused = false;
  let frame = 0;
  const resume = () => { paused = false; };

  const show = (i) => {
    index = Math.max(0, Math.min(slides.length - 1, i));
    elapsed = 0;
    stage.dataset.themeSlide = slides[index].theme;
    slideEls.forEach((el, n) => {
      el.classList.toggle('is-active', n === index);
      el.classList.toggle('is-past', n < index);
    });
    bars.forEach((bar, n) => { bar.style.width = n < index ? '100%' : '0%'; });
    animateCounts(slideEls[index]);
  };

  const tick = (now) => {
    const delta = now - lastTick;
    lastTick = now;
    if (!paused && !document.hidden && index < slides.length - 1) {
      elapsed += delta;
      bars[index].style.width = `${Math.min(100, (elapsed / SLIDE_MS) * 100)}%`;
      if (elapsed >= SLIDE_MS) show(index + 1);
    } else if (index === slides.length - 1) {
      bars[index].style.width = '100%';
    }
    frame = requestAnimationFrame(tick);
  };

  const close = () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerup', resume);
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.remove();
      setScrollLock(false);
      previousFocus?.focus?.();
    }, 350);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  };
  document.addEventListener('keydown', onKey);

  // Podržení prstu/myši příběh pozastaví (jako na Instagramu).
  // Swipe do stran přepíná příběhy, stažení dolů shrnutí zavře – karta jde za prstem.
  let gesture = null;
  let suppressClick = false;

  stage.addEventListener('pointerdown', (e) => {
    paused = true;
    suppressClick = false;
    if (e.target.closest('button')) return;
    gesture = { x: e.clientX, y: e.clientY, axis: null, samples: [{ y: e.clientY, t: e.timeStamp }] };
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    // Směr určíme až po ~10 px pohybu, aby drobné chvění nebylo gesto
    if (!gesture.axis && Math.hypot(dx, dy) > 10) gesture.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    gesture.samples.push({ y: e.clientY, t: e.timeStamp });
    if (gesture.samples.length > 8) gesture.samples.shift();
    if (gesture.axis === 'y' && dy > 0) {
      stage.style.transition = 'none';
      stage.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 400) / 2000})`;
    }
  });

  const endGesture = (e) => {
    if (!gesture) return;
    const { axis } = gesture;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    const last = gesture.samples[gesture.samples.length - 1];
    const first = gesture.samples.find(s => last.t - s.t <= 100) || gesture.samples[0];
    const velocityY = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    gesture = null;
    if (!axis) return; // obyčejné klepnutí – vyřeší ho click

    suppressClick = true;
    if (axis === 'x' && Math.abs(dx) > 50) {
      show(index + (dx < 0 ? 1 : -1));
    } else if (axis === 'y' && dy > 0 && (dy > 140 || velocityY > 0.5)) {
      stage.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1)';
      stage.style.transform = `translateY(${stage.offsetHeight}px) scale(0.9)`;
      close();
      return;
    }
    stage.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
    stage.style.transform = '';
  };
  stage.addEventListener('pointerup', endGesture);
  stage.addEventListener('pointercancel', () => {
    gesture = null;
    stage.style.transition = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)';
    stage.style.transform = '';
  });
  window.addEventListener('pointerup', resume);

  stage.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.target.closest('[data-close]')) { close(); return; }
    const chip = e.target.closest('.w-year-chip');
    if (chip) {
      close();
      setTimeout(() => openWrapped(records, chip.dataset.year), 360);
      return;
    }
    const rect = stage.getBoundingClientRect();
    show(e.clientX - rect.left < rect.width * 0.3 ? index - 1 : index + 1);
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  show(0);
  frame = requestAnimationFrame(tick);
  stage.querySelector('.wrapped-close').focus();
  return true;
}
