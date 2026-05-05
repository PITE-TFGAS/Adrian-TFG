// recorder-content.js - Script injected into web pages

let isRecording = false;
let currentWorkflow = null;
let recordingOverlay = null;
let clickHandler = null;
let isReplaying = false; // Flag for event replay

// Listen for messages from the popup
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

  return true; // Important for asynchronous responses
});

// Start Recording
function startRecording(workflow) {
  isRecording = true;
  currentWorkflow = workflow;

  // Create recording overlay
  createRecordingOverlay();

  // Add click listener
  clickHandler = function (event) {
    if (isReplaying) return;
    if (!isRecording) return;

    // Ignore clicks on the recording overlay
    if (event.target.closest('#recording-overlay')) {
      return;
    }

    // IMPORTANT: Ignore clicks on the description modal
    if (event.target.closest('.recording-modal-overlay')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    handleElementClick(event.target, event.clientX, event.clientY);
  };

  document.addEventListener('click', clickHandler, true);

  // Add hover effects
  document.addEventListener('mouseover', highlightElement, true);
  document.addEventListener('mouseout', unhighlightElement, true);

  console.log('🎥 Grabación iniciada:', workflow.name);
  saveState();
}

// Stop Recording
function stopRecording() {
  isRecording = false;

  // Remove listeners
  if (clickHandler) {
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('mouseover', highlightElement, true);
    document.removeEventListener('mouseout', unhighlightElement, true);
  }

  // Remove overlay
  removeRecordingOverlay();

  if (currentWorkflow) {
    console.log('⏹️ Grabación detenida. Pasos grabados:', currentWorkflow.steps.length);
  }
  saveState();
}

// Clear Recording
function clearRecording() {
  stopRecording();
  currentWorkflow = null;
  isRecording = false;
  chrome.storage.local.remove(['recorder_state']);
}

// Create recording overlay
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

// Remove recording overlay
function removeRecordingOverlay() {
  if (recordingOverlay) {
    recordingOverlay.remove();
    recordingOverlay = null;
  }
}

// Update steps counter in overlay
function updateStepsCounter() {
  const counter = document.getElementById('steps-counter');
  if (counter && currentWorkflow) {
    counter.textContent = currentWorkflow.steps.length;
  }
}

// Highlight element on hover
function highlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '3px solid #d32f2f';
  event.target.style.outlineOffset = '2px';
  event.target.style.cursor = 'crosshair';
}

// Remove highlight
function unhighlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '';
  event.target.style.outlineOffset = '';
  event.target.style.cursor = '';
}

