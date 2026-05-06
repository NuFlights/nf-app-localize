'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let reviews       = {};
let translations  = {};
let currentEl     = null;
let pendingAction = null;
let historyFilter = 'all';
let currentLocale = null;
let currentOrigin = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const startScreen = $('startScreen');
const mainScreen  = $('mainScreen');

const stDetecting = $('stDetecting');
const stReady     = $('stReady');
const stFileLocal = $('stFileLocal');
const stNoLocale  = $('stNoLocale');
const stFetching  = $('stFetching');
const stError     = $('stError');
const ALL_STATES  = [stDetecting, stReady, stFileLocal, stNoLocale, stFetching, stError];

const localePill  = $('localePill');
const localeName  = $('localeName');
const fetchUrl    = $('fetchUrl');
const fetchingUrl = $('fetchingUrl');
const errorMsg    = $('errorMsg');

const reviewEmpty    = $('reviewEmpty');
const reviewForm     = $('reviewForm');
const rvKey          = $('rvKey');
const rvCurrentText  = $('rvCurrentText');
const rvRefRow       = $('rvRefRow');
const rvRefText      = $('rvRefText');
const rvStatus       = $('rvStatus');
const rvSuggestRow   = $('rvSuggestRow');
const rvSuggestLabel = $('rvSuggestLabel');
const rvSuggestText  = $('rvSuggestText');
const rvNoteRow      = $('rvNoteRow');
const rvNoteText     = $('rvNoteText');
const btnApprove     = $('btnApprove');
const btnSuggest     = $('btnSuggest');
const btnIssue       = $('btnIssue');
const btnSubmit      = $('btnSubmit');
const rvToast        = $('rvToast');

const searchBox   = $('searchBox');
const reviewList  = $('reviewList');
const listEmpty   = $('listEmpty');
const stApproved  = $('stApproved');
const stSuggested = $('stSuggested');
const stIssue     = $('stIssue');
const stTotal     = $('stTotal');

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}

function flattenObject(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenObject(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

const LOCALE_NAMES = {
  fr: 'French', en: 'English', de: 'German', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese',
  zh: 'Chinese', ar: 'Arabic', ko: 'Korean', ru: 'Russian',
};

function getLocaleName(code) {
  return code ? (LOCALE_NAMES[code] || code.toUpperCase()) : 'Unknown';
}

const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', suggested: 'Suggested', needs_review: 'Issue' };
const STATUS_BADGE  = { pending: 'badge-pending', approved: 'badge-approved', suggested: 'badge-suggested', needs_review: 'badge-needs_review' };

function fmtStatus(s) { return STATUS_LABELS[s] ?? s; }

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, ok = true) {
  rvToast.className = ok ? 'toast toast-ok' : 'toast toast-err';
  rvToast.textContent = msg;
  show(rvToast);
  setTimeout(() => hide(rvToast), 2800);
}

// ── Screen / state management ─────────────────────────────────────────────────

function showState(stateEl) {
  ALL_STATES.forEach(s => hide(s));
  show(stateEl);
}

function setupStartScreen(locale, origin) {
  currentLocale = locale;
  currentOrigin = origin;

  mainScreen.style.display = 'none';
  startScreen.style.display = '';

  // file:// page — can't auto-fetch
  if (origin === 'file://') {
    showState(stFileLocal);
    return;
  }

  // No locale detected on the page
  if (!locale) {
    showState(stNoLocale);
    return;
  }

  // Happy path — show locale + fetch URL
  const name = getLocaleName(locale);
  localeName.textContent = `${name} (${locale})`;
  fetchUrl.textContent   = `${origin}/locales/${locale}.json`;
  showState(stReady);
}

function activateSession(flat) {
  translations = flat;
  storageSet({ translations: flat });

  // Send to the active tab's content script
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SESSION', translations: flat }).catch(() => {});
    }
  });

  // Show locale badge in header
  if (currentLocale) {
    localePill.textContent = `${getLocaleName(currentLocale)} · ${currentLocale.toUpperCase()}`;
    show(localePill);
  }

  startScreen.style.display = 'none';
  mainScreen.style.display  = 'flex';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function load() {
  const data = await storageGet(['reviews', 'translations', 'detectedLocale', 'pageOrigin']);
  reviews      = data.reviews      || {};
  translations = data.translations || {};

  renderHistory();
  updateStats();

  // detectedLocale === undefined means content script hasn't run yet
  if (data.detectedLocale === undefined) {
    showState(stDetecting);
  } else {
    setupStartScreen(data.detectedLocale ?? null, data.pageOrigin ?? null);
  }
}

