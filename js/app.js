// js/app.js
import {
  checkAuth, fetchRecords, addRecord, updateRecord, deleteRecord,
  fetchVehicles, addVehicle, deleteVehicle, updateMonthlyBudget, updateVehicleBudget,
  fetchReminders, addReminder, setReminderDone, deleteReminder, changePassword, deleteAccount
} from './api.js?v=7.0';

import { setupAuthUI } from './auth.js?v=7.0';
import { initCharts, updateCharts, updateConsumptionChart } from './charts.js?v=7.0';
import { consumptionSegments, summarizeSegments, lastOdometers, forecastMonthEnd } from './stats.js?v=7.0';
import { openWrapped } from './wrapped.js?v=7.0';
import { enhanceDateInput } from './datepicker.js?v=7.0';
import { escapeHtml, safeColor, toISODate, todayISO, monthKey, formatCzk, parseDecimal } from './utils.js?v=7.0';
import { showToast, confirmDialog, setupModalDismiss, withBusyButton, enhanceSelect, openModal, closeModal, animateOut, haptic } from './ui.js?v=7.0';
import { initEffects, startReveal, animateNumber } from './effects.js?v=7.0';

const DEFAULT_BUDGET = 5000;
const DEFAULT_VEHICLE_COLOR = '#c6ff34';

let allRecords = [];
let allVehicles = [];
let currentBudget = DEFAULT_BUDGET;
let currentFilterPeriod = 'all';
let currentVehicleFilter = 'all';
let currentChartMode = 'daily';
let currentDonutMode = 'vehicle';
let currentSearch = '';
let editingRecordId = null;
let allReminders = [];
let reminderAlertShown = false;

// Id položek, které právě přibyly nebo se změnily – jen ty se při nejbližším
// vykreslení zvýrazní. Při prvním načtení se nezvýrazňuje nic.
let dataLoaded = false;
const freshIds = { records: new Set(), vehicles: new Set(), reminders: new Set() };
let justToggledReminderId = null;

function markFresh(kind, prevList, nextList) {
  if (!dataLoaded) return;
  const known = new Set(prevList.map(item => String(item.id)));
  nextList.forEach(item => {
    if (!known.has(String(item.id))) freshIds[kind].add(String(item.id));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const dateInput = document.getElementById('dateInput');
  if (dateInput) {
    dateInput.value = todayISO();
  }

  try {
    initTheme();
    initCharts();
    setupModals();
    setupBudgetModal();
    setupPeriodFilters();
    setupChartControls();
    setupFuelForm();
    setupGarageForm();
    setupTableFilter();
    setupTableActions();
    setupGarageActions();
    setupFooterActions();

    setupAuthUI(
      (user) => handleLoginState(user),
      () => handleLogoutState()
    );
  } catch (err) {
    console.error('Chyba při inicializaci UI:', err);
  }

  // Efekty jsou čistě vizuální – jejich případná chyba nesmí rozbít aplikaci
  try {
    initEffects();
    enhanceSelect(document.getElementById('vehicleFilterSelect'));
    enhanceSelect(document.getElementById('modalVehicleSelect'), { requiredMessage: 'Vyberte vozidlo.' });
    enhanceSelect(document.getElementById('fuelType'));
    enhanceSelect(document.getElementById('reminderVehicle'));
    enhanceDateInput(document.getElementById('dateInput'), { max: 'today', requiredMessage: 'Vyberte datum tankování.' });
    enhanceDateInput(document.getElementById('reminderDate'), { clearable: true, placeholder: 'Bez data' });
  } catch (err) {
    console.error('Chyba při inicializaci efektů:', err);
  }

  // Doplňkové funkce mají vlastní try, aby jejich chyba nezablokovala přihlášení
  try {
    setupReminders();
    setupOdometerHint();
    setupWrapped();
    setupAccount();
    setupPrivacy();
  } catch (err) {
    console.error('Chyba při inicializaci doplňků:', err);
  }

  const startTime = Date.now();

  try {
    const authStatus = await checkAuth();
    if (authStatus && authStatus.authenticated) {
      await handleLoginState(authStatus.user);
    } else {
      handleLogoutState();
    }
  } catch (err) {
    console.error('Chyba při ověřování přihlášení:', err);
    handleLogoutState();
    showToast(err.message, 'error');
  } finally {
    const elapsed = Date.now() - startTime;
    // Úvodní kapka se stihne naplnit (0,7 s), ale uživatele nezdržuje déle, než je nutné
    const remainingTime = Math.max(150, 700 - elapsed);

    setTimeout(() => {
      const splash = document.getElementById('splashScreen');
      if (splash) {
        // Kapka se rozplyne, pak splash úplně odstraníme z vykreslování
        splash.classList.add('is-leaving');
        setTimeout(() => {
          splash.classList.add('hidden');
          syncThemeColor();
        }, 500);
      }
      startReveal();
    }, remainingTime);
  }
});

// Barva stavového řádku a lišty prohlížeče = barva horního okraje stránky.
// Úvodní animace i přihlášení jsou vždy tmavé.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const isVisible = (id) => {
    const el = document.getElementById(id);
    return Boolean(el) && !el.classList.contains('hidden');
  };
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  meta.content = isVisible('splashScreen') || isVisible('authPortal') || dark ? '#0b0b0d' : '#eef0ea';
}

// TMAVÝ / SVĚTLÝ REŽIM
function initTheme() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const moonIcon = document.getElementById('moonIcon');
  const sunIcon = document.getElementById('sunIcon');
  if (!themeToggleBtn) return;

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const storedTheme = () => {
    try {
      return localStorage.getItem('fuelflow_theme');
    } catch {
      return null; // localStorage může být v soukromém režimu zakázaný
    }
  };

  // Bez vlastní volby se motiv řídí nastavením systému
  const initial = storedTheme() || (systemDark.matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', initial);
  updateThemeIcons(initial);

  const applyTheme = (theme, persist) => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', theme);
      if (persist) {
        try {
          localStorage.setItem('fuelflow_theme', theme);
        } catch { /* viz výše */ }
      }
      updateThemeIcons(theme);
      syncThemeColor();
      renderAll();
    };
    // Celá stránka se krátce prolne místo skokové změny jasu
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) document.startViewTransition(apply);
    else apply();
  };

  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
  });

  systemDark.addEventListener('change', (e) => {
    if (!storedTheme()) applyTheme(e.matches ? 'dark' : 'light', false);
  });

  function updateThemeIcons(theme) {
    if (!moonIcon || !sunIcon) return;
    moonIcon.classList.toggle('hidden', theme === 'dark');
    sunIcon.classList.toggle('hidden', theme !== 'dark');
  }
}