/**
 * Simulate a full click sequence (mousedown -> mouseup -> click)
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

// Detect if an element is an editable input field
function isInputElement(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image'].includes(type);
  }
  if (tag === 'textarea') return true;
  if (element.isContentEditable) return true;
  return false;
}

// Handle element click
async function handleElementClick(element, x, y) {
  const selector = generateUniqueSelector(element);
  const isInput  = isInputElement(element);

  // Show description modal (Spanish UI)
  const result = await promptForDescription(element, currentWorkflow.steps.length + 1, isInput);
  if (result === null) return; // User cancelled

  const tooltipPosition = determineTooltipPosition(element);

  let finalSelector = selector;
  let finalStepType = isInput ? 'input' : 'click';
  if (result.isDynamic) {
    const container = findDynamicContainer(element);
    finalSelector   = generateUniqueSelector(container);
    finalStepType   = 'dynamic';
    console.log('[Recorder] 🎯 Paso dinámico. Contenedor seleccionado:', finalSelector);
  }

  const step = {
    selector:     finalSelector,
    description:  result.description || 'Sin descripción',
    stepType:     finalStepType,
    position:     { x, y },
    tooltipPosition,
    url:          window.location.href,
    timestamp:    new Date().toISOString()
  };

  isReplaying = true;

  if (finalStepType === 'input') {
    element.focus();
    setTimeout(() => isReplaying = false, 200);
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (input):`, step);
    await saveState();

  } else if (finalStepType === 'dynamic') {
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (dynamic):`, step);
    await saveState();
    setTimeout(() => isReplaying = false, 200);
    simulateFullClick(element);

  } else {
    const snapBefore = snapshotDOM();
    console.log('[Recorder] 📸 snapBefore:', snapBefore.visible.size, 'selectores');

    currentWorkflow.steps.push(step);
    const stepIndex = currentWorkflow.steps.length - 1;
    updateStepsCounter();
    showConfirmationEffect(element);

    await new Promise(r => chrome.storage.local.set({
      pending_snapshot: {
        visible:     [...snapBefore.visible],
        text:        snapBefore.text,
        stepIndex,
        saveExpected: result.saveExpected || false,
        timestamp:   Date.now()
      }
    }, r));

    await saveState();
    simulateFullClick(element);
    setTimeout(() => isReplaying = false, 200);

    const hideIndicator = showWaitingForChangesIndicator();
    await waitForDOMStability(4000, 500, 1000);
    hideIndicator();

    const snapAfter = snapshotDOM();
    console.log('[Recorder] 📸 snapAfter:', snapAfter.visible.size, 'selectores');

    const diff    = computeDOMDiff(snapBefore, snapAfter);
    const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
    console.log('[Recorder] diff in-page -> hasDiff:', hasDiff, diff);

    if (hasDiff && result.saveExpected) {
      const expected = {};
      if (diff.appeared.length    > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden  = diff.disappeared;
      if (diff.newText)                expected.text    = diff.newText;
      currentWorkflow.steps[stepIndex].expected = expected;
      await saveState();
      console.log('[Recorder] ✅ Expected state guardado automáticamente.');
    }
    await new Promise(r => chrome.storage.local.remove(['pending_snapshot'], r));
    console.log(`✓ Paso ${stepIndex + 1} grabado (click):`, currentWorkflow.steps[stepIndex]);
  }
}

// Detect if an ID looks dynamic
function isDynamicId(id) {
  if (!id) return true;
  const numDigits = (id.match(/\d/g) || []).length;
  if (numDigits > 3) return true;
  if (id.length > 20) return true;
  if (/^(ember|gui|gen|idx|v-)/i.test(id)) return true;
  return false;
}

// Generate unique CSS selector
function generateUniqueSelector(element) {
  if (element.id) {
    const idSelector = `#${element.id}`;
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch (e) {
      console.warn('Error con selector ID:', idSelector);
    }
  }

  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();

    if (current.id && !isDynamicId(current.id)) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    if (selector !== 'html' && selector !== 'body' && current.className && typeof current.className === 'string') {
      const skipClassPattern = /^(ng-|v-|js-|hover|active|focus|visited|link|disabled|enabled|invalid|valid)/i;
      const classes = current.className.split(' ')
        .filter(c => {
          const t = c.trim();
          return t && !t.includes(' ') && !skipClassPattern.test(t);
        })
        .map(c => c.trim());
      if (classes.length > 0) {
        selector += '.' + classes.slice(0, 3).join('.');
      }
    }

    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const sameTagSiblings = siblings.filter(s => s.nodeName === current.nodeName);
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current);
        selector += `:nth-of-type(${index + 1})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
    if (path.length > 10) break;
  }

  let fullSelector = path.join(' > ');
  try {
    const matches = document.querySelectorAll(fullSelector);
    if (matches.length === 1) return fullSelector;
  } catch (e) {
    console.warn('Error validando selector path:', fullSelector, e);
  }

  fullSelector = generateSelectorWithAttributes(element);
  try {
    const finalMatches = document.querySelectorAll(fullSelector);
    if (finalMatches.length === 1) return fullSelector;
  } catch (e) {
    console.warn('Error validando selector con atributos:', fullSelector, e);
  }

  return generateXPathSelector(element);
}

// Generate selector with additional attributes
function generateSelectorWithAttributes(element) {
  let selector = element.nodeName.toLowerCase();

  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c.trim()).map(c => c.trim());
    if (classes.length > 0) selector += '.' + classes.join('.');
  }

  const attributesToCheck = [
    'data-testid', 'data-id', 'name', 'type', 'role',
    'aria-label', 'placeholder', 'title', 'alt', 'href', 'value'
  ];

  for (const attr of attributesToCheck) {
    const value = element.getAttribute(attr);
    if (value) {
      const escapedValue = value.replace(/"/g, '\\"');
      selector += `[${attr}="${escapedValue}"]`;
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
  }

  const text = element.textContent.trim();
  if (text && text.length < 50 && !text.includes('\n')) {
    const elementsWithSameText = Array.from(document.querySelectorAll(element.nodeName))
      .filter(el => el.textContent.trim() === text);
    if (elementsWithSameText.length === 1) {
      const parent = element.parentElement;
      if (parent) {
        const index = Array.from(parent.children).indexOf(element) + 1;
        const parentSelector = parent.id ? `#${parent.id}` : parent.nodeName.toLowerCase();
        selector = `${parentSelector} > ${selector}:nth-child(${index})`;
      }
    }
  }

  return selector;
}

// Generate selector based on DOM structure
function generateXPathSelector(element) {
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.nodeName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.nodeName === current.nodeName) index++;
      sibling = sibling.previousElementSibling;
    }
    const parent = current.parentElement;
    if (parent) {
      const sameTypeSiblings = Array.from(parent.children).filter(child => child.nodeName === current.nodeName);
      if (sameTypeSiblings.length > 1) selector += `:nth-of-type(${index})`;
    }
    path.unshift(selector);
    current = current.parentElement;
    if (current && current.id) {
      path.unshift(`#${current.id}`);
      break;
    }
  }

  const finalSelector = path.join(' > ');
  try {
    const matches = document.querySelectorAll(finalSelector);
    if (matches.length === 1) return finalSelector;
  } catch (e) {
    console.warn('Error validando selector:', finalSelector, e);
  }

  const uniqueId = `temp-selector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  element.setAttribute('data-recorder-temp', uniqueId);
  const tempSelector = `[data-recorder-temp="${uniqueId}"]`;
  setTimeout(() => element.removeAttribute('data-recorder-temp'), 100);
  return tempSelector;
}

/**
 * Finds the most suitable parent container for a dynamic step.
 */