// ── Incoming messages ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'LOCALE_DETECTED') {
    setupStartScreen(message.locale, message.origin);
  }

  if (message.type === 'ELEMENT_SELECTED') {
    currentEl = message.data;
    showReviewForm(currentEl);
    if (!$('reviewPane').classList.contains('active')) activateTab('reviewPane');
  }
});

// ── Storage listener ──────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.reviews)      { reviews = changes.reviews.newValue || {}; renderHistory(); updateStats(); }
  if (changes.translations) { translations = changes.translations.newValue || {}; }

  // Content script wrote locale info — update start screen if session not active
  if ((changes.detectedLocale !== undefined || changes.pageOrigin !== undefined)
      && mainScreen.style.display !== 'flex') {
    const locale = changes.detectedLocale !== undefined
      ? changes.detectedLocale.newValue
      : currentLocale;
    const origin = changes.pageOrigin !== undefined
      ? changes.pageOrigin.newValue
      : currentOrigin;
    setupStartScreen(locale, origin);
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function activateTab(paneId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.pane === paneId));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === paneId));
}

document.querySelectorAll('.tab-btn').forEach(btn =>
  btn.addEventListener('click', () => activateTab(btn.dataset.pane))
);

// ── Fetch on "Start Review Session" ──────────────────────────────────────────

$('btnStart').addEventListener('click', async () => {
  if (!currentLocale || !currentOrigin) return;
  const url = `${currentOrigin}/locales/${currentLocale}.json`;
  fetchingUrl.textContent = url;
  showState(stFetching);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    activateSession(flattenObject(json));
  } catch {
    errorMsg.textContent = `Could not load translations from:\n${currentOrigin}/locales/${currentLocale}.json`;
    showState(stError);
  }
});

$('btnRetry').addEventListener('click', () => setupStartScreen(currentLocale, currentOrigin));

// ── Import handlers ───────────────────────────────────────────────────────────

function setupImport(btnId, fileId, onLoaded) {
  const btn  = $(btnId);
  const file = $(fileId);
  if (!btn || !file) return;

  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const flat = flattenObject(JSON.parse(await f.text()));
      onLoaded(flat);
    } catch {
      showToast('Invalid JSON file', false);
    }
    file.value = '';
  });
}

// Start-screen imports → start session
const onManualImport = flat => activateSession(flat);
setupImport('importBtnStart',    'importFileStart',    onManualImport);
setupImport('importBtnLocal',    'importFileLocal',    onManualImport);
setupImport('importBtnNoLocale', 'importFileNoLocale', onManualImport);
setupImport('importBtnError',    'importFileError',    onManualImport);

// Mid-session import (history tab) → update reference translations only
setupImport('importBtnHistory', 'importFileHistory', flat => {
  translations = flat;
  storageSet({ translations: flat });
  showToast(`Imported ${Object.keys(flat).length} keys`);
});

// ── Review form ───────────────────────────────────────────────────────────────

function showReviewForm(el) {
  hide(reviewEmpty);
  show(reviewForm);

  rvKey.textContent         = el.key;
  rvCurrentText.textContent = el.currentText;

  const ref = el.referenceTranslation || translations[el.key] || '';
  if (ref) { rvRefText.textContent = ref; show(rvRefRow); } else { hide(rvRefRow); }

  const existing = reviews[el.key];
  if (existing) {
    setStatusBadge(existing.status);
    rvSuggestText.value = existing.suggestedText || '';
    rvNoteText.value    = existing.note || '';
  } else {
    setStatusBadge('pending');
    rvSuggestText.value = '';
    rvNoteText.value    = '';
  }

  pendingAction = null;
  hide(rvSuggestRow); hide(rvNoteRow); hide(btnSubmit); hide(rvToast);
  [btnApprove, btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));
}

function setStatusBadge(status) {
  rvStatus.textContent = fmtStatus(status);
  rvStatus.className   = `badge ${STATUS_BADGE[status] || 'badge-pending'}`;
}

// ── Action buttons ────────────────────────────────────────────────────────────

btnApprove.addEventListener('click', () => {
  activateAction('approved');
  saveReview('approved', null, null);
});

btnSuggest.addEventListener('click', () => {
  activateAction('suggested');
  rvSuggestLabel.textContent = 'Suggested correction';
  show(rvSuggestRow); hide(rvNoteRow); show(btnSubmit);
  rvSuggestText.focus();
});

