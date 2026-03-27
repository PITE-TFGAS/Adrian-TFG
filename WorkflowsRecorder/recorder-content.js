// recorder-content.js - Script que se inyecta en las páginas web

let isRecording = false;
let currentWorkflow = null;
let recordingOverlay = null;
let clickHandler = null;
let isReplaying = false; // Flag for event replay

// Escuchar mensajes desde el popup
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

  return true; // Importante para respuestas asíncronas
});

// Iniciar grabación
function startRecording(workflow) {
  isRecording = true;
  currentWorkflow = workflow;

  // Crear overlay de grabación
  createRecordingOverlay();

  // Agregar listener de clics
  clickHandler = function (event) {
    if (isReplaying) return;
    if (!isRecording) return;

    // Ignorar clics en el overlay de grabación
    if (event.target.closest('#recording-overlay')) {
      return;
    }

    // IMPORTANTE: Ignorar clics en el modal de descripción
    if (event.target.closest('.recording-modal-overlay')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    handleElementClick(event.target, event.clientX, event.clientY);
  };

  document.addEventListener('click', clickHandler, true);

  // Agregar hover effect
  document.addEventListener('mouseover', highlightElement, true);
  document.addEventListener('mouseout', unhighlightElement, true);

  console.log('🎥 Grabación iniciada:', workflow.name);
  saveState();
}

// Detener grabación
function stopRecording() {
  isRecording = false;

  // Remover listeners
  if (clickHandler) {
    document.removeEventListener('click', clickHandler, true);
    document.removeEventListener('mouseover', highlightElement, true);
    document.removeEventListener('mouseout', unhighlightElement, true);
  }

  // Remover overlay
  removeRecordingOverlay();

  console.log('⏹️ Grabación detenida. Pasos grabados:', currentWorkflow.steps.length);
  saveState();
}

// Limpiar grabación
function clearRecording() {
  stopRecording();
  currentWorkflow = null;
  isRecording = false;
  chrome.storage.local.remove(['recorder_state']);
}

// Crear overlay de grabación
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

// Remover overlay de grabación
function removeRecordingOverlay() {
  if (recordingOverlay) {
    recordingOverlay.remove();
    recordingOverlay = null;
  }
}

// Actualizar contador en overlay
function updateStepsCounter() {
  const counter = document.getElementById('steps-counter');
  if (counter && currentWorkflow) {
    counter.textContent = currentWorkflow.steps.length;
  }
}

// Resaltar elemento al pasar el mouse
function highlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  // No resaltar elementos dentro del modal
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '3px solid #d32f2f';
  event.target.style.outlineOffset = '2px';
  event.target.style.cursor = 'crosshair';
}

// Quitar resaltado
function unhighlightElement(event) {
  if (!isRecording) return;
  if (event.target.closest('#recording-overlay')) return;
  // No quitar resaltado de elementos dentro del modal
  if (event.target.closest('.recording-modal-overlay')) return;

  event.target.style.outline = '';
  event.target.style.outlineOffset = '';
  event.target.style.cursor = '';
}

// Simular una secuencia completa de clic (mousedown -> mouseup -> click)
// Esto es necesario para ciertos componentes como desplegables de aerolíneas
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

// Detectar si un elemento es un campo de entrada editable
function isInputElement(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (element.type || 'text').toLowerCase();
    // Excluir checkboxes, radios, botones y ficheros que son otro tipo de interacción
    return !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image'].includes(type);
  }
  if (tag === 'textarea') return true;
  // Divs editables (e.g. rich text editors)
  if (element.isContentEditable) return true;
  return false;
}