function findDynamicContainer(element) {
  const dynamicRoles    = ['dialog', 'listbox', 'grid', 'combobox', 'menu', 'tree', 'calendar', 'datepicker', 'search'];
  const dynamicKeywords = ['picker', 'calendar', 'datepicker', 'dropdown', 'popover', 'popup', 'modal', 'overlay', 'flyout', 'autocomplete', 'suggest', 'combobox', 'selector', 'panel', 'search'];

  let current = element.parentElement;
  for (let i = 0; i < 8 && current && current !== document.body; i++) {
    const role    = (current.getAttribute('role') || '').toLowerCase();
    const classes = (typeof current.className === 'string' ? current.className : '').toLowerCase();
    const id      = (current.id || '').toLowerCase();
    if (dynamicRoles.some(r => role.includes(r)) || dynamicKeywords.some(k => classes.includes(k) || id.includes(k))) return current;
    current = current.parentElement;
  }

  let fallback = element;
  for (let i = 0; i < 3 && fallback.parentElement && fallback.parentElement !== document.body; i++) {
    fallback = fallback.parentElement;
  }
  return fallback;
}

// Determine best tooltip position
function determineTooltipPosition(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;
  if (rect.top < windowHeight / 3) return 'bottom';
  if (rect.bottom > (windowHeight * 2) / 3) return 'top';
  if (rect.left < windowWidth / 4) return 'right';
  if (rect.right > (windowWidth * 3) / 4) return 'left';
  return 'bottom';
}

// Show modal to request step description (Spanish UI)
function promptForDescription(element, stepNumber, isInput = false) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'recording-modal-overlay';

    const elementText          = element.textContent.trim().substring(0, 50);
    const elementTag           = element.tagName.toLowerCase();
    const placeholder          = element.placeholder || '';
    const suggestedDescription = isInput
      ? (placeholder ? `Introduce: ${placeholder}` : `Rellena el campo ${elementTag}`)
      : (elementText || `Interactuar con ${elementTag}`);

    modal.innerHTML = `
      <div class="recording-modal">
        <h3>${isInput ? '⌨️' : '📝'} Describe este paso</h3>
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
            📊 Guardar comprobación de cambios esperados
          </label>
          <small style="color:#888;margin-left:24px;">Si está marcado, se guardarán los cambios que ocurran tras el clic para verificar que el paso funcionó.</small>
        </div>` : ''}
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;">
            <input type="checkbox" id="dynamic-step-check" style="width:16px;height:16px;cursor:pointer;">
            🔄 Paso dinámico (el usuario elige libremente: fecha, destino…)
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

    const textarea      = modal.querySelector('#step-description');
    const dynCheck      = modal.querySelector('#dynamic-step-check');
    const saveExpCheck  = modal.querySelector('#save-expected-check');
    const btnCancel     = modal.querySelector('#btn-cancel');
    const btnConfirm    = modal.querySelector('#btn-confirm');

    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnConfirm.click(); }
    });

    btnCancel.onclick  = () => { modal.remove(); resolve(null); };
    btnConfirm.onclick = () => {
      modal.remove();
      resolve({
        description:  textarea.value.trim(),
        isDynamic:    dynCheck?.checked    || false,
        saveExpected: saveExpCheck?.checked || false
      });
    };
  });
}