async function handleLoginState(user) {
  const authPortal = document.getElementById('authPortal');
  const mainApp = document.getElementById('mainApp');
  const emailDisplay = document.getElementById('userEmailDisplay');
  const avatar = document.getElementById('userAvatar');

  if (authPortal) authPortal.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');
  syncThemeColor();
  if (emailDisplay && user.email) emailDisplay.textContent = user.email;
  if (avatar && user.email) avatar.textContent = user.email.charAt(0).toUpperCase();

  document.getElementById('adminLink')?.classList.toggle('hidden', !user.isAdmin);

  const welcomeName = document.getElementById('welcomeName');
  if (welcomeName && user.email) welcomeName.textContent = nameFromEmail(user.email);
  const todayLabel = document.getElementById('todayLabel');
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  currentBudget = Number(user.budget) > 0 ? Number(user.budget) : DEFAULT_BUDGET;

  await loadAllData();
}

// „jan.novak@firma.cz“ → „Jan“
function nameFromEmail(email) {
  const first = email.split('@')[0].split(/[._\-+]/)[0] || email;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function handleLogoutState() {
  allRecords = [];
  allVehicles = [];
  currentVehicleFilter = 'all';
  currentSearch = '';
  editingRecordId = null;
  allReminders = [];
  reminderAlertShown = false;
  dataLoaded = false;
  Object.values(freshIds).forEach(set => set.clear());

  const tableFilter = document.getElementById('tableFilter');
  if (tableFilter) tableFilter.value = '';
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('is-closing', 'is-dragged');
    m.classList.add('hidden');
  });

  const mainApp = document.getElementById('mainApp');
  const authPortal = document.getElementById('authPortal');
  if (mainApp) mainApp.classList.add('hidden');
  if (authPortal) authPortal.classList.remove('hidden');
  syncThemeColor();
}

// Společné ošetření chyby z API: vypršelá session vrátí uživatele na přihlášení
function handleApiError(err) {
  if (err.status === 401) {
    handleLogoutState();
    showToast('Přihlášení vypršelo. Přihlaste se prosím znovu.', 'error');
    return;
  }
  showToast(err.message, 'error');
}

async function loadAllData() {
  const started = performance.now();
  try {
    const [records, vehicles, reminders] = await Promise.all([
      fetchRecords(),
      fetchVehicles(),
      // Připomínky jsou doplněk – když selžou, zbytek aplikace se načte i tak
      fetchReminders().catch(err => {
        if (err.status === 401) throw err;
        console.warn('Připomínky se nepodařilo načíst:', err.message);
        return [];
      })
    ]);
    const nextRecords = Array.isArray(records) ? records : [];
    const nextVehicles = Array.isArray(vehicles) ? vehicles : [];
    const nextReminders = Array.isArray(reminders) ? reminders : [];
    markFresh('records', allRecords, nextRecords);
    markFresh('vehicles', allVehicles, nextVehicles);
    markFresh('reminders', allReminders, nextReminders);
    allRecords = nextRecords;
    allVehicles = nextVehicles;
    allReminders = nextReminders;
    dataLoaded = true;
    setServerStatus(true, Math.round(performance.now() - started));
  } catch (err) {
    setServerStatus(false);
    handleApiError(err);
    return;
  }

  populateVehicleSelects();
  renderGarageList();
  renderAll();
  announceUrgentReminders();
}

function setServerStatus(online, latencyMs) {
  const statusText = document.getElementById('serverStatusText');
  const ping = document.getElementById('dbPingBadge');
  const footer = document.querySelector('.status-indicator');

  if (statusText) statusText.textContent = online ? 'Online' : 'Offline';
  if (ping) ping.textContent = online ? `${latencyMs} ms` : '–';
  if (footer) footer.classList.toggle('is-offline', !online);
}

function populateVehicleSelects() {
  const modalSelect = document.getElementById('modalVehicleSelect');
  const filterSelect = document.getElementById('vehicleFilterSelect');
  if (!modalSelect || !filterSelect) return;

  const placeholder = new Option('Vyberte vozidlo', '');
  placeholder.dataset.placeholder = '1';
  modalSelect.replaceChildren(placeholder);
  filterSelect.replaceChildren(new Option('Všechna vozidla', 'all'));

  allVehicles.forEach(v => {
    const modalOption = new Option(v.plate ? `${v.name} · ${v.plate}` : v.name, v.id);
    modalOption.dataset.color = safeColor(v.color);
    modalSelect.append(modalOption);
    const filterOption = new Option(v.name, v.id);
    filterOption.dataset.color = safeColor(v.color);
    filterSelect.append(filterOption);
  });

  // Vybrané auto mohlo být mezitím smazáno
  if (!allVehicles.some(v => String(v.id) === currentVehicleFilter)) {
    currentVehicleFilter = 'all';
  }
  filterSelect.value = currentVehicleFilter;
}

function findVehicle(id) {
  return allVehicles.find(v => String(v.id) === String(id));
}

function getVehicleRecords() {
  if (currentVehicleFilter === 'all') return allRecords;
  return allRecords.filter(r => String(r.vehicleId) === currentVehicleFilter);
}

// Data jsou ve tvaru YYYY-MM-DD, takže je lze bezpečně porovnávat jako řetězce
function inCurrentPeriod(date) {
  const now = new Date();
  switch (currentFilterPeriod) {
    case 'month':
      return date.startsWith(monthKey(now));
    case 'year':
      return date.startsWith(String(now.getFullYear()));
    case '6m': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      return date >= toISODate(from);
    }
    default:
      return true;
  }
}

function getFilteredRecords() {
  return getVehicleRecords().filter(r => inCurrentPeriod(r.date));
}

function getSearchedRecords() {
  const records = getFilteredRecords();
  if (!currentSearch) return records;

  return records.filter(r =>
    [r.vehicleName, r.station, r.note, r.fuelType, r.date]
      .some(field => field && String(field).toLowerCase().includes(currentSearch))
  );
}

function sumAmount(records) {
  return records.reduce((acc, r) => acc + Number(r.amount), 0);
}

