/**
 * dom-analyzer.js - DOM analysis, snapshot, diffing, and stability detection.
 *
 * Provides utilities for examining DOM state, computing differences,
 * waiting for mutations to settle, and prompting users for expected-state
 * feedback during recording.
 */

/**
 * Checks whether an element belongs to the recorder's own UI overlay.
 *
 * @param {Element} el - The DOM element to check.
 * @returns {boolean} True if the element is part of recorder UI.
 */
function isForRecorder(el) {
  return !!(el.closest('#recording-overlay') ||
    el.closest('.recording-modal-overlay') ||
    el.id === 'recorder-analyzing');
}

/**
 * Determines whether an element is visually visible on the page.
 *
 * Checks bounding rect dimensions, computed visibility, display, and opacity.
 *
 * @param {Element} el - The DOM element to check.
 * @returns {boolean} True if the element has positive dimensions and is visible.
 */
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
 * Checks whether an element is an input-type element (text fields, textareas, contenteditable).
 *
 * Excludes buttons, checkboxes, radios, and other non-text input types.
 *
 * @param {Element} element - The DOM element to check.
 * @returns {boolean} True if the element accepts text input.
 */
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

/**
 * Determines the optimal tooltip position relative to an element.
 *
 * Uses viewport quadrant heuristics: top-third → bottom, bottom-third → top,
 * left-quarter → right, right-quarter → left, default → bottom.
 *
 * @param {Element} element - The target DOM element.
 * @returns {string} Tooltip position: 'top', 'bottom', 'left', or 'right'.
 */
function determineTooltipPosition(element) {
  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight;
  const windowWidth = window.innerWidth;

  if (rect.top < windowHeight / 3) {
    return 'bottom';
  }

  if (rect.bottom > (windowHeight * 2) / 3) {
    return 'top';
  }

  if (rect.left < windowWidth / 4) {
    return 'right';
  }

  if (rect.right > (windowWidth * 3) / 4) {
    return 'left';
  }

  return 'bottom';
}

/**
 * Finds the nearest dynamic container ancestor (e.g. dropdown, picker, dialog).
 *
 * Walks up to 8 levels looking for ARIA roles or class/id keywords
 * that identify interactive containers. Falls back to a parent 3 levels up.
 *
 * @param {Element} element - The child element within a potential dynamic container.
 * @returns {Element} The identified container element.
 */
function findDynamicContainer(element) {
  const dynamicRoles = ['dialog', 'listbox', 'grid', 'combobox', 'menu',
    'tree', 'calendar', 'datepicker', 'search'];
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

  let fallback = element;
  for (let i = 0; i < 3 && fallback.parentElement && fallback.parentElement !== document.body; i++) {
    fallback = fallback.parentElement;
  }
  return fallback;
}

/**
 * Takes a snapshot of the current DOM state.
 *
 * Captures visible elements by ID, named form fields, ARIA roles,
 * structural elements, and divs with meaningful classes.
 * Returns a Set of selectors and the body text.
 *
 * @returns {{visible: Set<string>, text: string}} Snapshot object.
 */
function snapshotDOM() {
  const visible = new Set();

  document.querySelectorAll('[id]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`#${el.id}`);
    }
  });

  document.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
    if (!isForRecorder(el) && isVisibleElement(el)) {
      visible.add(`${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`);
    }
  });

  const ariaSelectors = [
    '[role="alert"]', '[role="status"]', '[role="dialog"]',
    '[role="alertdialog"]', '[aria-live]', '[aria-invalid]',
    '[aria-expanded]'
  ];
  document.querySelectorAll(ariaSelectors.join(',')).forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el)) return;
    if (el.id) {
      visible.add(`#${el.id}`);
    } else {
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

  const genericPattern = /^(row|col|container|wrapper|d-|p-|m-|text-|bg-|btn|icon|flex|grid|sr-only|show|hide|active|fade|modal-|ng-|v-|js-)/;
  document.querySelectorAll('div[class]').forEach(el => {
    if (isForRecorder(el) || !isVisibleElement(el) || el.id) return;
    const classes = el.className.toString().trim().split(/\s+/);
    const sig = classes.find(c => c.length >= 4 && c.length <= 50 && !genericPattern.test(c));
    if (sig) visible.add(`div.${sig}`);
  });

  return { visible, text: document.body.innerText || '' };
}

/**
 * Computes the difference between two DOM snapshots.
 *
 * Determines which elements appeared, disappeared, and whether new text content
 * was added (up to 120 chars, up to 3 new lines).
 *
 * @param {{visible: Set<string>, text: string}} before - Previous snapshot.
 * @param {{visible: Set<string>, text: string}} after - Current snapshot.
 * @returns {{appeared: string[], disappeared: string[], newText: string}} Diff result.
 */
function computeDOMDiff(before, after) {
  const appeared = [];
  const disappeared = [];

  after.visible.forEach(sel => { if (!before.visible.has(sel)) appeared.push(sel); });
  before.visible.forEach(sel => { if (!after.visible.has(sel)) disappeared.push(sel); });

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
 * Waits for the DOM to stop mutating (stability detection).
 *
 * Uses a MutationObserver to detect changes. The promise resolves when:
 * - No mutations are observed for `stableMs` milliseconds after the last change,
 * - Or `minMs` have elapsed since start, whichever is longer,
 * - Or `maxMs` total have elapsed (hard timeout).
 *
 * @param {number} [maxMs=4000] - Maximum total wait time in ms.
 * @param {number} [stableMs=500] - Required idle period after last mutation in ms.
 * @param {number} [minMs=1000] - Minimum wait time in ms regardless of stability.
 * @returns {Promise<void>} Resolves when the DOM is considered stable.
 */
function waitForDOMStability(maxMs = 4000, stableMs = 500, minMs = 1000) {
  return new Promise(resolve => {
    const startTime = Date.now();
    let stableTimer = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(stableTimer);
      observer.disconnect();
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

    setTimeout(finish, maxMs);
    resetTimer();
  });
}

/**
 * Shows a floating "Analyzing changes" indicator on the page.
 *
 * @returns {Function} A cleanup function that fades and removes the indicator.
 */
function showWaitingForChanges() {
  const el = document.createElement('div');
  el.id = 'recorder-analyzing';
  el.style.cssText = `
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    background:#1565c0; color:white;
    padding:12px 24px; border-radius:50px;
    font-family:sans-serif; font-size:14px;
    z-index:1000002; box-shadow:0 4px 16px rgba(0,0,0,0.3);
  `;
  el.textContent = '?? Analizando cambios en la página...';
  document.body.appendChild(el);
  return () => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s ease';
    setTimeout(() => el.remove(), 300);
  };
}

/**
 * Prompts the user to confirm or discard detected DOM changes as an expected state.
 *
 * Shows a persistent bar at the bottom of the page listing detected changes
 * (appeared, disappeared, new text) with Skip and Save buttons.
 * Auto-closes after 15 seconds.
 *
 * @param {{appeared: string[], disappeared: string[], newText: string}} diff - The DOM diff to present.
 * @returns {Promise<Object|null>} The expected state object, or null if skipped/timed out.
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
      <span style="flex:1;">?? <strong>Cambios detectados:</strong> ${summary} · ·Guardar comprobación?</span>
      <button id="rec-bar-skip" style="
        padding:6px 14px;border:1px solid #555;background:transparent;
        color:#ccc;border-radius:6px;cursor:pointer;font-size:13px;
      ">Omitir</button>
      <button id="rec-bar-save" style="
        padding:6px 14px;background:#7c3aed;border:none;
        color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;
      ">? Guardar</button>
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