// Show visual confirmation effect
function showConfirmationEffect(element) {
  const rect      = element.getBoundingClientRect();
  const checkmark = document.createElement('div');
  checkmark.className  = 'recording-checkmark';
  checkmark.style.left = rect.left + rect.width  / 2 + 'px';
  checkmark.style.top  = rect.top  + rect.height / 2 + 'px';
  checkmark.innerHTML  = '✓';
  document.body.appendChild(checkmark);
  setTimeout(() => checkmark.remove(), 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM CHANGE AUTO-DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function isForRecorder(el) {
  return !!(el.closest('#recording-overlay') || el.closest('.recording-modal-overlay') || el.id === 'recorder-analyzing');
}

function isVisibleElement(el) {
  if (!el) return false;
  const rect  = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0');
}

function snapshotDOM() {
  const visible = new Set();
  document.querySelectorAll('[id]').forEach(el => { if (!isForRecorder(el) && isVisibleElement(el)) visible.add(`#${el.id}`); });
  document.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => { if (!isForRecorder(el) && isVisibleElement(el)) visible.add(`${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`); });
  const ariaSelectors = ['[role="alert"]', '[role="status"]', '[role="dialog"]', '[role="alertdialog"]', '[aria-live]', '[aria-invalid]', '[aria-expanded]'];
  document.querySelectorAll(ariaSelectors.join(',')).forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el)) return;
    if (el.id) visible.add(`#${el.id}`);
    else {
      const role = el.getAttribute('role') || el.getAttribute('aria-live') || 'live';
      const snippet = (el.textContent || '').trim().substring(0, 24).replace(/\s+/g, ' ');
      visible.add(`[role="${role}"]|${snippet}`);
    }
  });
  document.querySelectorAll('section,article,fieldset,form,dialog,aside,main').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || !el.className) return;
    const cls = el.className.toString().trim().split(/\s+/)[0];
    if (cls && cls.length >= 3 && cls.length <= 50 && !el.id) visible.add(`${el.tagName.toLowerCase()}.${cls}`);
  });
  const genericPattern = /^(row|col|container|wrapper|d-|p-|m-|text-|bg-|btn|icon|flex|grid|sr-only|show|hide|active|fade|modal-|ng-|v-|js-)/ ;
  document.querySelectorAll('div[class]').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || el.id) return;
    const classes = el.className.toString().trim().split(/\s+/);
    const sig = classes.find(c => c.length >= 4 && c.length <= 50 && !genericPattern.test(c));
    if (sig) visible.add(`div.${sig}`);
  });
  return { visible, text: document.body.innerText || '' };
}

function computeDOMDiff(before, after) {
  const appeared    = [];
  const disappeared = [];
  after.visible.forEach(sel  => { if (!before.visible.has(sel)) appeared.push(sel); });
  before.visible.forEach(sel => { if (!after.visible.has(sel))  disappeared.push(sel); });
  const beforeLines = new Set(before.text.split('\n').map(l => l.trim()).filter(l => l.length > 4));
  const newLines = after.text.split('\n').map(l => l.trim()).filter(l => l.length > 4 && !beforeLines.has(l));
  const newText = newLines.slice(0, 3).join(' ').trim().substring(0, 120);
  return { appeared, disappeared, newText };
}

function waitForDOMStability(maxMs = 4000, stableMs = 500, minMs = 1000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    let stableTimer = null;
    let finished    = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(stableTimer); observer.disconnect(); resolve(); };
    const resetTimer = () => { clearTimeout(stableTimer); const elapsed = Date.now() - startTime; const wait = Math.max(stableMs, minMs - elapsed); stableTimer = setTimeout(finish, wait); };
    const observer = new MutationObserver(resetTimer);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'disabled'] });
    setTimeout(finish, maxMs);
    resetTimer();
  });
}

function showWaitingForChangesIndicator() {
  const el = document.createElement('div');
  el.id = 'recorder-analyzing';
  el.style.cssText = `position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1565c0; color:white; padding:12px 24px; border-radius:50px; font-family:sans-serif; font-size:14px; z-index:1000002; box-shadow:0 4px 16px rgba(0,0,0,0.3);`;
  el.textContent = '🔍 Analizando cambios en la página...';
  document.body.appendChild(el);
  return () => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s ease'; setTimeout(() => el.remove(), 300); };
}

