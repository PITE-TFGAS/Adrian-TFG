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

// Start recording
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

  // Add hover effect
  document.addEventListener('mouseover', highlightElement, true);
  document.addEventListener('mouseout', unhighlightElement, true);

  console.log('🎥 Grabación iniciada:', workflow.name);
  saveState();
}

// Stop recording
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

  console.log('⏹️ Grabación detenida. Pasos grabados:', currentWorkflow.steps.length);
  saveState();
}

// Clear recording
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
  // Don't highlight elements inside the modal
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '3px solid #d32f2f';
  event.target.style.outlineOffset = '2px';
  event.target.style.cursor = 'crosshair';
}

// Remove highlight
function unhighlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  // Don't remove highlight from elements inside the modal
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '';
  event.target.style.outlineOffset = '';
  event.target.style.cursor = '';
}

// Simulate a full click sequence (mousedown -> mouseup -> click)
// Necessary for some components like airline dropdowns
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
    // Exclude checkboxes, radios, buttons and files which are different types of interaction
    return !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image'].includes(type);
  }
  if (tag === 'textarea') return true;
  // Content editable divs (e.g., rich text editors)
  if (element.isContentEditable) return true;
  return false;
}

// Handle element click
async function handleElementClick(element, x, y) {
  const selector = generateUniqueSelector(element);
  const isInput = isInputElement(element);

  // Show description modal
  const result = await promptForDescription(element, currentWorkflow.steps.length + 1, isInput);
  if (result === null) return; // User cancelled

  const tooltipPosition = determineTooltipPosition(element);

  // If the step is dynamic, use the parent container selector
  let finalSelector = selector;
  let finalStepType = isInput ? 'input' : 'click';
  if (result.isDynamic) {
    const container = findDynamicContainer(element);
    finalSelector = generateUniqueSelector(container);
    finalStepType = 'dynamic';
    console.log('[Recorder] 🎯 Paso dinámico. Contenedor seleccionado:', finalSelector);
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
    // INPUT: no change detection (user writes next)
    element.focus();
    setTimeout(() => isReplaying = false, 200);
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (input):`, step);
    await saveState();

  } else if (finalStepType === 'dynamic') {
    // DYNAMIC: record container, don't simulate click (user chooses during playback)
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (dynamic):`, step);
    await saveState();
    setTimeout(() => isReplaying = false, 200);

    // Simulate original click so the page follows its normal flow during recording
    simulateFullClick(element);

  } else {
    // CLICK: page might navigate → save everything to storage BEFORE click

    // 1. Snapshot of current state (before click)
    const snapBefore = snapshotDOM();
    console.log('[Recorder] 📸 snapBefore:', snapBefore.visible.size, 'selectores');

    // 2. Add step to workflow and save state (persists if page navigates)
    currentWorkflow.steps.push(step);
    const stepIndex = currentWorkflow.steps.length - 1;
    updateStepsCounter();
    showConfirmationEffect(element);

    // 3. Save snapBefore to storage to recover it on the new page
    await new Promise(r => chrome.storage.local.set({
      pending_snapshot: {
        visible: [...snapBefore.visible],
        text: snapBefore.text,
        stepIndex,
        saveExpected: result.saveExpected || false, // user's choice
        timestamp: Date.now()
      }
    }, r));

    // 4. Save workflow state (including the new step)
    await saveState();

    // 5. Simulate click (likely causes navigation)
    simulateFullClick(element);
    setTimeout(() => isReplaying = false, 200);

    // 6. Try in-page detection (for SPAs pushState without reload)
    const hideIndicator = showWaitingForChanges();
    await waitForDOMStability(4000, 500, 1000);
    hideIndicator();

    const snapAfter = snapshotDOM();
    console.log('[Recorder] 📸 snapAfter:', snapAfter.visible.size, 'selectores');

    const diff = computeDOMDiff(snapBefore, snapAfter);
    const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
    console.log('[Recorder] diff in-page → hayDiff:', hasDiff, diff);

    if (hasDiff && result.saveExpected) {
      // Save automatically without asking — user already checked the box
      const expected = {};
      if (diff.appeared.length > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden = diff.disappeared;
      if (diff.newText) expected.text = diff.newText;
      currentWorkflow.steps[stepIndex].expected = expected;
      await saveState();
      console.log('[Recorder] ✅ Expected state guardado automáticamente.');
    }
    await new Promise(r => chrome.storage.local.remove(['pending_snapshot'], r));

    console.log(`✓ Paso ${stepIndex + 1} grabado (click):`, currentWorkflow.steps[stepIndex]);
  }
}

