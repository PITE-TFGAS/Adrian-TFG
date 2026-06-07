/**
 * expected-state.js - Expected DOM state validation (check, wait, highlight).
 *
 * Provides functions for verifying that the DOM matches an expected state
 * (visible elements, hidden elements, text content), with polling support
 * and failure highlighting.
 */

/**
 * Checks whether the current DOM matches an expected state.
 *
 * Verifies that:
 * - Elements listed in `expected.visible` exist and are visible.
 * - Elements listed in `expected.hidden` do not exist, or exist and are hidden.
 * - `expected.text` appears somewhere in the document body text.
 *
 * @param {Object|null} expected - The expected state with optional `visible`, `hidden`, and `text` arrays.
 * @returns {boolean} True if the DOM matches the expected state.
 */
function checkExpectedState(expected) {
  if (!expected) return true;

  if (expected.visible && expected.visible.length > 0) {
    for (const selector of expected.visible) {
      const el = document.querySelector(selector);
      if (!el) {
        ;
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
        ;
        return false;
      }
    }
  }

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
          ;
          return false;
        }
      }
    }
  }

  if (expected.text) {
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = expected.text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (!bodyText.includes(targetText)) {
      ;
      return false;
    }
  }

  return true;
}

/**
 * Polls until the DOM matches the expected state or a timeout is reached.
 *
 * Checks every 200ms. Resolves true if the state matches, false on timeout.
 *
 * @param {Object|null} expected - The expected state to wait for.
 * @param {number} [timeout=4000] - Maximum wait time in milliseconds.
 * @returns {Promise<boolean>} True if expected state was reached, false on timeout.
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
        ;
        resolve(false);
        return;
      }
      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Highlights an element with a red outline and pulsing effect.
 *
 * Scrolls the element into view, applies a visual highlight for 3.5 seconds,
 * then restores the original styling.
 *
 * @param {Element} element - The DOM element to highlight.
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