// Manejar clic en elemento
async function handleElementClick(element, x, y) {
  const selector = generateUniqueSelector(element);
  const isInput  = isInputElement(element);

  // Mostrar modal de descripción
  const result = await promptForDescription(element, currentWorkflow.steps.length + 1, isInput);
  if (result === null) return; // Usuario canceló

  const tooltipPosition = determineTooltipPosition(element);
  const step = {
    selector,
    description:     result.description || 'Sin descripción',
    stepType:        isInput ? 'input' : 'click',
    position:        { x, y },
    tooltipPosition,
    url:             window.location.href,
    timestamp:       new Date().toISOString()
  };

  isReplaying = true;

  if (isInput) {
    // INPUT: sin detección de cambios (el usuario escribe a continuación)
    element.focus();
    setTimeout(() => isReplaying = false, 200);
    currentWorkflow.steps.push(step);
    updateStepsCounter();
    showConfirmationEffect(element);
    console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (input):`, step);
    await saveState();

  } else {
    // CLICK: la página puede navegar → guardar todo en storage ANTES del clic

    // 1. Snapshot del estado actual (antes del clic)
    const snapBefore = snapshotDOM();
    console.log('[Recorder] 📸 snapBefore:', snapBefore.visible.size, 'selectores');

    // 2. Añadir el paso al workflow y guardar estado (persiste si la página navega)
    currentWorkflow.steps.push(step);
    const stepIndex = currentWorkflow.steps.length - 1;
    updateStepsCounter();
    showConfirmationEffect(element);

    // 3. Guardar snapBefore en storage para recuperarlo en la nueva página
    await new Promise(r => chrome.storage.local.set({
      pending_snapshot: {
        visible:   [...snapBefore.visible],
        text:      snapBefore.text,
        stepIndex,
        timestamp: Date.now()
      }
    }, r));

    // 4. Guardar estado del workflow (con el paso ya incluido)
    await saveState();

    // 5. Simular el clic (que probablemente cause navegación)
    simulateFullClick(element);
    setTimeout(() => isReplaying = false, 200);

    // 6. Intentar detección en la misma página (para SPAs pushState sin recarga)
    const ocultarIndicador = mostrarEsperandoCambios();
    await waitForDOMStability(4000, 500, 1000);
    ocultarIndicador();

    const snapAfter = snapshotDOM();
    console.log('[Recorder] 📸 snapAfter:', snapAfter.visible.size, 'selectores');

    const diff    = computeDOMDiff(snapBefore, snapAfter);
    const hayDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
    console.log('[Recorder] diff in-page → hayDiff:', hayDiff, diff);

    if (hayDiff) {
      // Encontrado en la misma página → procesar aquí y limpiar storage
      const expected = await promptForExpectedState(diff);
      if (expected) {
        currentWorkflow.steps[stepIndex].expected = expected;
        await saveState();
      }
      await new Promise(r => chrome.storage.local.remove(['pending_snapshot'], r));
    }
    // Si no hay diff en esta página, pending_snapshot queda para la nueva página

    console.log(`✓ Paso ${stepIndex + 1} grabado (click):`, currentWorkflow.steps[stepIndex]);
  }
}

// Detectar si un ID parece ser dinámico (contiene números secuenciales, es muy largo/aleatorio)
function isDynamicId(id) {
  if (!id) return true;
  // IDs que contienen muchos números suelen ser dinámicos (ej: ember123, jstree-4)
  const numDigits = (id.match(/\d/g) || []).length;
  if (numDigits > 3) return true;
  // IDs muy largos generados por frameworks
  if (id.length > 20) return true;
  // IDs conocidos de frameworks comunes que son dinámicos
  if (/^(ember|gui|gen|idx|v-)/i.test(id)) return true;
  return false;
}

// Generar selector CSS único y específico
function generateUniqueSelector(element) {
  // Método 1: Si tiene ID único, usarlo directamente
  if (element.id) {
    const idSelector = `#${element.id}`;
    // Verificar que sea realmente único
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch (e) {
      console.warn('Error con selector ID:', idSelector);
    }
  }

  // Método 2: Construir selector desde el elemento hasta la raíz
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let selector = current.nodeName.toLowerCase();

    // Si tiene ID y no parece dinámico, usarlo y detener
    if (current.id && !isDynamicId(current.id)) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    // Agregar clases si las tiene (omitiendo html y body, que suelen tener clases de Modernizr/temas inestables)
    if (selector !== 'html' && selector !== 'body' && current.className && typeof current.className === 'string') {
      // Ignorar clases que suelen ser de estado (hover, active) o autogeneradas para scripts
      const skipClassPattern = /^(ng-|v-|js-|hover|active|focus|visited|link|disabled|enabled|invalid|valid)/i;
      
      const classes = current.className.split(' ')
        .filter(c => {
          const t = c.trim();
          return t && !t.includes(' ') && !skipClassPattern.test(t);
        })
        .map(c => c.trim());
        
      if (classes.length > 0) {
        // Limitar a 3 clases máximo por nivel para evitar selectores kilométricos
        selector += '.' + classes.slice(0, 3).join('.');
      }
    }

    // Obtener el índice nth-child para hacerlo único
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      const sameTagSiblings = siblings.filter(s => s.nodeName === current.nodeName);

      // Si hay múltiples hermanos con el mismo tag
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current);
        selector += `:nth-of-type(${index + 1})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Limitar la profundidad para no hacer selectores absurdamente largos
    if (path.length > 10) {
      break;
    }
  }

  // Unir el path con '>'
  let fullSelector = path.join(' > ');

  // Verificar si es único
  try {
    const matches = document.querySelectorAll(fullSelector);
    if (matches.length === 1) {
      console.log('✓ Selector único generado (método 2):', fullSelector);
      return fullSelector;
    }
  } catch (e) {
    console.warn('Error validando selector path:', fullSelector, e);
  }

  // Método 3: Si aún no es único, agregar más atributos específicos
  fullSelector = generateSelectorWithAttributes(element);

  // Verificar nuevamente
  try {
    const finalMatches = document.querySelectorAll(fullSelector);
    if (finalMatches.length === 1) {
      console.log('✓ Selector único generado (método 3):', fullSelector);
      return fullSelector;
    }
  } catch (e) {
    console.warn('Error validando selector con atributos:', fullSelector, e);
  }

  // Método 4: Último recurso - usar estructura DOM completa
  const fallbackSelector = generateXPathSelector(element);
  console.log('✓ Selector único generado (método 4 - fallback):', fallbackSelector);
  return fallbackSelector;
}

// Generar selector con atributos adicionales
function generateSelectorWithAttributes(element) {
  let selector = element.nodeName.toLowerCase();

  // Agregar clases
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ')
      .filter(c => c.trim())
      .map(c => c.trim());
    if (classes.length > 0) {
      selector += '.' + classes.join('.');
    }
  }

  // Agregar atributos específicos que ayuden a identificar el elemento
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
      // Escapar caracteres especiales en el valor
      const escapedValue = value.replace(/"/g, '\\"');
      selector += `[${attr}="${escapedValue}"]`;

      // Verificar si ya es único
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Si tiene texto único y corto, usarlo
  const text = element.textContent.trim();
  if (text && text.length < 50 && !text.includes('\n')) {
    // Verificar cuántos elementos tienen exactamente el mismo texto
    const elementsWithSameText = Array.from(document.querySelectorAll(element.nodeName))
      .filter(el => el.textContent.trim() === text);

    if (elementsWithSameText.length === 1) {
      // Podemos usar un selector con el texto (aunque no es CSS puro)
      // En su lugar, agregamos nth-child desde el padre
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

// Generar selector basado en la estructura del DOM (más preciso)
function generateXPathSelector(element) {
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.nodeName.toLowerCase();

    // Contar hermanos del mismo tipo
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    // Contar total de hermanos del mismo tipo
    const parent = current.parentElement;
    if (parent) {
      const sameTypeSiblings = Array.from(parent.children).filter(
        child => child.nodeName === current.nodeName
      );

      // Solo agregar nth-of-type si hay más de uno del mismo tipo
      if (sameTypeSiblings.length > 1) {
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Si llegamos a un elemento con ID, detenerse
    if (current && current.id) {
      path.unshift(`#${current.id}`);
      break;
    }
  }

  // Unir con ' > ' para selector directo
  const finalSelector = path.join(' > ');

  // Verificar si es único
  try {
    const matches = document.querySelectorAll(finalSelector);
    if (matches.length === 1) {
      return finalSelector;
    }
  } catch (e) {
    console.warn('Error validando selector:', finalSelector, e);
  }

  // Si aún no es único, usar posición absoluta con data attribute
  // Agregar un atributo temporal único
  const uniqueId = `temp-selector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  element.setAttribute('data-recorder-temp', uniqueId);
  const tempSelector = `[data-recorder-temp="${uniqueId}"]`;

  // Guardar para limpieza posterior
  setTimeout(() => {
    element.removeAttribute('data-recorder-temp');
  }, 100);

  return tempSelector;
}

// Determinar mejor posición para el tooltip
function determineTooltipPosition(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;

  // Si está en la parte superior, mostrar abajo
  if (rect.top < windowHeight / 3) {
    return 'bottom';
  }

  // Si está en la parte inferior, mostrar arriba
  if (rect.bottom > (windowHeight * 2) / 3) {
    return 'top';
  }

  // Si está muy a la izquierda, mostrar a la derecha
  if (rect.left < windowWidth / 4) {
    return 'right';
  }

  // Si está muy a la derecha, mostrar a la izquierda
  if (rect.right > (windowWidth * 3) / 4) {
    return 'left';
  }

  // Por defecto, mostrar abajo
  return 'bottom';
}

// Mostrar modal para pedir descripción del paso
function promptForDescription(element, stepNumber, isInput = false) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'recording-modal-overlay';

    const elementText           = element.textContent.trim().substring(0, 50);
    const elementTag            = element.tagName.toLowerCase();
    const placeholder           = element.placeholder || '';
    const suggestedDescription  = isInput
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
        <div class="modal-buttons">
          <button id="btn-cancel" class="btn-secondary">Cancelar</button>
          <button id="btn-confirm" class="btn-primary">Confirmar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const textarea   = modal.querySelector('#step-description');
    const btnCancel  = modal.querySelector('#btn-cancel');
    const btnConfirm = modal.querySelector('#btn-confirm');

    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnConfirm.click(); }
    });

    btnCancel.onclick  = () => { modal.remove(); resolve(null); };
    btnConfirm.onclick = () => { modal.remove(); resolve({ description: textarea.value.trim() }); };
  });
}

// Mostrar efecto visual de confirmación
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
// AUTO-DETECCIÓN DE CAMBIOS EN EL DOM
// Compara el estado de la página antes y después de un clic para generar
// automáticamente el campo "expected" sin que el grabador necesite saber nada técnico.
// ─────────────────────────────────────────────────────────────────────────────

/** Comprueba si un elemento pertenece a la UI del recorder (para excluirlo del snapshot). */
function isForRecorder(el) {
  return !!(el.closest('#recording-overlay') ||
            el.closest('.recording-modal-overlay') ||
            el.id === 'recorder-analyzing');
}

/** Comprueba si un elemento es visible para el usuario (dimensiones + CSS). */
function isVisibleElement(el) {
  if (!el) return false;
  const rect  = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width  > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display    !== 'none'   &&
    style.opacity    !== '0'
  );
}

/**
 * Toma una instantánea del DOM usando 4 estrategias para cubrir máxima superficie:
 *  1. Elementos con id         → más fiable, pero muchos sitios no los usan
 *  2. Campos de formulario por name → muy útiles en formularios multi-paso
 *  3. Elementos ARIA de alerta/diálogo/estado → detectan mensajes de error/éxito
 *  4. Contenedores semánticos con clase → sections, forms, fieldsets visibles
 *
 * @returns {{ visible: Set<string>, text: string }}
 */
function snapshotDOM() {
  const visible = new Set();

  // Estrategia 1: elementos con id (los más fiables como selectores)
  document.querySelectorAll('[id]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`#${el.id}`);
    }
  });

  // Estrategia 2: inputs, selects y textareas con atributo name
  //   → muy comunes en formularios multi-paso (aparecen/desaparecen al avanzar)
  document.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`);
    }
  });

  // Estrategia 3: elementos ARIA que señalan mensajes de error, éxito o diálogos
  //   → fundamentales para detectar si un envío de formulario tuvo error o éxito
  const ariaSelectors = [
    '[role="alert"]', '[role="status"]', '[role="dialog"]',
    '[role="alertdialog"]', '[aria-live]', '[aria-invalid]',
    '[aria-expanded]'
  ];
  document.querySelectorAll(ariaSelectors.join(',')).forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el)) return;
    // Usar id si lo tiene, si no construir clave compuesta
    if (el.id) {
      visible.add(`#${el.id}`);
    } else {
      const role = el.getAttribute('role') || el.getAttribute('aria-live') || 'live';
      const snippet = (el.textContent || '').trim().substring(0, 24).replace(/\s+/g, ' ');
      visible.add(`[role="${role}"]|${snippet}`);
    }
  });

  // Estrategia 4: contenedores semánticos con clase
  document.querySelectorAll('section,article,fieldset,form,dialog,aside,main').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || !el.className) return;
    const cls = el.className.toString().trim().split(/\s+/)[0];
    if (cls && cls.length >= 3 && cls.length <= 50 && !el.id) visible.add(`${el.tagName.toLowerCase()}.${cls}`);
  });

  // Estrategia 5: divs con clase CSS significativa (patrón dominante en SPAs)
  // Excluye clases genéricas de Bootstrap/Tailwind que no distinguen contenido
  const genericPattern = /^(row|col|container|wrapper|d-|p-|m-|text-|bg-|btn|icon|flex|grid|sr-only|show|hide|active|fade|modal-|ng-|v-|js-)/ ;
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
 * Compara dos snapshots y devuelve qué selectores aparecieron, desaparecieron y qué texto es nuevo.
 * @returns {{ appeared: string[], disappeared: string[], newText: string }}
 */
