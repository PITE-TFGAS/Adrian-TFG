// recorder-popup.js - Lógica del panel de control

let isRecording = false;
let currentWorkflow = null;

// Elementos del DOM
const workflowNameInput = document.getElementById('workflowName');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnUpload = document.getElementById('btnUpload'); // Replaced btnDownload
const btnClear = document.getElementById('btnClear');

// Auth DOM Elements
const loginForm = document.getElementById('loginForm');
const userInfo = document.getElementById('userInfo');
const userEmailSpan = document.getElementById('userEmail');
const btnLogin = document.getElementById('btnLogin');
const btnRegister = document.getElementById('btnRegister');
const btnLogout = document.getElementById('btnLogout');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authMessage = document.getElementById('authMessage');
const statusIdle = document.getElementById('statusIdle');
const statusRecording = document.getElementById('statusRecording');
const stepsCount = document.getElementById('stepsCount');
const countNumber = document.getElementById('countNumber');
const urlDisplay = document.getElementById('urlDisplay');
const currentUrl = document.getElementById('currentUrl');

// Inicializar: verificar si hay una grabación activa
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getRecordingState' }, (response) => {
      if (chrome.runtime.lastError) {
        // El content script aún no está cargado, está bien
        return;
      }

      if (response && response.isRecording) {
        activarModoGrabacion(response.workflow);
      }
    });
  }
});

// Iniciar grabación
btnStart.addEventListener('click', async () => {
  const workflowName = workflowNameInput.value.trim();

  if (!workflowName) {
    alert('⚠️ Por favor, introduce un nombre para el workflow');
    workflowNameInput.focus();
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    alert('⚠️ No se puede obtener la pestaña activa');
    return;
  }

  const workflow = {
    name: workflowName,
    url: tab.url,
    steps: [],
    createdAt: new Date().toISOString()
  };

  chrome.tabs.sendMessage(tab.id, {
    action: 'startRecording',
    workflow: workflow
  }, (response) => {
    if (chrome.runtime.lastError) {
      alert('⚠️ Error al iniciar la grabación. Recarga la página e intenta de nuevo.');
      return;
    }

    if (response && response.success) {
      activarModoGrabacion(workflow);
    }
  });
});

// Detener grabación
btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, (response) => {
    if (response && response.workflow) {
      desactivarModoGrabacion(response.workflow);
    }
  });
});

// Auth Logic
function updateAuthUI(session) {
  if (session) {
    loginForm.style.display = 'none';
    userInfo.style.display = 'flex';
    userEmailSpan.textContent = session.user.email;
  } else {
    loginForm.style.display = 'block';
    userInfo.style.display = 'none';
    userEmailSpan.textContent = '';
  }
}

AuthManager.onAuthStateChange((event, session) => {
  updateAuthUI(session);
});

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

