// content.js - Reproductor Final (Grid + Manual Scroll + Error Handling)

// Shepherd.js ya está cargado desde el manifest
let tour = null;
let overlay = null;
let menuOverlay = null;

// Bandera para saber si la navegación fue iniciada por el tour (no por el usuario)
// Evita que beforeunload limpie el estado del tour durante la navegación entre pasos
let isTourNavigation = false;

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

// Limpiar el tour activo cuando el usuario cierra o abandona la pestaña
// SOLO si NO es una navegación programada por el propio tour
window.addEventListener('beforeunload', () => {
  if (!isTourNavigation) {
    try {
      chrome.storage.local.remove(['active_tour']);
    } catch (e) { /* ignorar */ }
  }
});

async function init() {
  // Verificar contexto de extensión (evitar error de script huérfano)
  if (!chrome.runtime || !chrome.runtime.id) {
    console.warn('Contexto de extensión inválido. Se requiere recargar.');
    return;
  }

  // Si hay un tour activo, crear el overlay inmediatamente (antes del delay de 2s)
  // para que no haya parpadeo al navegar entre páginas durante un tour
  try {
    const result = await chrome.storage.local.get(['active_tour']);
    if (result.active_tour && result.active_tour.isActive && overlay === null) {
      overlay = document.createElement('div');
      overlay.id = 'overlay-extension';
      document.body.appendChild(overlay);
      console.log('🔲 [Tour] Overlay creado inmediatamente (tour activo detectado).');
    }
  } catch (e) {
    // Si falla, el overlay se creará más tarde en iniciarTourDesdeJSON
  }

  // Inject Custom Styles for Shepherd Buttons
  if (!document.getElementById('shepherd-custom-styles')) {
    const style = document.createElement('style');
    style.id = 'shepherd-custom-styles';
    style.textContent = `
      .shepherd-button-complete {
        background: #28a745 !important;
        color: white !important;
        border: none !important;
        border-radius: 8px !important;
        font-weight: bold !important;
        padding: 8px 16px !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        transition: all 0.2s ease !important;
        cursor: pointer !important;
      }
      .shepherd-button-complete:hover {
        background: #218838 !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 12px rgba(40, 167, 69, 0.4) !important;
      }
      .shepherd-button-complete:active {
        transform: translateY(0) !important;
      }
      .shepherd-check-icon {
        background: white;
        color: #28a745;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
      }
      .shepherd-button-prev {
        background: #6c757d !important;
        color: white !important;
        border: none !important;
        border-radius: 8px !important;
        font-weight: bold !important;
        padding: 8px 16px !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        transition: all 0.2s ease !important;
        cursor: pointer !important;
      }
      .shepherd-button-prev:hover {
        background: #5a6268 !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 12px rgba(108, 117, 125, 0.4) !important;
      }
      .shepherd-button-prev:active {
        transform: translateY(0) !important;
      }
      .shepherd-back-icon {
        background: white;
        color: #6c757d;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
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

          const workflowData = savedState.workflow.data || savedState.workflow;
          const allNodes = (workflowData.drawflow?.nodes || []).sort((a, b) => a.id - b.id);
          const currentNode = allNodes[savedState.currentStepIndex];
          const expectedUrl = currentNode?.data?.url || null;

          // ── VALIDACIÓN DE URL ─────────────────────────────────────────
          // Si la URL actual NO coincide con la URL esperada para el paso guardado
          // Y NO es una navegación programada (isExpectedNavigation), el tour
          // quedó huérfano (ej: el usuario cerró y volvió a otra página). Lo limpiamos.
          const esNavegacionEsperada = savedState.isExpectedNavigation === true;
          const urlCoincide = !expectedUrl || urlsMatch(expectedUrl, window.location.href);

          if (!urlCoincide && !esNavegacionEsperada) {
            console.warn('⚠️ [Tour] URL no coincide con el paso guardado. Limpiando tour huérfano.');
            await clearTourState();
            if (overlay) { overlay.remove(); overlay = null; }
            // Continuar con la carga normal de la página
          } else {
            // ── URL coincide o es navegación esperada: reanudar tour ──────
            if (savedState.pendingValidationIdx != null) {
              const pIdx = savedState.pendingValidationIdx;
              const pendingNode = allNodes[pIdx] || null;

              if (pendingNode?.data?.expected) {
                console.log(`🔎 [Tour] Validando resultado del paso ${pIdx} tras recarga...`);
                const isValid = checkExpectedState(pendingNode.data.expected);

                if (!isValid) {
                  const pendingStepUrl = pendingNode.data?.url || null;
                  let revertIdx = pIdx;
                  if (pendingStepUrl) {
                    const firstForPendingUrl = allNodes.findIndex(
                      n => n.data?.url && urlsMatch(n.data.url, pendingStepUrl)
                    );
                    if (firstForPendingUrl !== -1) revertIdx = firstForPendingUrl;
                  }
                  console.warn(`⚠️ [Tour] Validación FALLÓ. Revirtiendo al paso ${revertIdx}.`);
                  await saveTourState(savedState.workflow, revertIdx, false, null);
                  const yaSomosEnLaURL = pendingStepUrl && urlsMatch(pendingStepUrl, window.location.href);
                  if (!yaSomosEnLaURL && pendingStepUrl) {
                    isTourNavigation = true; // proteger beforeunload
                    await handleError(pendingNode);
                    window.location.href = pendingStepUrl;
                  } else {
                    iniciarTourDesdeJSON(workflowData, revertIdx);
                    setTimeout(async () => { await handleError(pendingNode); }, 800);
                  }
                  tourResumed = true;
                } else {
                  console.log("✅ [Tour] Validación cross-reload exitosa. Continuando en paso", savedState.currentStepIndex);
                  await saveTourState(savedState.workflow, savedState.currentStepIndex, savedState.isExpectedNavigation, null);
                  iniciarTourDesdeJSON(workflowData, savedState.currentStepIndex);
                  tourResumed = true;
                }
              } else {
                await saveTourState(savedState.workflow, savedState.currentStepIndex, savedState.isExpectedNavigation, null);
                iniciarTourDesdeJSON(workflowData, savedState.currentStepIndex);
                tourResumed = true;
              }
            } else {
              iniciarTourDesdeJSON(workflowData, savedState.currentStepIndex);
              tourResumed = true;
            }
          }
          // ──────────────────────────────────────────────────────────────
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

async function saveTourState(workflow, stepIndex, isExpectedNavigation = false, pendingValidationIdx = null) {
  await chrome.storage.local.set({
    'active_tour': {
      isActive: true,
      workflow: workflow,
      currentStepIndex: stepIndex,
      isExpectedNavigation: isExpectedNavigation,
      pendingValidationIdx: pendingValidationIdx,
      lastUpdated: Date.now()
    }
  });
  const pendingMsg = pendingValidationIdx != null ? ` | Pendiente validar paso: ${pendingValidationIdx}` : '';
  console.log(`💾 [Tour] Estado guardado. Paso: ${stepIndex}${pendingMsg}`);
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
  if (!url1 || !url2) return true;
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);

    const host1 = u1.host.replace(/^www\./, "").toLowerCase();
    const host2 = u2.host.replace(/^www\./, "").toLowerCase();

    // Normalizar pathname: 
    // 1. Quitar trailing slashes y múltiples slashes
    // 2. IMPORTANTE: Quitar session IDs (como ;jsessionid=...) que rompen la comparación en webs gubernamentales/antiguas
    const normalizePath = (p) => p
      .split(';')[0] // Quitar ;jsessionid o similares
      .replace(/\/+$/, "")
      .replace(/\/+/g, "/")
      .toLowerCase();

    const path1 = normalizePath(u1.pathname);
    const path2 = normalizePath(u2.pathname);

    const match = host1 === host2 && path1 === path2;

    if (!match && host1 === host2) {
      console.log(`[Tour] 🔍 URL mismatch en mismo host. \n  Grabado: ${path1} \n  Actual: ${path2}`);
    }

    return match;
  } catch (e) {
    return false;
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
  // Crear el overlay oscuro de fondo ahora que sabemos que hay tours
  if (overlay === null) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-extension';
    document.body.appendChild(overlay);
  }

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
  subtitulo.textContent = 'Guías disponibles. Pulsa sobre la guia para ver los detalles y empezar.';
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
        <div style="font-size: 20px; opacity: 0.95; font-weight: normal;">▶ PULSA PARA VER LOS DETALLES</div>
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
        mostrarModalDetallesTour(workflow, workflows);
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
      // Eliminar también el overlay oscuro de fondo
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    }, 300);
  }
}

function mostrarModalDetallesTour(workflow, workflows) {
  if (menuOverlay) {
    menuOverlay.style.display = 'none';
  }

  const detallesOverlay = document.createElement('div');
  detallesOverlay.id = 'detalles-tutorial-overlay';
  detallesOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.85); z-index: 999999;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    animation: fadeIn 0.3s ease;
  `;

  const container = document.createElement('div');
  container.style.cssText = `
    background: white; border-radius: 30px; padding: 50px;
    max-width: 800px; width: 90%; box-shadow: 0 15px 80px rgba(0, 0, 0, 0.6);
    text-align: center;
  `;

  const titulo = document.createElement('h1');
  titulo.style.cssText = `margin: 0 0 20px 0; color: #2196F3; font-size: 48px;`;
  titulo.textContent = workflow.name;
  container.appendChild(titulo);

  // Intentamos obtener tags
  const tags = workflow.tags || (workflow.data && workflow.data.tags);
  if (tags && tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 30px;`;
    tags.forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.style.cssText = `
        background: ${tag === 'review needed' ? '#fff3cd' : '#e3f2fd'};
        color: ${tag === 'review needed' ? '#856404' : '#1976d2'};
        padding: 8px 16px; border-radius: 20px; font-size: 18px; font-weight: 500;
        border: 1px solid ${tag === 'review needed' ? '#ffc107' : '#90caf9'};
      `;
      tagSpan.textContent = tag;
      tagsContainer.appendChild(tagSpan);
    });
    container.appendChild(tagsContainer);
  }

  // Intentamos obtener descripción
  const description = workflow.description || (workflow.data && workflow.data.description);
  if (description) {
    const desc = document.createElement('p');
    desc.style.cssText = `margin: 0 0 40px 0; color: #555; font-size: 24px; line-height: 1.5; text-align: left; background: #f9f9f9; padding: 25px; border-radius: 15px; border-left: 6px solid #2196F3;`;
    desc.textContent = description;
    container.appendChild(desc);
  } else {
    const noDesc = document.createElement('p');
    noDesc.style.cssText = `margin: 0 0 40px 0; color: #999; font-size: 20px; font-style: italic;`;
    noDesc.textContent = "Este tour no tiene descripción.";
    container.appendChild(noDesc);
  }

  const buttonsContainer = document.createElement('div');
  buttonsContainer.style.cssText = `display: flex; gap: 20px; justify-content: center;`;

  const btnAtras = document.createElement('button');
  btnAtras.style.cssText = `
    background: #9e9e9e; color: white; border: none; border-radius: 15px;
    padding: 20px 40px; font-size: 24px; font-weight: bold; cursor: pointer;
    transition: all 0.2s ease;
  `;
  btnAtras.innerHTML = '← Volver';
  btnAtras.onmouseover = () => btnAtras.style.background = '#757575';
  btnAtras.onmouseout = () => btnAtras.style.background = '#9e9e9e';
  btnAtras.onclick = () => {
    detallesOverlay.remove();
    if (menuOverlay) {
      menuOverlay.style.display = 'flex';
    }
  };

  const btnEmpezar = document.createElement('button');
  btnEmpezar.style.cssText = `
    background: #4CAF50; color: white; border: none; border-radius: 15px;
    padding: 20px 40px; font-size: 24px; font-weight: bold; cursor: pointer;
    transition: all 0.2s ease; box-shadow: 0 5px 15px rgba(76, 175, 80, 0.4);
  `;
  btnEmpezar.innerHTML = '▶ Iniciar Tour';
  btnEmpezar.onmouseover = () => {
    btnEmpezar.style.transform = 'translateY(-2px)';
    btnEmpezar.style.boxShadow = '0 8px 20px rgba(76, 175, 80, 0.6)';
  };
  btnEmpezar.onmouseout = () => {
    btnEmpezar.style.transform = 'translateY(0)';
    btnEmpezar.style.boxShadow = '0 5px 15px rgba(76, 175, 80, 0.4)';
  };
  btnEmpezar.onclick = () => {
    detallesOverlay.remove();
    if (menuOverlay) {
      menuOverlay.remove();
      menuOverlay = null;
    }
    iniciarTourDesdeJSON(workflow.data);
  };

  buttonsContainer.appendChild(btnAtras);
  buttonsContainer.appendChild(btnEmpezar);
  container.appendChild(buttonsContainer);
  
  detallesOverlay.appendChild(container);
  document.body.appendChild(detallesOverlay);
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

  // Asegurar que el overlay oscuro existe (puede que no se haya creado si el tour fue reanudado)
  if (overlay === null) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-extension';
    document.body.appendChild(overlay);
  }

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
      stepConfig.buttons.push({
        text: '<span class="shepherd-back-icon">←</span> Anterior',
        action: async () => {
          // Update state for previous step
          await saveTourState({ data: tourData, name: tourData.name || "Workflow" }, index - 1);
          tour.back();
        },
        classes: 'shepherd-button-prev'
      });
    }

    const isLastStep = index === sortedNodes.length - 1;
    const isInputStep = node.data?.stepType === 'input';

    if (isInputStep && !isLastStep) {
      // Pasos de input: mostrar botón "Siguiente" para que el usuario avance tras escribir
      stepConfig.buttons.push({
        text: 'Hecho <span class="shepherd-check-icon">✓</span>',
        classes: 'shepherd-button-complete',
        action: async () => {
          const nextIdx = index + 1;
          const nextN = sortedNodes[nextIdx];
          const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);

          // ── 1. GUARDADO PREVENTIVO ──────────────────────────────────────
          await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, needsNav);

          // ── 2. VALIDACIÓN ───────────────────────────────────────────────
          if (node.data.expected) {
            console.log("[Validación] ⏳ Verificando estado tras input...");
            const ok = await waitForExpectedState(node.data.expected);
            if (!ok) {
              console.warn("[Validación] ❌ Falló. Revirtiendo al paso actual.");
              await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, index, false);
              handleError(node);
              return;
            }
          }
          // ───────────────────────────────────────────────────────────────

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
        text: 'Finalizar <span class="shepherd-check-icon">✓</span>',
        classes: 'shepherd-button-complete',
        action: async () => {
          await clearTourState();
          tour.complete();
        }
      });
    }

    stepConfig.beforeShowPromise = function () {
      return new Promise(async (resolve) => {
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
          const isDynamicStep = currentNode?.data?.stepType === 'dynamic';

          if (isInputStep) {
            el.focus();
          } else if (isDynamicStep) {
            // PASO DINÁMICO: el usuario elige libremente (fecha, destino…)
            // No interceptamos el clic — solo lo observamos para avanzar el tour.
            console.log('[Tour] 🔄 Paso dinámico activo. Esperando selección del usuario...');
            currentClickHandler = async (e) => {
              if (isReplaying) return;
              if (e.target.closest('.shepherd-element')) return;

              const currentStep = tour.getCurrentStep();
              if (!currentStep) return;

              isReplaying = true;
              try {
                // NO preventDefault/stopPropagation → el clic funciona con normalidad
                const gIdx = sortedNodes.findIndex(n =>
                  String(n.id) === String(currentStep.id) ||
                  `step-${sortedNodes.indexOf(n)}` === String(currentStep.id)
                );
                if (gIdx === -1) { isReplaying = false; return; }

                const isLast = gIdx === sortedNodes.length - 1;
                if (isLast) {
                  await clearTourState();
                  setTimeout(() => { tour.complete(); setTimeout(() => isReplaying = false, 600); }, 300);
                } else {
                  const nextIdx = gIdx + 1;
                  const nextN = sortedNodes[nextIdx];
                  const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);
                  await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, needsNav, null);
                  // Esperar 300 ms para que la UI actualice antes de avanzar el tour
                  setTimeout(() => {
                    if (needsNav) {
                      mostrarMensajeNavegacion(nextN.data.url || '');
                      tour.cancel();
                    } else {
                      tour.next();
                    }
                    setTimeout(() => isReplaying = false, 600);
                  }, 300);
                }
              } catch (err) {
                console.error('❌ [Tour] Error en paso dinámico:', err);
                isReplaying = false;
              }
            };
            el.addEventListener('click', currentClickHandler, true);
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
                  const hasExpected = !!currentNode?.data?.expected;
                  const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);

                  // ── 1. GUARDADO PREVENTIVO ────────────────────────────────────────
                  // Si el paso tiene 'expected', siempre guardamos pendingValidationIdx
                  // independientemente de si hay navegación o no.
                  // - Con navegación: init() en la nueva página valida el expected.
                  // - Sin navegación: el paso 3 valida aquí y limpia el flag si pasa.
                  // - Form POST que recarga la misma URL: init() detecta el flag y valida.
                  const pendingIdx = hasExpected ? globalIdxClick : null;
                  await saveTourState(
                    { data: tourData, name: tourData.name || 'Workflow' },
                    nextIdx,
                    needsNav,
                    pendingIdx
                  );

                  // ── 2. DISPARAR EL CLIC ──────────────────────────────────────────
                  setTimeout(() => {
                    try {
                      simulateFullClick(el);
                    } catch (err) {
                      console.error("❌ [Tour] Error al simular clic:", err);
                    } finally {
                      setTimeout(() => isReplaying = false, 600);
                    }
                  }, 50);

                  // ── 3. VALIDACIÓN INMEDIATA (si la página NO navega) ─────────────
                  // Si hay navegación, esta parte no llega a ejecutarse (la página
                  // muere). En ese caso, init() en la nueva página manejará la validación.
                  if (hasExpected && !needsNav) {
                    console.log("[Validación] ⏳ Verificando efecto del clic (sin navegación)...");
                    const ok = await waitForExpectedState(currentNode.data.expected);
                    if (!ok) {
                      console.warn("[Validación] ❌ Estado no alcanzado. Revirtiendo al paso", globalIdxClick);
                      await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, globalIdxClick, false, null);
                      handleError(currentNode);
                      return;
                    }
                    console.log("[Validación] ✅ Estado confirmado. Limpiando flag pendiente.");
                    // Limpiar el flag (no era necesario porque needsNav=false, pero por limpieza)
                    await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, false, null);
                  }

                  if (needsNav) {
                    mostrarMensajeNavegacion(nextN.data.url || '');
                    tour.cancel();
                  } else {
                    tour.next();
                  }
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
    // No limpiamos el overlay aquí: el recorte se actualizará en el siguiente paso
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
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);
    currentTargetElement = null;
    // No limpiamos el overlay aquí: si es navegación la página recargará;
    // si el usuario cancela manualmente el recorte desaparecerá al recargar.
  });

  console.log(`✓ Iniciando tutorial: ${tourData.name} desde paso ${initialStepIndex}`);
  setTimeout(() => tour.start(), 500);
}

