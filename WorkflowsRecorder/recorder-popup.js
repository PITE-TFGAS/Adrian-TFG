// recorder-popup.js - Control panel logic

let isRecording = false;
let currentWorkflow = null;

// DOM Elements
const workflowNameInput = document.getElementById('workflowName');
const workflowDescriptionInput = document.getElementById('workflowDescription');
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
const tagsGroup = document.getElementById('tagsGroup');
const tagsInput = document.getElementById('tagsInput');
const tagsContainer = document.getElementById('tagsContainer');

// Tags management
let workflowTags = [];

// Initialize: check if there is an active recording
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getRecordingState' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded yet, that's fine
        return;
      }

      if (response && response.isRecording) {
        activateRecordingMode(response.workflow);
      }
    });
  }
});

// Start recording
btnStart.addEventListener('click', async () => {
  const workflowName = workflowNameInput.value.trim();

  if (!workflowName) {
    alert('⚠️ Por favor, introduce un nombre para el workflow');
    workflowNameInput.focus();
    return;
  }

  const workflowDescription = workflowDescriptionInput.value.trim();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    alert('⚠️ No se puede obtener la pestaña activa');
    return;
  }

  const workflow = {
    name: workflowName,
    description: workflowDescription,
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
      activateRecordingMode(workflow);
    }
  });
});

// Stop recording
btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, (response) => {
    if (response && response.workflow) {
      deactivateRecordingMode(response.workflow);
    }
  });
});

// Tag Management Functions
function addTag(tagName) {
  const normalized = tagName.trim().toLowerCase().replace(/\s+/g, '-');
  if (!normalized || workflowTags.includes(normalized)) return;

  workflowTags.push(normalized);
  renderTags();
  tagsInput.value = '';
}

function removeTag(tagName) {
  workflowTags = workflowTags.filter(t => t !== tagName);
  renderTags();
}

function renderTags() {
  tagsContainer.innerHTML = '';

  workflowTags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `
      <span>${tag}</span>
      <span class="remove-tag" data-tag="${tag}">×</span>
    `;

    chip.querySelector('.remove-tag').addEventListener('click', () => {
      removeTag(tag);
    });

    tagsContainer.appendChild(chip);
  });
}

// Tags input event listener
tagsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag(tagsInput.value);
  }
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

// Upload to Cloud
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
    description: currentWorkflow.description,
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
        url: step.url,
        tooltipPosition: step.tooltipPosition || "bottom",
        stepType: step.stepType || "click",
        expected: step.expected || undefined
      }
    });
  });

  const originalText = btnUpload.textContent;
  btnUpload.textContent = '⏳ Guardando...';
  btnUpload.disabled = true;

  console.log("☁️ [Recorder] Starting upload...");
  console.log("👤 [Recorder] User ID:", user.id);
  console.log("📦 [Recorder] Payload Size:", JSON.stringify(output).length);

  try {
    // Prepare tags: always include "review needed" + user tags
    const finalTags = ['review needed', ...workflowTags];

    const { error } = await supabaseClient
      .from('workflows')
      .insert([{
        name: currentWorkflow.name,
        url: currentWorkflow.url,
        data: output,
        user_id: user.id,
        tags: finalTags
      }]);

    if (error) throw error;

    btnUpload.textContent = '✓ Guardado!';
    btnUpload.style.background = '#66bb6a';

    // Clear recording state after saving
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });

    // Reset popup UI
    setTimeout(() => {
      currentWorkflow = null;
      workflowTags = [];
      renderTags();
      btnUpload.style.display = 'none';
      btnClear.style.display = 'none';
      tagsGroup.style.display = 'none';
      btnStart.style.display = 'block';
      workflowNameInput.disabled = false;
      workflowNameInput.value = '';
      workflowDescriptionInput.disabled = false;
      workflowDescriptionInput.value = '';
      btnUpload.textContent = originalText;
      btnUpload.style.background = '';
      btnUpload.disabled = false;
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

// New recording
btnClear.addEventListener('click', () => {
  if (confirm('¿Estás seguro de que quieres comenzar una nueva grabación? Los datos actuales se perderán.')) {
    currentWorkflow = null;
    workflowNameInput.value = '';
    workflowNameInput.disabled = false;
    workflowDescriptionInput.value = '';
    workflowDescriptionInput.disabled = false;
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

    // Clear in content script as well
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });
  }
});

// Helper functions
function activateRecordingMode(workflow) {
  isRecording = true;
  currentWorkflow = workflow;

  workflowNameInput.disabled = true;
  workflowDescriptionInput.disabled = true;
  btnStart.style.display = 'none';
  btnStop.style.display = 'block';
  btnUpload.style.display = 'none';
  btnClear.style.display = 'none';
  statusIdle.style.display = 'none';
  statusRecording.style.display = 'block';
  stepsCount.style.display = 'block';
  urlDisplay.style.display = 'block';

  currentUrl.textContent = workflow.url;
  updateCounter(workflow.steps.length);

  // Periodically update counter
  const interval = setInterval(() => {
    if (!isRecording) {
      clearInterval(interval);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getStepsCount' }, (response) => {
          if (response && response.count !== undefined) {
            updateCounter(response.count);
          }
        });
      }
    });
  }, 500);
}

function deactivateRecordingMode(workflow) {
  isRecording = false;
  currentWorkflow = workflow;

  statusRecording.style.display = 'none';
  statusIdle.style.display = 'block';
  btnStop.style.display = 'none';
  btnUpload.style.display = 'block';
  btnClear.style.display = 'block';
  tagsGroup.style.display = 'block';
  workflowNameInput.disabled = true;
  workflowDescriptionInput.disabled = true;

  // Reset tags for new workflow
  workflowTags = [];
  renderTags();

  // Update counter
  if (workflow.steps && workflow.steps.length > 0) {
    countNumber.textContent = workflow.steps.length;
  }
  statusIdle.innerHTML = `
    <strong>✓ Grabación completada</strong><br>
    ${workflow.steps.length} paso(s) registrado(s)
  `;
  statusIdle.style.background = '#e8f5e9';
  statusIdle.style.borderColor = '#4CAF50';
  statusIdle.style.color = '#2e7d32';

  updateCounter(workflow.steps.length);
}

function updateCounter(count) {
  countNumber.textContent = count;
}