// Guardar en la Nube
btnUpload.addEventListener('click', async () => {
  const user = await AuthManager.getCurrentUser();
  if (!user) {
    alert('⚠️ Debes iniciar sesión para guardar.');
    return;
  }

  if (!currentWorkflow || !currentWorkflow.steps || currentWorkflow.steps.length === 0) {
    alert('⚠️ No hay pasos grabados.');
    return;
  }

  const output = {
    name: currentWorkflow.name,
    url: currentWorkflow.url,
    createdAt: currentWorkflow.createdAt,
    drawflow: { nodes: [] }
  };

  currentWorkflow.steps.forEach((step, index) => {
    output.drawflow.nodes.push({
      id: index + 1,
      label: "event-click",
      position: step.position,
      data: {
        selector: step.selector,
        description: step.description,
        url: step.url, // Save the specific URL for this step
        tooltipPosition: step.tooltipPosition || "bottom"
      }
    });
  });

  const originalText = btnUpload.textContent;
  btnUpload.textContent = '⏳ Guardando...';
  btnUpload.disabled = true;

  console.log("☁️ [Recorder] Iniciando subida...");
  console.log("👤 [Recorder] User ID:", user.id);
  console.log("📦 [Recorder] Payload Size:", JSON.stringify(output).length);

  try {
    const { error } = await supabaseClient
      .from('workflows')
      .insert([{
        name: currentWorkflow.name,
        url: currentWorkflow.url,
        data: output,
        user_id: user.id
      }]);

    if (error) throw error;

    btnUpload.textContent = '✓ Guardado!';
    btnUpload.style.background = '#66bb6a';

    // Limpiar estado de grabación tras guardar
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });

    // Resetear UI del popup
    setTimeout(() => {
      btnUpload.textContent = originalText;
      btnUpload.style.background = '';
      btnUpload.disabled = false;

      // Volver a estado inicial
      currentWorkflow = null;
      workflowNameInput.value = '';
      workflowNameInput.disabled = false;
      btnStart.style.display = 'block';
      btnStop.style.display = 'none';
      btnUpload.style.display = 'none';
      btnClear.style.display = 'none';
      stepsCount.style.display = 'none';
      urlDisplay.style.display = 'none';
      statusIdle.style.display = 'block';
      statusRecording.style.display = 'none';
      statusIdle.innerHTML = '<strong>⏸️ Listo para grabar</strong><br>Introduce los datos y presiona "Iniciar Grabación"';
      statusIdle.style.background = '#e3f2fd';
      statusIdle.style.borderColor = '#2196F3';
      statusIdle.style.color = '#1565c0';
    }, 2000);

  } catch (err) {
    console.error(err);
    alert('Error al guardar: ' + err.message);
    btnUpload.textContent = '❌ Error';
    btnUpload.disabled = false;
  }
});

// Storage function removed (using Cloud)

// Nueva grabación
btnClear.addEventListener('click', () => {
  if (confirm('¿Estás seguro de que quieres comenzar una nueva grabación? Los datos actuales se perderán.')) {
    currentWorkflow = null;
    workflowNameInput.value = '';
    workflowNameInput.disabled = false;
    btnStart.style.display = 'block';
    btnStop.style.display = 'none';
    btnUpload.style.display = 'none';
    btnClear.style.display = 'none';
    stepsCount.style.display = 'none';
    urlDisplay.style.display = 'none';
    statusIdle.style.display = 'block';
    statusRecording.style.display = 'none';
    statusIdle.innerHTML = '<strong>⏸️ Listo para grabar</strong><br>Introduce los datos y presiona "Iniciar Grabación"';
    statusIdle.style.background = '#e3f2fd';
    statusIdle.style.borderColor = '#2196F3';
    statusIdle.style.color = '#1565c0';

    // Limpiar en el content script también
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });
  }
});

// Funciones auxiliares
function activarModoGrabacion(workflow) {
  isRecording = true;
  currentWorkflow = workflow;

  workflowNameInput.disabled = true;
  btnStart.style.display = 'none';
  btnStop.style.display = 'block';
  btnUpload.style.display = 'none';
  btnClear.style.display = 'none';
  statusIdle.style.display = 'none';
  statusRecording.style.display = 'block';
  stepsCount.style.display = 'block';
  urlDisplay.style.display = 'block';

  currentUrl.textContent = workflow.url;
  actualizarContador(workflow.steps.length);

  // Actualizar contador periódicamente
  const interval = setInterval(() => {
    if (!isRecording) {
      clearInterval(interval);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getStepsCount' }, (response) => {
          if (response && response.count !== undefined) {
            actualizarContador(response.count);
          }
        });
      }
    });
  }, 500);
}

function desactivarModoGrabacion(workflow) {
  isRecording = false;
  currentWorkflow = workflow;

  btnStop.style.display = 'none';
  btnUpload.style.display = 'block';
  btnClear.style.display = 'block';
  statusRecording.style.display = 'none';
  statusIdle.style.display = 'block';
  statusIdle.innerHTML = `
    <strong>✓ Grabación completada</strong><br>
    ${workflow.steps.length} paso(s) registrado(s)
  `;
  statusIdle.style.background = '#e8f5e9';
  statusIdle.style.borderColor = '#4CAF50';
  statusIdle.style.color = '#2e7d32';

  actualizarContador(workflow.steps.length);
}

function actualizarContador(count) {
  countNumber.textContent = count;
}