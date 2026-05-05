'use strict';

let highlightEnabled = true;
let selectedElement = null;
let translationsCache = {};

// ── Initialisation ──────────────────────────────────────────────────────────

async function init() {
  const data = await storageGet(['highlightEnabled', 'translations']);
  highlightEnabled = data.highlightEnabled !== false;
  translationsCache = data.translations || {};
  scanAndAttach(document.documentElement);
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

// ── Element detection ────────────────────────────────────────────────────────

function scanAndAttach(root) {
  root.querySelectorAll('[data-i18n]').forEach(attachElement);
  if (root.dataset && root.dataset.i18n) attachElement(root);
}

function attachElement(el) {
  if (el.dataset.trtAttached === '1') return;
  el.dataset.trtAttached = '1';

  if (highlightEnabled) el.classList.add('trt-i18n-element');

  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);
  // capture phase so we intercept before app handlers when in review mode
  el.addEventListener('click', onClick, true);
}

// ── Hover & selection ────────────────────────────────────────────────────────

function onEnter(e) {
  if (highlightEnabled) e.currentTarget.classList.add('trt-i18n-hover');
}

function onLeave(e) {
  e.currentTarget.classList.remove('trt-i18n-hover');
}

function onClick(e) {
  if (!highlightEnabled) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const el = e.currentTarget;

  if (selectedElement && selectedElement !== el) {
    selectedElement.classList.remove('trt-i18n-selected');
  }
  selectedElement = el;
  el.classList.add('trt-i18n-selected');
  el.classList.remove('trt-i18n-hover');

  const key = el.dataset.i18n;
  const currentText = el.textContent.trim();
  const referenceTranslation = translationsCache[key] || '';

  chrome.storage.session.set({
    currentElement: {
      key,
      currentText,
      referenceTranslation,
      url: window.location.href,
      timestamp: Date.now(),
    },
  });
}

// ── Highlight toggle ─────────────────────────────────────────────────────────

function setHighlight(enabled) {
  highlightEnabled = enabled;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    if (enabled) {
      el.classList.add('trt-i18n-element');
    } else {
      el.classList.remove('trt-i18n-element', 'trt-i18n-hover', 'trt-i18n-selected');
    }
  });
}

// ── Storage listeners ─────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.highlightEnabled !== undefined) {
    setHighlight(changes.highlightEnabled.newValue);
  }
  if (changes.translations) {
    translationsCache = changes.translations.newValue || {};
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SET_HIGHLIGHT') setHighlight(msg.enabled);
});

// ── MutationObserver (SPA support) ───────────────────────────────────────────

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      scanAndAttach(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// ── Start ─────────────────────────────────────────────────────────────────────

init();
