// content.js - Final Player (Grid + Manual Scroll + Error Handling)

// Shepherd.js is already loaded from the manifest
let tour = null;
let overlay = null;
let menuOverlay = null;

// Flag to know if navigation was initiated by the tour (not by the user)
// Prevents beforeunload from clearing the tour state during step-to-step navigation
let isTourNavigation = false;

// Variables for tracking the current element
let currentTargetElement = null;
let animationFrameId = null;
let isReplaying = false;
let currentTargetSelector = null;
let lastAttachedElement = null;

/**
 * Simulate a full click sequence (mousedown -> mouseup -> click)
 * Necessary for components that react to mousedown (e.g., airline dropdowns)
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

async function init() {
  // Check extension context (avoid orphan script error)
  if (!chrome.runtime || !chrome.runtime.id) {
    console.warn('Invalid extension context. Reload required.');
    return;
  }

  // If there is an active tour, create the overlay immediately (before the 2s delay)
  // to avoid flickering when navigating between pages during a tour
  try {
    const result = await chrome.storage.local.get(['active_tour']);
    if (result.active_tour && result.active_tour.isActive && overlay === null) {
      overlay = document.createElement('div');
      overlay.id = 'overlay-extension';
      document.body.appendChild(overlay);
      console.log('🔲 [Tour] Overlay created immediately (active tour detected).');
    }
  } catch (e) {
    // If it fails, the overlay will be created later in startTourFromJSON
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

  // Wait 2 seconds after loading the page
  setTimeout(async () => {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        console.log("🔍 [Tour] Starting check...");

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
          console.log("🔄 [Tour] Persistent tour detected:", savedState.workflow.name, "Step:", savedState.currentStepIndex);

          const workflowData = savedState.workflow.data || savedState.workflow;
          const allNodes = (workflowData.drawflow?.nodes || []).sort((a, b) => a.id - b.id);
          const currentNode = allNodes[savedState.currentStepIndex];
          const expectedUrl = currentNode?.data?.url || null;

          // ── URL VALIDATION ─────────────────────────────────────────
          const isExpectedNavigation = savedState.isExpectedNavigation === true;
          const urlMatch = !expectedUrl || urlsMatch(expectedUrl, window.location.href);

          if (!urlMatch && !isExpectedNavigation) {
            console.warn('⚠️ [Tour] URL does not match the saved step. Clearing orphaned tour.');
            await clearTourState();
            if (overlay) { overlay.remove(); overlay = null; }
            // Continue with normal page load
          } else {
            // ── URL matches or is expected navigation: resume tour ──────
            if (savedState.pendingValidationIdx != null) {
              const pIdx = savedState.pendingValidationIdx;
              const pendingNode = allNodes[pIdx] || null;

              if (pendingNode?.data?.expected) {
                console.log(`🔎 [Tour] Validating step ${pIdx} result after reload...`);
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
                  console.warn(`⚠️ [Tour] Validation FAILED. Reverting to step ${revertIdx}.`);
                  await saveTourState(savedState.workflow, revertIdx, false, null);
                  const alreadyOnURL = pendingStepUrl && urlsMatch(pendingStepUrl, window.location.href);
                  if (!alreadyOnURL && pendingStepUrl) {
                    isTourNavigation = true; // protect beforeunload
                    await handleError(pendingNode);
                    window.location.href = pendingStepUrl;
                  } else {
                    startTourFromJSON(workflowData, revertIdx);
                    setTimeout(async () => { await handleError(pendingNode); }, 800);
                  }
                  tourResumed = true;
                } else {
                  console.log("✅ [Tour] Cross-reload validation successful. Continuing at step", savedState.currentStepIndex);
                  await saveTourState(savedState.workflow, savedState.currentStepIndex, savedState.isExpectedNavigation, null);
                  startTourFromJSON(workflowData, savedState.currentStepIndex);
                  tourResumed = true;
                }
              } else {
                await saveTourState(savedState.workflow, savedState.currentStepIndex, savedState.isExpectedNavigation, null);
                startTourFromJSON(workflowData, savedState.currentStepIndex);
                tourResumed = true;
              }
            } else {
              startTourFromJSON(workflowData, savedState.currentStepIndex);
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
      console.error('Error initializing:', e);
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
  const pendingMsg = pendingValidationIdx != null ? ` | Pending validation step: ${pendingValidationIdx}` : '';
  console.log(`💾 [Tour] State saved. Step: ${stepIndex}${pendingMsg}`);
}

async function loadTourState() {
  const result = await chrome.storage.local.get(['active_tour']);
  return result.active_tour;
}

async function clearTourState() {
  await chrome.storage.local.remove(['active_tour']);
  console.log("🗑️ [Tour] State cleared.");
}

function urlsMatch(url1, url2) {
  if (!url1 || !url2) return true;
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);

    const host1 = u1.host.replace(/^www\./, "").toLowerCase();
    const host2 = u2.host.replace(/^www\./, "").toLowerCase();

    const normalizePath = (p) => p
      .split(';')[0]
      .replace(/\/+$/, "")
      .replace(/\/+/g, "/")
      .toLowerCase();

    const path1 = normalizePath(u1.pathname);
    const path2 = normalizePath(u2.pathname);

    const match = host1 === host2 && path1 === path2;

    if (!match && host1 === host2) {
      console.log(`[Tour] 🔍 URL mismatch on same host. \n  Recorded: ${path1} \n  Current: ${path2}`);
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
      console.error("[Tour] ❌ Supabase client not initialized");
      return;
    }

    console.log("🔍 [Tour] Searching for all available guides...");

    const { data: rows, error } = await client
      .from('workflows')
      .select('*');

    if (error) {
      console.error("[Tour] ❌ Error downloading guides:", error);
      return;
    }

    if (!rows || rows.length === 0) {
      console.log("[Tour] No guides available in the database.");
      showNoGuidesMessage();
      return;
    }

    const currentUrl = window.location.href;

    const relevantWorkflows = rows.filter(row => {
      try {
        if (!row.data || !row.data.drawflow) return false;
        return urlsMatch(row.url, currentUrl);
      } catch (e) {
        return false;
      }
    }).map(row => {
      return {
        id: `s-${row.id}`,
        name: row.name,
        url: row.url,
        createdAt: row.created_at,
        tags: row.data.tags || [],
        description: row.data.description || "",
        data: row.data
      };
    });

    if (relevantWorkflows.length > 0) {
      console.log(`✓ [Tour] Found ${relevantWorkflows.length} guides for this page.`);
      createTourOverlay(relevantWorkflows);
    } else {
      console.log("[Tour] No guides for this specific URL.");
      showNoGuidesMessage();
    }

  } catch (err) {
    console.warn('[Tour] Fetch error:', err);
  }
}

function showNoGuidesMessage() {
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

// Show selection menu (Large Grid)
function createTourOverlay(workflows) {
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

  const title = document.createElement('h1');
  title.style.cssText = `
    margin: 0 0 30px 0; color: #2196F3;
    font-size: 56px; text-align: center;
  `;
  title.textContent = '👋 ¡Hola! ¿Necesitas ayuda?';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.style.cssText = `
    margin: 0 0 50px 0; color: #555;
    font-size: 32px; text-align: center; line-height: 1.4;
  `;
  subtitle.textContent = 'Guías disponibles. Pulsa sobre la guia para ver los detalles y empezar.';
  container.appendChild(subtitle);

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
    const button = document.createElement('button');
    button.style.cssText = `
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

    button.innerHTML = `
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

    button.onmouseover = () => {
      button.style.transform = 'translateY(-3px)';
      button.style.boxShadow = '0 12px 25px rgba(76, 175, 80, 0.6)';
    };

    button.onmouseout = () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 8px 20px rgba(76, 175, 80, 0.4)';
    };

    button.onclick = async () => {
      if (workflow.data) {
        showTourDetailsModal(workflow, workflows);
      }
    };

    grid.appendChild(button);
  });

  container.appendChild(grid);
  menuOverlay.appendChild(container);

  const btnClose = document.createElement('button');
  btnClose.style.cssText = `
    background: #9e9e9e; color: white; border: none;
    border-radius: 10px; padding: 15px 40px; font-size: 18px;
    font-weight: bold; cursor: pointer; display: block; margin: 0 auto;
  `;
  btnClose.textContent = '✕ Cerrar';
  btnClose.onclick = closeMenu;

  container.appendChild(btnClose);
  document.body.appendChild(menuOverlay);
}

function closeMenu() {
  if (menuOverlay) {
    menuOverlay.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => {
      if (menuOverlay) {
        menuOverlay.remove();
        menuOverlay = null;
      }
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
    }, 300);
  }
}

function showTourDetailsModal(workflow, workflows) {
  if (menuOverlay) {
    menuOverlay.style.display = 'none';
  }

  const detailsOverlay = document.createElement('div');
  detailsOverlay.id = 'detalles-tutorial-overlay';
  detailsOverlay.style.cssText = `
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

  const title = document.createElement('h1');
  title.style.cssText = `margin: 0 0 20px 0; color: #2196F3; font-size: 48px;`;
  title.textContent = workflow.name;
  container.appendChild(title);

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

  const btnBack = document.createElement('button');
  btnBack.style.cssText = `
    background: #9e9e9e; color: white; border: none; border-radius: 15px;
    padding: 20px 40px; font-size: 24px; font-weight: bold; cursor: pointer;
    transition: all 0.2s ease;
  `;
  btnBack.innerHTML = '← Volver';
  btnBack.onmouseover = () => btnBack.style.background = '#757575';
  btnBack.onmouseout = () => btnBack.style.background = '#9e9e9e';
  btnBack.onclick = () => {
    detailsOverlay.remove();
    if (menuOverlay) {
      menuOverlay.style.display = 'flex';
    }
  };

  const btnStart = document.createElement('button');
  btnStart.style.cssText = `
    background: #4CAF50; color: white; border: none; border-radius: 15px;
    padding: 20px 40px; font-size: 24px; font-weight: bold; cursor: pointer;
    transition: all 0.2s ease; box-shadow: 0 5px 15px rgba(76, 175, 80, 0.4);
  `;
  btnStart.innerHTML = '▶ Iniciar Tour';
  btnStart.onmouseover = () => {
    btnStart.style.transform = 'translateY(-2px)';
    btnStart.style.boxShadow = '0 8px 20px rgba(76, 175, 80, 0.6)';
  };
  btnStart.onmouseout = () => {
    btnStart.style.transform = 'translateY(0)';
    btnStart.style.boxShadow = '0 5px 15px rgba(76, 175, 80, 0.4)';
  };
  btnStart.onclick = () => {
    detailsOverlay.remove();
    if (menuOverlay) {
      menuOverlay.remove();
      menuOverlay = null;
    }
    startTourFromJSON(workflow.data);
  };

  buttonsContainer.appendChild(btnBack);
  buttonsContainer.appendChild(btnStart);
  container.appendChild(buttonsContainer);
  
  detailsOverlay.appendChild(container);
  document.body.appendChild(detailsOverlay);
}

// Dark Cutout Logic
function updateOverlayCutout(element) {
  if (!overlay) return;

  if (!element) {
    overlay.style.top = '50%';
    overlay.style.left = '50%';
    overlay.style.width = '0px';
    overlay.style.height = '0px';
    overlay.style.border = '0px solid transparent';
    overlay.classList.remove('has-cutout');
    return;
  }

  const rect = element.getBoundingClientRect();
  const padding = 12; // Adjusted slightly for the border

  overlay.style.top = `${rect.top - padding}px`;
  overlay.style.left = `${rect.left - padding}px`;
  overlay.style.width = `${rect.width + padding * 2}px`;
  overlay.style.height = `${rect.height + padding * 2}px`;
  
  overlay.style.border = '3px solid #FFD700'; // Yellow/Gold border
  overlay.classList.add('has-cutout');
}

function updateOverlayOnFrame() {
  if (currentTargetSelector) {
    const el = document.querySelector(currentTargetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
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

// "Click to Scroll" Logic (Manual)
function showScrollMessage(element) {
  return new Promise((resolve) => {
    const rect = element.getBoundingClientRect();
    const needsToScrollDown = rect.top > window.innerHeight;

    const overlayModal = document.createElement('div');
    overlayModal.className = 'modal-overlay';
    overlayModal.style.zIndex = '999999';
    overlayModal.style.background = 'rgba(0,0,0,0.9)';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.maxWidth = '600px';
    modal.style.padding = '40px';

    let direction = needsToScrollDown ? 'debajo' : 'arriba';
    let icon = needsToScrollDown ? '⬇️' : '⬆️';

    modal.innerHTML = `
      <div style="font-size: 80px; margin-bottom: 20px;">${icon}</div>
      <h3 style="color: #1976d2; margin: 10px 0 20px 0; font-size: 36px;">Siguiente paso fuera de pantalla</h3>
      <p style="font-size: 24px; line-height: 1.5; color: #333; margin-bottom: 40px;">
        El elemento que buscamos está más ${direction}.<br>
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
          ${icon} MOVER PANTALLA
        </button>
      </div>
    `;

    overlayModal.appendChild(modal);
    document.body.appendChild(overlayModal);

    const btn = document.getElementById('btnAutoScroll');

    btn.onclick = () => {
      btn.style.transform = 'scale(0.95)';
      btn.textContent = 'Moviendo...';

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      setTimeout(() => {
        document.body.removeChild(overlayModal);
        setTimeout(resolve, 400);
      }, 600);
    };
  });
}

function startTourFromJSON(tourData, initialStepIndex = 0) {
  if (typeof Shepherd === 'undefined') {
    alert('Error: El sistema de tutoriales no está disponible');
    return;
  }

  if (!tourData || !tourData.drawflow || !tourData.drawflow.nodes) {
    alert('Error: El tutorial no tiene pasos válidos');
    return;
  }

  if (tour) tour.complete();

  if (overlay === null) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-extension';
    document.body.appendChild(overlay);
  }

  const sortedNodes = tourData.drawflow.nodes.sort((a, b) => a.id - b.id);

  saveTourState({ data: tourData, name: tourData.name || "Workflow" }, initialStepIndex, false);

  tour = new Shepherd.Tour({
    useModalOverlay: false,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      scrollTo: false
    }
  });

  sortedNodes.forEach((node, index) => {
    if (index < initialStepIndex) return;
    if (!node.data?.selector) return;

    const stepConfig = {
      id: node.id || `step-${index}`,
      title: `Paso ${index + 1}`,
      text: `<div style="font-size: 18px; line-height: 1.6;">${node.data.description}</div>`,
      attachTo: {
        element: node.data.selector,
        on: 'bottom'
      },
      buttons: []
    };

    if (index > 0) {
      stepConfig.buttons.push({
        text: '<span class="shepherd-back-icon">←</span> Anterior',
        action: async () => {
          await saveTourState({ data: tourData, name: tourData.name || "Workflow" }, index - 1);
          tour.back();
        },
        classes: 'shepherd-button-prev'
      });
    }

    const isLastStep = index === sortedNodes.length - 1;
    const isInputStep = node.data?.stepType === 'input';

    if (isInputStep && !isLastStep) {
      stepConfig.buttons.push({
        text: 'Hecho <span class="shepherd-check-icon">✓</span>',
        classes: 'shepherd-button-complete',
        action: async () => {
          const nextIdx = index + 1;
          const nextN = sortedNodes[nextIdx];
          const needsNav = nextN.data.url && !urlsMatch(nextN.data.url, window.location.href);

          await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, needsNav);

          if (node.data.expected) {
            console.log("[Validation] ⏳ Verifying state after input...");
            const ok = await waitForExpectedState(node.data.expected);
            if (!ok) {
              console.warn("[Validation] ❌ Failed. Reverting to current step.");
              await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, index, false);
              handleError(node);
              return;
            }
          }

          if (needsNav) {
            showNavigationMessage(nextN.data.url);
            tour.cancel();
          } else {
            tour.next();
          }
        }
      });
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
        let element = null;
        let retryStart = Date.now();

        while (!element && (Date.now() - retryStart < 2000)) {
          element = document.querySelector(node.data.selector);
          if (!element) await new Promise(r => setTimeout(r, 200));
        }

        if (element) {
          if (!isElementVisible(element)) {
            updateOverlayCutout(null);
            await showScrollMessage(element);
          } else {
            element.scrollIntoView({ behavior: 'instant', block: 'center' });
          }
        }
        setTimeout(resolve, 50);
      });
    };

    tour.addStep(stepConfig);
  });

  let currentClickHandler = null;

  tour.on('show', (event) => {
    const step = event.step;
    if (step?.options?.attachTo) {
      const selector = step.options.attachTo.element;
      currentTargetSelector = selector;

      if (currentClickHandler && lastAttachedElement) {
        lastAttachedElement.removeEventListener('click', currentClickHandler, true);
        currentClickHandler = null;
      }

      let attempts = 0;
      const findInterval = setInterval(async () => {
        const el = document.querySelector(selector);
        attempts++;

        if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
          clearInterval(findInterval);
          console.log(`✅ [Tour] Element found after ${attempts} attempts:`, selector);

          currentTargetElement = el;
          lastAttachedElement = el;
          updateOverlayCutout(el);

          window.addEventListener('scroll', handleScrollOrResize, true);
          window.addEventListener('resize', handleScrollOrResize, true);

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
            console.log('[Tour] 🔄 Dynamic step active. Waiting for user selection...');
            currentClickHandler = async (e) => {
              if (isReplaying) return;
              if (e.target.closest('.shepherd-element')) return;

              const currentStep = tour.getCurrentStep();
              if (!currentStep) return;

              isReplaying = true;
              try {
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
                  setTimeout(() => {
                    if (needsNav) {
                      showNavigationMessage(nextN.data.url || '');
                      tour.cancel();
                    } else {
                      tour.next();
                    }
                    setTimeout(() => isReplaying = false, 600);
                  }, 300);
                }
              } catch (err) {
                console.error('❌ [Tour] Error in dynamic step:', err);
                isReplaying = false;
              }
            };
            el.addEventListener('click', currentClickHandler, true);
          } else {
            // Click-to-Advance Logic
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

                  const pendingIdx = hasExpected ? globalIdxClick : null;
                  await saveTourState(
                    { data: tourData, name: tourData.name || 'Workflow' },
                    nextIdx,
                    needsNav,
                    pendingIdx
                  );

                  setTimeout(() => {
                    try {
                      simulateFullClick(el);
                    } catch (err) {
                      console.error("❌ [Tour] Error simulating click:", err);
                    } finally {
                      setTimeout(() => isReplaying = false, 600);
                    }
                  }, 50);

                  if (hasExpected && !needsNav) {
                    console.log("[Validation] ⏳ Verifying click effect (no navigation)...");
                    const ok = await waitForExpectedState(currentNode.data.expected);
                    if (!ok) {
                      console.warn("[Validation] ❌ State not reached. Reverting to step", globalIdxClick);
                      await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, globalIdxClick, false, null);
                      handleError(currentNode);
                      return;
                    }
                    console.log("[Validation] ✅ State confirmed. Clearing pending flag.");
                    await saveTourState({ data: tourData, name: tourData.name || 'Workflow' }, nextIdx, false, null);
                  }

                  if (needsNav) {
                    showNavigationMessage(nextN.data.url || '');
                    tour.cancel();
                  } else {
                    tour.next();
                  }
                }
              } catch (err) {
                console.error("❌ [Tour] Error on click:", err);
                isReplaying = false;
              }
            };
            el.addEventListener('click', currentClickHandler, true);
          }
        }

        if (attempts > 20) {
          clearInterval(findInterval);
          console.warn(`⏳ [Tour] Timeout looking for element:`, selector);
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
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    clearTourState();
    showFinalMessage(tourData.name || "");
  });

  tour.on('cancel', () => {
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);

    if (currentTargetElement && currentClickHandler) {
      currentTargetElement.removeEventListener('click', currentClickHandler, true);
      currentClickHandler = null;
    }
    currentTargetElement = null;

    if (!isTourNavigation) {
      updateOverlayCutout(null);
      clearTourState();
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      console.log('🛑 [Tour] Tour cancelled by user.');
    }
  });

  console.log(`✓ Starting tutorial: ${tourData.name} from step ${initialStepIndex}`);
  setTimeout(() => tour.start(), 500);
}

function showNavigationMessage(nextUrl) {
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

function showFinalMessage(tourName) {
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
      <strong>"${tourName}"</strong>
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
// EXPECTED STATE VALIDATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronously checks if the current state of the interface
 * matches the expected state defined in the step.
 */
