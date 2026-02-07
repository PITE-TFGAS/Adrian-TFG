// content.js - Reproductor Final (Grid + Manual Scroll + Error Handling)

// Shepherd.js ya está cargado desde el manifest
let tour = null;
let overlay = null;
let menuOverlay = null;

// Variables para el seguimiento del elemento actual
let currentTargetElement = null;
let animationFrameId = null;

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
        console.log("🔍 [Tour] Iniciando comprobación directa en Supabase...");

        // 1. Get Auth Session (Only thing we read from storage)
        const sessionData = await chrome.storage.local.get(['supabase_session']);
        const client = window.supabaseClient || supabaseClient;

        if (sessionData && sessionData.supabase_session && client) {
          // 2. Direct Fetch & Show
          await fetchAndShowWorkflows(sessionData.supabase_session, client);
        } else {
          console.log("ℹ️ [Tour] Sesión no iniciada. No se buscarán guías.");
        }
      }
    } catch (e) {
      console.error('Error inicializando:', e);
    }
  }, 2000);
}

// Nueva función: Fetch directo + Filtrado + Mostrar
async function fetchAndShowWorkflows(session, client) {
  try {
    // A. Restore Session
    if (session.access_token && session.refresh_token) {
      const { error: authError } = await client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
      if (authError) console.warn("[Tour] Error restaurando sesión:", authError);
    }

    // B. Fetch All Workflows for User (Memory Only)
    const { data: rows, error } = await client
      .from('workflows')
      .select('*')
      .eq('user_id', session.user.id);

    if (error) {
      console.error("[Tour] Error descargando guías:", error);
      return;
    }

    if (!rows || rows.length === 0) {
      console.log("[Tour] El usuario no tiene guías en la nube.");
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

        // Check URL match
        const wUrl = new URL(row.url);
        return wUrl.host === curObj.host && wUrl.pathname === curObj.pathname;
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
  const padding = 10;

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
  if (currentTargetElement) {
    updateOverlayCutout(currentTargetElement);
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

function iniciarTourDesdeJSON(tourData) {
  if (typeof Shepherd === 'undefined') {
    alert('Error: El sistema de tutoriales no está disponible');
    return;
  }

  if (!tourData || !tourData.drawflow || !tourData.drawflow.nodes) {
    alert('Error: El tutorial no tiene pasos válidos');
    return;
  }

  if (tour) tour.complete();

  const sortedNodes = tourData.drawflow.nodes;

  tour = new Shepherd.Tour({
    useModalOverlay: false,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      scrollTo: false // Importante: Auto-scroll desactivado
    }
  });

  sortedNodes.forEach((node, index) => {
    if (!node.data?.selector) return;

    const stepConfig = {
      id: node.id || `step-${index}`,
      title: `Paso ${index + 1}`,
      text: `<div style="font-size: 18px; line-height: 1.6;">${node.data.description}</div>`,
      attachTo: {
        element: node.data.selector,
        on: node.data.tooltipPosition || 'bottom'
      },
      buttons: []
    };

    // Botones (Anterior, Siguiente, Finalizar)
    if (index > 0) {
      stepConfig.buttons.push({
        text: '← Anterior', action: tour.back, classes: 'shepherd-button-secondary'
      });
    }

    if (index < sortedNodes.length - 1) {
      stepConfig.buttons.push({ text: 'Siguiente →', action: tour.next });
    } else {
      stepConfig.buttons.push({ text: '✓ Finalizar', action: tour.complete });
    }

    // Interceptar para mostrar el botón de "Click to Scroll"
    stepConfig.beforeShowPromise = function () {
      return new Promise(async (resolve) => {
        const element = document.querySelector(node.data.selector);

        if (element) {
          // Solo ocultamos el recorte si REALMENTE necesitamos hacer scroll
          // Si el elemento ya es visible, mantenemos el recorte (o dejamos que el evento show lo actualice)
          if (!isElementVisible(element)) {
            updateOverlayCutout(null); // Ocultar para mostrar el aviso limpio
            await mostrarMensajeScroll(element);
          }
        }
        // Reducimos el timeout para que sea más ágil
        setTimeout(resolve, 50);
      });
    };

    tour.addStep(stepConfig);
  });

  // Eventos del Tour para manejar el Overlay y Click-to-Advance
  let currentClickHandler = null;

  tour.on('show', (event) => {
    const step = event.step;
    if (step?.options?.attachTo) {
      const el = document.querySelector(step.options.attachTo.element);
      if (el) {
        currentTargetElement = el;
        updateOverlayCutout(el);
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize, true);

        // Lógica Click-to-Advance
        // Limpiamos listener anterior por si acaso
        if (currentClickHandler) {
          el.removeEventListener('click', currentClickHandler);
        }

        currentClickHandler = (e) => {
          // Opcional: e.preventDefault(); si no queremos que haga la acción nativa
          // Pero el usuario dijo "darle click al elemento", lo que suele implicar usarlo.
          // Si avanza muy rápido, puede ser confuso. Dejaremos que haga la acción y avance.

          if (tour.getCurrentStep() === tour.steps[tour.steps.length - 1]) {
            tour.complete();
          } else {
            tour.next();
          }
        };

        el.addEventListener('click', currentClickHandler, { once: true }); // once: true para evitar dobles
      }
    }
  });

  tour.on('hide', () => {
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);

    // Limpiar click listener
    if (currentTargetElement && currentClickHandler) {
      currentTargetElement.removeEventListener('click', currentClickHandler);
      currentClickHandler = null;
    }

    currentTargetElement = null;
    updateOverlayCutout(null);
  });

  tour.on('complete', () => {
    // Asegurar limpieza total
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);

    if (currentTargetElement && currentClickHandler) {
      currentTargetElement.removeEventListener('click', currentClickHandler);
    }
    currentClickHandler = null;
    currentTargetElement = null;

    updateOverlayCutout(null); // Quitar recorte
    mostrarMensajeFinal(tourData.name);
  });

  tour.on('cancel', () => {
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);
    currentTargetElement = null;
    updateOverlayCutout(null);
  });

  console.log(`✓ Iniciando tutorial: ${tourData.name}`);
  setTimeout(() => tour.start(), 500);
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