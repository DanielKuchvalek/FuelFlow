// js/charts.js
import { safeColor } from './utils.js?v=7.0';

let timeSeriesChartInstance = null;
let doughnutChartInstance = null;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// První vykreslení se animuje naplno, změny filtru jen krátce – přepínají se často
function animDuration(isUpdate, full) {
  if (reduceMotion) return 0;
  return isUpdate ? 400 : full;
}

// Barvy z palety návrhu (Carbon, Lime, Turquoise, Lavender, Orchid, Candy Blue…)
const PALETTE_LIGHT = ['#171717', '#c6ff34', '#99e1d9', '#8b7fd6', '#e5bddf', '#b2d5e5', '#f5a524'];
const PALETTE_DARK = ['#c6ff34', '#99e1d9', '#d2c3f6', '#e5bddf', '#b2d5e5', '#f1fec8', '#8b7fd6'];
const FUEL_ORDER = ['Natural 95', 'Natural 98', 'Diesel', 'LPG', 'Elektro'];

function isDarkMode() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getTheme() {
  const dark = isDarkMode();
  return {
    dark,
    strong: cssVar('--chart-strong') || '#171717',
    grid: cssVar('--chart-grid'),
    text: cssVar('--chart-text'),
    fill: cssVar('--chart-fill'),
    tooltip: cssVar('--chart-tooltip') || '#171717',
    surface: cssVar('--surface') || '#ffffff',
    palette: dark ? PALETTE_DARK : PALETTE_LIGHT,
    hatchBase: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(23, 23, 23, 0.06)',
    hatchStripe: dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(23, 23, 23, 0.09)'
  };
}

function formatCzechPlural(count, one, few, many) {
  if (count === 1) return `${count} ${one}`;
  if (count >= 2 && count <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

const czk = (value) => `${Math.round(Number(value)).toLocaleString('cs-CZ')} Kč`;
const compact = (value) => (value >= 1000 ? `${(value / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}k` : `${value}`);

// Šrafovaný vzor pro méně důležité sloupce
function hatchPattern(base, stripe) {
  const size = 10;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = stripe;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, -size / 2);
  ctx.moveTo(size / 2, size * 1.5);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  return ctx.createPattern(canvas, 'repeat');
}

function tooltipStyle(theme) {
  return {
    backgroundColor: theme.tooltip,
    titleColor: 'rgba(255, 255, 255, 0.55)',
    bodyColor: '#ffffff',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    padding: { x: 14, y: 11 },
    cornerRadius: 14,
    caretSize: 6,
    displayColors: false,
    titleFont: { weight: 500, size: 12 },
    bodyFont: { weight: 600, size: 14 },
    titleMarginBottom: 4
  };
}

// Svislá přerušovaná čára pod aktivním bodem (jako u burzovních grafů)
const crosshairPlugin = {
  id: 'ffCrosshair',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'line') return;
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const { x, y } = active[0].element;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = getTheme().text;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  }
};

// Plovoucí štítek s hodnotou nad zvýrazněným (posledním) sloupcem
const barBadgePlugin = {
  id: 'ffBarBadge',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'bar') return;
    const meta = chart.getDatasetMeta(0);
    const index = meta.data.length - 1;
    const bar = meta.data[index];
    if (!bar || meta.data.length < 1) return;

    const theme = getTheme();
    const value = chart.data.datasets[0].data[index];
    const prev = chart.data.datasets[0].data[index - 1];
    const text = prev > 0 ? `${value >= prev ? '+' : ''}${Math.round(((value - prev) / prev) * 100)} %` : czk(value);

    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 11.5px ${cssVar('--font') || 'sans-serif'}`;
    const w = ctx.measureText(text).width + 18;
    const h = 24;
    const x = bar.x - w / 2;
    const y = Math.max(chart.chartArea.top - 6, bar.y - h - 10);

    ctx.fillStyle = theme.dark ? '#c6ff34' : '#171717';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bar.x - 5, y + h - 0.5);
    ctx.lineTo(bar.x + 5, y + h - 0.5);
    ctx.lineTo(bar.x, y + h + 5);
    ctx.fill();

    ctx.fillStyle = theme.dark ? '#171717' : '#c6ff34';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bar.x, y + h / 2 + 0.5);
    ctx.restore();
  }
};

// Výška překryvu se středovým textem podle skutečné plochy prstence (bez legendy)
const donutCenterPlugin = {
  id: 'ffDonutCenter',
  afterLayout(chart) {
    if (chart.config.type !== 'doughnut') return;
    const { top, bottom } = chart.chartArea;
    chart.canvas.parentNode.style.setProperty('--donut-center-h', `${top + bottom}px`);
  }
};

export function initCharts() {
  Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.register(crosshairPlugin, barBadgePlugin, donutCenterPlugin);
}

export function updateCharts(records, vehicles, chartMode = 'daily', donutMode = 'vehicle') {
  updateTimeSeries(records, chartMode);
  updateDonut(records, donutMode);
}

function monthLabel(key, withYear) {
  const [y, m] = key.split('-').map(Number);
  const month = new Date(y, m - 1, 1).toLocaleDateString('cs-CZ', { month: 'short' }).replace('.', '');
  return withYear ? `${month} ${String(y).slice(2)}` : month;
}

function dayLabel(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}.`;
}

