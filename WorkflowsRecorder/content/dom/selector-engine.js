/**
 * selector-engine.js - CSS selector generation (unique, attributes, XPath).
 *
 * Generates deterministic CSS selectors for recorded DOM elements,
 * with fallback strategies: unique selector → attribute selector → XPath.
 */

/**
 * Determines whether an element ID is likely auto-generated or dynamic.
 *
 * Dynamic IDs contain many digits, are very long, or match known framework prefixes.
 *
 * @param {string} id - The element's ID attribute value.
 * @returns {boolean} True if the ID appears to be dynamic and should be avoided.
 */
function isDynamicId(id) {
  if (!id) return true;
  const numDigits = (id.match(/\d/g) || []).length;
  if (numDigits > 3) return true;
  if (id.length > 20) return true;
  if (/^(ember|gui|gen|idx|v-)/i.test(id)) return true;
  return false;
}

/**
 * Generates a unique CSS selector for the given element.
 *
 * Strategy order:
 *   1. Use a stable ID if it uniquely identifies the element.
 *   2. Build a path-based selector using tag names, stable classes, and :nth-of-type.
 *   3. Fall back to generateSelectorWithAttributes().
 *   4. Final fallback to generateXPathSelector().
 *
 * @param {Element} element - The DOM element to generate a selector for.
 * @returns {string} A CSS selector string that uniquely identifies the element.
 */
function generateUniqueSelector(element) {
  if (element.id) {
    const idSelector = `#${element.id}`;
    try {
      if (document.querySelectorAll(idSelector).length === 1) {
        return idSelector;
      }
    } catch (e) {
      ;
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

    if (path.length > 10) {
      break;
    }
  }

  let fullSelector = path.join(' > ');

  try {
    const matches = document.querySelectorAll(fullSelector);
    if (matches.length === 1) {
      return fullSelector;
    }
  } catch (e) {
    ;
  }

  fullSelector = generateSelectorWithAttributes(element);

  try {
    const finalMatches = document.querySelectorAll(fullSelector);
    if (finalMatches.length === 1) {
      return fullSelector;
    }
  } catch (e) {
    ;
  }

  const fallbackSelector = generateXPathSelector(element);
  return fallbackSelector;
}

/**
 * Generates a CSS selector using element attributes (data-testid, name, role, etc.).
 *
 * Iterates through a priority list of attributes. For each attribute present,
 * appends it as a selector and checks uniqueness. If text content is unique
 * among same-tag elements, includes a parent-child structural qualifier.
 *
 * @param {Element} element - The DOM element.
 * @returns {string} A CSS selector string.
 */
function generateSelectorWithAttributes(element) {
  let selector = element.nodeName.toLowerCase();

  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ')
      .filter(c => c.trim())
      .map(c => c.trim());
    if (classes.length > 0) {
      selector += '.' + classes.join('.');
    }
  }

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
      const escapedValue = value.replace(/"/g, '\\"');
      selector += `[${attr}="${escapedValue}"]`;

      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
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

/**
 * Generates an XPath-style CSS selector as a last-resort fallback.
 *
 * Builds a path from the element up to an ID'd ancestor or the body,
 * using :nth-of-type for disambiguation. If the result is not unique,
 * assigns a temporary data-recorder-temp attribute for guaranteed uniqueness.
 *
 * @param {Element} element - The DOM element.
 * @returns {string} A unique CSS selector string.
 */
function generateXPathSelector(element) {
  const path = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let selector = current.nodeName.toLowerCase();

    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const parent = current.parentElement;
    if (parent) {
      const sameTypeSiblings = Array.from(parent.children).filter(
        child => child.nodeName === current.nodeName
      );

      if (sameTypeSiblings.length > 1) {
        selector += `:nth-of-type(${index})`;
      }
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
    if (matches.length === 1) {
      return finalSelector;
    }
  } catch (e) {
    ;
  }

  const uniqueId = `temp-selector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  element.setAttribute('data-recorder-temp', uniqueId);
  const tempSelector = `[data-recorder-temp="${uniqueId}"]`;

  setTimeout(() => {
    element.removeAttribute('data-recorder-temp');
  }, 100);

  return tempSelector;
}
