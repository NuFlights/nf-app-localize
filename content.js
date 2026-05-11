'use strict';

let sessionActive  = false;
let interceptEnabled = true;
let selectedElement = null;
let elements       = [];   // ordered list of all attached i18n elements in the DOM
let currentIndex   = -1;
let translationsCache = {};

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function normalizeLocale(raw) {
  // Normalise to e.g. "fr-FR", "en-GB" — lang lowercase, region uppercase
  const [lang, region] = raw.split(/[-_]/);
  return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
}

function detectLocale() {
  const lang = document.documentElement.lang;
  if (lang) return normalizeLocale(lang);

  const pathMatch = window.location.pathname.match(/^\/([a-z]{2}(?:[-_][a-z]{2})?)\//i);
  if (pathMatch) return normalizeLocale(pathMatch[1]);

  const p = new URLSearchParams(window.location.search);
  const qp = p.get('lang') || p.get('locale') || p.get('lng');
  if (qp) return normalizeLocale(qp);

  return null;
}

async function init() {
  const { translations } = await storageGet(['translations']);
  translationsCache = translations || {};

  const locale = detectLocale();
  const origin = window.location.protocol === 'file:' ? 'file://' : window.location.origin;

  chrome.storage.local.set({ detectedLocale: locale, pageOrigin: origin });
  chrome.runtime.sendMessage({ type: 'LOCALE_DETECTED', locale, origin }).catch(() => {});
}

// ── Element attachment ────────────────────────────────────────────────────────

function scanAndAttach(root) {
  root.querySelectorAll('[data-i18n]').forEach(attachEl);
  if (root.dataset?.i18n) attachEl(root);
  rebuildElements();
}

function attachEl(el) {
  if (el.dataset.trtAttached === '1') return;
  el.dataset.trtAttached = '1';
  el.classList.add('trt-i18n-element');
  el.addEventListener('mouseenter', e => e.currentTarget.classList.add('trt-i18n-hover'));
  el.addEventListener('mouseleave', e => e.currentTarget.classList.remove('trt-i18n-hover'));
  el.addEventListener('click', onClick, true);
}

function rebuildElements() {
  // Maintain DOM order
  elements = Array.from(document.querySelectorAll('[data-i18n][data-trt-attached="1"]'));
}

// ── Click handler ─────────────────────────────────────────────────────────────

function onClick(e) {
  if (!interceptEnabled) return; // navigate mode — let the app handle clicks
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const el = e.currentTarget;
  selectElement(el);
}

function selectElement(el) {
  selectedElement?.classList.remove('trt-i18n-selected');
  selectedElement = el;
  el.classList.add('trt-i18n-selected');
  el.classList.remove('trt-i18n-hover');

  const idx = elements.indexOf(el);
  if (idx !== -1) currentIndex = idx;

  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTED',
    data: {
      key: el.dataset.i18n,
      currentText: el.textContent.trim(),
      referenceTranslation: translationsCache[el.dataset.i18n] || '',
      url: window.location.href,
      timestamp: Date.now(),
      index: currentIndex,
      total: elements.length,
    },
  }).catch(() => {});
}

// ── Navigate to element by index ──────────────────────────────────────────────

function navigateTo(idx) {
  if (idx < 0) {
    chrome.runtime.sendMessage({ type: 'NAV_BOUNDARY', boundary: 'start' }).catch(() => {});
    return;
  }
  if (idx >= elements.length) {
    chrome.runtime.sendMessage({ type: 'NAV_BOUNDARY', boundary: 'end' }).catch(() => {});
    return;
  }

  currentIndex = idx;
  const el = elements[idx];
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  selectElement(el);
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'START_SESSION') {
    if (msg.translations) translationsCache = msg.translations;
    sessionActive = true;
    scanAndAttach(document.documentElement);
    // Auto-open first element
    if (elements.length > 0) navigateTo(0);
  }

  if (msg.type === 'REDETECT') {
    init();
  }

  if (msg.type === 'SET_INTERCEPT') {
    interceptEnabled = msg.enabled;
    document.documentElement.classList.toggle('trt-navigate-mode', !interceptEnabled);
  }

  if (msg.type === 'RESET_SESSION') {
    sessionActive = false;
    interceptEnabled = true;
    document.documentElement.classList.remove('trt-navigate-mode');
    elements = [];
    currentIndex = -1;
    selectedElement = null;
    document.querySelectorAll('[data-trt-attached="1"]').forEach(el => {
      el.classList.remove('trt-i18n-element', 'trt-i18n-hover', 'trt-i18n-selected');
      delete el.dataset.trtAttached;
    });
  }

  if (msg.type === 'NAVIGATE') {
    const skipSet = new Set(msg.skipKeys || []);
    const step = msg.direction === 'next' ? 1 : -1;
    let idx = currentIndex + step;

    // Skip already-reviewed keys
    while (idx >= 0 && idx < elements.length && skipSet.has(elements[idx].dataset.i18n)) {
      idx += step;
    }

    navigateTo(idx);
  }
});

// ── Storage / mutation listeners ──────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.translations) {
    translationsCache = changes.translations.newValue || {};
  }
});

new MutationObserver(mutations => {
  if (!sessionActive) return;
  let added = false;
  for (const { addedNodes } of mutations) {
    for (const node of addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        scanAndAttach(node);
        added = true;
      }
    }
  }
  if (added) rebuildElements();
}).observe(document.documentElement, { childList: true, subtree: true });

init();

// Watch for <html lang="..."> changes (SPA locale switching via attribute)
new MutationObserver(mutations => {
  for (const m of mutations) {
    if (m.attributeName === 'lang') {
      const locale = detectLocale();
      const origin = window.location.protocol === 'file:' ? 'file://' : window.location.origin;
      chrome.storage.local.set({ detectedLocale: locale, pageOrigin: origin });
      chrome.runtime.sendMessage({ type: 'LOCALE_DETECTED', locale, origin }).catch(() => {});
    }
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

// Watch for URL changes (SPA navigation via pushState / replaceState / popstate)
let _lastHref = location.href;

function checkUrlChange() {
  const href = location.href;
  if (href === _lastHref) return;
  _lastHref = href;
  const locale = detectLocale();
  const origin = window.location.protocol === 'file:' ? 'file://' : window.location.origin;
  chrome.storage.local.set({ detectedLocale: locale, pageOrigin: origin });
  chrome.runtime.sendMessage({ type: 'LOCALE_DETECTED', locale, origin }).catch(() => {});
}

window.addEventListener('popstate',   checkUrlChange);
window.addEventListener('hashchange', checkUrlChange);

(function patchHistory() {
  const wrap = fn => function (...args) { fn.apply(history, args); checkUrlChange(); };
  history.pushState    = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
})();