function buildTimeSeries(records, mode, theme) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  if (mode === 'monthly') {
    const monthlyMap = {};
    sorted.forEach(r => {
      const key = r.date.substring(0, 7);
      monthlyMap[key] = (monthlyMap[key] || 0) + Number(r.amount);
    });
    const keys = Object.keys(monthlyMap);
    const multiYear = new Set(keys.map(k => k.slice(0, 4))).size > 1;
    const soft = hatchPattern(theme.hatchBase, theme.hatchStripe);

    return {
      type: 'bar',
      labels: keys.map(k => monthLabel(k, multiYear)),
      fullLabels: keys.map(k => monthLabel(k, true)),
      datasets: [{
        label: 'Měsíční útrata',
        data: keys.map(k => monthlyMap[k]),
        backgroundColor: keys.map((_, i) => (i === keys.length - 1 ? theme.strong : soft)),
        hoverBackgroundColor: keys.map((_, i) => (i === keys.length - 1 ? theme.strong : theme.dark ? 'rgba(198, 255, 52, 0.45)' : 'rgba(23, 23, 23, 0.22)')),
        borderRadius: 999,
        borderSkipped: false,
        barPercentage: 0.72,
        categoryPercentage: 0.86,
        maxBarThickness: 58
      }]
    };
  }

  const lineColor = theme.strong;
  return {
    type: 'line',
    labels: sorted.map(r => dayLabel(r.date)),
    fullLabels: sorted.map(r => `${dayLabel(r.date)} ${r.date.slice(0, 4)}${r.vehicleName ? ` · ${r.vehicleName}` : ''}`),
    datasets: [{
      label: 'Útrata',
      data: sorted.map(r => Number(r.amount)),
      borderColor: lineColor,
      borderWidth: 2.5,
      tension: 0.42,
      cubicInterpolationMode: 'monotone',
      fill: 'start',
      backgroundColor: (ctx) => {
        const { chart } = ctx;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return 'transparent';
        const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, theme.fill);
        gradient.addColorStop(1, 'rgba(198, 255, 52, 0)');
        return gradient;
      },
      pointRadius: sorted.length < 2 ? 5 : 0,
      pointBackgroundColor: lineColor,
      pointHoverRadius: 7,
      pointHoverBorderWidth: 3,
      pointHoverBorderColor: theme.surface,
      pointHoverBackgroundColor: sorted.map(r => (r.vehicleColor ? safeColor(r.vehicleColor) : lineColor))
    }]
  };
}

function timeSeriesOptions(theme, built, isUpdate = false) {
  const isBar = built.type === 'bar';
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: isBar ? 34 : 10 } },
    interaction: { mode: 'index', intersect: false },
    animation: {
      duration: animDuration(isUpdate, 900),
      easing: 'easeOutQuart',
      delay: (ctx) => (!isUpdate && !reduceMotion && isBar && ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 70 : 0)
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipStyle(theme),
        callbacks: {
          title: (items) => built.fullLabels[items[0].dataIndex],
          label: (context) => czk(context.raw)
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: theme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { weight: 500 } }
      },
      y: {
        beginAtZero: true,
        grace: '8%',
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: theme.text, padding: 10, maxTicksLimit: 6, callback: (val) => compact(val) }
      }
    }
  };
}