function renderKPIs() {
  const periodRecords = getFilteredRecords();
  // Měsíční a týdenní souhrn nezávisí na zvoleném období, jen na vybraném autě
  const vehicleRecords = getVehicleRecords();

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  animateNumber(document.getElementById('kpiTotal'), sumAmount(periodRecords));

  const thisMonth = monthKey();
  const prevMonthDate = new Date();
  prevMonthDate.setDate(1);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevMonth = monthKey(prevMonthDate);

  animateNumber(document.getElementById('kpiMonth'), sumAmount(vehicleRecords.filter(r => r.date.startsWith(thisMonth))));
  setText('kpiMonthSub', `Minulý měsíc: ${formatCzk(sumAmount(vehicleRecords.filter(r => r.date.startsWith(prevMonth))))}`);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekFrom = toISODate(weekStart);
  const today = todayISO();
  const weekRecords = vehicleRecords.filter(r => r.date >= weekFrom && r.date <= today);

  animateNumber(document.getElementById('kpiWeek'), sumAmount(weekRecords));
  setText('kpiWeekCount', `${weekRecords.length} tankování`);

  const litreRecords = periodRecords.filter(r => Number(r.litres) > 0);
  const sumLitres = litreRecords.reduce((acc, r) => acc + Number(r.litres), 0);

  animateNumber(document.getElementById('kpiAvgPrice'), sumLitres > 0 ? sumAmount(litreRecords) / sumLitres : 0, { decimals: 1 });
  animateNumber(document.getElementById('kpiTotalLitres'), sumLitres, { decimals: 1 });
  setText('kpiLitreRecordsCount', `${litreRecords.length} záznamů`);
}

function renderBudget() {
  const title = document.getElementById('budgetWidgetTitle');
  const subtitle = document.getElementById('budgetWidgetSubtitle');
  const spentVal = document.getElementById('budgetSpentVal');
  const totalVal = document.getElementById('budgetTotalVal');
  const badge = document.getElementById('budgetPercentBadge');
  const bar = document.getElementById('budgetProgressBar');
  const remainingTxt = document.getElementById('budgetRemainingTxt');
  const tip = document.getElementById('budgetStatusTip');

  if (!spentVal || !totalVal || !badge || !bar) return;

  let effectiveBudget = currentBudget;

  if (currentVehicleFilter === 'all') {
    if (title) title.textContent = 'Měsíční rozpočet: Celý vozový park';
    if (subtitle) subtitle.textContent = 'Souhrnný limit za všechna auta dohromady pro aktuální měsíc';
  } else {
    const selectedVeh = findVehicle(currentVehicleFilter);
    const vehName = selectedVeh ? selectedVeh.name : 'Vozidlo';
    if (selectedVeh && Number(selectedVeh.budget) > 0) effectiveBudget = Number(selectedVeh.budget);

    if (title) title.textContent = `Měsíční rozpočet: ${vehName}`;
    if (subtitle) subtitle.textContent = `Samostatný limit určený výhradně pro vůz ${vehName}`;
  }

  const thisMonth = monthKey();
  const spentThisMonth = sumAmount(getVehicleRecords().filter(r => r.date.startsWith(thisMonth)));
  const realPercent = effectiveBudget > 0 ? Math.round((spentThisMonth / effectiveBudget) * 100) : 0;

  spentVal.textContent = formatCzk(spentThisMonth);
  totalVal.textContent = formatCzk(effectiveBudget);
  badge.textContent = `${realPercent} %`;
  bar.style.width = `${Math.min(realPercent, 100)}%`;

  bar.className = 'budget-progress-bar';
  badge.className = 'budget-percent-badge';
  if (remainingTxt) remainingTxt.classList.remove('budget-over-text');

  if (realPercent >= 100) {
    bar.classList.add('status-danger');
    badge.classList.add('status-danger');
    if (remainingTxt) {
      remainingTxt.textContent = `Překročeno o ${formatCzk(spentThisMonth - effectiveBudget)}!`;
      remainingTxt.classList.add('budget-over-text');
    }
    if (tip) tip.textContent = 'Měsíční limit byl překročen';
  } else {
    if (realPercent >= 75) {
      bar.classList.add('status-warning');
      badge.classList.add('status-warning');
    }
    if (remainingTxt) remainingTxt.textContent = `Zbývá: ${formatCzk(effectiveBudget - spentThisMonth)}`;
    if (tip) tip.textContent = realPercent >= 75 ? 'Pozor, blížíte se k limitu' : 'Čerpání je pod kontrolou';
  }

  renderForecast(effectiveBudget);
}

// Odhad útraty na konec měsíce + průhledný „stín“ v pruhu rozpočtu
function renderForecast(budget) {
  const txt = document.getElementById('budgetForecastTxt');
  const bar = document.getElementById('budgetForecastBar');
  if (!txt || !bar) return;

  const { forecast, daysLeft } = forecastMonthEnd(getVehicleRecords());
  if (forecast <= 0 || daysLeft === 0 || !(budget > 0)) {
    txt.textContent = '';
    bar.style.width = '0%';
    return;
  }

  const rounded = Math.round(forecast / 10) * 10;
  const diff = Math.round(((forecast - budget) / budget) * 100);
  const isOver = forecast > budget;

  bar.style.width = `${Math.min(100, (forecast / budget) * 100)}%`;
  bar.classList.toggle('is-over', isOver);
  txt.classList.toggle('is-over', isOver);
  txt.textContent = isOver
    ? `Odhad na konec měsíce ~${formatCzk(rounded)} · o ${diff} % nad limitem`
    : `Odhad na konec měsíce ~${formatCzk(rounded)} · ${Math.abs(diff)} % pod limitem`;
}

