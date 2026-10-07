// admin/admin.js – administrace uživatelů Fuel Flow
import { request } from '../js/api.js?v=7.0';
import { showToast, confirmDialog, setupModalDismiss, withBusyButton, enhanceSelect } from '../js/ui.js?v=7.0';
import { initEffects, animateNumber } from '../js/effects.js?v=7.0';
import { escapeHtml, safeColor, formatCzk } from '../js/utils.js?v=7.0';

const API = '../api/admin.php';
const VIEW_TITLES = { overview: 'Přehled', users: 'Uživatelé', audit: 'Audit log' };
const AUDIT_LABELS = {
  update_user: 'Úprava účtu',
  delete_user: 'Smazání účtu',
  reset_password: 'Nové heslo'
};

let me = null;
let chart = null;
let currentView = 'overview';
let openUserId = null;
const userQuery = { q: '', role: 'all', sort: 'created', dir: 'desc', page: 1 };

// --- POMOCNÉ FUNKCE ---
const $ = (id) => document.getElementById(id);

function formatDate(value, withTime = false) {
  if (!value) return '–';
  const date = new Date(value.replace(' ', 'T'));
  return withTime
    ? date.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('cs-CZ');
}

// „před 3 dny“, „právě teď“…
function timeAgo(value) {
  if (!value) return 'nikdy';
  const diff = (Date.now() - new Date(value.replace(' ', 'T')).getTime()) / 1000;
  if (diff < 60) return 'právě teď';
  const units = [[31536000, 'rokem', 'lety'], [2592000, 'měsícem', 'měsíci'], [86400, 'dnem', 'dny'], [3600, 'hodinou', 'hodinami'], [60, 'minutou', 'minutami']];
  for (const [seconds, one, many] of units) {
    const n = Math.floor(diff / seconds);
    if (n >= 1) return n === 1 ? `před ${one}` : `před ${n} ${many}`;
  }
  return 'právě teď';
}

function initial(email) {
  return (email || '?').charAt(0).toUpperCase();
}

function handleError(err) {
  if (err.status === 401 || err.status === 403) {
    showLogin(err.status === 403 ? err.message : 'Přihlášení vypršelo. Přihlaste se prosím znovu.');
    return;
  }
  showToast(err.message, 'error');
}

// --- PŘIHLÁŠENÍ ---
function showLogin(message) {
  $('adminApp').classList.add('hidden');
  $('adminLogin').classList.remove('hidden');
  const alert = $('adminLoginAlert');
  alert.classList.toggle('hidden', !message);
  alert.textContent = message || '';
}

async function enterAdmin() {
  me = await request(`${API}?action=me`);
  $('adminLogin').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  $('adminEmail').textContent = me.email;
  $('adminAvatar').textContent = initial(me.email);
  $('adminDate').textContent = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
  showView(currentView);
}

function setupLogin() {
  const form = $('adminLoginForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusyButton(form.querySelector('button[type="submit"]'), async () => {
      try {
        await request('../api/auth.php?action=login', {
          method: 'POST',
          body: { email: $('adminEmailInput').value.trim(), password: $('adminPasswordInput').value }
        });
        form.reset();
        await enterAdmin();
      } catch (err) {
        showLogin(err.message);
      }
    });
  });

  $('adminLogoutBtn').addEventListener('click', async () => {
    try {
      await request('../api/auth.php?action=logout', { method: 'POST' });
    } catch { /* odhlásíme i při chybě serveru */ }
    showLogin('');
  });
}

// --- TÉMA ---
function setupTheme() {
  const update = (theme) => {
    $('moonIcon').classList.toggle('hidden', theme === 'dark');
    $('sunIcon').classList.toggle('hidden', theme !== 'dark');
  };
  update(document.documentElement.getAttribute('data-theme'));
  $('themeToggleBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('fuelflow_theme', next); } catch { /* bez úložiště */ }
      update(next);
      if (currentView === 'overview') loadOverview();
    };
    // Krátké prolnutí místo skokové změny jasu
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) document.startViewTransition(apply);
    else apply();
  });
}

// --- NAVIGACE MEZI POHLEDY ---
function showView(view) {
  currentView = view;
  document.querySelectorAll('.admin-nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.admin-view').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== view));
  $('adminTitle').textContent = VIEW_TITLES[view];
  if (view === 'overview') loadOverview();
  if (view === 'users') loadUsers();
  if (view === 'audit') loadAudit();
}

function setupNav() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-view], [data-goto]');
    if (target) showView(target.dataset.view || target.dataset.goto);
  });
}