function updateTimeSeries(records, mode) {
  const canvas = document.getElementById('timeSeriesChart');
  if (!canvas) return;

  const theme = getTheme();
  const built = buildTimeSeries(records, mode, theme);

  // Změna typu grafu (čára ↔ sloupce) vyžaduje nový graf
  if (timeSeriesChartInstance && timeSeriesChartInstance.config.type !== built.type) {
    timeSeriesChartInstance.destroy();
    timeSeriesChartInstance = null;
  }

  if (!timeSeriesChartInstance) {
    timeSeriesChartInstance = new Chart(canvas, {
      type: built.type,
      data: { labels: built.labels, datasets: built.datasets },
      options: timeSeriesOptions(theme, built)
    });
    return;
  }

  timeSeriesChartInstance.data.labels = built.labels;
  timeSeriesChartInstance.data.datasets = built.datasets;
  timeSeriesChartInstance.options = timeSeriesOptions(theme, built, true);
  timeSeriesChartInstance.update();
}

function updateDonut(records, mode) {
  const canvas = document.getElementById('doughnutChart');
  if (!canvas) return;

  const theme = getTheme();
  const centerVal = document.getElementById('donutCenterValue');
  const centerLbl = document.getElementById('donutCenterLabel');
  const groups = {};

  if (mode === 'vehicle') {
    if (centerLbl) centerLbl.textContent = 'VOZIDLA';
    // Seskupujeme podle ID, aby se dvě auta se stejným názvem neslila do jednoho dílku
    records.forEach(r => {
      const key = r.vehicleName ? `v${r.vehicleId}` : 'none';
      if (!groups[key]) {
        groups[key] = {
          label: r.vehicleName || 'Bez vozidla',
          amount: 0,
          color: r.vehicleName ? safeColor(r.vehicleColor) : theme.dark ? '#3a3a3f' : '#d4d6ce'
        };
      }
      groups[key].amount += Number(r.amount);
    });
    if (centerVal) centerVal.textContent = formatCzechPlural(Object.keys(groups).length, 'auto', 'auta', 'aut');
  } else if (mode === 'fuel') {
    if (centerLbl) centerLbl.textContent = 'PALIVO';
    records.forEach(r => {
      const type = r.fuelType || 'Natural 95';
      if (!groups[type]) {
        const index = FUEL_ORDER.indexOf(type);
        groups[type] = { label: type, amount: 0, color: theme.palette[(index < 0 ? 5 : index) % theme.palette.length] };
      }
      groups[type].amount += Number(r.amount);
    });
    if (centerVal) centerVal.textContent = formatCzechPlural(Object.keys(groups).length, 'druh', 'druhy', 'druhů');
  } else {
    if (centerLbl) centerLbl.textContent = 'STANICE';
    let idx = 0;
    records.forEach(r => {
      const st = r.station || 'Nezadáno';
      if (!groups[st]) {
        groups[st] = { label: st, amount: 0, color: theme.palette[idx % theme.palette.length] };
        idx++;
      }
      groups[st].amount += Number(r.amount);
    });
    if (centerVal) centerVal.textContent = formatCzechPlural(Object.keys(groups).length, 'stanice', 'stanice', 'stanic');
  }

  const keys = Object.keys(groups);
  const isEmpty = keys.length === 0;
  const total = keys.reduce((acc, k) => acc + groups[k].amount, 0);

  const data = {
    labels: isEmpty ? ['Žádná data'] : keys.map(k => groups[k].label),
    datasets: [{
      data: isEmpty ? [1] : keys.map(k => groups[k].amount),
      backgroundColor: isEmpty ? [theme.dark ? '#242428' : '#eceee7'] : keys.map(k => groups[k].color),
      borderWidth: 0,
      spacing: keys.length > 1 ? 4 : 0,
      borderRadius: keys.length > 1 ? 10 : 0,
      hoverOffset: isEmpty ? 0 : 10
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '76%',
    layout: { padding: 8 },
    animation: { animateRotate: true, animateScale: true, duration: animDuration(Boolean(doughnutChartInstance), 1000), easing: 'easeOutQuart' },
    plugins: {
      legend: {
        display: !isEmpty,
        position: 'bottom',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 8,
          boxHeight: 8,
          padding: 14,
          color: theme.text,
          font: { weight: 500, size: 12.5 }
        }
      },
      tooltip: {
        ...tooltipStyle(theme),
        enabled: !isEmpty,
        callbacks: {
          title: (items) => items[0].label,
          label: (context) => `${czk(context.raw)} · ${total > 0 ? Math.round((context.raw / total) * 100) : 0} %`
        }
      }
    }
  };

  if (!doughnutChartInstance) {
    doughnutChartInstance = new Chart(canvas, { type: 'doughnut', data, options });
    return;
  }

  doughnutChartInstance.data = data;
  doughnutChartInstance.options = options;
  doughnutChartInstance.update();
}

// --- GRAF SPOTŘEBY (l/100 km po jednotlivých úsecích plná–plná) ---
let consumptionChartInstance = null;

export function updateConsumptionChart(segments) {
  const canvas = document.getElementById('consumptionChart');
  if (!canvas) return;

  const theme = getTheme();
  const avg = segments.length
    ? (segments.reduce((a, s) => a + s.litres, 0) / segments.reduce((a, s) => a + s.distance, 0)) * 100
    : 0;

  // Každé auto má vlastní čáru – jinak by se spojovaly body různých vozidel
  const dates = [...new Set(segments.map(s => s.date))].sort();
  const groups = new Map();
  segments.forEach(seg => {
    if (!groups.has(seg.vehicleId)) {
      groups.set(seg.vehicleId, { name: seg.vehicleName || 'Vozidlo', color: safeColor(seg.vehicleColor, theme.strong), byDate: new Map() });
    }
    groups.get(seg.vehicleId).byDate.set(seg.date, seg);
  });
  const single = groups.size <= 1;

  const vehicleDatasets = [...groups.values()].map(g => {
    const segs = dates.map(d => g.byDate.get(d) || null);
    return {
      label: g.name,
      segs,
      data: segs.map(seg => (seg ? Number(seg.per100.toFixed(2)) : null)),
      spanGaps: true,
      borderColor: single ? theme.strong : g.color,
      borderWidth: single ? 2.5 : 3,
      tension: 0.4,
      cubicInterpolationMode: 'monotone',
      fill: single ? 'start' : false,
      backgroundColor: (ctx) => {
        if (!single) return g.color;
        const { chart } = ctx;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return 'transparent';
        const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, theme.dark ? 'rgba(153, 225, 217, 0.35)' : 'rgba(153, 225, 217, 0.6)');
        gradient.addColorStop(1, 'rgba(153, 225, 217, 0)');
        return gradient;
      },
      pointRadius: 5,
      pointHoverRadius: 8,
      pointBorderWidth: 3,
      pointBorderColor: theme.surface,
      pointBackgroundColor: g.color
    };
  });

  const data = {
    labels: dates.map(dayLabel),
    datasets: [
      ...vehicleDatasets,
      {
        label: 'Průměr',
        data: dates.map(() => Number(avg.toFixed(2))),
        borderColor: theme.text,
        borderWidth: 1.5,
        borderDash: [6, 6],
        pointRadius: 0,
        pointHoverRadius: 0,
        pointStyle: 'line',
        fill: false
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: animDuration(Boolean(consumptionChartInstance), 900), easing: 'easeOutQuart' },
    plugins: {
      legend: {
        display: !single,
        position: 'bottom',
        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, color: theme.text, font: { weight: 500, size: 12.5 } }
      },
      tooltip: {
        ...tooltipStyle(theme),
        // Průměr i prázdná místa (auto v daný den netankovalo) v tooltipu vynecháme
        filter: (item) => Boolean(item.dataset.segs && item.dataset.segs[item.dataIndex]),
        callbacks: {
          title: (items) => (items.length ? `${dayLabel(dates[items[0].dataIndex])} ${dates[items[0].dataIndex].slice(0, 4)}` : ''),
          label: (context) => {
            const seg = context.dataset.segs[context.dataIndex];
            return `${single ? '' : `${context.dataset.label}: `}${seg.per100.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} l/100 km · ${Math.round(seg.distance).toLocaleString('cs-CZ')} km · ${seg.costPerKm.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč/km`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: theme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { weight: 500 } }
      },
      y: {
        grace: '15%',
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: theme.text, padding: 10, maxTicksLimit: 5, callback: (val) => `${Number(val).toLocaleString('cs-CZ')} l` }
      }
    }
  };

  if (!consumptionChartInstance) {
    consumptionChartInstance = new Chart(canvas, { type: 'line', data, options });
    return;
  }
  consumptionChartInstance.data = data;
  consumptionChartInstance.options = options;
  consumptionChartInstance.update();
}
