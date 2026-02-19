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
  // Generar selector CSS único para el elemento
  const selector = generateUniqueSelector(element);

  // Detectar si es un campo de texto
  const isInput = isInputElement(element);

  // Crear modal para pedir descripción (y valor si es input)
  const result = await promptForDescription(element, currentWorkflow.steps.length + 1, isInput);

  if (result === null) {
    // Usuario canceló
    return;
  }

  // Determinar mejor posición para el tooltip
  const tooltipPosition = determineTooltipPosition(element);

  // Agregar paso al workflow
  const step = {
    selector: selector,
    description: result.description || 'Sin descripción',
    stepType: isInput ? 'input' : 'click',
    position: { x, y },
    tooltipPosition: tooltipPosition,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };

  currentWorkflow.steps.push(step);
  updateStepsCounter();

  // Efecto visual de confirmación
  showConfirmationEffect(element);

  console.log(`✓ Paso ${currentWorkflow.steps.length} grabado (${step.stepType}):`, step);

  // Guardar estado antes de navegar
  await saveState();

  // FINALMENTE: Reproducir la acción original
  setTimeout(() => {
    isReplaying = true;
    if (isInput) {
      // Para inputs: solo enfocar el campo para que el usuario pueda seguir escribiendo
      element.focus();
    } else {
      // Usar simulación de secuencia completa para asegurar que se activan desplegables, etc.
      simulateFullClick(element);
    }
    setTimeout(() => isReplaying = false, 200);
  }, 500);
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

    // Agregar clases si las tiene
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.split(' ')
        .filter(c => c.trim() && !c.includes(' '))
        .map(c => c.trim());
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
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

// Mostrar modal para pedir descripción
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
            Elemento: <code>${elementTag}</code>${placeholder ? ` · placeholder: "${placeholder}"` : ''}
            ${!isInput && elementText ? `<br>Texto: "${elementText}"` : ''}
          </div>
        </div>
        <div class="form-group">
          <label>Descripción para el usuario:</label>
          <textarea 
            id="step-description" 
            placeholder="Ej: Introduce tu número de DNI"
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

    const textarea = modal.querySelector('#step-description');
    const btnCancel = modal.querySelector('#btn-cancel');
    const btnConfirm = modal.querySelector('#btn-confirm');

    setTimeout(() => { textarea.focus(); textarea.select(); }, 100);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btnConfirm.click();
      }
    });

    btnCancel.onclick = () => { modal.remove(); resolve(null); };
    btnConfirm.onclick = () => {
      const description = textarea.value.trim();
      modal.remove();
      resolve({ description });
    };
  });
}

// Mostrar efecto visual de confirmación
function showConfirmationEffect(element) {
  const rect = element.getBoundingClientRect();

  const checkmark = document.createElement('div');
  checkmark.className = 'recording-checkmark';
  checkmark.style.left = rect.left + rect.width / 2 + 'px';
  checkmark.style.top = rect.top + rect.height / 2 + 'px';
  checkmark.innerHTML = '✓';

  document.body.appendChild(checkmark);

  setTimeout(() => {
    checkmark.remove();
  }, 1000);
}

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
    }
  }
});