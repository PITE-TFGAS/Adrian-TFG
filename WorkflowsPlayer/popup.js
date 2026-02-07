// DOM Elements
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
const btnSync = document.getElementById('btnSync'); // May be null if removed from HTML

// Auth Logic
async function updateAuthUI(session) {
  if (session) {
    loginForm.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmailSpan.textContent = session.user.email;

    // AUTO SYNC when user is logged in
    await syncWorkflows(session.user);

    // Bridge to Content Script (Save Session)
    await chrome.storage.local.set({ 'supabase_session': session });
  } else {
    loginForm.style.display = 'block';
    userInfo.style.display = 'none';
    userEmailSpan.textContent = '';
    statusDiv.style.display = 'none';

    // Clear session from storage
    await chrome.storage.local.remove(['supabase_session']);
  }
}

AuthManager.onAuthStateChange((event, session) => {
  updateAuthUI(session);
});

// Initial check
AuthManager.getCurrentUser().then(user => {
  if (user) updateAuthUI({ user });
});

btnLogin.addEventListener('click', async () => {
  authMessage.textContent = 'Iniciando...';
  const { error } = await AuthManager.login(emailInput.value, passwordInput.value);
  if (error) authMessage.textContent = error.message;
  else authMessage.textContent = '';
});

btnRegister.addEventListener('click', async () => {
  authMessage.textContent = 'Registrando...';
  const { error } = await AuthManager.register(emailInput.value, passwordInput.value);
  if (error) authMessage.textContent = error.message;
  else authMessage.textContent = 'Registro enviado. Verifica tu correo.';
});

btnLogout.addEventListener('click', async () => {
  await AuthManager.logout();
  authMessage.textContent = '';
});

// Sync Logic (Auto Function)
async function syncWorkflows(user) {
  if (!user) return;

  statusDiv.style.display = 'block';
  statusDiv.innerHTML = '⏳ Sincronizando guías...';
  statusDiv.className = '';

  try {
    // 1. Fetch from Supabase
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

    // 2. Process Data
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
      // 3. Save to Storage
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
    console.error(error);
    statusDiv.innerHTML = '❌ Error sincronizando: ' + error.message;
    statusDiv.className = 'error';
  }
}

// Keep button just in case user wants to force sync, if element exists
if (btnSync) {
  btnSync.addEventListener('click', async () => {
    const user = await AuthManager.getCurrentUser();
    if (user) await syncWorkflows(user);
    else alert('Inicia sesión primero');
  });
}