function computeDOMDiff(before, after) {
  const appeared    = [];
  const disappeared = [];

  after.visible.forEach(sel  => { if (!before.visible.has(sel)) appeared.push(sel); });
  before.visible.forEach(sel => { if (!after.visible.has(sel))  disappeared.push(sel); });

  // Detectar texto nuevo: líneas de más de 4 caracteres que no estaban antes
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
 * Espera a que el DOM deje de mutar durante `stableMs` milisegundos
 * o hasta alcanzar el timeout máximo `maxMs`.
 * Mucho más fiable que un setTimeout fijo en SPAs que tienen animaciones o cargas asíncronas.
 *
 * @param {number} maxMs    - Tiempo máximo total de espera (default 4000 ms)
 * @param {number} stableMs - Tiempo sin mutaciones para considerar el DOM estable (default 400 ms)
 * @returns {Promise<void>}
 */
function waitForDOMStability(maxMs = 4000, stableMs = 500, minMs = 1000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    let stableTimer = null;
    let finished    = false;

    const finish = () => {
      if (finished) return; // evitar doble llamada
      finished = true;
      clearTimeout(stableTimer);
      observer.disconnect();
      console.log(`[Recorder] DOM estable tras ${Date.now() - startTime}ms`);
      resolve();
    };

    const resetTimer = () => {
      clearTimeout(stableTimer);
      const elapsed = Date.now() - startTime;
      const wait    = Math.max(stableMs, minMs - elapsed);
      stableTimer   = setTimeout(finish, wait);
    };

    const observer = new MutationObserver(resetTimer);
    observer.observe(document.body, {
      childList: true,
      subtree:   true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'disabled']
    });

    // Timeout máximo de seguridad
    setTimeout(finish, maxMs);
    // Arrancar primer timer
    resetTimer();
  });
}

