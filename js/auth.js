// js/auth.js
import { loginUser, registerUser, logoutUser } from './api.js?v=7.0';
import { withBusyButton } from './ui.js?v=7.0';

let isLoginMode = true;

export function setupAuthUI(onAuthSuccess, onLogout) {
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const authSubtitle = document.getElementById('authSubtitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const authForm = document.getElementById('authForm');
  const logoutBtn = document.getElementById('logoutBtn');
  const authAlert = document.getElementById('authAlert');
  const authPassword = document.getElementById('authPassword');
  const strengthWrapper = document.getElementById('passwordStrengthWrapper');

  // Eye toggle
  const toggleEyeBtn = document.getElementById('togglePasswordVisibility');
  const eyeOpenIcon = document.getElementById('eyeOpenIcon');
  const eyeClosedIcon = document.getElementById('eyeClosedIcon');

  toggleEyeBtn.addEventListener('click', () => {
    const isPassword = authPassword.type === 'password';
    authPassword.type = isPassword ? 'text' : 'password';
    eyeOpenIcon.classList.toggle('hidden', isPassword);
    eyeClosedIcon.classList.toggle('hidden', !isPassword);
  });

  const setMode = (loginMode) => {
    isLoginMode = loginMode;
    tabLogin.classList.toggle('active', loginMode);
    tabRegister.classList.toggle('active', !loginMode);
    authSubtitle.textContent = loginMode ? 'Přihlaste se ke svému účtu' : 'Vytvořte si nový účet pro ukládání dat';
    authSubmitBtn.querySelector('.btn-text').textContent = loginMode ? 'Přihlásit se' : 'Vytvořit účet';
    authPassword.autocomplete = loginMode ? 'current-password' : 'new-password';
    strengthWrapper.classList.toggle('hidden', loginMode);
    authAlert.classList.add('hidden');
    if (!loginMode) evaluatePasswordStrength(authPassword.value);
  };

  tabLogin.addEventListener('click', () => setMode(true));
  tabRegister.addEventListener('click', () => setMode(false));

  // Měření síly hesla v reálném čase
  authPassword.addEventListener('input', (e) => {
    if (!isLoginMode) {
      evaluatePasswordStrength(e.target.value);
    }
  });

  // Odeslání formuláře
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const pass = authPassword.value;

    withBusyButton(authSubmitBtn, async () => {
      try {
        authAlert.classList.add('hidden');
        if (!email || !pass) {
          throw new Error('Zadejte e-mail i heslo.');
        }
        let response;
        if (isLoginMode) {
          response = await loginUser(email, pass);
        } else {
          if (pass.length < 6) {
            throw new Error('Heslo musí mít minimálně 6 znaků.');
          }
          response = await registerUser(email, pass);
        }
        authForm.reset();
        evaluatePasswordStrength('');
        await onAuthSuccess(response.user);
      } catch (err) {
        authAlert.classList.remove('hidden');
        authAlert.textContent = err.message;
      }
    });
  });

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await logoutUser();
      } catch (err) {
        console.warn('Odhlášení na serveru selhalo:', err.message);
      }
      onLogout();
    });
  }
}

// Vyhodnocení síly hesla (0 - 4 body)
function evaluatePasswordStrength(password) {
  const barsWrap = document.querySelector('.meter-bars');
  const strengthText = document.getElementById('strengthText');
  const strengthHint = document.getElementById('strengthHint');

  barsWrap.className = 'meter-bars';

  if (!password) {
    strengthText.textContent = 'Zadejte heslo';
    strengthText.style.color = 'var(--text-muted)';
    strengthHint.textContent = 'Minimálně 6 znaků';
    return;
  }

  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;

  barsWrap.classList.add(`lvl-${score}`);

  switch (score) {
    case 0:
    case 1:
      strengthText.textContent = 'Slabé heslo';
      strengthText.style.color = '#ef4444';
      strengthHint.textContent = password.length < 6 ? 'Minimálně 6 znaků' : 'Přidejte velká písmena nebo číslice';
      break;
    case 2:
      strengthText.textContent = 'Střední heslo';
      strengthText.style.color = '#f59e0b';
      strengthHint.textContent = 'Zkuste ještě delší heslo';
      break;
    case 3:
      strengthText.textContent = 'Dobré heslo';
      strengthText.style.color = '#2dd4bf';
      strengthHint.textContent = 'Bezpečné pro běžné použití';
      break;
    case 4:
      strengthText.textContent = 'Velmi silné heslo';
      strengthText.style.color = '#c6ff34';
      strengthHint.textContent = 'Vynikající zabezpečení!';
      break;
  }
}
