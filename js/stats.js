// js/stats.js – výpočty nad záznamy tankování (bez DOM)
import { toISODate } from './utils.js?v=7.0';

const sum = (list, pick) => list.reduce((acc, item) => acc + Number(pick(item) || 0), 0);

// Spotřeba metodou „plná–plná“: mezi dvěma tankováními do plna se stavem tachometru
// sečteme všechny natankované litry (i částečná tankování mezi nimi) a vydělíme ujetou
// vzdáleností. Úseky s elektřinou nebo bez zadaných litrů přeskočíme.
export function consumptionSegments(records) {
  const byVehicle = new Map();
  records.forEach(r => {
    if (!r.vehicleId) return;
    if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, []);
    byVehicle.get(r.vehicleId).push(r);
  });

  const segments = [];
  byVehicle.forEach(list => {
    const sorted = [...list].sort((a, b) =>
      a.date.localeCompare(b.date) || (Number(a.odometer) || 0) - (Number(b.odometer) || 0) || a.id - b.id
    );

    let lastFull = null;
    sorted.forEach((r, i) => {
      const isFull = Number(r.fullTank) === 1;
      const odometer = r.odometer === null || r.odometer === undefined ? null : Number(r.odometer);
      if (!isFull) return;
      if (odometer === null) {
        lastFull = null; // bez tachometru nelze navázat, řetězec se přeruší
        return;
      }

      if (lastFull) {
        const between = sorted.slice(lastFull.index + 1, i + 1);
        const distance = odometer - lastFull.odometer;
        const valid = distance > 0
          && between.every(x => Number(x.litres) > 0 && x.fuelType !== 'Elektro');
        if (valid) {
          const litres = sum(between, x => x.litres);
          const amount = sum(between, x => x.amount);
          segments.push({
            vehicleId: r.vehicleId,
            vehicleName: r.vehicleName,
            vehicleColor: r.vehicleColor,
            date: r.date,
            distance,
            litres,
            amount,
            per100: (litres / distance) * 100,
            costPerKm: amount / distance
          });
        }
      }
      lastFull = { index: i, odometer };
    });
  });

  return segments.sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeSegments(segments) {
  const distance = sum(segments, s => s.distance);
  const litres = sum(segments, s => s.litres);
  const amount = sum(segments, s => s.amount);
  return {
    distance,
    per100: distance > 0 ? (litres / distance) * 100 : 0,
    costPerKm: distance > 0 ? amount / distance : 0,
    count: segments.length
  };
}

// Nejvyšší známý stav tachometru pro každé auto
export function lastOdometers(records) {
  const map = new Map();
  records.forEach(r => {
    if (!r.vehicleId || r.odometer === null || r.odometer === undefined) return;
    map.set(String(r.vehicleId), Math.max(map.get(String(r.vehicleId)) || 0, Number(r.odometer)));
  });
  return map;
}

// Odhad útraty na konec měsíce. Tankování je nárazové, proto tempo bereme
// z posledních tří celých měsíců; bez historie počítáme lineárně z dosavadní útraty.
export function forecastMonthEnd(records, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthPrefix = toISODate(now).substring(0, 7);

  const spent = sum(records.filter(r => r.date.startsWith(monthPrefix)), r => r.amount);

  const histFrom = toISODate(new Date(y, m - 3, 1));
  const histTo = toISODate(new Date(y, m, 0));
  const history = records.filter(r => r.date >= histFrom && r.date <= histTo);
  const histDays = Math.round((new Date(y, m, 1) - new Date(y, m - 3, 1)) / 86400000);

  const dailyRate = history.length >= 2 ? sum(history, r => r.amount) / histDays : spent / day;
  return {
    spent,
    forecast: spent + dailyRate * (daysInMonth - day),
    daysLeft: daysInMonth - day
  };
}
