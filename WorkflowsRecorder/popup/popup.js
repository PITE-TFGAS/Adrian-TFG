/**
 * popup.js - Recorder popup UI logic (login, recording controls, sync).
 *
 * Manages the extension popup interface: authentication, workflow naming,
 * start/stop recording, tag management, and cloud upload.
 */

/** @type {boolean} Whether a recording is in progress. */
let isRecording = false;
/** @type {Object|null} The current workflow being recorded. */
let currentWorkflow = null;

/*  ----  DOM element references  ----  */

const workflowNameInput = document.getElementById('workflowName');
const workflowDescriptionInput = document.getElementById('workflowDescription');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnUpload = document.getElementById('btnUpload');
const btnClear = document.getElementById('btnClear');

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

/** @type {string[]} Array of tag strings for the current workflow. */
let workflowTags = [];

/**
 * On popup open, queries the content script for current recording state
 * and restores UI to match (e.g., if already recording).
 */
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'getRecordingState' }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (response && response.isRecording) {
        activateRecordingMode(response.workflow);
      }
    });
  }
});

/**
 * Starts a recording session.
 *
 * Validates the workflow name, creates the workflow object, and sends
 * a startRecording message to the content script.
 */
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

/**
 * Stops the active recording session by messaging the content script.
 */
btnStop.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, (response) => {
    if (response && response.workflow) {
      deactivateRecordingMode(response.workflow);
    }
  });
});

/**
 * Adds a tag to the workflow.
 *
 * Normalizes the tag (lowercase, hyphens) and skips duplicates.
 *
 * @param {string} tagName - The tag to add.
 */
function addTag(tagName) {
  const normalized = tagName.trim().toLowerCase().replace(/\s+/g, '-');
  if (!normalized || workflowTags.includes(normalized)) return;

  workflowTags.push(normalized);
  renderTags();
  tagsInput.value = '';
}

/**
 * Removes a tag from the workflow.
 *
 * @param {string} tagName - The tag to remove.
 */
function removeTag(tagName) {
  workflowTags = workflowTags.filter(t => t !== tagName);
  renderTags();
}

/**
 * Renders all current tags as removable chips in the tags container.
 */
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

/**
 * Allows adding a tag by pressing Enter in the tags input field.
 */
tagsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTag(tagsInput.value);
  }
});

/**
 * Toggles the authentication UI between login form and user info display.
 *
 * @param {Object|null} session - Supabase session object, or null for logged out.
 */
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

/**
 * Authenticates the user with email/password on login button click.
 */
btnLogin.addEventListener('click', async () => {
  authMessage.textContent = 'Iniciando...';
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
 * Uploads the recorded workflow to Supabase.
 *
 * Transforms the workflow into the expected drawflow format,
 * saves it to the 'workflows' table, and resets the UI on success.
 */
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

  ;
  ;
  ;

  try {
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

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });

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
    ;
    alert('Error al guardar: ' + err.message);
    btnUpload.textContent = '❌ Error';
    btnUpload.disabled = false;
  }
});

/**
 * Clears the current recording and resets the UI to its initial state.
 */
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

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
      }
    });
  }
});

/**
 * Activates the recording UI mode (called when recording starts).
 *
 * Disables inputs, shows recording status and step counter,
 * and starts a polling interval to update the step count.
 *
 * @param {Object} workflow - The workflow being recorded.
 */
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

/**
 * Deactivates the recording UI mode (called when recording stops).
 *
 * Shows upload/clear buttons, displays tag input, and updates status
 * with step count.
 *
 * @param {Object} workflow - The completed workflow.
 */
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

  workflowTags = [];
  renderTags();

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

/**
 * Updates the displayed step counter.
 *
 * @param {number} count - The number of steps to display.
 */
function updateCounter(count) {
  countNumber.textContent = count;
}