function mostrarMensajeNavegacion(nextUrl) {
  // Marcar que la navegación es del tour para que beforeunload no limpie el estado
  isTourNavigation = true;

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


// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE VALIDACIÓN DE ESTADO ESPERADO
// Comprueba si la interfaz ha alcanzado el estado esperado tras ejecutar un paso.
// Los pasos del workflow pueden incluir un campo opcional "expected":
//   { visible: ["#sel1"], hidden: ["#sel2"], text: "Texto esperado" }
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprueba de forma síncrona si el estado actual de la interfaz
 * coincide con el estado esperado definido en el paso.
 *
 * @param {Object} expected - { visible: string[], hidden: string[], text: string }
 * @returns {boolean} true si se cumple todo el estado esperado
 */
function checkExpectedState(expected) {
  if (!expected) return true;

  // 1. Comprobar selectores que deben estar VISIBLES
  if (expected.visible && expected.visible.length > 0) {
    for (const selector of expected.visible) {
      const el = document.querySelector(selector);
      if (!el) {
        console.log(`[Validación] ❌ Elemento visible faltante: ${selector}`);
        return false;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
      if (!isVisible) {
        console.log(`[Validación] ❌ Elemento no es visible: ${selector}`);
        return false;
      }
    }
  }

  // 2. Comprobar selectores que deben estar OCULTOS
  if (expected.hidden && expected.hidden.length > 0) {
    for (const selector of expected.hidden) {
      const el = document.querySelector(selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isVisible = (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
        if (isVisible) {
          console.log(`[Validación] ❌ Elemento debería estar oculto pero es visible: ${selector}`);
          return false;
        }
      }
    }
  }

  // 3. Comprobar texto esperado (Fuzzy Matching)
  if (expected.text) {
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = expected.text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (!bodyText.includes(targetText)) {
      console.log(`[Validación] ❌ Texto esperado no encontrado. Buscando: "${targetText.substring(0, 30)}..."`);
      return false;
    }
  }

  return true;
}

/**
 * Espera de forma asíncrona (polling cada 200 ms) hasta que el estado
 * esperado se cumpla o se agote el tiempo límite.
 *
 * @param {Object} expected - { visible: string[], hidden: string[], text: string }
 * @param {number} [timeout=4000] - Tiempo máximo de espera en ms
 * @returns {Promise<boolean>} true si el estado se cumplió, false si se agotó el tiempo
 */
function waitForExpectedState(expected, timeout = 4000) {
  if (!expected) return Promise.resolve(true);

  return new Promise((resolve) => {
    const interval = 200;
    let elapsed = 0;

    const check = () => {
      if (checkExpectedState(expected)) {
        resolve(true);
        return;
      }
      elapsed += interval;
      if (elapsed >= timeout) {
        console.warn('[Validación] ⏰ Tiempo agotado esperando el estado esperado.', expected);
        resolve(false);
        return;
      }
      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Hace scroll hasta el elemento y añade una animación temporal de resaltado.
 *
 * @param {Element} element - Elemento DOM a resaltar
 */
function highlightElement(element) {
  if (!element) return;

  // Scroll suave hasta el elemento
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Guardar estilos originales para restaurarlos
  const originalOutline = element.style.outline;
  const originalBoxShadow = element.style.boxShadow;
  const originalTransition = element.style.transition;

  // Aplicar resaltado visual llamativo
  element.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
  element.style.outline = '3px solid #e53935';
  element.style.boxShadow = '0 0 0 6px rgba(229, 57, 53, 0.35)';

  // Efecto de parpadeo para captar la atención
  let pulseCount = 0;
  const pulseInterval = setInterval(() => {
    pulseCount++;
    element.style.opacity = pulseCount % 2 === 0 ? '1' : '0.6';
    if (pulseCount >= 6) {
      clearInterval(pulseInterval);
      element.style.opacity = '1';
    }
  }, 300);

  // Restaurar estilos originales tras 3.5 s
  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.boxShadow = originalBoxShadow;
    element.style.transition = originalTransition;
  }, 3500);
}

/**
 * Gestiona el error cuando el estado esperado no se cumple.
 *
 * @param {Object} node - Nodo del workflow que no superó la validación
 */
async function handleError(node) {
  console.warn('[Validación] ❌ Estado esperado no alcanzado. Activando recuperación guiada.');

  // ── CASO A: campo inválido detectable ───────────────────────────────────
  const invalidField = document.querySelector(':invalid');
  if (invalidField) {
    console.log('[Validación] 🔎 Campo inválido encontrado:', invalidField);
    highlightElement(invalidField);
    await mostrarMensajeError(
      '¡Ups! Un pequeño despiste 😅',
      'Parece que hay algún dato que no es del todo correcto.',
      '¡No te preocupes! Vamos a revisarlo juntos para poder continuar.'
    );
    return;
  }

  // ── CASO B: sin error específico detectable ──────────────────────────────
  console.log('[Validación] 🔁 Sin campo inválido. Volviendo al primer paso de la página.');
  await mostrarMensajeError(
    'No ha salido a la primera, ¡pero no pasa nada! 😊',
    'A veces la tecnología es un poco caprichosa.',
    'Vamos a volver a intentarlo tranquilamente, paso a paso.'
  );

  // Volver al primer paso cuya URL coincide con la actual
  if (tour) {
    const steps = tour.steps;
    if (steps && steps.length > 0) {
      // El primer paso del tour activo corresponde al primero en esta página
      tour.show(steps[0].id);
    }
  }
}

/**
 * Muestra un modal de error en el centro de la pantalla.
 *
 * @param {string} titulo  - Título principal del mensaje
 * @param {string} mensaje - Mensaje descriptivo
 * @param {string} [ayuda] - Texto de ayuda adicional (opcional)
 */
function mostrarMensajeError(titulo, mensaje, ayuda = '') {
  return new Promise((resolve) => {
    // Evitar duplicados
    const existente = document.getElementById('tour-error-toast');
    const existenteBackdrop = document.getElementById('tour-error-backdrop');
    if (existente) existente.remove();
    if (existenteBackdrop) existenteBackdrop.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'tour-error-backdrop';
    backdrop.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(3px);
      z-index: 1000000;
      animation: fadeInBackdrop 0.3s ease;
    `;

    const modal = document.createElement('div');
    modal.id = 'tour-error-toast';
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      color: #333;
      border-radius: 20px;
      padding: 30px 40px;
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
      z-index: 1000001;
      box-shadow: 0 15px 50px rgba(0,0,0,0.2);
      max-width: 480px;
      width: 90%;
      animation: popInModal 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

    modal.innerHTML = `
      <div style="font-weight: 800; font-size: 24px; margin-bottom: 15px; color: #d32f2f;">
        ${titulo}
      </div>
      <div style="color: #444; font-size: 18px; margin-bottom: ${ayuda ? '10px' : '0'}">
        ${mensaje}
      </div>
      ${ayuda ? `<div style="color: #666; font-size: 16px; margin-bottom: 25px;">${ayuda}</div>` : ''}
      <button id="btn-tour-error-retry" style="
        background: linear-gradient(135deg, #e53935 0%, #c62828 100%);
        color: white;
        border: none;
        padding: 12px 30px;
        font-size: 18px;
        font-weight: bold;
        border-radius: 50px;
        cursor: pointer;
        box-shadow: 0 6px 15px rgba(229, 57, 53, 0.4);
        transition: all 0.2s ease;
      ">
        Volver a intentar
      </button>
    `;

    // Animaciones
    if (!document.getElementById('tour-error-style')) {
      const s = document.createElement('style');
      s.id = 'tour-error-style';
      s.textContent = `
        @keyframes popInModal {
          0%   { opacity: 0; transform: translate(-50%, -20%) scale(0.8); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes fadeInBackdrop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        #btn-tour-error-retry:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(229, 57, 53, 0.5);
        }
        #btn-tour-error-retry:active {
          transform: translateY(1px);
          box-shadow: 0 3px 10px rgba(229, 57, 53, 0.4);
        }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    const btnRetry = modal.querySelector('#btn-tour-error-retry');
    btnRetry.onclick = () => {
      modal.style.transition = 'all 0.3s ease';
      backdrop.style.transition = 'opacity 0.3s ease';
      modal.style.opacity = '0';
      modal.style.transform = 'translate(-50%, -40%) scale(0.9)';
      backdrop.style.opacity = '0';
      
      setTimeout(() => {
        modal.remove();
        backdrop.remove();
        resolve(); // RESOLVE PROMISE ON CLICK
      }, 300);
    };
  });
}

console.log('✓ Sistema cargado');