// Detect if an ID appears to be dynamic (contains sequential numbers, is very long/random)
function isDynamicId(id) {
  if (!id) return true;
  // IDs containing many numbers are usually dynamic (e.g., ember123, jstree-4)
  const numDigits = (id.match(/\d/g) || []).length;
  if (numDigits > 3) return true;
  // Very long IDs generated by frameworks
  if (id.length > 20) return true;
  // Known dynamic IDs from common frameworks
  if (/^(ember|gui|gen|idx|v-)/i.test(id)) return true;
  return false;
}

// Generate unique and specific CSS selector
function generateUniqueSelector(element) {
  // Method 1: If it has a unique ID, use it directly
  if (element.id) {
    const idSelector = `#${element.id}`;
    // Verify it's actually unique
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch (e) {
      console.warn('Error with ID selector:', idSelector);
    }
  }

  // Method 2: Build selector from element to root
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();

    // If it has an ID and doesn't seem dynamic, use it and stop
    if (current.id && !isDynamicId(current.id)) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    // Add classes if it has them (omitting html and body, which often have unstable classes)
    if (selector !== 'html' && selector !== 'body' && current.className && typeof current.className === 'string') {
      // Ignore classes that are usually state-related (hover, active) or autogenerated
      const skipClassPattern = /^(ng-|v-|js-|hover|active|focus|visited|link|disabled|enabled|invalid|valid)/i;

      const classes = current.className.split(' ')
        .filter(c => {
          const t = c.trim();
          return t && !t.includes(' ') && !skipClassPattern.test(t);
        })
        .map(c => c.trim());

      if (classes.length > 0) {
        // Limit to 3 classes max per level to avoid long selectors
        selector += '.' + classes.slice(0, 3).join('.');
      }
    }

    // Get nth-child index to make it unique
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const sameTagSiblings = siblings.filter(s => s.nodeName === current.nodeName);

      // If there are multiple siblings with the same tag
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current);
        selector += `:nth-of-type(${index + 1})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Limit depth to avoid absurdly long selectors
    if (path.length > 10) {
      break;
    }
  }

  // Join path with '>'
  let fullSelector = path.join(' > ');

  // Verify if unique
  try {
    const matches = document.querySelectorAll(fullSelector);
    if (matches.length === 1) {
      console.log('✓ Selector único generado (método 2):', fullSelector);
      return fullSelector;
    }
  } catch (e) {
    console.warn('Error validating path selector:', fullSelector, e);
  }

  // Method 3: If still not unique, add more specific attributes
  fullSelector = generateSelectorWithAttributes(element);

  // Verify again
  try {
    const finalMatches = document.querySelectorAll(fullSelector);
    if (finalMatches.length === 1) {
      console.log('✓ Selector único generado (método 3):', fullSelector);
      return fullSelector;
    }
  } catch (e) {
    console.warn('Error validating attribute selector:', fullSelector, e);
  }

  // Method 4: Last resort - use complete DOM structure
  const fallbackSelector = generateXPathSelector(element);
  console.log('✓ Selector único generado (método 4 - fallback):', fallbackSelector);
  return fallbackSelector;
}

// Generate selector with additional attributes
function generateSelectorWithAttributes(element) {
  let selector = element.nodeName.toLowerCase();

  // Add classes
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ')
      .filter(c => c.trim())
      .map(c => c.trim());
    if (classes.length > 0) {
      selector += '.' + classes.join('.');
    }
  }

  // Add specific attributes that help identify the element
  const attributesToCheck = [
    'data-testid',
    'data-id',
    'name',
    'type',
    'role',
    'aria-label',
    'placeholder',
    'title',
    'alt',
    'href',
    'value'
  ];

  for (const attr of attributesToCheck) {
    const value = element.getAttribute(attr);
    if (value) {
      // Escape special characters in value
      const escapedValue = value.replace(/"/g, '\\"');
      selector += `[${attr}="${escapedValue}"]`;

      // Verify if unique
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // If it has short unique text, use it
  const text = element.textContent.trim();
  if (text && text.length < 50 && !text.includes('\n')) {
    // Check how many elements have exactly the same text
    const elementsWithSameText = Array.from(document.querySelectorAll(element.nodeName))
      .filter(el => el.textContent.trim() === text);

    if (elementsWithSameText.length === 1) {
      // We can use a selector with text (though not pure CSS)
      // Instead, we add nth-child from parent
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

// Generate selector based on DOM structure (more precise)
function generateXPathSelector(element) {
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.nodeName.toLowerCase();

    // Count siblings of same type
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    // Count total siblings of same type
    const parent = current.parentElement;
    if (parent) {
      const sameTypeSiblings = Array.from(parent.children).filter(
        child => child.nodeName === current.nodeName
      );

      // Only add nth-of-type if there's more than one of the same type
      if (sameTypeSiblings.length > 1) {
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // If we reach an element with an ID, stop
    if (current && current.id) {
      path.unshift(`#${current.id}`);
      break;
    }
  }

  // Join with ' > ' for direct selector
  const finalSelector = path.join(' > ');

  // Verify if unique
  try {
    const matches = document.querySelectorAll(finalSelector);
    if (matches.length === 1) {
      return finalSelector;
    }
  } catch (e) {
    console.warn('Error validating selector:', finalSelector, e);
  }

  // If still not unique, use absolute position with data attribute
  // Add a unique temporary attribute
  const uniqueId = `temp-selector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  element.setAttribute('data-recorder-temp', uniqueId);
  const tempSelector = `[data-recorder-temp="${uniqueId}"]`;

  // Save for later cleanup
  setTimeout(() => {
    element.removeAttribute('data-recorder-temp');
  }, 100);

  return tempSelector;
}

/**
 * Finds the most suitable parent container for a dynamic step.
 * RULES:
 *  1. Only Structural UI COMPONENT keywords (not content/domain).
 *     Words like 'airport', 'city', 'day' caused hidden elements with d-none to be selected, breaking player polling.
 *  2. Never use position:absolute/fixed (those elements are not always in DOM).
 *  3. Fallback: 3 levels up (stable ancestor always visible).
 */
function findDynamicContainer(element) {
  const dynamicRoles = ['dialog', 'listbox', 'grid', 'combobox', 'menu',
    'tree', 'calendar', 'datepicker', 'search'];
  // Only words describing the COMPONENT, not the content
  const dynamicKeywords = ['picker', 'calendar', 'datepicker', 'dropdown',
    'popover', 'popup', 'modal', 'overlay', 'flyout',
    'autocomplete', 'suggest', 'combobox',
    'selector', 'panel', 'search'];

  let current = element.parentElement;
  for (let i = 0; i < 8 && current && current !== document.body; i++) {
    const role = (current.getAttribute('role') || '').toLowerCase();
    const classes = (typeof current.className === 'string' ? current.className : '').toLowerCase();
    const id = (current.id || '').toLowerCase();

    if (dynamicRoles.some(r => role.includes(r))) return current;
    if (dynamicKeywords.some(k => classes.includes(k) || id.includes(k))) return current;

    current = current.parentElement;
  }

  // Fallback: 3 levels up — points to a stable container always in DOM
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

  // If at the top, show below
  if (rect.top < windowHeight / 3) {
    return 'bottom';
  }

  // If at the bottom, show above
  if (rect.bottom > (windowHeight * 2) / 3) {
    return 'top';
  }

  // If far left, show on right
  if (rect.left < windowWidth / 4) {
    return 'right';
  }

  // If far right, show on left
  if (rect.right > (windowWidth * 3) / 4) {
    return 'left';
  }

  // Default to bottom
  return 'bottom';
}

// Show modal to ask for step description
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

// Show visual confirmation effect
function showConfirmationEffect(element) {
  const rect = element.getBoundingClientRect();
  const checkmark = document.createElement('div');
  checkmark.className = 'recording-checkmark';
  checkmark.style.left = rect.left + rect.width / 2 + 'px';
  checkmark.style.top = rect.top + rect.height / 2 + 'px';
  checkmark.innerHTML = '✓';
  document.body.appendChild(checkmark);
  setTimeout(() => checkmark.remove(), 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM CHANGE AUTO-DETECTION
// Compares page state before and after a click to automatically generate
// the "expected" field without requiring technical knowledge from the recorder.
// ─────────────────────────────────────────────────────────────────────────────

/** Checks if an element belongs to the recorder UI (to exclude it from snapshot). */
function isForRecorder(el) {
  return !!(el.closest('#recording-overlay') ||
    el.closest('.recording-modal-overlay') ||
    el.id === 'recorder-analyzing');
}

/** Checks if an element is visible to the user (dimensions + CSS). */
function isVisibleElement(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    style.opacity !== '0'
  );
}

/**
 * Takes a DOM snapshot using 4 strategies for maximum coverage:
 *  1. Elements with ID         → most reliable, but many sites don't use them
 *  2. Form fields by name      → very useful in multi-step forms
 *  3. ARIA alert/dialog/status elements → detect error/success messages
 *  4. Semantic containers with class → visible sections, forms, fieldsets
 *
 * @returns {{ visible: Set<string>, text: string }}
 */
function snapshotDOM() {
  const visible = new Set();

  // Strategy 1: elements with ID (most reliable selectors)
  document.querySelectorAll('[id]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`#${el.id}`);
    }
  });

  // Strategy 2: inputs, selects, and textareas with name attribute
  //   → very common in multi-step forms (appear/disappear on advance)
  document.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`);
    }
  });

  // Strategy 3: ARIA elements signaling error, success, or dialogs
  //   → fundamental for detecting if a form submission failed or succeeded
  const ariaSelectors = [
    '[role="alert"]', '[role="status"]', '[role="dialog"]',
    '[role="alertdialog"]', '[aria-live]', '[aria-invalid]',
    '[aria-expanded]'
  ];
  document.querySelectorAll(ariaSelectors.join(',')).forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el)) return;
    // Use ID if it has one, otherwise build a composite key
    if (el.id) {
      visible.add(`#${el.id}`);
    } else {
      const role = el.getAttribute('role') || el.getAttribute('aria-live') || 'live';
      const snippet = (el.textContent || '').trim().substring(0, 24).replace(/\s+/g, ' ');
      visible.add(`[role="${role}"]|${snippet}`);
    }
  });

  // Strategy 4: semantic containers with class
  document.querySelectorAll('section,article,fieldset,form,dialog,aside,main').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || !el.className) return;
    const cls = el.className.toString().trim().split(/\s+/)[0];
    if (cls && cls.length >= 3 && cls.length <= 50 && !el.id) visible.add(`${el.tagName.toLowerCase()}.${cls}`);
  });

  // Strategy 5: divs with significant CSS class (dominant pattern in SPAs)
  // Excludes generic Bootstrap/Tailwind classes that don't distinguish content
  const genericPattern = /^(row|col|container|wrapper|d-|p-|m-|text-|bg-|btn|icon|flex|grid|sr-only|show|hide|active|fade|modal-|ng-|v-|js-)/;
  document.querySelectorAll('div[class]').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || el.id) return;
    const classes = el.className.toString().trim().split(/\s+/);
    const sig = classes.find(c => c.length >= 4 && c.length <= 50 && !genericPattern.test(c));
    if (sig) visible.add(`div.${sig}`);
  });

  console.log('[Recorder] snapshot →', visible.size, 'selectores |', [...visible].slice(0, 6));
  return { visible, text: document.body.innerText || '' };
}

