// content.js - Reproductor Final (Grid + Manual Scroll + Error Handling)

// Shepherd.js ya está cargado desde el manifest
let tour = null;
let overlay = null;
let menuOverlay = null;

// Variables para el seguimiento del elemento actual
let currentTargetElement = null;
let animationFrameId = null;
let isReplaying = false;
let currentTargetSelector = null;
let lastAttachedElement = null;

// Simular una secuencia completa de clic (mousedown -> mouseup -> click)
// Necesario para componentes que reaccionan a mousedown (ej: desplegables de aerolíneas)
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  // Verificar contexto de extensión (evitar error de script huérfano)
  if (!chrome.runtime || !chrome.runtime.id) {
    console.warn('Contexto de extensión inválido. Se requiere recargar.');
    return;
  }

  // Crear el overlay para oscurecer
  if (overlay === null) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-extension';
    document.body.appendChild(overlay);
  }

  // Esperar 2 segundos después de cargar la página
  setTimeout(async () => {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        console.log("🔍 [Tour] Iniciando comprobación...");

        // 0. Check for invalid context
        if (!window.supabaseClient && !window.supabase) {
          console.warn("[Tour] Supabase client not found");
          return;
        }

        const client = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        // 1. Check for Active Tour State (Resume)
        let savedState = await loadTourState();

        // Retry once after 1s if no state but we suspect a pending tour (optional but safer)
        if (!savedState || !savedState.isActive) {
          await new Promise(r => setTimeout(r, 1000));
          savedState = await loadTourState();
        }

        let tourResumed = false;

        if (savedState && savedState.isActive) {
          console.log("🔄 [Tour] Detectado tour persistente:", savedState.workflow.name, "Paso:", savedState.currentStepIndex);
          const currentUrl = window.location.href;
          const nextStep = savedState.workflow.data?.drawflow?.nodes?.[savedState.currentStepIndex];

          if (nextStep) {
            const matches = urlsMatch(currentUrl, nextStep.data.url);
            // Si la navegación fue hace menos de 8 segundos, la consideramos "esperada" aunque el flag se haya perdido
            const isRecentlyUpdated = (Date.now() - (savedState.lastUpdated || 0)) < 8000;
            const navigationExpected = savedState.isExpectedNavigation || isRecentlyUpdated;

            if (matches) {
              if (navigationExpected) {
                console.log("✅ [Tour] Reanudación confirmada. Paso:", savedState.currentStepIndex);
                // Reseteamos el flag de navegación ya que ya hemos llegado
                await saveTourState(savedState.workflow, savedState.currentStepIndex, false);
                iniciarTourDesdeJSON(savedState.workflow.data || savedState.workflow, savedState.currentStepIndex);
                tourResumed = true;
              } else {
                console.log("🚫 [Tour] Recarga manual o externa detectada. Limpiando tour.");
                await clearTourState();
              }
            } else {
              if (navigationExpected) {
                console.log("⏳ [Tour] URL distinta pero acción de tour detectada. Esperando navegación...");
                setTimeout(async () => {
                  const updatedState = await loadTourState();
                  // Si después de 15s seguimos en URL incorrecta y NADIE ha retomado el tour, limpiamos.
                  if (updatedState && updatedState.isActive && !urlsMatch(window.location.href, nextStep.data.url)) {
                    console.log("⏳ [Tour] Tiempo agotado. Cancelando tour pendiente.");
                    await clearTourState();
                    // location.reload(); // Evitamos recarga automática para no marear
                  }
                }, 15000);
                return;
              } else {
                console.log("ℹ️ [Tour] Tour activo en otra pestaña/URL. Continuando con menú local.");
              }
            }
          }
        }

        if (tourResumed) return;

        // 2. Fetch workflows (no authentication required)
        await fetchAndShowWorkflows(client);
      }
    } catch (e) {
      console.error('Error inicializando:', e);
    }
  }, 2000);
}

// --- State Management Functions ---