/**
 * Muestra un indicador "Analizando cambios..." mientras esperamos.
 * Devuelve una función para ocultarlo.
 */
function mostrarEsperandoCambios() {
  const el = document.createElement('div');
  el.id = 'recorder-analyzing';
  el.style.cssText = `
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    background:#1565c0; color:white;
    padding:12px 24px; border-radius:50px;
    font-family:sans-serif; font-size:14px;
    z-index:1000002; box-shadow:0 4px 16px rgba(0,0,0,0.3);
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
 * Muestra un modal amigable con el diff detectado y pregunta si guardar la comprobación.
 * @returns {Promise<Object|null>} objeto "expected" o null si el usuario omite
 */
function promptForExpectedState(diff) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'recording-modal-overlay';

    const liStyle = `margin:4px 0;padding:4px 8px;background:#f5f5f5;
      border-radius:4px;font-family:monospace;font-size:12px;word-break:break-all;`;

    const htmlAppeared = diff.appeared.length > 0
      ? diff.appeared.map(s => `<li style="${liStyle}">${s}</li>`).join('')
      : '<li style="color:#999;font-size:12px;">Ninguno detectado</li>';

    const htmlDisappeared = diff.disappeared.length > 0
      ? diff.disappeared.map(s => `<li style="${liStyle}">${s}</li>`).join('')
      : '<li style="color:#999;font-size:12px;">Ninguno detectado</li>';

    modal.innerHTML = `
      <div class="recording-modal" style="max-width:460px;">
        <div style="font-size:32px;text-align:center;margin-bottom:8px;">🔍</div>
        <h3 style="text-align:center;margin:0 0 6px 0;">Hemos detectado cambios en la página</h3>
        <p style="text-align:center;color:#555;font-size:13px;margin:0 0 16px 0;">
          ¿Guardamos esta comprobación para verificar que el paso se completó correctamente?
        </p>

        <div style="margin-bottom:10px;">
          <strong style="font-size:13px;color:#2e7d32;">✅ Elementos que aparecieron:</strong>
          <ul style="margin:6px 0 0 0;padding:0;list-style:none;">${htmlAppeared}</ul>
        </div>

        <div style="margin-bottom:10px;">
          <strong style="font-size:13px;color:#c62828;">🚫 Elementos que desaparecieron:</strong>
          <ul style="margin:6px 0 0 0;padding:0;list-style:none;">${htmlDisappeared}</ul>
        </div>

        ${diff.newText ? `
        <div style="margin-bottom:14px;">
          <strong style="font-size:13px;color:#1565c0;">💬 Texto nuevo detectado:</strong>
          <p style="margin:6px 0 0 0;padding:6px 10px;background:#e3f2fd;
            border-radius:4px;font-size:13px;color:#0d47a1;">
            &ldquo;${diff.newText}&rdquo;
          </p>
        </div>` : ''}

        <p style="font-size:12px;color:#888;text-align:center;margin:0 0 14px 0;">
          Si los cambios no corresponden a este paso, pulsa &ldquo;Omitir&rdquo;.
        </p>

        <div class="modal-buttons">
          <button id="btn-skip-expected" class="btn-secondary">Omitir</button>
          <button id="btn-save-expected" class="btn-primary">✅ Guardar comprobación</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-skip-expected').onclick = () => { modal.remove(); resolve(null); };
    modal.querySelector('#btn-save-expected').onclick = () => {
      modal.remove();
      const expected = {};
      if (diff.appeared.length    > 0) expected.visible = diff.appeared;
      if (diff.disappeared.length > 0) expected.hidden  = diff.disappeared;
      if (diff.newText)                expected.text    = diff.newText;
      resolve(expected);
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FIN AUTO-DETECCIÓN
// ─────────────────────────────────────────────────────────────────────────────

// --- Persistencia del Estado ---
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

// Restaurar estado al cargar la página
chrome.storage.local.get([STATE_KEY], (result) => {
  const state = result[STATE_KEY];
  if (state && state.workflow) {
    console.log("🔄 Restaurando estado de grabación...");
    currentWorkflow = state.workflow;

    if (state.isRecording) {
      isRecording = true;
      createRecordingOverlay();
      updateStepsCounter();

      // Re-asignar listeners
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

      // ── Comprobar si hay un snapshot pendiente de la página anterior ───────────
      // Ocurre cuando: se grabó un clic que causó navegación a esta página.
      // El snapshot "antes" se guardó antes del clic; ahora tomamos el "después".
      chrome.storage.local.get(['pending_snapshot'], async (res) => {
        const pending = res.pending_snapshot;
        if (!pending) return;

        const age = Date.now() - (pending.timestamp || 0);
        if (age > 15000) {
          // Snapshot demasiado antiguo (>15s), ignorar
          chrome.storage.local.remove(['pending_snapshot']);
          return;
        }

        console.log('[Recorder] 🔄 Snapshot pendiente encontrado (', Math.round(age/1000), 's ago). Analizando cambios...');

        // Esperar a que la nueva página cargue y se estabilice
        const ocultarIndicador = mostrarEsperandoCambios();
        await waitForDOMStability(4000, 600, 1500);
        ocultarIndicador();

        // Reconstruir snapBefore (el Set se serializó como array)
        const snapBefore = { visible: new Set(pending.visible), text: pending.text };
        const snapAfter  = snapshotDOM();

        console.log('[Recorder] 📸 snapBefore:', snapBefore.visible.size, 'selectores (página anterior)');
        console.log('[Recorder] 📸 snapAfter:', snapAfter.visible.size, 'selectores (nueva página)');

        const diff    = computeDOMDiff(snapBefore, snapAfter);
        const hayDiff = diff.appeared.length > 0 || diff.disappeared.length > 0 || diff.newText;
        console.log('[Recorder] diff post-navegación → hayDiff:', hayDiff, diff);

        // Limpiar siempre el pending_snapshot
        chrome.storage.local.remove(['pending_snapshot']);

        if (!hayDiff) return;

        // Mostrar modal al grabador con los cambios detectados
        const expected = await promptForExpectedState(diff);
        if (!expected) return;

        // Actualizar el paso correspondiente con el expected state
        if (currentWorkflow && currentWorkflow.steps && currentWorkflow.steps[pending.stepIndex]) {
          currentWorkflow.steps[pending.stepIndex].expected = expected;
          await saveState();
          console.log('[Recorder] ✅ expected state guardado en paso', pending.stepIndex);
        }
      });
      // ───────────────────────────────────────────────────────────
    }
  }
});