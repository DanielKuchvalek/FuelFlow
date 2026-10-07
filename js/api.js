// js/api.js

export async function request(url, { method = 'GET', body } = {}) {
  const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Nepodařilo se spojit se serverem. Zkontrolujte připojení.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Odpověď není JSON (např. PHP fatal error) – ošetříme níže
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Chyba serveru (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (data === null) {
    throw new Error('Server vrátil neplatnou odpověď.');
  }
  return data;
}

const recordUrl = (id) => `api/records.php?id=${encodeURIComponent(id)}`;
const vehicleUrl = (id) => `api/records.php?action=vehicles&id=${encodeURIComponent(id)}`;

export const checkAuth = () => request('api/auth.php?action=check');
export const loginUser = (email, password) => request('api/auth.php?action=login', { method: 'POST', body: { email, password } });
export const registerUser = (email, password) => request('api/auth.php?action=register', { method: 'POST', body: { email, password } });
export const logoutUser = () => request('api/auth.php?action=logout', { method: 'POST' });
export const updateMonthlyBudget = (budget) => request('api/auth.php?action=update_budget', { method: 'POST', body: { budget } });

export const fetchRecords = () => request('api/records.php');
export const addRecord = (record) => request('api/records.php', { method: 'POST', body: record });
export const updateRecord = (id, record) => request(recordUrl(id), { method: 'PUT', body: record });
export const deleteRecord = (id) => request(recordUrl(id), { method: 'DELETE' });

export const fetchVehicles = () => request('api/records.php?action=vehicles');
export const addVehicle = (data) => request('api/records.php?action=vehicles', { method: 'POST', body: data });
export const updateVehicleBudget = (id, budget) => request(vehicleUrl(id), { method: 'PUT', body: { budget } });
export const deleteVehicle = (id) => request(vehicleUrl(id), { method: 'DELETE' });

const reminderUrl = (id) => `api/records.php?action=reminders&id=${encodeURIComponent(id)}`;

export const fetchReminders = () => request('api/records.php?action=reminders');
export const addReminder = (data) => request('api/records.php?action=reminders', { method: 'POST', body: data });
export const setReminderDone = (id, done) => request(reminderUrl(id), { method: 'PUT', body: { done } });
export const deleteReminder = (id) => request(reminderUrl(id), { method: 'DELETE' });

export const changePassword = (currentPassword, newPassword) => request('api/auth.php?action=change_password', { method: 'POST', body: { currentPassword, newPassword } });
export const deleteAccount = (password) => request('api/auth.php?action=delete_account', { method: 'POST', body: { password } });