// --- PŘEHLED ---
function renderAudit(container, items) {
  if (!items.length) {
    container.innerHTML = '<p class="audit-empty">Zatím žádné akce.</p>';
    return;
  }
  container.innerHTML = items.map(a => `
    <div class="audit-item audit-${escapeHtml(a.action)}">
      <span class="audit-dot"></span>
      <div class="audit-main">
        <strong>${escapeHtml(AUDIT_LABELS[a.action] || a.action)}</strong>
        <span>${escapeHtml(a.targetEmail || '')}${a.detail ? ` · ${escapeHtml(a.detail)}` : ''}</span>
      </div>
      <div class="audit-meta">
        <span>${escapeHtml(a.adminEmail || 'smazaný admin')}</span>
        <time title="${escapeHtml(formatDate(a.createdAt, true))}">${escapeHtml(timeAgo(a.createdAt))}</time>
      </div>
    </div>`).join('');
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function renderChart(months) {
  const canvas = $('adminChart');
  const strong = cssVar('--chart-strong');
  const text = cssVar('--chart-text');
  const grid = cssVar('--chart-grid');
  const labels = months.map(m => {
    const [y, mo] = m.month.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString('cs-CZ', { month: 'short' }).replace('.', '');
  });

  const data = {
    labels,
    datasets: [
      {
        type: 'bar',
        label: 'Tankování',
        data: months.map(m => m.refuels),
        backgroundColor: months.map((_, i) => (i === months.length - 1 ? strong : cssVar('--chart-soft'))),
        borderRadius: 999,
        borderSkipped: false,
        barPercentage: 0.6,
        yAxisID: 'y'
      },
      {
        type: 'line',
        label: 'Nové registrace',
        data: months.map(m => m.signups),
        borderColor: '#99e1d9',
        backgroundColor: '#99e1d9',
        borderWidth: 3,
        tension: 0.4,
        pointRadius: 4,
        pointBorderWidth: 2,
        pointBorderColor: cssVar('--surface'),
        yAxisID: 'y1'
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16, color: text, font: { family: "'Outfit', sans-serif", weight: 500 } } },
      tooltip: {
        backgroundColor: cssVar('--chart-tooltip') || '#171717',
        padding: 12,
        cornerRadius: 14,
        titleFont: { family: "'Outfit', sans-serif" },
        bodyFont: { family: "'Outfit', sans-serif", weight: 600 }
      }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: text, font: { family: "'Outfit', sans-serif" } } },
      y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, precision: 0 } },
      y1: { beginAtZero: true, position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: '#5fb8ae', precision: 0 } }
    }
  };

  if (chart) chart.destroy();
  chart = new Chart(canvas, { type: 'bar', data, options });
}

async function loadOverview() {
  try {
    const { totals, months, audit } = await request(`${API}?action=stats`);
    animateNumber($('stUsers'), Number(totals.users));
    animateNumber($('stActive'), Number(totals.activeUsers30));
    animateNumber($('stRecords'), Number(totals.records));
    animateNumber($('stAmount'), Math.round(Number(totals.totalAmount)));
    $('stUsersSub').textContent = `${totals.newUsers30} nových za 30 dní`;
    $('stAdmins').textContent = `${totals.admins} ${Number(totals.admins) === 1 ? 'administrátor' : 'administrátorů'}`;
    $('stVehicles').textContent = `${totals.vehicles} vozidel · ${totals.openReminders} otevřených připomínek`;
    $('stLitres').textContent = `${Math.round(Number(totals.totalLitres)).toLocaleString('cs-CZ')} l paliva`;
    renderChart(months);
    renderAudit($('auditMini'), audit.slice(0, 6));
  } catch (err) {
    handleError(err);
  }
}

// --- UŽIVATELÉ ---
async function loadUsers() {
  const list = $('userList');
  const params = new URLSearchParams({ action: 'users', ...userQuery });
  try {
    const { users, total, page, pages } = await request(`${API}?${params}`);
    if (!users.length) {
      list.innerHTML = '<p class="audit-empty">Žádný uživatel neodpovídá hledání.</p>';
    } else {
      list.innerHTML = users.map(u => `
        <button type="button" class="user-row" data-user="${Number(u.id)}">
          <span class="user-cell-main">
            <span class="user-circle">${escapeHtml(initial(u.email))}</span>
            <span class="user-cell-text">
              <strong>${escapeHtml(u.email)}</strong>
              <span class="user-badges">
                ${Number(u.isAdmin) === 1 ? '<span class="role-badge is-admin">Admin</span>' : '<span class="role-badge">Uživatel</span>'}
                ${Number(u.id) === me?.id ? '<span class="role-badge is-you">To jste vy</span>' : ''}
              </span>
            </span>
          </span>
          <span class="user-cell" data-label="Registrace">${escapeHtml(formatDate(u.createdAt))}</span>
          <span class="user-cell" data-label="Přihlášení">${escapeHtml(timeAgo(u.lastLoginAt))}</span>
          <span class="user-cell" data-label="Auta">${Number(u.vehicles)}</span>
          <span class="user-cell" data-label="Tankování">${Number(u.records)}</span>
          <span class="user-cell user-amount" data-label="Útrata">${formatCzk(Math.round(Number(u.totalAmount)))}</span>
          <span class="user-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>
        </button>`).join('');
    }
    renderPagination(page, pages, total);
  } catch (err) {
    handleError(err);
  }
}