btnIssue.addEventListener('click', () => {
  activateAction('needs_review');
  rvSuggestLabel.textContent = 'Corrected text (optional)';
  show(rvSuggestRow); show(rvNoteRow); show(btnSubmit);
});

btnSubmit.addEventListener('click', () => {
  if (!pendingAction) return;
  const suggested = rvSuggestText.value.trim();
  const note      = rvNoteText.value.trim();

  if (pendingAction === 'suggested' && !suggested) {
    rvSuggestText.classList.add('error');
    rvSuggestText.focus();
    setTimeout(() => rvSuggestText.classList.remove('error'), 1500);
    return;
  }
  saveReview(pendingAction, suggested || null, note || null);
});

function activateAction(action) {
  pendingAction = action;
  [btnApprove, btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));
  ({ approved: btnApprove, suggested: btnSuggest, needs_review: btnIssue })[action]?.classList.add('active');
}

async function saveReview(status, suggestedText, note) {
  if (!currentEl) return;
  reviews[currentEl.key] = {
    key: currentEl.key, currentText: currentEl.currentText,
    suggestedText, note, status, url: currentEl.url || '',
    timestamp: new Date().toISOString(),
  };
  await storageSet({ reviews });
  setStatusBadge(status);
  hide(rvSuggestRow); hide(rvNoteRow); hide(btnSubmit);
  [btnApprove, btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));
  pendingAction = null;
  showToast(`Saved as "${fmtStatus(status)}"`);
}

// ── History ───────────────────────────────────────────────────────────────────

function renderHistory() {
  const query = searchBox?.value.toLowerCase() || '';
  let items = Object.values(reviews);
  if (historyFilter !== 'all') items = items.filter(r => r.status === historyFilter);
  if (query) items = items.filter(r => r.key.toLowerCase().includes(query));
  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  reviewList.innerHTML = '';
  if (!items.length) { show(listEmpty); return; }
  hide(listEmpty);

  items.forEach(r => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div class="review-card-header">
        <span class="review-card-key">${esc(r.key)}</span>
        <span class="badge ${STATUS_BADGE[r.status] || 'badge-pending'}">${fmtStatus(r.status)}</span>
      </div>
      <div class="review-card-text">${esc(r.currentText)}</div>
      ${r.suggestedText ? `<div class="review-card-suggested">→ ${esc(r.suggestedText)}</div>` : ''}
      ${r.note ? `<div class="review-card-suggested" style="color:#64748b">📝 ${esc(r.note)}</div>` : ''}
      <div class="review-card-time">${fmtTime(r.timestamp)}${r.url ? ` · ${esc(new URL(r.url).pathname)}` : ''}</div>
    `;
    card.addEventListener('click', () => {
      currentEl = { key: r.key, currentText: r.currentText, referenceTranslation: translations[r.key] || '', url: r.url };
      showReviewForm(currentEl);
      activateTab('reviewPane');
    });
    reviewList.appendChild(card);
  });
}

function updateStats() {
  const vals = Object.values(reviews);
  stApproved.textContent  = vals.filter(r => r.status === 'approved').length;
  stSuggested.textContent = vals.filter(r => r.status === 'suggested').length;
  stIssue.textContent     = vals.filter(r => r.status === 'needs_review').length;
  stTotal.textContent     = vals.length;
}

document.querySelectorAll('.chip').forEach(chip =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    historyFilter = chip.dataset.filter;
    renderHistory();
  })
);

searchBox?.addEventListener('input', renderHistory);

// ── Export ────────────────────────────────────────────────────────────────────

$('exportJson').addEventListener('click', () => {
  const data = Object.values(reviews);
  if (!data.length) { showToast('Nothing to export', false); return; }
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `translations-review-${Date.now()}.json`);
});

$('exportCsv').addEventListener('click', () => {
  const data = Object.values(reviews);
  if (!data.length) { showToast('Nothing to export', false); return; }
  const header = ['key', 'currentText', 'suggestedText', 'note', 'status', 'url', 'timestamp'];
  const rows   = data.map(r => header.map(h => csvEsc(r[h] ?? '')).join(','));
  downloadBlob(new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' }), `translations-review-${Date.now()}.csv`);
});

function csvEsc(val) {
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

$('clearAll').addEventListener('click', async () => {
  if (!confirm('Delete all review data? This cannot be undone.')) return;
  reviews = {};
  await storageSet({ reviews: {} });
  renderHistory(); updateStats();
});

// ── Init ──────────────────────────────────────────────────────────────────────

load();