/**
 * Compares two snapshots and returns which selectors appeared, disappeared, and what text is new.
 * @returns {{ appeared: string[], disappeared: string[], newText: string }}
 */
function computeDOMDiff(before, after) {
  const appeared = [];
  const disappeared = [];

  after.visible.forEach(sel => { if (!before.visible.has(sel)) appeared.push(sel); });
  before.visible.forEach(sel => { if (!after.visible.has(sel)) disappeared.push(sel); });

  // Detect new text: lines longer than 4 characters that weren't there before
  const beforeLines = new Set(
    before.text.split('\n').map(l => l.trim()).filter(l => l.length > 4)
  );
  const newLines = after.text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 4 && !beforeLines.has(l));
  const newText = newLines.slice(0, 3).join(' ').trim().substring(0, 120);

  return { appeared, disappeared, newText };
}

/**
 * Waits for the DOM to stop mutating for `stableMs` milliseconds
 * or until reaching the `maxMs` maximum timeout.
 * Much more reliable than a fixed setTimeout in SPAs with animations or async loads.
 *
 * @param {number} maxMs    - Maximum total wait time (default 4000 ms)
 * @param {number} stableMs - Mutation-free time to consider DOM stable (default 500 ms)
 * @returns {Promise<void>}
 */
function waitForDOMStability(maxMs = 4000, stableMs = 500, minMs = 1000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    let stableTimer = null;
    let finished = false;

    const finish = () => {
      if (finished) return; // avoid double call
      finished = true;
      clearTimeout(stableTimer);
      observer.disconnect();
      console.log(`[Recorder] DOM estable tras ${Date.now() - startTime}ms`);
      resolve();
    };

    const resetTimer = () => {
      clearTimeout(stableTimer);
      const elapsed = Date.now() - startTime;
      const wait = Math.max(stableMs, minMs - elapsed);
      stableTimer = setTimeout(finish, wait);
    };

    const observer = new MutationObserver(resetTimer);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'disabled']
    });

    // Safety maximum timeout
    setTimeout(finish, maxMs);
    // Start first timer
    resetTimer();
  });
}