async function saveTourState(workflow, stepIndex, isExpectedNavigation = false) {
  // Optimización: Solo guardar si el estado es diferente o si se fuerza la navegación esperada
  const currentState = await loadTourState();
  const currentWorkflowId = currentState?.workflow?.data?.id || currentState?.workflow?.id;
  const newWorkflowId = workflow?.data?.id || workflow?.id;

  if (currentState &&
    currentWorkflowId === newWorkflowId &&
    currentState.currentStepIndex === stepIndex &&
    currentState.isExpectedNavigation === isExpectedNavigation) {
    return;
  }

  await chrome.storage.local.set({
    'active_tour': {
      isActive: true,
      workflow: workflow,
      currentStepIndex: stepIndex,
      isExpectedNavigation: isExpectedNavigation,
      lastUpdated: Date.now()
    }
  });
  console.log("💾 [Tour] Estado guardado. Paso:", stepIndex, "Navegación esperada:", isExpectedNavigation);
}

async function loadTourState() {
  const result = await chrome.storage.local.get(['active_tour']);
  return result.active_tour;
}

async function clearTourState() {
  await chrome.storage.local.remove(['active_tour']);
  console.log("🗑️ [Tour] Estado limpiado.");
}

function urlsMatch(url1, url2) {
  if (!url1 || !url2) return true; // Considerar que coinciden si alguna es nula/vacía
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);

    // Normalize host: ignore www.
    const host1 = u1.host.replace(/^www\./, "").toLowerCase();
    const host2 = u2.host.replace(/^www\./, "").toLowerCase();

    // Normalize path: ignore trailing slash and multiple slashes
    const path1 = u1.pathname.replace(/\/+$/, "").replace(/\/+/g, "/").toLowerCase();
    const path2 = u2.pathname.replace(/\/+$/, "").replace(/\/+/g, "/").toLowerCase();

    const match = host1 === host2 && path1 === path2;

    // console.log(`🔍 [Tour] Comparación URL: ${match ? "✅" : "❌"}\n  Guía: ${url1}\n  Nav: ${url2}`);
    return match;
  } catch (e) {
    console.warn(`[Tour] Error al comparar URLs: ${url1}, ${url2}`, e);
    return false; // Si hay error, no coinciden
  }
}


// Fetch and show all workflows (no authentication required)
async function fetchAndShowWorkflows(client) {
  try {
    if (!client) {
      console.error("[Tour] ❌ Cliente de Supabase no inicializado");
      return;
    }

    // Fetch ALL workflows from database (no user filter)
    console.log("🔍 [Tour] Buscando todas las guías disponibles...");
    console.log("🔍 [Tour] Cliente Supabase:", client);

    const { data: rows, error } = await client
      .from('workflows')
      .select('*');

    console.log("🔍 [Tour] Respuesta de Supabase:", { rows, error });

    if (rows) console.log(`🔍 [Tour] Guías encontradas (total): ${rows.length}`);

    if (error) {
      console.error("[Tour] ❌ Error descargando guías:", error);
      console.error("[Tour] Detalles del error:", JSON.stringify(error, null, 2));

      // Si el error es de autenticación, mostrar mensaje específico
      if (error.message?.includes('JWT') || error.message?.includes('auth')) {
        console.error("[Tour] ⚠️ Error de autenticación. Puede que necesites configurar políticas RLS en Supabase.");
      }
      return;
    }

    if (!rows || rows.length === 0) {
      console.log("[Tour] No hay guías disponibles en la base de datos.");
      mostrarMensajeSinGuias();
      return;
    }

    // C. Filter by Current URL
    const currentUrl = window.location.href;
    const curObj = new URL(currentUrl);

    const relevantWorkflows = rows.filter(row => {
      try {
        // Check valid structure
        if (!row.data || !row.data.drawflow) return false;

        // Check URL match using the robust urlsMatch function
        return urlsMatch(row.url, currentUrl);
      } catch (e) {
        return false;
      }
    }).map(row => {
      // Map to usable structure
      const json = row.data;
      return {
        id: `s-${row.id}`,
        name: row.name,
        url: row.url,
        createdAt: row.created_at,
        data: json // Keep full data in memory
      };
    });

    if (relevantWorkflows.length > 0) {
      console.log(`✓ [Tour] Encontradas ${relevantWorkflows.length} guías para esta página.`);
      crearOverlayTutoriales(relevantWorkflows);
    } else {
      console.log("[Tour] No hay guías para esta URL específica.");
      mostrarMensajeSinGuias();
    }

  } catch (err) {
    console.warn('[Tour] Fetch error:', err);
  }
}