function promptForExpectedState(diff) {
  return new Promise((resolve) => {
    const prev = document.getElementById('recorder-expected-bar');
    if (prev) prev.remove();
    const bar = document.createElement('div');
    bar.id = 'recorder-expected-bar';
    bar.style.cssText = `position: fixed; bottom: 0; left: 0; right: 0; background: #1e1e2e; color: #fff; padding: 12px 20px; display: flex; align-items: center; gap: 12px; z-index: 2147483647; font-family: system-ui, sans-serif; font-size: 13px; box-shadow: 0 -4px 20px rgba(0,0,0,0.4); border-top: 2px solid #7c3aed;`;
    const summary = [
      diff.appeared.length    > 0 ? `${diff.appeared.length} aparecieron`    : '',
      diff.disappeared.length > 0 ? `${diff.disappeared.length} desaparecieron` : '',
      diff.newText            ? 'texto nuevo'                                  : ''
    ].filter(Boolean).join(' · ');
    bar.innerHTML = `
      <span style="flex:1;">🔍 <strong>Cambios detectados:</strong> ${summary} — ¿Guardar comprobación?</span>
      <button id="rec-bar-skip" style="padding:6px 14px;border:1px solid #555;background:transparent; color:#ccc;border-radius:6px;cursor:pointer;font-size:13px;">Omitir</button>
      <button id="rec-bar-save" style="padding:6px 14px;background:#7c3aed;border:none; color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">✅ Guardar</button>
    `;
    document.body.appendChild(bar);
    const autoClose = setTimeout(() => { bar.remove(); resolve(null); }, 15000);
    bar.querySelector('#rec-bar-skip').onclick = () => { clearTimeout(autoClose); bar.remove(); resolve(null); };
    bar.querySelector('#rec-bar-save').onclick = () => {
      clearTimeout(autoClose); bar.remove();
      const expected = {};
      if (diff.appeared.length    > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden  = diff.disappeared;
      if (diff.newText)                expected.text    = diff.newText;
      resolve(expected);
    };
  });
}

// State Persistence
const STATE_KEY = 'recorder_state';

function saveState() {
  return new Promise((resolve) => {
    const state = { isRecording: isRecording, workflow: currentWorkflow };
    chrome.storage.local.set({ [STATE_KEY]: state }, () => {
      if (chrome.runtime.lastError) console.error("Error guardando estado:", chrome.runtime.lastError);
      resolve();
    });
  });
}

// Restore state on page load
chrome.storage.local.get([STATE_KEY], (result) => {
  const state = result[STATE_KEY];
  if (state && state.workflow) {
    console.log("🔄 Restaurando estado de grabación...");
    currentWorkflow = state.workflow;
    if (state.isRecording) {
      isRecording = true;
      createRecordingOverlay();
      updateStepsCounter();
      clickHandler = function (event) {
        if (isReplaying) return;
        if (!isRecording) return;
        if (event.target.closest('#recording-overlay') || event.target.closest('.recording-modal-overlay')) return;
        event.preventDefault(); event.stopPropagation();
        handleElementClick(event.target, event.clientX, event.clientY);
      };
      document.addEventListener('click', clickHandler, true);
      document.addEventListener('mouseover', highlightElement, true);
      document.addEventListener('mouseout', unhighlightElement, true);
      console.log("✅ Grabación reanudada tras navegación");
      chrome.storage.local.get(['pending_snapshot'], async (res) => {
        const pending = res.pending_snapshot;
        if (!pending) return;
        const age = Date.now() - (pending.timestamp || 0);
        if (age > 15000) { chrome.storage.local.remove(['pending_snapshot']); return; }
        console.log('[Recorder] 🔄 Snapshot pendiente encontrado. Analizando cambios...');
        const hideIndicator = showWaitingForChangesIndicator();
        await waitForDOMStability(4000, 600, 1500);
        hideIndicator();
        const snapBefore = { visible: new Set(pending.visible), text: pending.text };
        const snapAfter  = snapshotDOM();
        const diff    = computeDOMDiff(snapBefore, snapAfter);
        const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
        chrome.storage.local.remove(['pending_snapshot']);
        if (!hasDiff || !pending.saveExpected) return;
        const expected = {};
        if (diff.appeared.length    > 0) expected.visible = diff.appeared;
        if (diff.disappeared.length > 0) expected.hidden  = diff.disappeared;
        if (diff.newText)                expected.text    = diff.newText;
        if (currentWorkflow && currentWorkflow.steps && currentWorkflow.steps[pending.stepIndex]) {
          currentWorkflow.steps[pending.stepIndex].expected = expected;
          await saveState();
          console.log('[Recorder] ✅ Expected state guardado (cross-page) en paso', pending.stepIndex);
        }
      });
    }
  }
});