// Vykreslení tabulky s elegantní lineární ikonou tužky
function renderTable() {
  const tbody = document.getElementById('recordsTableBody');
  if (!tbody) return;

  const records = getSearchedRecords();

  if (records.length === 0) {
    const emptyText = currentSearch ? 'Hledání neodpovídá žádný záznam.' : 'Žádné záznamy k zobrazení.';
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">${emptyText}</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const litres = Number(r.litres);
    const pricePerLitre = litres > 0
      ? `${(Number(r.amount) / litres).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kč/l`
      : '-';

    const color = safeColor(r.vehicleColor);
    const vehicleBadge = r.vehicleName
      ? `<span class="vehicle-pill-tag" style="--veh: ${color}">${escapeHtml(r.vehicleName)}</span>`
      : '<span class="text-muted">-</span>';

    return `
      <tr${freshIds.records.has(String(r.id)) ? ' class="is-new"' : ''}>
        <td><strong>${escapeHtml(r.date)}</strong>${r.odometer !== null && r.odometer !== undefined ? `<small class="cell-sub">${Number(r.odometer).toLocaleString('cs-CZ')} km</small>` : ''}</td>
        <td>${vehicleBadge}</td>
        <td><strong>${formatCzk(r.amount)}</strong></td>
        <td data-label="Objem">${litres > 0 ? `${litres.toLocaleString('cs-CZ')} l` : '-'}${Number(r.fullTank) === 1 ? '<span class="full-badge" title="Tankováno do plna">plná</span>' : ''}</td>
        <td data-label="Cena/litr">${pricePerLitre}</td>
        <td data-label="Palivo"><span class="badge-tag">${escapeHtml(r.fuelType || 'Natural 95')}</span></td>
        <td data-label="Stanice">${escapeHtml(r.station || '-')}</td>
        <td class="text-muted cell-note${r.note ? '' : ' is-empty'}">${escapeHtml(r.note || '')}</td>
        <td class="text-right">
          <div class="row-actions-group">
            <button class="btn-action-icon btn-edit-row" data-id="${Number(r.id)}" title="Upravit záznam" aria-label="Upravit záznam">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
              </svg>
            </button>
            <button class="btn-action-icon btn-delete-row" data-id="${Number(r.id)}" title="Smazat záznam" aria-label="Smazat záznam">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  freshIds.records.clear();
}

// Tlačítka v tabulce obsluhuje jeden delegovaný posluchač, ne nové při každém vykreslení
function setupTableActions() {
  const tbody = document.getElementById('recordsTableBody');
  if (!tbody) return;

  tbody.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.btn-edit-row');
    const deleteBtn = e.target.closest('.btn-delete-row');

    if (editBtn) {
      const rec = allRecords.find(r => String(r.id) === editBtn.dataset.id);
      if (rec) openFuelModalForEdit(rec);
      return;
    }

    if (deleteBtn) {
      const confirmed = await confirmDialog({
        title: 'Smazat tankování?',
        message: 'Záznam bude trvale odstraněn a tuto akci nelze vrátit.'
      });
      if (!confirmed) return;

      try {
        await deleteRecord(deleteBtn.dataset.id);
        haptic(10);
        await animateOut(deleteBtn.closest('tr'));
        showToast('Záznam byl smazán.');
        await loadAllData();
      } catch (err) {
        handleApiError(err);
      }
    }
  });
}

function setFuelModalMode(isEdit) {
  const modal = document.getElementById('fuelModal');
  const title = modal.querySelector('.modal-title h3');
  const subtitle = modal.querySelector('.modal-title p');
  const submitBtn = modal.querySelector('button[type="submit"]');

  if (title) title.textContent = isEdit ? 'Upravit tankování' : 'Nové tankování';
  if (subtitle) subtitle.textContent = isEdit ? 'Změňte údaje o tankování' : 'Zadejte podrobnosti o výdaji';
  if (submitBtn) submitBtn.textContent = isEdit ? 'Uložit změny' : 'Uložit tankování';
}

function openFuelModalForEdit(rec) {
  editingRecordId = rec.id;
  setFuelModalMode(true);

  document.getElementById('modalVehicleSelect').value = rec.vehicleId || '';
  document.getElementById('amountInput').value = rec.amount;
  document.getElementById('dateInput').value = rec.date;
  document.getElementById('litresInput').value = rec.litres || '';
  document.getElementById('fuelType').value = rec.fuelType || 'Natural 95';
  // Starší záznamy mohly mít jako prázdnou stanici uložený text „Nezadáno“
  document.getElementById('stationInput').value = rec.station === 'Nezadáno' ? '' : (rec.station || '');
  document.getElementById('noteInput').value = rec.note || '';
  document.getElementById('odometerInput').value = rec.odometer ?? '';
  document.getElementById('fullTankInput').checked = Number(rec.fullTank) === 1;
  updateOdometerHint();

  openModal(document.getElementById('fuelModal'));
}

function renderGarageList() {
  const container = document.getElementById('garageList');
  if (!container) return;

  if (allVehicles.length === 0) {
    container.innerHTML = '<p class="text-muted text-sm">Zatím nemáte přidané žádné auto.</p>';
    return;
  }

  container.innerHTML = allVehicles.map(v => `
    <div class="garage-item-card${freshIds.vehicles.has(String(v.id)) ? ' is-new' : ''}">
      <div class="garage-item-meta">
        <span class="color-circle" style="background: ${safeColor(v.color)}"></span>
        <span class="garage-item-name">${escapeHtml(v.name)}</span>
        ${v.plate ? `<span class="veh-badge-pill">${escapeHtml(v.plate)}</span>` : ''}
        <span class="veh-budget-pill">Limit: ${formatCzk(v.budget || DEFAULT_BUDGET)}</span>
      </div>
      <button class="delete-veh-btn" data-id="${Number(v.id)}" title="Smazat vozidlo" aria-label="Smazat vozidlo">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join('');
  freshIds.vehicles.clear();
}

function setupGarageActions() {
  const container = document.getElementById('garageList');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-veh-btn');
    if (!btn) return;

    const vehicle = findVehicle(btn.dataset.id);
    const confirmed = await confirmDialog({
      title: `Smazat vozidlo${vehicle ? ` „${vehicle.name}“` : ''}?`,
      message: 'Jeho tankování zůstanou zachována, jen u nich nebude uvedeno žádné vozidlo. Smažou se i jeho připomínky servisu.'
    });
    if (!confirmed) return;

    try {
      await deleteVehicle(btn.dataset.id);
      haptic(10);
      await animateOut(btn.closest('.garage-item-card'));
      showToast('Vozidlo bylo odstraněno.');
      await loadAllData();
    } catch (err) {
      handleApiError(err);
    }
  });
}

function renderAll() {
  renderKPIs();
  renderBudget();
  renderTable();
  updateCharts(getFilteredRecords(), allVehicles, currentChartMode, currentDonutMode);
  renderConsumption();
  renderReminders();
}