function renderPagination(page, pages, total) {
  const container = $('userPagination');
  const buttons = [];
  for (let p = 1; p <= pages; p++) {
    if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - page) > 1) {
      if (buttons[buttons.length - 1] !== '…') buttons.push('…');
      continue;
    }
    buttons.push(p);
  }
  container.innerHTML = `
    <span class="pagination-info">${total} ${total === 1 ? 'uživatel' : total >= 2 && total <= 4 ? 'uživatelé' : 'uživatelů'}</span>
    <div class="pagination-pages">
      ${buttons.map(b => (b === '…'
        ? '<span class="page-gap">…</span>'
        : `<button type="button" class="page-btn${b === page ? ' active' : ''}" data-page="${b}">${b}</button>`)).join('')}
    </div>`;
}

function setupUsers() {
  let debounce = 0;
  $('userSearch').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      userQuery.q = e.target.value.trim();
      userQuery.page = 1;
      loadUsers();
    }, 250);
  });

  $('roleFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    document.querySelectorAll('#roleFilter [data-role]').forEach(b => b.classList.toggle('active', b === btn));
    userQuery.role = btn.dataset.role;
    userQuery.page = 1;
    loadUsers();
  });

  $('userSort').addEventListener('change', (e) => {
    [userQuery.sort, userQuery.dir] = e.target.value.split(':');
    userQuery.page = 1;
    loadUsers();
  });

  $('userPagination').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    userQuery.page = Number(btn.dataset.page);
    loadUsers();
  });

  $('userList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-user]');
    if (row) openUser(Number(row.dataset.user));
  });
}

// --- DETAIL UŽIVATELE ---
async function openUser(id) {
  openUserId = id;
  const drawer = $('userDrawer');
  $('drawerBody').innerHTML = '<div class="drawer-loading"><span></span><span></span><span></span></div>';
  drawer.classList.remove('hidden');
  try {
    const { user, vehicles, records } = await request(`${API}?action=user&id=${id}`);
    renderUser(user, vehicles, records);
  } catch (err) {
    closeDrawer();
    handleError(err);
  }
}

function closeDrawer() {
  $('userDrawer').classList.add('hidden');
  openUserId = null;
}