function mostrarMensajeSinGuias() {
  if (document.getElementById('no-tours-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'no-tours-toast';
  toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: rgba(0,0,0,0.7); color: white;
        padding: 10px 20px; border-radius: 50px;
        font-family: sans-serif; font-size: 14px;
        z-index: 999999; pointer-events: none;
        animation: fadeInOut 4s forwards;
    `;
  toast.textContent = '📭 No hay guías para esta página';
  document.body.appendChild(toast);

  if (!document.getElementById('toast-style')) {
    const s = document.createElement('style');
    s.id = 'toast-style';
    s.textContent = `@keyframes fadeInOut { 
            0% { opacity: 0; transform: translateY(20px); } 
            10% { opacity: 1; transform: translateY(0); } 
            80% { opacity: 1; transform: translateY(0); } 
            100% { opacity: 0; transform: translateY(20px); } 
        }`;
    document.head.appendChild(s);
  }

  setTimeout(() => { if (toast) toast.remove(); }, 4000);
}

// Mostrar el menú de selección (Grid Grande)
function crearOverlayTutoriales(workflows) {
  menuOverlay = document.createElement('div');
  menuOverlay.id = 'menu-tutoriales-overlay';
  menuOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.85); z-index: 999998;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    animation: fadeIn 0.5s ease;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    background: white; border-radius: 30px; padding: 60px;
    max-width: 1200px; width: 90%; box-shadow: 0 15px 80px rgba(0, 0, 0, 0.6);
    animation: slideUp 0.5s ease;
  `;

  const titulo = document.createElement('h1');
  titulo.style.cssText = `
    margin: 0 0 30px 0; color: #2196F3;
    font-size: 56px; text-align: center;
  `;
  titulo.textContent = '👋 ¡Hola! ¿Necesitas ayuda?';
  container.appendChild(titulo);

  const subtitulo = document.createElement('p');
  subtitulo.style.cssText = `
    margin: 0 0 50px 0; color: #555;
    font-size: 32px; text-align: center; line-height: 1.4;
  `;
  subtitulo.textContent = 'Guía disponible. Pulsa el botón verde para empezar.';
  container.appendChild(subtitulo);

  // Crear contenedor de lista (Grid)
  const grid = document.createElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 30px;
    margin-bottom: 40px;
    width: 100%;
    justify-content: center;
    padding: 10px;
    box-sizing: border-box;
  `;

  workflows.forEach((workflow) => {
    const boton = document.createElement('button');
    boton.style.cssText = `
      background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
      color: white; border: none; border-radius: 25px;
      padding: 30px; 
      font-size: 32px; font-weight: bold;
      cursor: pointer; transition: all 0.3s ease;
      box-shadow: 0 10px 30px rgba(76, 175, 80, 0.5);
      width: 100%;
      min-height: 180px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      text-align: left;
    `;

    boton.innerHTML = `
      <div style="flex: 1;">
        <div style="margin-bottom: 15px; font-size: 36px; word-break: break-word;">${workflow.name}</div>
        ${workflow.tags && workflow.tags.length > 0 ? `
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
            ${workflow.tags.map(tag => `
              <span style="
                background: ${tag === 'review needed' ? '#fff3cd' : '#e3f2fd'};
                color: ${tag === 'review needed' ? '#856404' : '#1976d2'};
                padding: 4px 12px;
                border-radius: 16px;
                font-size: 14px;
                font-weight: 500;
                border: 1px solid ${tag === 'review needed' ? '#ffc107' : '#90caf9'};
              ">${tag}</span>
            `).join('')}
          </div>
        ` : ''}
        <div style="font-size: 20px; opacity: 0.95; font-weight: normal;">▶ CLIC PARA EMPEZAR</div>
      </div>
      <div style="font-size: 60px; margin-left: 20px;">👉</div>
    `;

    boton.onmouseover = () => {
      boton.style.transform = 'translateY(-3px)';
      boton.style.boxShadow = '0 12px 25px rgba(76, 175, 80, 0.6)';
    };

    boton.onmouseout = () => {
      boton.style.transform = 'translateY(0)';
      boton.style.boxShadow = '0 8px 20px rgba(76, 175, 80, 0.4)';
    };

    boton.onclick = async () => {
      if (workflow.data) {
        cerrarMenu();
        iniciarTourDesdeJSON(workflow.data);
      }
    };

    grid.appendChild(boton);
  });

  container.appendChild(grid);
  menuOverlay.appendChild(container);

  const btnCerrar = document.createElement('button');
  btnCerrar.style.cssText = `
    background: #9e9e9e; color: white; border: none;
    border-radius: 10px; padding: 15px 40px; font-size: 18px;
    font-weight: bold; cursor: pointer; display: block; margin: 0 auto;
  `;
  btnCerrar.textContent = '✕ Cerrar';
  btnCerrar.onclick = cerrarMenu;

  container.appendChild(btnCerrar);
  document.body.appendChild(menuOverlay);
}

function cerrarMenu() {
  if (menuOverlay) {
    menuOverlay.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => {
      if (menuOverlay) {
        menuOverlay.remove();
        menuOverlay = null;
      }
    }, 300);
  }
}

// Lógica de recorte oscuro
function updateOverlayCutout(element) {
  if (!overlay) return;

  if (!element) {
    overlay.style.clipPath = '';
    overlay.classList.remove('has-cutout');
    return;
  }

  const rect = element.getBoundingClientRect();
  const padding = 15;

  const clipPath = `polygon(
    0% 0%,
    0% 100%,
    ${rect.left - padding}px 100%,
    ${rect.left - padding}px ${rect.top - padding}px,
    ${rect.right + padding}px ${rect.top - padding}px,
    ${rect.right + padding}px ${rect.bottom + padding}px,
    ${rect.left - padding}px ${rect.bottom + padding}px,
    ${rect.left - padding}px 100%,
    100% 100%,
    100% 0%
  )`;

  overlay.style.clipPath = clipPath;
  overlay.classList.add('has-cutout');
}

function updateOverlayOnFrame() {
  if (currentTargetSelector) {
    const el = document.querySelector(currentTargetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      // Solo actualizar si el elemento existe y tiene dimensiones (está visible)
      if (rect.width > 0 && rect.height > 0) {
        updateOverlayCutout(el);
      }
    }
  }
}

function handleScrollOrResize() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  animationFrameId = requestAnimationFrame(updateOverlayOnFrame);
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= windowHeight &&
    rect.right <= windowWidth
  );
}

// NUEVA Lógica de "Click to Scroll" (Manual)
function mostrarMensajeScroll(element) {
  return new Promise((resolve) => {
    const rect = element.getBoundingClientRect();
    const necesitaBajar = rect.top > window.innerHeight;

    // Crear el overlay temporal
    const overlayModal = document.createElement('div');
    overlayModal.className = 'modal-overlay';
    overlayModal.style.zIndex = '999999';
    overlayModal.style.background = 'rgba(0,0,0,0.9)';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.maxWidth = '600px';
    modal.style.padding = '40px';

    let direccion = necesitaBajar ? 'debajo' : 'arriba';
    let icono = necesitaBajar ? '⬇️' : '⬆️';

    modal.innerHTML = `
      <div style="font-size: 80px; margin-bottom: 20px;">${icono}</div>
      <h3 style="color: #1976d2; margin: 10px 0 20px 0; font-size: 36px;">Siguiente paso fuera de pantalla</h3>
      <p style="font-size: 24px; line-height: 1.5; color: #333; margin-bottom: 40px;">
        El elemento que buscamos está más ${direccion}.<br>
        Pulsa el botón para ir hacia él.
      </p>
      
      <div style="display: flex; gap: 15px; justify-content: center;">
        <button id="btnAutoScroll" style="
          background: #2196F3; 
          color: white; 
          border: none; 
          padding: 25px 50px; 
          border-radius: 50px; 
          cursor: pointer; 
          font-size: 28px; 
          font-weight: bold;
          box-shadow: 0 10px 25px rgba(33, 150, 243, 0.5);
          display: flex;
          align-items: center;
          gap: 15px;
          transition: transform 0.2s;
        ">
          ${icono} MOVER PANTALLA
        </button>
      </div>
    `;

    overlayModal.appendChild(modal);
    document.body.appendChild(overlayModal);

    const btn = document.getElementById('btnAutoScroll');

    btn.onclick = () => {
      // Feedback visual
      btn.style.transform = 'scale(0.95)';
      btn.textContent = 'Moviendo...';

      // Scroll suave
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Esperar brevemente y continuar
      setTimeout(() => {
        document.body.removeChild(overlayModal);
        setTimeout(resolve, 400);
      }, 600);
    };
  });
}

function iniciarTourDesdeJSON(tourData, initialStepIndex = 0) {
  if (typeof Shepherd === 'undefined') {
    alert('Error: El sistema de tutoriales no está disponible');
    return;
  }

  if (!tourData || !tourData.drawflow || !tourData.drawflow.nodes) {
    alert('Error: El tutorial no tiene pasos válidos');
    return;
  }

  if (tour) tour.complete();

  // Ensure nodes are sorted
  const sortedNodes = tourData.drawflow.nodes.sort((a, b) => a.id - b.id);

  // Save state immediately when starting (or resuming)
  saveTourState({ data: tourData, name: tourData.name || "Workflow" }, initialStepIndex, false);

  tour = new Shepherd.Tour({
    useModalOverlay: false,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      scrollTo: false
    }
  });

  // Solo agregar pasos a partir del índice inicial
  // Pero necesitamos mantener la referencia a todos para saber cuál es el "siguiente" real

  sortedNodes.forEach((node, index) => {
    // Skip steps before initialStepIndex
    if (index < initialStepIndex) return;

    if (!node.data?.selector) return;

    const stepConfig = {
      id: node.id || `step-${index}`,
      title: `Paso ${index + 1}`,
      text: `<div style="font-size: 18px; line-height: 1.6;">${node.data.description}</div>`,
      attachTo: {
        element: node.data.selector,
        on: 'bottom'  // Siempre abajo; el scroll-to-center garantiza espacio
      },
      buttons: []
    };

    // Botones
    if (index > 0) {
      // "Anterior" is tricky with multi-page. For now, basic back.
      stepConfig.buttons.push({
        text: '← Anterior',
        action: async () => {
          // Update state for previous step
          await saveTourState({ data: tourData, name: tourData.name || "Workflow" }, index - 1);
          tour.back();
        },
        classes: 'shepherd-button-secondary'
      });
    }

    const isLastStep = index === sortedNodes.length - 1;
    const isInputStep = node.data?.stepType === 'input';

    if (isInputStep && !isLastStep) {
      // Pasos de input: mostrar botón "Siguiente" para que el usuario avance tras escribir
      stepConfig.buttons.push({
        text: 'Siguiente →',
        action: async () => {
          const nextIdx = index + 1;
          const nextN = sortedNodes[nextIdx];
          const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);
          await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, needsNav);
          if (needsNav) {
            mostrarMensajeNavegacion(nextN.data.url);
            tour.cancel();
          } else {
            tour.next();
          }
        }
      });
    } else if (!isLastStep) {
      // Pasos de click: sin botón (el clic en el elemento avanza el tour)
    }

    if (isLastStep) {
      stepConfig.buttons.push({
        text: '✓ Finalizar',
        action: async () => {
          await clearTourState();
          tour.complete();
        }
      });
    }

    stepConfig.beforeShowPromise = function () {
      return new Promise(async (resolve) => {
        if (node.data.url && !urlsMatch(node.data.url, window.location.href)) {
          console.warn("⚠️ [Tour] Paso intentando mostrarse en URL incorrecta");
        }

        // Reintento de búsqueda en beforeShowPromise (máximo 2s)
        let element = null;
        let retryStart = Date.now();

        while (!element && (Date.now() - retryStart < 2000)) {
          element = document.querySelector(node.data.selector);
          if (!element) await new Promise(r => setTimeout(r, 200));
        }

        if (element) {
          if (!isElementVisible(element)) {
            updateOverlayCutout(null);
            await mostrarMensajeScroll(element);
          } else {
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        }
        setTimeout(resolve, 50);
      });
    };

    tour.addStep(stepConfig);

  });

  // Eventos del Tour
  let currentClickHandler = null;

  tour.on('show', (event) => {
    const step = event.step;
    // Find the current node index based on step ID or valid steps
    const currentStepId = step.id; // "step-X" or ID
    // We saved state on button click, but let's confirm here?
    // Actually relying on button click is safer for "Next".

    if (step?.options?.attachTo) {
      const selector = step.options.attachTo.element;
      currentTargetSelector = selector; // Guardar el selector, no el elemento, para re-busqueda

      // Limpiar handlers anteriores si existen
      if (currentClickHandler && lastAttachedElement) {
        lastAttachedElement.removeEventListener('click', currentClickHandler, true);
        currentClickHandler = null;
      }

      // Intervalo de búsqueda dinámica (Polling)
      let attempts = 0;
      const findInterval = setInterval(async () => {
        const el = document.querySelector(selector);
        attempts++;

        if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          clearInterval(findInterval);
          console.log(`✅ [Tour] Elemento encontrado tras ${attempts} intentos:`, selector);

          currentTargetElement = el;
          lastAttachedElement = el;
          updateOverlayCutout(el);

          window.addEventListener('scroll', handleScrollOrResize, true);
          window.addEventListener('resize', handleScrollOrResize, true);

          // Buscar el nodo actual para saber si es un input step
          const globalIdx = sortedNodes.findIndex(n =>
            String(n.id) === String(step.id) ||
            `step-${sortedNodes.indexOf(n)}` === String(step.id)
          );
          const currentNode = sortedNodes[globalIdx] || null;
          const isInputStep = currentNode?.data?.stepType === 'input';

          if (isInputStep) {
            el.focus();
          } else {
            // Lógica Click-to-Advance
            currentClickHandler = async (e) => {
              if (isReplaying) return;
              if (e.target.closest('.shepherd-element')) return;

              const currentStep = tour.getCurrentStep();
              if (!currentStep) return;

              isReplaying = true;
              try {
                e.preventDefault();
                e.stopPropagation();

                const globalIdxClick = sortedNodes.findIndex(n =>
                  String(n.id) === String(currentStep.id) ||
                  `step-${sortedNodes.indexOf(n)}` === String(currentStep.id)
                );

                if (globalIdxClick === -1) {
                  simulateFullClick(el);
                  return;
                }

                const isLast = globalIdxClick === sortedNodes.length - 1;
                if (isLast) {
                  await clearTourState();
                  tour.complete();
                  setTimeout(() => {
                    try { simulateFullClick(el); } finally { setTimeout(() => isReplaying = false, 600); }
                  }, 100);
                } else {
                  const nextIdx = globalIdxClick + 1;
                  const nextN = sortedNodes[nextIdx];
                  const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);

                  await saveTourState({ data: tourData, name: tourData.name }, nextIdx, true);

                  if (needsNav) {
                    mostrarMensajeNavegacion(nextN.data.url);
                    tour.cancel();
                  } else {
                    tour.next();
                  }

                  setTimeout(() => {
                    try { simulateFullClick(el); } finally { setTimeout(() => isReplaying = false, 600); }
                  }, 200);
                }
              } catch (err) {
                console.error("❌ [Tour] Error en clic:", err);
                isReplaying = false;
              }
            };
            el.addEventListener('click', currentClickHandler, true);
          }
        }

        if (attempts > 20) { // 4 segundos total (20 * 200ms)
          clearInterval(findInterval);
          console.warn(`⏳ [Tour] Tiempo agotado buscando elemento:`, selector);
        }
      }, 200);
    }
  });

  tour.on('hide', () => {
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);

    if (currentTargetElement && currentClickHandler) {
      currentTargetElement.removeEventListener('click', currentClickHandler, true);
      currentClickHandler = null;
    }

    currentTargetElement = null;
    updateOverlayCutout(null);
  });

  tour.on('complete', () => {
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);

    if (currentTargetElement && currentClickHandler) {
      currentTargetElement.removeEventListener('click', currentClickHandler, true);
    }
    currentClickHandler = null;
    currentTargetElement = null;

    updateOverlayCutout(null);
    clearTourState(); // Ensure cleared
    mostrarMensajeFinal(tourData.name || "");
  });

  tour.on('cancel', () => {
    // If canceled manually, clear state?
    // Usually yes. But if it was canceled programmatically for navigation, NO.
    // We need a flag.
    // simpler: If we are navigating, we shouldn't trigger 'cancel' cleanup that deletes state.
    // We can check if 'active_tour' still has a future step index.
    // For now, let's assume 'cancel' means USER cancel.
    // Navigation calls tour.cancel() manually? 
    // Logic: If navigation happens, we simply don't call clearTourState() here if we want to persist.

    // ADJUSTMENT: We won't clear state on cancel. We only clear on 'complete'. 
    // If user cancels, they might want to resume optionally?
    // Standard UX: Cancel = Quit.
    // But our Navigation logic calls tour.cancel().
    // We will handle "Quit" button explicitly if we ever add one (Close button on modal).
    // The "X" button triggers 'cancel'.

    // For now, let's NOT clear state on cancel automatically unless we verify intent.
    // Or we clear it ONLY if it wasn't a navigation event.
    // Hard to distinguish without a global flag.

    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);
    currentTargetElement = null;
    updateOverlayCutout(null);

    // Explicitly check if we should clear state
    // For now, we leave state. If user reloads, it might prompt to resume. 
    // We can add a "Quit" button to the resume prompt if needed.
  });

  console.log(`✓ Iniciando tutorial: ${tourData.name} desde paso ${initialStepIndex}`);
  setTimeout(() => tour.start(), 500);
}

function mostrarMensajeNavegacion(nextUrl) {
  const msg = document.createElement('div');
  msg.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: #2196F3; color: white;
        padding: 15px 25px; border-radius: 50px;
        z-index: 1000000; font-family: sans-serif;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        animation: slideInRight 0.5s forwards;
    `;
  msg.innerHTML = `⏳ Esperando navegación...<br><small>Hacia: ${new URL(nextUrl).pathname}</small>`;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 5000);
}

function mostrarMensajeFinal(nombreTutorial) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.85); z-index: 999999;
    display: flex; justify-content: center; align-items: center;
    animation: fadeIn 0.5s ease;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white; border-radius: 20px; padding: 50px;
    text-align: center; box-shadow: 0 10px 50px rgba(0, 0, 0, 0.5);
    max-width: 500px;
  `;

  modal.innerHTML = `
    <div style="font-size: 80px; margin-bottom: 20px;">🎉</div>
    <h2 style="color: #4CAF50; margin: 0 0 20px 0; font-size: 32px;">¡Felicidades!</h2>
    <p style="font-size: 20px; color: #333; margin-bottom: 30px; line-height: 1.6;">
      Has completado el tutorial<br>
      <strong>"${nombreTutorial}"</strong>
    </p>
    <button id="btnCerrarFinal" style="
      background: #4CAF50; color: white; border: none; border-radius: 10px;
      padding: 15px 40px; font-size: 20px; font-weight: bold; cursor: pointer;
    ">✓ Entendido</button>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('btnCerrarFinal').onclick = () => {
    overlay.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
  };
}


// Estilos globales
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;
document.head.appendChild(style);
console.log('✓ Sistema cargado');