function setupModals() {
  const fuelModal = document.getElementById('fuelModal');
  const garageModal = document.getElementById('garageModal');
  const helpModal = document.getElementById('helpModal');

  const bind = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  };

  // Průvodce: Jak to funguje
  const closeHelp = () => closeModal(helpModal);
  bind('openHelpBtn', () => openModal(helpModal));
  bind('closeHelpBtn', closeHelp);
  bind('confirmHelpBtn', closeHelp);

  bind('openModalBtn', () => {
    editingRecordId = null;
    setFuelModalMode(false);
    document.getElementById('fuelForm').reset();
    document.getElementById('dateInput').value = todayISO();
    if (currentVehicleFilter !== 'all') {
      document.getElementById('modalVehicleSelect').value = currentVehicleFilter;
    }
    updateOdometerHint();
    openModal(fuelModal);
    document.getElementById('amountInput').focus();
  });

  const closeFuel = () => {
    closeModal(fuelModal);
    editingRecordId = null;
  };
  bind('closeModalBtn', closeFuel);
  bind('cancelModalBtn', closeFuel);

  bind('openGarageBtn', () => openModal(garageModal));
  bind('closeGarageBtn', () => closeModal(garageModal));

  setupModalDismiss();
}

function setupBudgetModal() {
  const modal = document.getElementById('budgetModal');
  const openBtn = document.getElementById('openBudgetModalBtn');
  const closeBtn = document.getElementById('closeBudgetModalBtn');
  const cancelBtn = document.getElementById('cancelBudgetModalBtn');
  const form = document.getElementById('budgetForm');
  const input = document.getElementById('budgetLimitInput');
  const desc = document.getElementById('budgetModalDesc');

  if (!modal || !openBtn || !form || !input) return;

  openBtn.addEventListener('click', () => {
    if (currentVehicleFilter === 'all') {
      input.value = currentBudget;
      if (desc) desc.textContent = 'Nastavení celkového měsíčního limitu pro celý vozový park';
    } else {
      const selectedVeh = findVehicle(currentVehicleFilter);
      input.value = selectedVeh && Number(selectedVeh.budget) > 0 ? Number(selectedVeh.budget) : currentBudget;
      if (desc) desc.textContent = `Nastavení měsíčního limitu pro auto: ${selectedVeh ? selectedVeh.name : ''}`;
    }
    openModal(modal);
    input.focus();
  });

  modal.querySelectorAll('.btn-quick-val').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.getAttribute('data-val');
    });
  });

  const close = () => closeModal(modal);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const newBudget = parseDecimal(input.value);
    if (!(newBudget > 0)) {
      showToast('Zadejte kladnou částku limitu.', 'error');
      return;
    }

    withBusyButton(form.querySelector('button[type="submit"]'), async () => {
      try {
        if (currentVehicleFilter === 'all') {
          await updateMonthlyBudget(newBudget);
          currentBudget = newBudget;
        } else {
          await updateVehicleBudget(currentVehicleFilter, newBudget);
          const veh = findVehicle(currentVehicleFilter);
          if (veh) veh.budget = newBudget;
          renderGarageList();
        }
        renderBudget();
        close();
        showToast('Měsíční limit byl uložen.');
      } catch (err) {
        handleApiError(err);
      }
    });
  });
}

function setupFuelForm() {
  const form = document.getElementById('fuelForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const vehicleValue = document.getElementById('modalVehicleSelect').value;
    const litresValue = document.getElementById('litresInput').value;
    const odometerValue = document.getElementById('odometerInput').value;
    const record = {
      vehicleId: vehicleValue ? Number(vehicleValue) : null,
      amount: parseDecimal(document.getElementById('amountInput').value),
      date: document.getElementById('dateInput').value,
      litres: litresValue.trim() ? parseDecimal(litresValue) : null,
      fuelType: document.getElementById('fuelType').value,
      station: document.getElementById('stationInput').value.trim(),
      note: document.getElementById('noteInput').value.trim(),
      odometer: odometerValue ? Number(odometerValue) : null,
      fullTank: document.getElementById('fullTankInput').checked
    };

    // Pole jsou textová (kvůli desetinné čárce), rozsah proto hlídáme sami
    if (!(record.amount > 0 && record.amount <= 1000000)) {
      showToast('Zadejte částku mezi 0,01 a 1 000 000 Kč.', 'error');
      return;
    }
    if (record.litres !== null && !(record.litres > 0 && record.litres <= 10000)) {
      showToast('Zadejte počet litrů mezi 0,01 a 10 000.', 'error');
      return;
    }

    withBusyButton(form.querySelector('button[type="submit"]'), async () => {
      try {
        const isEdit = editingRecordId !== null;
        if (isEdit) {
          await updateRecord(editingRecordId, record);
          freshIds.records.add(String(editingRecordId));
        } else {
          await addRecord(record);
          if (window.confetti) {
            window.confetti({ particleCount: 70, spread: 70, origin: { y: 0.8 }, colors: ['#c6ff34', '#99e1d9', '#d2c3f6', '#171717'], disableForReducedMotion: true });
          }
        }
        haptic(12);

        form.reset();
        editingRecordId = null;
        document.getElementById('dateInput').value = todayISO();
        closeModal(document.getElementById('fuelModal'));
        showToast(isEdit ? 'Změny byly uloženy.' : 'Tankování bylo uloženo.');
        await loadAllData();
      } catch (err) {
        handleApiError(err);
      }
    });
  });
}

function setupGarageForm() {
  const form = document.getElementById('vehicleForm');
  if (!form) return;

  const vehColor = document.getElementById('vehColor');
  const preview = document.getElementById('colorPreviewBox');
  const hexVal = document.getElementById('colorHexVal');
  const vehBudget = document.getElementById('vehBudget');

  const setColorPreview = (value) => {
    if (preview) preview.style.backgroundColor = value;
    if (hexVal) hexVal.textContent = value.toUpperCase();
  };

  if (vehColor) {
    vehColor.addEventListener('input', (e) => setColorPreview(e.target.value));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const vehicle = {
      name: document.getElementById('vehName').value.trim(),
      plate: document.getElementById('vehPlate').value.trim(),
      color: vehColor ? vehColor.value : DEFAULT_VEHICLE_COLOR,
      budget: parseDecimal(vehBudget.value) || DEFAULT_BUDGET
    };

    withBusyButton(form.querySelector('button[type="submit"]'), async () => {
      try {
        await addVehicle(vehicle);
        form.reset();
        if (vehColor) vehColor.value = DEFAULT_VEHICLE_COLOR;
        setColorPreview(DEFAULT_VEHICLE_COLOR);
        if (vehBudget) vehBudget.value = DEFAULT_BUDGET;
        showToast(`Vozidlo „${vehicle.name}“ bylo přidáno.`);
        await loadAllData();
      } catch (err) {
        handleApiError(err);
      }
    });
  });
}

