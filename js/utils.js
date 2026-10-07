// js/utils.js – drobné pomocné funkce bez závislosti na DOM

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Každý text od uživatele, který jde do innerHTML, musí projít touto funkcí
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// Barva se vkládá do atributu style, proto propustíme jen platný hex kód
export function safeColor(value, fallback = '#c6ff34') {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
}

// Datum ve tvaru YYYY-MM-DD podle místního času (toISOString() by vracel UTC,
// takže by se po půlnoci ukazoval včerejší den)
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function monthKey(date = new Date()) {
  return toISODate(date).substring(0, 7);
}

export function formatCzk(value) {
  return `${Number(value).toLocaleString('cs-CZ')} Kč`;
}

// Číslo z pole s desetinnou klávesnicí: „1 850,50“ → 1850.5, prázdné pole → NaN
export function parseDecimal(value) {
  const text = String(value ?? '').replace(/[\s ]/g, '').replace(',', '.');
  return text === '' ? NaN : Number(text);
}
