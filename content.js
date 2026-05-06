'use strict';

let sessionActive = false;
let selectedElement = null;
let translationsCache = {};

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function detectLocale() {
  // 1. HTML lang attribute — most reliable
  const lang = document.documentElement.lang;
  if (lang) return lang.split('-')[0].toLowerCase();

  // 2. URL path segment e.g. /fr/, /en-US/
  const pathMatch = window.location.pathname.match(/^\/([a-z]{2})(?:[-_][a-z]{2})?\//i);
  if (pathMatch) return pathMatch[1].toLowerCase();

  // 3. Query param ?lang=fr / ?locale=fr / ?lng=fr
  const p = new URLSearchParams(window.location.search);
  const qp = p.get('lang') || p.get('locale') || p.get('lng');
  if (qp) return qp.split('-')[0].toLowerCase();

  return null;
}

async function init() {
  const { translations } = await storageGet(['translations']);
  translationsCache = translations || {};

  const locale = detectLocale();
  // Use sentinel 'file://' so side panel can distinguish from a real origin being null
  const origin = window.location.protocol === 'file:' ? 'file://' : window.location.origin;

  chrome.storage.local.set({ detectedLocale: locale, pageOrigin: origin });
  chrome.runtime.sendMessage({ type: 'LOCALE_DETECTED', locale, origin }).catch(() => {});
}

function scanAndAttach(root) {
  root.querySelectorAll('[data-i18n]').forEach(attachEl);
  if (root.dataset?.i18n) attachEl(root);
}

function attachEl(el) {
  if (el.dataset.trtAttached === '1') return;
  el.dataset.trtAttached = '1';
  el.classList.add('trt-i18n-element');
  el.addEventListener('mouseenter', e => e.currentTarget.classList.add('trt-i18n-hover'));
  el.addEventListener('mouseleave', e => e.currentTarget.classList.remove('trt-i18n-hover'));
  el.addEventListener('click', onClick, true);
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const el = e.currentTarget;
  selectedElement?.classList.remove('trt-i18n-selected');
  selectedElement = el;
  el.classList.add('trt-i18n-selected');
  el.classList.remove('trt-i18n-hover');

  chrome.runtime.sendMessage({
    type: 'ELEMENT_SELECTED',
    data: {
      key: el.dataset.i18n,
      currentText: el.textContent.trim(),
      referenceTranslation: translationsCache[el.dataset.i18n] || '',
      url: window.location.href,
      timestamp: Date.now(),
    },
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'START_SESSION') return;
  if (msg.translations) translationsCache = msg.translations;
  sessionActive = true;
  scanAndAttach(document.documentElement);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.translations) {
    translationsCache = changes.translations.newValue || {};
  }
});

new MutationObserver(mutations => {
  if (!sessionActive) return;
  for (const { addedNodes } of mutations) {
    for (const node of addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scanAndAttach(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

init();