function setupPeriodFilters() {
  document.querySelectorAll('.pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill-btn').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilterPeriod = pill.getAttribute('data-period');
      const label = document.getElementById('activePeriodLabel');
      if (label) label.textContent = pill.textContent;
      renderAll();
    });
  });

  const vehSelect = document.getElementById('vehicleFilterSelect');
  if (vehSelect) {
    vehSelect.addEventListener('change', (e) => {
      currentVehicleFilter = e.target.value;
      renderAll();
    });
  }
}

function setupChartControls() {
  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentChartMode = btn.getAttribute('data-chartmode');
      updateCharts(getFilteredRecords(), allVehicles, currentChartMode, currentDonutMode);
    });
  });

  document.querySelectorAll('.seg-donut').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-donut').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDonutMode = btn.getAttribute('data-donut');
      updateCharts(getFilteredRecords(), allVehicles, currentChartMode, currentDonutMode);
    });
  });
}

// Hledaný text se drží ve stavu, takže vydrží i překreslení po uložení nebo změně filtru
function setupTableFilter() {
  const filterInput = document.getElementById('tableFilter');
  if (!filterInput) return;

  filterInput.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim().toLowerCase();
    renderTable();
  });
}

function setupFooterActions() {
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const printPdfBtn = document.getElementById('printPdfBtn');

  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportToCsv);
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', exportToJson);
  if (printPdfBtn) printPdfBtn.addEventListener('click', prepareAndPrintReport);
}

// Text do CSV: zdvojení uvozovek a ochrana proti spuštění vzorce v Excelu (=, +, -, @)
function csvText(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportToCsv() {
  const records = getFilteredRecords();
  if (records.length === 0) {
    showToast('Žádná data k exportu.', 'info');
    return;
  }

  const headers = ['Datum', 'Vozidlo', 'Castka_Kc', 'Litry', 'Cena_za_litr_Kc', 'Palivo', 'Cerpaci_stanice', 'Poznamka', 'Tachometr_km', 'Plna_nadrz'];

  const rows = records.map(r => {
    const litres = Number(r.litres);
    return [
      csvText(r.date),
      csvText(r.vehicleName || 'Bez prirazeni'),
      Number(r.amount).toFixed(2),
      litres > 0 ? litres.toFixed(2) : '',
      litres > 0 ? (Number(r.amount) / litres).toFixed(2) : '',
      csvText(r.fuelType || 'Natural 95'),
      csvText(r.station),
      csvText(r.note),
      r.odometer ?? '',
      Number(r.fullTank) === 1 ? 'ano' : 'ne'
    ].join(';');
  });

  const csvContent = '﻿' + [headers.join(';'), ...rows].join('\r\n');
  downloadFile(csvContent, `fuelflow_export_${todayISO()}.csv`, 'text/csv;charset=utf-8;');
}

function exportToJson() {
  const records = getFilteredRecords();
  if (records.length === 0) {
    showToast('Žádná data k exportu.', 'info');
    return;
  }

  downloadFile(JSON.stringify(records, null, 2), `fuelflow_backup_${todayISO()}.json`, 'application/json');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function prepareAndPrintReport() {
  const records = getFilteredRecords();
  if (records.length === 0) {
    showToast('Pro aktuální výběr nejsou k dispozici žádná data k vytištění.', 'info');
    return;
  }

  const emailDisplay = document.getElementById('userEmailDisplay');
  const periodLabel = document.getElementById('activePeriodLabel');
  const vehicleFilter = document.getElementById('vehicleFilterSelect');

  const email = emailDisplay ? emailDisplay.textContent : '';
  const period = periodLabel ? periodLabel.textContent : 'Vše';
  const vehicleText = (vehicleFilter && vehicleFilter.selectedIndex >= 0)
    ? vehicleFilter.options[vehicleFilter.selectedIndex].text
    : 'Všechna vozidla';

  const printUserEmail = document.getElementById('printUserEmail');
  const printReportDate = document.getElementById('printReportDate');
  const printReportMeta = document.getElementById('printReportMeta');

  if (printUserEmail) printUserEmail.textContent = email;
  if (printReportDate) printReportDate.textContent = new Date().toLocaleDateString('cs-CZ');
  if (printReportMeta) printReportMeta.textContent = `Období: ${period} • Vozidlo: ${vehicleText}`;

  const litreRecords = records.filter(r => Number(r.litres) > 0);
  const totalLitres = litreRecords.reduce((acc, r) => acc + Number(r.litres), 0);
  const avgPrice = totalLitres > 0 ? (sumAmount(litreRecords) / totalLitres).toFixed(2) : '0.00';

  const kpiContainer = document.getElementById('printKpiSummary');
  if (kpiContainer) {
    kpiContainer.innerHTML = `
      <div class="print-kpi-pill">
        <span class="print-kpi-lbl">Celkové náklady</span>
        <span class="print-kpi-val">${formatCzk(sumAmount(records))}</span>
      </div>
      <div class="print-kpi-pill">
        <span class="print-kpi-lbl">Počet tankování</span>
        <span class="print-kpi-val">${records.length}</span>
      </div>
      <div class="print-kpi-pill">
        <span class="print-kpi-lbl">Objem paliva</span>
        <span class="print-kpi-val">${totalLitres.toFixed(1)} l</span>
      </div>
      <div class="print-kpi-pill">
        <span class="print-kpi-lbl">Průměrná cena</span>
        <span class="print-kpi-val">${avgPrice} Kč/l</span>
      </div>
    `;
  }

  // Tisk má obsahovat celý výběr, ne jen výsledky hledání v tabulce
  const searchBackup = currentSearch;
  currentSearch = '';
  renderTable();
  window.print();
  currentSearch = searchBackup;
  renderTable();
}

// --- SPOTŘEBA A NÁKLADY NA KM ---
function renderConsumption() {
  // Řetězce plná–plná počítáme z celé historie, filtry se použijí až na hotové úseky
  const segments = consumptionSegments(allRecords).filter(seg =>
    (currentVehicleFilter === 'all' || String(seg.vehicleId) === currentVehicleFilter) && inCurrentPeriod(seg.date)
  );
  const summary = summarizeSegments(segments);
  const hasData = segments.length > 0;

  const empty = document.getElementById('consumptionEmpty');
  if (empty) empty.classList.toggle('hidden', hasData);

  const setStat = (id, value, decimals) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!hasData) {
      el.textContent = '–';
      el.dataset.value = '0';
      return;
    }
    animateNumber(el, value, { decimals });
  };
  setStat('consPer100', summary.per100, 1);
  setStat('consCostKm', summary.costPerKm, 2);
  setStat('consDistance', summary.distance, 0);

  updateConsumptionChart(segments);
}

