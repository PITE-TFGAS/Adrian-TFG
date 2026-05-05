// DOM Elements
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnSave = document.getElementById('btn-save');
const btnClear = document.getElementById('btn-clear');
const nameInput = document.getElementById('workflow-name');
const nameContainer = document.getElementById('name-container');
const recordingStatus = document.getElementById('recording-status');
const stepsCount = document.getElementById('steps-count');
const authStatus = document.getElementById('auth-status');

// Initialize State
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const activeTab = tabs[0];
  if (!activeTab) return;

  chrome.tabs.sendMessage(activeTab.id, { action: 'getRecordingState' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.isRecording) {
      setUIState('recording', response.workflow.steps.length);
    }
  });
});

// Update Auth Status
AuthManager.getCurrentUser().then(user => {
  if (user) {
    authStatus.textContent = `Sesión iniciada como: ${user.email}`;
  } else {
    authStatus.innerHTML = '<span style="color:#d32f2f">⚠️ Debes iniciar sesión en el Player primero</span>';
    btnStart.disabled = true;
  }
});

// Event Listeners
btnStart.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert('Por favor, introduce un nombre para el tutorial');
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const workflow = {
      name: name,
      url: activeTab.url,
      steps: []
    };

    chrome.tabs.sendMessage(activeTab.id, { action: 'startRecording', workflow }, (response) => {
      if (response && response.success) {
        setUIState('recording', 0);
        window.close(); // Close popup to allow interaction
      }
    });
  });
});

btnStop.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }, (response) => {
      if (response && response.workflow) {
        setUIState('finished', response.workflow.steps.length);
      }
    });
  });
});

btnSave.addEventListener('click', async () => {
  const user = await AuthManager.getCurrentUser();
  if (!user) {
    alert('Debes iniciar sesión en la extensión Player para poder subir tutoriales.');
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: 'stopRecording' }, async (response) => {
      const workflow = response.workflow;
      if (!workflow || workflow.steps.length === 0) {
        alert('No hay pasos grabados para subir.');
        return;
      }

      btnSave.textContent = 'Subiendo...';
      btnSave.disabled = true;

      try {
        const drawflowData = {
          drawflow: {
            Home: {
              data: {}
            }
          }
        };

        workflow.steps.forEach((step, index) => {
          drawflowData.drawflow.Home.data[index + 1] = {
            id: index + 1,
            name: 'step',
            data: {
              selector: step.selector,
              description: step.description,
              url: step.url,
              stepType: step.stepType,
              expected: step.expected
            }
          };
        });

        const { error } = await supabaseClient.from('workflows').insert({
          name: workflow.name,
          url: workflow.url,
          user_id: user.id,
          data: drawflowData
        });

        if (error) throw error;

        alert('✅ Tutorial subido con éxito a la nube');
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' });
        setUIState('idle');
      } catch (err) {
        console.error(err);
        alert('❌ Error al subir: ' + err.message);
        btnSave.textContent = 'Subir a la nube';
        btnSave.disabled = false;
      }
    });
  });
});

btnClear.addEventListener('click', () => {
  if (confirm('¿Estás seguro de que quieres borrar la grabación actual?')) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'clearRecording' }, () => {
        setUIState('idle');
      });
    });
  }
});

function setUIState(state, count = 0) {
  if (state === 'recording') {
    btnStart.style.display = 'none';
    nameContainer.style.display = 'none';
    btnStop.style.display = 'flex';
    btnSave.style.display = 'none';
    recordingStatus.style.display = 'block';
    stepsCount.textContent = count;
  } else if (state === 'finished') {
    btnStart.style.display = 'none';
    nameContainer.style.display = 'none';
    btnStop.style.display = 'none';
    btnSave.style.display = 'flex';
    recordingStatus.style.display = 'block';
    stepsCount.textContent = count;
  } else {
    btnStart.style.display = 'flex';
    nameContainer.style.display = 'block';
    btnStop.style.display = 'none';
    btnSave.style.display = 'none';
    recordingStatus.style.display = 'none';
  }
}