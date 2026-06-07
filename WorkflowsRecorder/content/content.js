/**
 * content.js - Main recording engine (click capture, overlay, step management).
 *
 * Handles recording workflow steps by intercepting user clicks on the page,
 * prompting for descriptions, analyzing resulting DOM changes, and persisting
 * state across page loads via chrome.storage.local.
 */

/** @type {boolean} Whether a recording session is currently active. */
let isRecording = false;
/** @type {Object|null} The current workflow being recorded. */
let currentWorkflow = null;
/** @type {HTMLElement|null} The recording overlay DOM element. */
let recordingOverlay = null;
/** @type {Function|null} Reference to the active click handler for cleanup. */
let clickHandler = null;
/** @type {boolean} Prevents recursive handling while programmatic clicks are replayed. */
let isReplaying = false;

/**
 * Listens for management messages from the popup or background script.
 *
 * Supported actions: startRecording, stopRecording, getRecordingState,
 * getStepsCount, clearRecording.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startRecording') {
    startRecording(request.workflow);
    sendResponse({ success: true });
  } else if (request.action === 'stopRecording') {
    stopRecording();
    sendResponse({ workflow: currentWorkflow });
  } else if (request.action === 'getRecordingState') {
    sendResponse({ isRecording: isRecording, workflow: currentWorkflow });
  } else if (request.action === 'getStepsCount') {
    sendResponse({ count: currentWorkflow ? currentWorkflow.steps.length : 0 });
  } else if (request.action === 'clearRecording') {
    clearRecording();
    sendResponse({ success: true });
  }

  return true;
});

/**
 * Starts a recording session.
 *
 * Creates the visual overlay, attaches click/mouseover/mouseout listeners,
 * and saves initial state.
 *
 * @param {Object} workflow - The workflow object to record into.
 */
function startRecording(workflow) {
  isRecording = true;
  currentWorkflow = workflow;

  createRecordingOverlay();

  clickHandler = function (event) {
    if (isReplaying) return;
    if (!isRecording) return;

    if (event.target.closest('#recording-overlay')) {
      return;
    }

    if (event.target.closest('.recording-modal-overlay')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    handleElementClick(event.target, event.clientX, event.clientY);
  };

  document.addEventListener('click', clickHandler, true);

  document.addEventListener('mouseover', highlightElement, true);
  document.addEventListener('mouseout', unhighlightElement, true);

  saveState();
}

/**
 * Stops the active recording session.
 *
 * Removes event listeners and the overlay, then saves state.
 */
function stopRecording() {
  isRecording = false;

  if (clickHandler) {
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('mouseover', highlightElement, true);
    document.removeEventListener('mouseout', unhighlightElement, true);
  }

  removeRecordingOverlay();
  saveState();
}

/**
 * Clears the current recording entirely.
 *
 * Stops recording, discards the workflow, and removes persisted state.
 */
function clearRecording() {
  stopRecording();
  currentWorkflow = null;
  isRecording = false;
  chrome.storage.local.remove(['recorder_state']);
}

/**
 * Creates and appends the recording overlay badge to the page.
 */
function createRecordingOverlay() {
  if (recordingOverlay) return;

  recordingOverlay = document.createElement('div');
  recordingOverlay.id = 'recording-overlay';
  recordingOverlay.innerHTML = `
    <div class="recording-badge">
      <div class="recording-dot"></div>
      <span>GRABANDO</span>
    </div>
    <div class="recording-info">
      Haz clic en los elementos que quieres registrar
    </div>
    <div class="recording-counter">
      Pasos: <strong id="steps-counter">0</strong>
    </div>
  `;

  document.body.appendChild(recordingOverlay);
}

/**
 * Removes the recording overlay from the page.
 */
function removeRecordingOverlay() {
  if (recordingOverlay) {
    recordingOverlay.remove();
    recordingOverlay = null;
  }
}

/**
 * Updates the step counter displayed in the overlay badge.
 */
function updateStepsCounter() {
  const counter = document.getElementById('steps-counter');
  if (counter && currentWorkflow) {
    counter.textContent = currentWorkflow.steps.length;
  }
}

/**
 * Adds a red highlight outline to an element on mouseover during recording.
 *
 * @param {Event} event - The mouseover event.
 */
function highlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '3px solid #d32f2f';
  event.target.style.outlineOffset = '2px';
  event.target.style.cursor = 'crosshair';
}

/**
 * Removes the highlight outline from an element on mouseout.
 *
 * @param {Event} event - The mouseout event.
 */
function unhighlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '';
  event.target.style.outlineOffset = '';
  event.target.style.cursor = '';
}

/**
 * Programmatically dispatches mousedown, mouseup, and click events on an element.
 *
 * Uses element.click() for non-anchor elements; dispatches a click event for anchors.
 *
 * @param {Element} element - The element to simulate a full click on.
 */