function checkExpectedState(expected) {
  if (!expected) return true;

  // 1. Check selectors that must be VISIBLE
  if (expected.visible && expected.visible.length > 0) {
    for (const selector of expected.visible) {
      const el = document.querySelector(selector);
      if (!el) {
        console.log(`[Validation] ❌ Missing visible element: ${selector}`);
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
        console.log(`[Validation] ❌ Element is not visible: ${selector}`);
        return false;
      }
    }
  }

  // 2. Check selectors that must be HIDDEN
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
          console.log(`[Validation] ❌ Element should be hidden but is visible: ${selector}`);
          return false;
        }
      }
    }
  }

  // 3. Check expected text (Fuzzy Matching)
  if (expected.text) {
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = expected.text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (!bodyText.includes(targetText)) {
      console.log(`[Validation] ❌ Expected text not found. Looking for: "${targetText.substring(0, 30)}..."`);
      return false;
    }
  }

  return true;
}

/**
 * Asynchronously waits (polling every 200 ms) until the expected
 * state is met or the timeout is reached.
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
        console.warn('[Validation] ⏰ Timeout waiting for expected state.', expected);
        resolve(false);
        return;
      }
      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Scrolls to the element and adds a temporary highlight animation.
 */
function highlightElement(element) {
  if (!element) return;

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const originalOutline = element.style.outline;
  const originalBoxShadow = element.style.boxShadow;
  const originalTransition = element.style.transition;

  element.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
  element.style.outline = '3px solid #e53935';
  element.style.boxShadow = '0 0 0 6px rgba(229, 57, 53, 0.35)';

  let pulseCount = 0;
  const pulseInterval = setInterval(() => {
    pulseCount++;
    element.style.opacity = pulseCount % 2 === 0 ? '1' : '0.6';
    if (pulseCount >= 6) {
      clearInterval(pulseInterval);
      element.style.opacity = '1';
    }
  }, 300);

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.boxShadow = originalBoxShadow;
    element.style.transition = originalTransition;
  }, 3500);
}

