/**
 * popup.js - Player popup UI logic (login, tour selection, playback control).
 *
 * Manages the extension popup interface: authentication, workflow syncing
 * from Supabase, and displaying the sync status.
 */

const authContainer = document.getElementById('authContainer');
const loginForm = document.getElementById('loginForm');
const userInfo = document.getElementById('userInfo');
const userEmailSpan = document.getElementById('userEmail');
const btnLogin = document.getElementById('btnLogin');
const btnRegister = document.getElementById('btnRegister');
const btnLogout = document.getElementById('btnLogout');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authMessage = document.getElementById('authMessage');

const statusDiv = document.getElementById('status');
const btnSync = document.getElementById('btnSync');

/**
 * Updates the authentication UI and optionally syncs workflows.
 *
 * When a session is present, hides the login form, shows user info,
 * triggers workflow sync, and persists the session. When null,
 * restores the login form and removes the session from storage.
 *
 * @param {Object|null} session - Supabase session object, or null for logged out.
 */
async function updateAuthUI(session) {
  if (session) {
    loginForm.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmailSpan.textContent = session.user.email;

    await syncWorkflows(session.user);

    await chrome.storage.local.set({ 'supabase_session': session });
  } else {
    loginForm.style.display = 'block';
    userInfo.style.display = 'none';
    userEmailSpan.textContent = '';
    statusDiv.style.display = 'none';

    await chrome.storage.local.remove(['supabase_session']);
  }
}

AuthManager.onAuthStateChange((event, session) => {
  updateAuthUI(session);
});

AuthManager.getCurrentUser().then(user => {
  if (user) updateAuthUI({ user });
});

/**
 * Authenticates the user on login button click.
 */
btnLogin.addEventListener('click', async () => {
  authMessage.textContent = 'Iniciando sesión...';
  const { error } = await AuthManager.login(emailInput.value, passwordInput.value);
  if (error) authMessage.textContent = error.message;
  else authMessage.textContent = '';
});

/**
 * Registers a new user on register button click.
 */
btnRegister.addEventListener('click', async () => {
  authMessage.textContent = 'Registrando...';
  const { error } = await AuthManager.register(emailInput.value, passwordInput.value);
  if (error) authMessage.textContent = error.message;
  else authMessage.textContent = 'Registro enviado. Verifica tu correo.';
});

/**
 * Logs out the current user on logout button click.
 */
btnLogout.addEventListener('click', async () => {
  await AuthManager.logout();
  authMessage.textContent = '';
});

/**
 * Synchronizes workflows from Supabase to local storage for the given user.
 *
 * Fetches all workflows owned by the user, stores them locally with
 * a workflow list index, and updates the status UI with the result.
 *
 * @param {Object} user - The authenticated Supabase user object.
 */
async function syncWorkflows(user) {
  if (!user) return;

  statusDiv.style.display = 'block';
  statusDiv.innerHTML = '⏳ Sincronizando guías...';
  statusDiv.className = '';

  try {
    const { data: rows, error } = await supabaseClient
      .from('workflows')
      .select('*')
      .eq('user_id', user.id);

    if (error) throw error;

    if (!rows || rows.length === 0) {
      statusDiv.innerHTML = '✨ No hay guías nuevas.';
      statusDiv.className = '';
      return;
    }

    let count = 0;
    const workflowList = [];
    const fullWorkflows = {};

    rows.forEach(row => {
      const json = row.data;
      const id = `s-${row.id}`;

      if (json.drawflow) {
        workflowList.push({
          id: id,
          filename: row.name,
          name: row.name,
          url: row.url,
          createdAt: row.created_at,
          stepsCount: json.drawflow.nodes.length
        });

        fullWorkflows[`workflow_${id}`] = {
          name: row.name,
          url: row.url,
          createdAt: row.created_at,
          steps: [],
          ...json
        };
        count++;
      }
    });

    if (count > 0) {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ workflowList });
      await chrome.storage.local.set(fullWorkflows);

      statusDiv.innerHTML = `
        <span class="count">${count}</span>
        Guías sincronizadas
      `;
      statusDiv.className = 'success';
    } else {
      statusDiv.innerHTML = '⚠️ Datos incompletos en la nube.';
      statusDiv.className = 'error';
    }

  } catch (error) {
    ;
    statusDiv.innerHTML = '❌ Error al sincronizar: ' + error.message;
    statusDiv.className = 'error';
  }
}

if (btnSync) {
  /**
   * Manually triggers workflow sync on sync button click.
   */
  btnSync.addEventListener('click', async () => {
    const user = await AuthManager.getCurrentUser();
    if (user) await syncWorkflows(user);
    else alert('Por favor, inicia sesión primero');
  });
}