function simulateFullClick(element) {
  if (!element) return;

  const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
  const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
  const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });

  element.dispatchEvent(mousedownEvent);
  element.dispatchEvent(mouseupEvent);

  if (typeof element.click === 'function' && element.tagName.toLowerCase() !== 'a') {
    element.click();
  } else {
    element.dispatchEvent(clickEvent);
  }
}

/**
 * Handles a user click during recording.
 *
 * Generates a selector, prompts the user for a description, creates a step,
 * and manages expected-state detection for click-type steps.
 *
 * @param {Element} element - The clicked DOM element.
 * @param {number} x - ClientX of the click.
 * @param {number} y - ClientY of the click.
 */
async function handleElementClick(element, x, y) {
  const selector = generateUniqueSelector(element);
  const isInput = isInputElement(element);

  const result = await promptForDescription(element, currentWorkflow.steps.length + 1, isInput);
  if (result === null) return;

  const tooltipPosition = determineTooltipPosition(element);

  let finalSelector = selector;
  let finalStepType = isInput ? 'input' : 'click';
  if (result.isDynamic) {
    const container = findDynamicContainer(element);
    finalSelector = generateUniqueSelector(container);
    finalStepType = 'dynamic';
  }

  const step = {
    selector: finalSelector,
    description: result.description || 'Sin descripción',
    stepType: finalStepType,
    position: { x, y },
    tooltipPosition,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };

  isReplaying = true;

  if (finalStepType === 'input') {
    element.focus();
    setTimeout(() => isReplaying = false, 200);
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    await saveState();

  } else if (finalStepType === 'dynamic') {
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    await saveState();
    setTimeout(() => isReplaying = false, 200);

    simulateFullClick(element);

  } else {
    const snapBefore = snapshotDOM();

    currentWorkflow.steps.push(step);
    const stepIndex = currentWorkflow.steps.length - 1;
    updateStepsCounter();
    showConfirmationEffect(element);

    await new Promise(r => chrome.storage.local.set({
      pending_snapshot: {
        visible: [...snapBefore.visible],
        text: snapBefore.text,
        stepIndex,
        saveExpected: result.saveExpected || false,
        timestamp: Date.now()
      }
    }, r));

    await saveState();

    simulateFullClick(element);
    setTimeout(() => isReplaying = false, 200);

    const hideIndicator = showWaitingForChanges();
    await waitForDOMStability(4000, 500, 1000);
    hideIndicator();

    const snapAfter = snapshotDOM();

    const diff = computeDOMDiff(snapBefore, snapAfter);
    const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;

    if (hasDiff && result.saveExpected) {
      const expected = {};
      if (diff.appeared.length > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden = diff.disappeared;
      if (diff.newText) expected.text = diff.newText;
      currentWorkflow.steps[stepIndex].expected = expected;
      await saveState();
    }
    await new Promise(r => chrome.storage.local.remove(['pending_snapshot'], r));
  }
}

/**
 * Shows a modal dialog asking the user to describe the current step.
 *
 * @param {Element} element - The clicked element (used to suggest a description).
 * @param {number} stepNumber - The step index for display.
 * @param {boolean} [isInput=false] - Whether this is an input step.
 * @returns {Promise<{description: string, isDynamic: boolean, saveExpected: boolean}|null>}
 *   User input, or null if cancelled.
 */
function promptForDescription(element, stepNumber, isInput = false) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'recording-modal-overlay';

    const elementText = element.textContent.trim().substring(0, 50);
    const elementTag = element.tagName.toLowerCase();
    const placeholder = element.placeholder || '';
    const suggestedDescription = isInput
      ? (placeholder ? `Introduce: ${placeholder}` : `Rellena el campo ${elementTag}`)
      : (elementText || `Interactuar con ${elementTag}`);

    modal.innerHTML = `
      <div class="recording-modal">
        <h3>${isInput ? '??' : '??'} Describe este paso</h3>
        <div class="step-info">
          <strong>Paso ${stepNumber}</strong>
          <div class="element-preview">
            Elemento: <code>${elementTag}</code>${placeholder ? ` &middot; placeholder: "${placeholder}"` : ''}
            ${!isInput && elementText ? `<br>Texto: "${elementText}"` : ''}
          </div>
        </div>
        <div class="form-group">
          <label>Descripción para el usuario:</label>
          <textarea
            id="step-description"
            placeholder="Ej: Pulsa el botón de solicitar cita"
            rows="2"
          >${suggestedDescription}</textarea>
          <small style="color:#666;">Esta instrucción se mostrará durante el tutorial</small>
        </div>
        ${!isInput ? `
        <div class="form-group" style="margin-top:8px;border-top:1px solid #eee;padding-top:10px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;">
            <input type="checkbox" id="save-expected-check" style="width:16px;height:16px;cursor:pointer;">
            ?? Guardar comprobación de cambios esperados
          </label>
          <small style="color:#888;margin-left:24px;">Si está marcado, se guardarán los cambios que ocurran tras el clic para verificar que el paso funcionó.</small>
        </div>` : ''}
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;">
            <input type="checkbox" id="dynamic-step-check" style="width:16px;height:16px;cursor:pointer;">
            ?? Paso dinámico (el usuario elige libremente: fecha, destino…)
          </label>
          <small style="color:#888;margin-left:24px;">El tutorial resaltará el área completa sin fijar una opción concreta.</small>
        </div>
        <div class="modal-buttons">
          <button id="btn-cancel" class="btn-secondary">Cancelar</button>
          <button id="btn-confirm" class="btn-primary">Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const textarea = modal.querySelector('#step-description');
    const dynCheck = modal.querySelector('#dynamic-step-check');
    const saveExpCheck = modal.querySelector('#save-expected-check');
    const btnCancel = modal.querySelector('#btn-cancel');
    const btnConfirm = modal.querySelector('#btn-confirm');

    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnConfirm.click(); }
    });

    btnCancel.onclick = () => { modal.remove(); resolve(null); };
    btnConfirm.onclick = () => {
      modal.remove();
      resolve({
        description: textarea.value.trim(),
        isDynamic: dynCheck?.checked || false,
        saveExpected: saveExpCheck?.checked || false
      });
    };
  });
}

/**
 * Displays a brief checkmark confirmation effect on the clicked element.
 *
 * @param {Element} element - The element to show the effect on.
 */
function showConfirmationEffect(element) {
  const rect = element.getBoundingClientRect();
  const checkmark = document.createElement('div');
  checkmark.className = 'recording-checkmark';
  checkmark.style.left = rect.left + rect.width / 2 + 'px';
  checkmark.style.top = rect.top + rect.height / 2 + 'px';
  checkmark.innerHTML = '?';
  document.body.appendChild(checkmark);
  setTimeout(() => checkmark.remove(), 1000);
}

/** @constant {string} The chrome.storage.local key for recorder state. */
const STATE_KEY = 'recorder_state';

/**
 * Persists the current recording state to local storage.
 *
 * @returns {Promise<void>}
 */
function saveState() {
  return new Promise((resolve) => {
    const state = {
      isRecording: isRecording,
      workflow: currentWorkflow
    };
    chrome.storage.local.set({ [STATE_KEY]: state }, () => {
      if (chrome.runtime.lastError) {
        ;
      }
      resolve();
    });
  });
}

/**
 * Restores a previously saved recording session on page load.
 *
 * If state indicates an active recording, re-attaches all event listeners
 * and checks for any pending snapshot diff that needs re-evaluation.
 */
chrome.storage.local.get([STATE_KEY], (result) => {
  const state = result[STATE_KEY];
  if (state && state.workflow) {
    currentWorkflow = state.workflow;

    if (state.isRecording) {
      isRecording = true;
      createRecordingOverlay();
      updateStepsCounter();

      clickHandler = function (event) {
        if (isReplaying) return;
        if (!isRecording) return;

        if (event.target.closest('#recording-overlay')) return;
        if (event.target.closest('.recording-modal-overlay')) return;

        event.preventDefault();
        event.stopPropagation();

        handleElementClick(event.target, event.clientX, event.clientY);
      };

      document.addEventListener('click', clickHandler, true);
      document.addEventListener('mouseover', highlightElement, true);
      document.addEventListener('mouseout', unhighlightElement, true);

      chrome.storage.local.get(['pending_snapshot'], async (res) => {
        const pending = res.pending_snapshot;
        if (!pending) return;

        const age = Date.now() - (pending.timestamp || 0);
        if (age > 15000) {
          chrome.storage.local.remove(['pending_snapshot']);
          return;
        }

        const hideIndicator = showWaitingForChanges();
        await waitForDOMStability(4000, 600, 1500);
        hideIndicator();

        const snapBefore = { visible: new Set(pending.visible), text: pending.text };
        const snapAfter = snapshotDOM();

        const diff = computeDOMDiff(snapBefore, snapAfter);
        const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;

        chrome.storage.local.remove(['pending_snapshot']);

        if (!hasDiff || !pending.saveExpected) {
          return;
        }

        const expected = {};
        if (diff.appeared.length > 0) expected.visible = diff.appeared;
        if (diff.disappeared.length > 0) expected.hidden = diff.disappeared;
        if (diff.newText) expected.text = diff.newText;

        if (currentWorkflow && currentWorkflow.steps && currentWorkflow.steps[pending.stepIndex]) {
          currentWorkflow.steps[pending.stepIndex].expected = expected;
          await saveState();
        }
      });
    }
  }
});