/**
 * Handles error when the expected state is not met.
 */
async function handleError(node) {
  console.warn('[Validation] ❌ Expected state not reached. Activating guided recovery.');

  const invalidField = document.querySelector(':invalid');
  if (invalidField) {
    console.log('[Validation] 🔎 Invalid field found:', invalidField);
    highlightElement(invalidField);
    await showErrorMessage(
      '¡Ups! Un pequeño despiste 😅',
      'Parece que hay algún dato que no es del todo correcto.',
      '¡No te preocupes! Vamos a revisarlo juntos para poder continuar.'
    );
    return;
  }

  console.log('[Validation] 🔁 No invalid field. Returning to the first step of the page.');
  await showErrorMessage(
    'No ha salido a la primera, ¡pero no pasa nada! 😊',
    'A veces la tecnología es un poco caprichosa.',
    'Vamos a volver a intentarlo tranquilamente, paso a paso.'
  );

  if (tour) {
    const steps = tour.steps;
    if (steps && steps.length > 0) {
      tour.show(steps[0].id);
    }
  }
}

/**
 * Displays an error modal in the center of the screen.
 */
function showErrorMessage(title, message, help = '') {
  return new Promise((resolve) => {
    const existing = document.getElementById('tour-error-toast');
    const existingBackdrop = document.getElementById('tour-error-backdrop');
    if (existing) existing.remove();
    if (existingBackdrop) existingBackdrop.remove();

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
        ${title}
      </div>
      <div style="color: #444; font-size: 18px; margin-bottom: ${help ? '10px' : '0'}">
        ${message}
      </div>
      ${help ? `<div style="color: #666; font-size: 16px; margin-bottom: 25px;">${help}</div>` : ''}
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
        resolve();
      }, 300);
    };
  });
}

console.log('✓ System loaded');