/**
 * Shows an "Analyzing changes..." indicator while we wait.
 * Returns a function to hide it.
 */
function showWaitingForChanges() {
  const el = document.createElement('div');
  el.id = 'recorder-analyzing';
  el.style.cssText = `
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    background:#1565c0; color:white;
    padding:12px 24px; border-radius:50px;
    font-family:sans-serif; font-size:14px;
    z-index:1000002; box-shadow:0 4px 166px rgba(0,0,0,0.3);
  `;
  el.textContent = '🔍 Analizando cambios en la página...';
  document.body.appendChild(el);
  return () => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s ease';
    setTimeout(() => el.remove(), 300);
  };
}

/**
 * Shows a NON-BLOCKING floating bar at the bottom of the screen
 * to ask whether to save the state check.
 * DOES NOT steal focus or close dropdowns/autocompletes.
 */
function promptForExpectedState(diff) {
  return new Promise((resolve) => {
    const prev = document.getElementById('recorder-expected-bar');
    if (prev) prev.remove();

    const bar = document.createElement('div');
    bar.id = 'recorder-expected-bar';
    bar.style.cssText = `
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #1e1e2e;
      color: #fff;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 2147483647;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
      border-top: 2px solid #7c3aed;
    `;

    const summary = [
      diff.appeared.length > 0 ? `${diff.appeared.length} aparecieron` : '',
      diff.disappeared.length > 0 ? `${diff.disappeared.length} desaparecieron` : '',
      diff.newText ? 'texto nuevo' : ''
    ].filter(Boolean).join(' · ');

    bar.innerHTML = `
      <span style="flex:1;">🔍 <strong>Cambios detectados:</strong> ${summary} — ¿Guardar comprobación?</span>
      <button id="rec-bar-skip" style="
        padding:6px 14px;border:1px solid #555;background:transparent;
        color:#ccc;border-radius:6px;cursor:pointer;font-size:13px;
      ">Omitir</button>
      <button id="rec-bar-save" style="
        padding:6px 14px;background:#7c3aed;border:none;
        color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;
      ">✅ Guardar</button>
    `;

    document.body.appendChild(bar);

    const autoClose = setTimeout(() => { bar.remove(); resolve(null); }, 15000);

    bar.querySelector('#rec-bar-skip').onclick = () => {
      clearTimeout(autoClose);
      bar.remove();
      resolve(null);
    };

    bar.querySelector('#rec-bar-save').onclick = () => {
      clearTimeout(autoClose);
      bar.remove();
      const expected = {};
      if (diff.appeared.length > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden = diff.disappeared;
      if (diff.newText) expected.text = diff.newText;
      resolve(expected);
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// END AUTO-DETECTION
// ─────────────────────────────────────────────────────────────────────────────

// --- State Persistence ---
const STATE_KEY = 'recorder_state';

function saveState() {
  return new Promise((resolve) => {
    const state = {
      isRecording: isRecording,
      workflow: currentWorkflow
    };
    chrome.storage.local.set({ [STATE_KEY]: state }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error guardando estado:", chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

// Restore state upon page load
chrome.storage.local.get([STATE_KEY], (result) => {
  const state = result[STATE_KEY];
  if (state && state.workflow) {
    console.log("🔄 Restaurando estado de grabación...");
    currentWorkflow = state.workflow;

    if (state.isRecording) {
      isRecording = true;
      createRecordingOverlay();
      updateStepsCounter();

      // Re-assign listeners
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

      console.log("✅ Grabación reanudada tras navegación");

      // ── Check for pending snapshot from previous page ───────────
      // Occurs when: a click was recorded that caused navigation to this page.
      // The "before" snapshot was saved before the click; now we take the "after".
      chrome.storage.local.get(['pending_snapshot'], async (res) => {
        const pending = res.pending_snapshot;
        if (!pending) return;

        const age = Date.now() - (pending.timestamp || 0);
        if (age > 15000) {
          // Snapshot too old (>15s), ignore
          chrome.storage.local.remove(['pending_snapshot']);
          return;
        }

        console.log('[Recorder] 🔄 Snapshot pendiente encontrado (', Math.round(age / 1000), 's ago). Analizando cambios...');

        // Wait for new page to load and stabilize
        const hideIndicator = showWaitingForChanges();
        await waitForDOMStability(4000, 600, 1500);
        hideIndicator();

        // Reconstruct snapBefore (Set was serialized as array)
        const snapBefore = { visible: new Set(pending.visible), text: pending.text };
        const snapAfter = snapshotDOM();

        console.log('[Recorder] 📸 snapBefore:', snapBefore.visible.size, 'selectores (página anterior)');
        console.log('[Recorder] 📸 snapAfter:', snapAfter.visible.size, 'selectores (nueva página)');

        const diff = computeDOMDiff(snapBefore, snapAfter);
        const hasDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
        console.log('[Recorder] diff post-navegación → hayDiff:', hasDiff, diff);

        // Always clear pending_snapshot
        chrome.storage.local.remove(['pending_snapshot']);

        if (!hasDiff || !pending.saveExpected) {
          // No changes, or user didn't want to save them — do nothing
          return;
        }

        // Save expected state automatically (without showing any prompt)
        const expected = {};
        if (diff.appeared.length > 0) expected.visible = diff.appeared;
        if (diff.disappeared.length > 0) expected.hidden = diff.disappeared;
        if (diff.newText) expected.text = diff.newText;

        if (currentWorkflow && currentWorkflow.steps && currentWorkflow.steps[pending.stepIndex]) {
          currentWorkflow.steps[pending.stepIndex].expected = expected;
          await saveState();
          console.log('[Recorder] ✅ Expected state guardado (cross-page) en paso', pending.stepIndex);
        }
      });
      // ───────────────────────────────────────────────────────────
    }
  }
});