function renderUser(user, vehicles, records) {
  const isSelf = Number(user.id) === me?.id;
  $('drawerAvatar').textContent = initial(user.email);
  $('drawerEmail').textContent = user.email;
  $('drawerMeta').textContent = `Registrace ${formatDate(user.createdAt)} · přihlášení ${timeAgo(user.lastLoginAt)}`;

  $('drawerBody').innerHTML = `
    <div class="drawer-stats">
      <div><span>Tankování</span><strong>${Number(user.records)}</strong></div>
      <div><span>Útrata</span><strong>${formatCzk(Math.round(Number(user.totalAmount)))}</strong></div>
      <div><span>Palivo</span><strong>${Math.round(Number(user.totalLitres)).toLocaleString('cs-CZ')} l</strong></div>
      <div><span>Připomínky</span><strong>${Number(user.openReminders)}</strong></div>
    </div>

    <form class="drawer-section" id="userEditForm">
      <h4>Údaje účtu</h4>
      <div class="form-grid">
        <div class="form-group full-w">
          <label for="editEmail">E-mail</label>
          <input type="email" id="editEmail" value="${escapeHtml(user.email)}" required>
        </div>
        <div class="form-group">
          <label for="editBudget">Měsíční rozpočet (Kč)</label>
          <input type="number" id="editBudget" min="1" step="any" value="${Math.round(Number(user.budget))}">
        </div>
        <div class="form-group">
          <label>Role</label>
          <label class="switch-field" for="editAdmin">
            <input type="checkbox" id="editAdmin" ${Number(user.isAdmin) === 1 ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-text">Administrátor</span>
          </label>
        </div>
      </div>
      ${isSelf ? '<p class="account-note">Vlastní roli ani účet z administrace měnit nelze – ochrana proti nechtěnému uzamčení.</p>' : ''}
      <div class="account-actions">
        <button type="submit" class="btn-action-primary">Uložit změny</button>
        <button type="button" class="btn-secondary" id="resetPasswordBtn">Nastavit nové heslo</button>
      </div>
    </form>

    <div class="drawer-section">
      <h4>Vozidla (${vehicles.length})</h4>
      ${vehicles.length ? `<div class="drawer-list">${vehicles.map(v => `
        <div class="drawer-list-item">
          <span class="vehicle-pill-tag" style="--veh: ${safeColor(v.color)}">${escapeHtml(v.name)}</span>
          <span class="text-muted">${v.plate ? escapeHtml(v.plate) + ' · ' : ''}${Number(v.records)} tankování</span>
        </div>`).join('')}</div>` : '<p class="account-note">Žádná vozidla.</p>'}
    </div>

    <div class="drawer-section">
      <h4>Poslední tankování</h4>
      ${records.length ? `<div class="drawer-list">${records.map(r => `
        <div class="drawer-list-item">
          <span><strong>${escapeHtml(formatDate(r.date))}</strong> <span class="text-muted">${escapeHtml(r.station || '')}</span></span>
          <strong>${formatCzk(Math.round(Number(r.amount)))}</strong>
        </div>`).join('')}</div>` : '<p class="account-note">Uživatel zatím nic neevidoval.</p>'}
    </div>

    ${isSelf ? '' : `
    <div class="drawer-section danger-zone">
      <h4>Smazat uživatele</h4>
      <p class="account-note">Smaže účet i všechna jeho tankování, vozidla a připomínky. Akci nelze vrátit.</p>
      <button type="button" class="btn-danger" id="deleteUserBtn">Smazat účet</button>
    </div>`}`;

  $('userEditForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      email: $('editEmail').value.trim(),
      budget: Number($('editBudget').value)
    };
    if (!isSelf) body.isAdmin = $('editAdmin').checked;
    withBusyButton(e.submitter || e.target.querySelector('button[type="submit"]'), async () => {
      try {
        await request(`${API}?action=user&id=${user.id}`, { method: 'PUT', body });
        showToast('Změny byly uloženy.');
        await openUser(Number(user.id));
        loadUsers();
      } catch (err) {
        handleError(err);
      }
    });
  });

  $('resetPasswordBtn').addEventListener('click', () => openReset(user));

  $('deleteUserBtn')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: `Smazat ${user.email}?`,
      message: 'Účet i všechna data uživatele budou trvale odstraněna. Tuto akci nelze vrátit.',
      confirmText: 'Smazat účet'
    });
    if (!confirmed) return;
    try {
      await request(`${API}?action=user&id=${user.id}`, { method: 'DELETE' });
      closeDrawer();
      showToast('Uživatel byl smazán.');
      loadUsers();
    } catch (err) {
      handleError(err);
    }
  });
}

function setupDrawer() {
  $('closeDrawerBtn').addEventListener('click', closeDrawer);
  $('userDrawer').addEventListener('mousedown', (e) => {
    if (e.target === $('userDrawer')) closeDrawer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openUserId !== null && $('resetModal').classList.contains('hidden')
      && $('confirmModal').classList.contains('hidden')) {
      closeDrawer();
    }
  });
}

// --- NOVÉ HESLO ---
let resetUser = null;

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function openReset(user) {
  resetUser = user;
  $('resetFor').textContent = user.email;
  $('resetPassword').value = generatePassword();
  $('resetModal').classList.remove('hidden');
  $('resetPassword').select();
}

function setupReset() {
  const modal = $('resetModal');
  const close = () => modal.classList.add('hidden');
  $('cancelResetBtn').addEventListener('click', close);
  $('generatePasswordBtn').addEventListener('click', () => { $('resetPassword').value = generatePassword(); });
  $('resetForm').addEventListener('submit', (e) => {
    e.preventDefault();
    withBusyButton(e.target.querySelector('button[type="submit"]'), async () => {
      try {
        await request(`${API}?action=reset_password&id=${resetUser.id}`, { method: 'POST', body: { password: $('resetPassword').value } });
        close();
        showToast('Nové heslo bylo nastaveno.');
      } catch (err) {
        handleError(err);
      }
    });
  });
}

// --- AUDIT ---
async function loadAudit() {
  try {
    renderAudit($('auditList'), await request(`${API}?action=audit`));
  } catch (err) {
    handleError(err);
  }
}

// --- START ---
document.addEventListener('DOMContentLoaded', async () => {
  setupLogin();
  setupTheme();
  setupNav();
  setupUsers();
  setupDrawer();
  setupReset();
  setupModalDismiss();
  try {
    initEffects();
    enhanceSelect($('userSort'));
  } catch (err) {
    console.error('Chyba při inicializaci efektů:', err);
  }

  try {
    await enterAdmin();
  } catch (err) {
    showLogin(err.status === 403 ? err.message : '');
  }
});