// Nápověda s posledním známým stavem tachometru vybraného auta
function updateOdometerHint() {
  const input = document.getElementById('odometerInput');
  const vehicleId = document.getElementById('modalVehicleSelect')?.value;
  if (!input) return;
  const last = vehicleId ? lastOdometers(allRecords).get(String(vehicleId)) : undefined;
  input.placeholder = last ? `naposledy ${last.toLocaleString('cs-CZ')} km` : 'např. 45230';
}

function setupOdometerHint() {
  document.getElementById('modalVehicleSelect')?.addEventListener('change', updateOdometerHint);
}

// --- PŘIPOMÍNKY SERVISU ---
const LEVEL_ORDER = { overdue: 0, soon: 1, ok: 2, done: 3 };

function pluralDays(n) {
  if (n === 1) return 'den';
  if (n >= 2 && n <= 4) return 'dny';
  return 'dní';
}

function formatDateCz(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

function reminderStatus(rem, odometers) {
  if (Number(rem.done) === 1) return { level: 'done', label: 'Hotovo' };

  let level = 'ok';
  const raise = (next) => { if (LEVEL_ORDER[next] < LEVEL_ORDER[level]) level = next; };
  const parts = [];

  if (rem.dueDate) {
    const days = Math.round((new Date(`${rem.dueDate}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 86400000);
    if (days < 0) {
      raise('overdue');
      parts.push(`${-days} ${pluralDays(-days)} po termínu`);
    } else {
      if (days <= 30) raise('soon');
      parts.push(days === 0 ? 'dnes' : days === 1 ? 'zítra' : `za ${days} ${pluralDays(days)}`);
    }
  }

  if (rem.dueKm !== null && rem.dueKm !== undefined) {
    const last = rem.vehicleId ? odometers.get(String(rem.vehicleId)) : undefined;
    if (last !== undefined) {
      const left = Number(rem.dueKm) - last;
      if (left < 0) {
        raise('overdue');
        parts.push(`${(-left).toLocaleString('cs-CZ')} km po termínu`);
      } else {
        if (left <= 1000) raise('soon');
        parts.push(`za ${left.toLocaleString('cs-CZ')} km`);
      }
    } else {
      parts.push(`při ${Number(rem.dueKm).toLocaleString('cs-CZ')} km`);
    }
  }

  return { level, label: parts.join(' · ') };
}

function getVisibleReminders() {
  const odometers = lastOdometers(allRecords);
  return allReminders
    .filter(r => currentVehicleFilter === 'all' || !r.vehicleId || String(r.vehicleId) === currentVehicleFilter)
    .map(r => ({ ...r, status: reminderStatus(r, odometers) }))
    .sort((a, b) =>
      LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level]
      || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
    );
}

function renderReminders() {
  const list = document.getElementById('reminderList');
  if (!list) return;

  const items = getVisibleReminders();
  updateServiceNavBadge();

  if (!items.length) {
    list.innerHTML = `
      <div class="reminder-empty">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <strong>Žádné připomínky</strong>
        <p>Přidejte si termín STK, výměny oleje nebo konec dálniční známky.</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(r => `
    <div class="reminder-item is-${r.status.level}${freshIds.reminders.has(String(r.id)) ? ' is-new' : ''}${String(r.id) === justToggledReminderId ? ' just-toggled' : ''}">
      <button type="button" class="reminder-check" data-id="${Number(r.id)}" data-done="${Number(r.done) === 1 ? 1 : 0}"
        aria-label="${Number(r.done) === 1 ? 'Vrátit mezi aktivní' : 'Označit jako hotové'}" title="${Number(r.done) === 1 ? 'Vrátit mezi aktivní' : 'Označit jako hotové'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </button>
      <div class="reminder-main">
        <strong class="reminder-title">${escapeHtml(r.title)}</strong>
        <div class="reminder-meta">
          ${r.vehicleName ? `<span class="vehicle-pill-tag" style="--veh: ${safeColor(r.vehicleColor)}">${escapeHtml(r.vehicleName)}</span>` : ''}
          ${r.dueDate ? `<span>${formatDateCz(r.dueDate)}</span>` : ''}
          ${r.dueKm !== null && r.dueKm !== undefined ? `<span>${Number(r.dueKm).toLocaleString('cs-CZ')} km</span>` : ''}
        </div>
      </div>
      <span class="reminder-status">${escapeHtml(r.status.label)}</span>
      <button type="button" class="reminder-delete" data-id="${Number(r.id)}" aria-label="Smazat připomínku" title="Smazat připomínku">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `).join('');
  freshIds.reminders.clear();
  justToggledReminderId = null;
}

// Počet naléhavých připomínek jako odznak u položky „Servis“ v navigaci
function updateServiceNavBadge() {
  const link = document.querySelector('.nav-link[data-section="sec-service"]');
  if (!link) return;
  const urgent = getVisibleReminders().filter(r => r.status.level === 'overdue' || r.status.level === 'soon').length;
  if (urgent) link.dataset.alert = String(urgent);
  else delete link.dataset.alert;
}

function announceUrgentReminders() {
  if (reminderAlertShown) return;
  reminderAlertShown = true;
  const odometers = lastOdometers(allRecords);
  const urgent = allReminders.map(r => reminderStatus(r, odometers)).filter(st => st.level === 'overdue' || st.level === 'soon');
  if (!urgent.length) return;
  const overdue = urgent.filter(st => st.level === 'overdue').length;
  const text = overdue
    ? `Servis: ${overdue} ${overdue === 1 ? 'termín je' : 'termíny jsou'} po splatnosti.`
    : `Servis: blíží se ${urgent.length} ${urgent.length === 1 ? 'termín' : 'termíny'}.`;
  setTimeout(() => showToast(text, overdue ? 'error' : 'info'), 1200);
}

async function reloadReminders() {
  try {
    const next = await fetchReminders();
    markFresh('reminders', allReminders, next);
    allReminders = next;
  } catch (err) {
    handleApiError(err);
  }
  renderReminders();
}

function setupReminders() {
  const modal = document.getElementById('reminderModal');
  const form = document.getElementById('reminderForm');
  const list = document.getElementById('reminderList');
  const titleInput = document.getElementById('reminderTitle');
  const vehicleSelect = document.getElementById('reminderVehicle');
  if (!modal || !form || !list) return;

  const close = () => closeModal(modal);

  document.getElementById('openReminderBtn')?.addEventListener('click', () => {
    form.reset();
    vehicleSelect.replaceChildren(
      new Option('Bez konkrétního vozidla', ''),
      ...allVehicles.map(v => {
        const option = new Option(v.name, v.id);
        option.dataset.color = safeColor(v.color);
        return option;
      })
    );
    if (currentVehicleFilter !== 'all') vehicleSelect.value = currentVehicleFilter;
    openModal(modal);
    titleInput.focus();
  });
  document.getElementById('closeReminderBtn')?.addEventListener('click', close);
  document.getElementById('cancelReminderBtn')?.addEventListener('click', close);

  document.getElementById('reminderPresets')?.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-title]');
    if (preset) titleInput.value = preset.dataset.title;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      title: titleInput.value.trim(),
      vehicleId: vehicleSelect.value ? Number(vehicleSelect.value) : null,
      dueDate: document.getElementById('reminderDate').value || null,
      dueKm: document.getElementById('reminderKm').value ? Number(document.getElementById('reminderKm').value) : null
    };
    if (!data.dueDate && data.dueKm === null) {
      showToast('Zadejte termín – datum, kilometry, nebo obojí.', 'error');
      return;
    }

    withBusyButton(form.querySelector('button[type="submit"]'), async () => {
      try {
        await addReminder(data);
        close();
        showToast('Připomínka byla uložena.');
        await reloadReminders();
      } catch (err) {
        handleApiError(err);
      }
    });
  });

  list.addEventListener('click', async (e) => {
    const check = e.target.closest('.reminder-check');
    const del = e.target.closest('.reminder-delete');

    if (check) {
      const done = check.dataset.done !== '1';
      try {
        await setReminderDone(check.dataset.id, done);
        if (done) {
          haptic(10);
          showToast('Připomínka splněna.');
        }
        justToggledReminderId = check.dataset.id;
        await reloadReminders();
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (del) {
      const confirmed = await confirmDialog({ title: 'Smazat připomínku?', message: 'Připomínka bude trvale odstraněna.' });
      if (!confirmed) return;
      try {
        await deleteReminder(del.dataset.id);
        haptic(10);
        await animateOut(del.closest('.reminder-item'));
        showToast('Připomínka byla smazána.');
        await reloadReminders();
      } catch (err) {
        handleApiError(err);
      }
    }
  });
}

// --- ROČNÍ SHRNUTÍ ---
function setupWrapped() {
  document.getElementById('openWrappedBtn')?.addEventListener('click', () => {
    if (!openWrapped(allRecords)) {
      showToast('Zatím nejsou žádná tankování ke shrnutí.', 'info');
    }
  });
}

// --- MŮJ ÚČET ---
function setupAccount() {
  const modal = document.getElementById('accountModal');
  const passwordForm = document.getElementById('passwordForm');
  const deleteForm = document.getElementById('deleteAccountForm');
  if (!modal || !passwordForm || !deleteForm) return;

  const close = () => closeModal(modal);

  document.getElementById('openAccountBtn')?.addEventListener('click', () => {
    const email = document.getElementById('userEmailDisplay')?.textContent || '';
    document.getElementById('accountEmail').textContent = email;
    document.getElementById('accountAvatar').textContent = email.charAt(0).toUpperCase() || 'U';
    passwordForm.reset();
    deleteForm.reset();
    openModal(modal);
  });
  document.getElementById('closeAccountBtn')?.addEventListener('click', close);

  passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const current = document.getElementById('currentPassword').value;
    const next = document.getElementById('newPassword').value;
    if (next.length < 6) {
      showToast('Nové heslo musí mít minimálně 6 znaků.', 'error');
      return;
    }
    withBusyButton(passwordForm.querySelector('button[type="submit"]'), async () => {
      try {
        await changePassword(current, next);
        passwordForm.reset();
        showToast('Heslo bylo změněno.');
      } catch (err) {
        handleApiError(err);
      }
    });
  });

  // Kompletní záloha všech dat účtu (právo na přenositelnost údajů)
  document.getElementById('accountExportBtn')?.addEventListener('click', () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      account: document.getElementById('userEmailDisplay')?.textContent || '',
      vehicles: allVehicles,
      records: allRecords,
      reminders: allReminders
    };
    downloadFile(JSON.stringify(backup, null, 2), `fuelflow_vsechna_data_${todayISO()}.json`, 'application/json');
    showToast('Záloha byla stažena.');
  });

  deleteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('deleteAccountPassword').value;
    withBusyButton(deleteForm.querySelector('button[type="submit"]'), async () => {
      const confirmed = await confirmDialog({
        title: 'Opravdu smazat účet?',
        message: 'Účet a všechna vaše data budou trvale odstraněna. Tuto akci nelze vrátit.',
        confirmText: 'Smazat účet'
      });
      if (!confirmed) return;
      try {
        await deleteAccount(password);
        handleLogoutState();
        showToast('Účet byl smazán. Díky, že jste Fuel Flow používali.');
      } catch (err) {
        handleApiError(err);
      }
    });
  });
}

// --- SOUKROMÍ A COOKIES ---
function setupPrivacy() {
  const modal = document.getElementById('privacyModal');
  if (!modal) return;
  const close = () => closeModal(modal);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-privacy]')) openModal(modal);
  });
  document.getElementById('closePrivacyBtn')?.addEventListener('click', close);
  document.getElementById('confirmPrivacyBtn')?.addEventListener('click', close);
}
