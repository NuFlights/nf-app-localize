'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let reviews            = {};
let translations       = {};   // reference (fr.json / imported)
let englishTranslations = {};  // english source (en.json)
let currentEl          = null;
let pendingAction      = null;
let historyFilter      = 'all';
let currentLocale      = null;
let currentOrigin      = null;
const drafts           = {};   // in-memory draft text { [key]: { text, note } }

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

// Review pane
const reviewEmpty    = $('reviewEmpty');
const reviewForm     = $('reviewForm');
const navProgress    = $('navProgress');
const btnPrev        = $('btnPrev');
const btnNext        = $('btnNext');
const rvKey          = $('rvKey');
const rvEnRow        = $('rvEnRow');
const rvEnText       = $('rvEnText');
const rvCurrentText  = $('rvCurrentText');
const rvRefRow       = $('rvRefRow');
const rvRefText      = $('rvRefText');
const rvStatus       = $('rvStatus');
const rvSuggestRow   = $('rvSuggestRow');
const rvSuggestLabel = $('rvSuggestLabel');
const rvSuggestText  = $('rvSuggestText');
const rvNoteRow      = $('rvNoteRow');
const rvNoteText     = $('rvNoteText');
const btnSuggest     = $('btnSuggest');
const btnIssue       = $('btnIssue');
const btnSubmit      = $('btnSubmit');
const rvToast        = $('rvToast');

// History pane
const searchBox   = $('searchBox');
const reviewList  = $('reviewList');
const listEmpty   = $('listEmpty');
const stSuggested = $('stSuggested');
const stIssue     = $('stIssue');
const stTotal     = $('stTotal');

// Download modal
const dlModal      = $('dlModal');
const dlSummary    = $('dlSummary');
const dlEndRow     = $('dlEndRow');

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

function unflattenObject(flat) {
  const out = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const parts = dotKey.split('.');
    let obj = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }
  return out;
}

const LOCALE_NAMES = {
  'fr': 'French',       'fr-FR': 'French (france)',    'fr-BE': 'French (Belgium)',
  'en': 'English',      'en-GB': 'English (UK)',        'en-US': 'English (US)',
  'de': 'German',       'de-DE': 'German (Germany)',
  'es': 'Spanish',      'es-ES': 'Spanish (Spain)',
  'it': 'Italian',      'nl': 'Dutch',
  'pt': 'Portuguese',   'pt-BR': 'Portuguese (Brazil)',
  'ja': 'Japanese',     'zh': 'Chinese',
  'ar': 'Arabic',       'ko': 'Korean',   'ru': 'Russian',
};

function getLocaleName(code) {
  if (!code) return 'Unknown';
  return LOCALE_NAMES[code] || LOCALE_NAMES[code.split('-')[0]] || code.toUpperCase();
}

// Maps short locale codes to the full regional code used in the file structure.
const LOCALE_REGION_MAP = {
  'fr': 'fr-FR',
  'en': 'en-GB',
  'de': 'de-DE',
  'es': 'es-ES',
  'pt': 'pt-BR',
};

// Builds the translation file URL from origin + locale code.
// Short codes are expanded via LOCALE_REGION_MAP before building the path.
// e.g. fr   → {origin}/locales/fr-FR/fr.json
//      fr-FR → {origin}/locales/fr-FR/fr.json
//      en-GB → {origin}/locales/en-GB/en.json
function localeToUrl(origin, locale) {
  const fullLocale = LOCALE_REGION_MAP[locale] || locale;
  const langCode   = fullLocale.split('-')[0].toLowerCase();
  return `${origin}/locales/${fullLocale}/${langCode}.json`;
}

const STATUS_LABELS = { pending: 'Pending', suggested: 'Suggested', needs_review: 'Flagged' };
const STATUS_BADGE  = { pending: 'badge-pending', suggested: 'badge-suggested', needs_review: 'badge-needs_review' };

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

  if (origin === 'file://') { showState(stFileLocal); return; }
  if (!locale)              { showState(stNoLocale);  return; }

  localeName.textContent = `${getLocaleName(locale)} (${locale})`;
  fetchUrl.textContent   = localeToUrl(origin, locale);
  showState(stReady);
}

async function activateSession(flat) {
  translations = flat;
  await storageSet({ translations: flat });

  // Also try to fetch English source in the background (non-blocking)
  if (currentOrigin && currentOrigin !== 'file://' && currentLocale && !currentLocale.startsWith('en')) {
    fetch(localeToUrl(currentOrigin, 'en-GB'))
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json) {
          englishTranslations = flattenObject(json);
          storageSet({ englishTranslations: englishTranslations });
        }
      })
      .catch(() => {});
  }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'START_SESSION', translations: flat }).catch(() => {});
    }
  });

  if (currentLocale) {
    localePill.textContent = currentLocale.toUpperCase();
    show(localePill);
  }
  show(btnToggleNav);

  startScreen.style.display = 'none';
  mainScreen.style.display  = 'flex';
}

// ── Navigation helpers ────────────────────────────────────────────────────────

function sendNavigate(direction) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'NAVIGATE', direction, skipKeys: [] }).catch(() => {});
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function load() {
  const data = await storageGet(['reviews', 'translations', 'englishTranslations', 'detectedLocale', 'pageOrigin']);
  reviews             = data.reviews             || {};
  translations        = data.translations        || {};
  englishTranslations = data.englishTranslations || {};

  renderHistory();
  updateStats();

  if (data.detectedLocale === undefined) {
    showState(stDetecting);
  } else {
    setupStartScreen(data.detectedLocale ?? null, data.pageOrigin ?? null);
  }
}

// ── Incoming messages ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'LOCALE_DETECTED') {
    if (mainScreen.style.display === 'flex') {
      // Session is active — show banner if locale actually changed
      if (message.locale && message.locale !== currentLocale) {
        currentLocale = message.locale;
        currentOrigin = message.origin;
        $('langBannerText').textContent =
          `Language changed to ${getLocaleName(message.locale)} (${message.locale.toUpperCase()}) — refresh to start a new session.`;
        show($('langChangeBanner'));
      }
    } else {
      setupStartScreen(message.locale, message.origin);
    }
  }

  if (message.type === 'ELEMENT_SELECTED') {
    currentEl = message.data;
    showReviewForm(currentEl);
    // Update progress counter
    if (message.data.total) {
      navProgress.textContent = `${message.data.index + 1} / ${message.data.total}`;
    }
    if (!$('reviewPane').classList.contains('active')) activateTab('reviewPane');
  }

  if (message.type === 'NAV_BOUNDARY') {
    showToast(
      message.boundary === 'end'
        ? "You've reached the last element"
        : "You're at the first element",
      false
    );
  }
});

// ── Storage listener ──────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.reviews)             { reviews = changes.reviews.newValue || {}; renderHistory(); updateStats(); }
  if (changes.translations)        { translations = changes.translations.newValue || {}; }
  if (changes.englishTranslations) { englishTranslations = changes.englishTranslations.newValue || {}; }

  if (changes.detectedLocale !== undefined || changes.pageOrigin !== undefined) {
    const locale = changes.detectedLocale !== undefined ? changes.detectedLocale.newValue : currentLocale;
    const origin = changes.pageOrigin     !== undefined ? changes.pageOrigin.newValue     : currentOrigin;
    if (mainScreen.style.display === 'flex') {
      // Session active — show banner only if locale actually changed
      if (locale && locale !== currentLocale) {
        currentLocale = locale;
        currentOrigin = origin;
        $('langBannerText').textContent =
          `Language changed to ${getLocaleName(locale)} (${locale.toUpperCase()}) — refresh to start a new session.`;
        show($('langChangeBanner'));
      }
    } else {
      setupStartScreen(locale, origin);
    }
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
  const url = localeToUrl(currentOrigin, currentLocale);
  fetchingUrl.textContent = url;
  showState(stFetching);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await activateSession(flattenObject(json));
  } catch {
    errorMsg.textContent = `Could not load translations from:\n${url}`;
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
      await onLoaded(flattenObject(JSON.parse(await f.text())));
    } catch {
      showToast('Invalid JSON file', false);
    }
    file.value = '';
  });
}

const onManualImport = flat => activateSession(flat);
setupImport('importBtnStart',    'importFileStart',    onManualImport);
setupImport('importBtnLocal',    'importFileLocal',    onManualImport);
setupImport('importBtnNoLocale', 'importFileNoLocale', onManualImport);
setupImport('importBtnError',    'importFileError',    onManualImport);


// ── Navigation buttons ────────────────────────────────────────────────────────

btnPrev.addEventListener('click', () => sendNavigate('prev'));
btnNext.addEventListener('click', () => sendNavigate('next'));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (mainScreen.style.display !== 'flex') return;

  const inInput = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

  // Ctrl/Cmd+Enter submits from anywhere
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!btnSubmit.classList.contains('hidden')) btnSubmit.click();
    return;
  }

  // Arrow keys navigate only when not typing
  if (!inInput) {
    if (e.key === 'ArrowRight') { e.preventDefault(); sendNavigate('next'); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); sendNavigate('prev'); }
  }
});

// ── Review form ───────────────────────────────────────────────────────────────

function showReviewForm(el) {
  hide(reviewEmpty);
  show(reviewForm);

  rvKey.textContent         = el.key;
  rvCurrentText.textContent = el.currentText;
  $('rvCurrentLabel').textContent = el.attrName
    ? `🏷 ${el.attrName} (attribute)`
    : '🇫🇷 Current text on page';

  // English source
  const enText = englishTranslations[el.key] || '';
  if (enText) { rvEnText.textContent = enText; show(rvEnRow); } else { hide(rvEnRow); }

  // Expected translation reference
  const ref = el.referenceTranslation || translations[el.key] || '';
  if (ref) { rvRefText.textContent = ref; show(rvRefRow); } else { hide(rvRefRow); }

  // Load existing review or draft
  const existing = reviews[el.key];
  const draft    = drafts[el.key];

  pendingAction = null;
  hide(rvSuggestRow); hide(rvNoteRow); hide(btnSubmit); hide(rvToast);
  [btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));

  if (existing) {
    setStatusBadge(existing.status);
    rvSuggestText.value = existing.suggestedText || '';
    rvNoteText.value    = existing.note || '';

    // Re-show the saved values so the reviewer can see / edit them
    if (existing.status === 'suggested') {
      pendingAction = 'suggested';
      rvSuggestLabel.textContent = 'Corrected translation';
      btnSuggest.classList.add('active');
      show(rvSuggestRow);
      show(btnSubmit);
    } else if (existing.status === 'needs_review') {
      pendingAction = 'needs_review';
      rvSuggestLabel.textContent = 'Corrected text (optional)';
      btnIssue.classList.add('active');
      show(rvSuggestRow);
      show(rvNoteRow);
      show(btnSubmit);
    }
  } else if (draft?.text) {
    setStatusBadge('pending');
    rvSuggestText.value = draft.text;
    rvNoteText.value    = draft.note || '';
    // Restore suggest UI for the draft
    pendingAction = 'suggested';
    rvSuggestLabel.textContent = 'Corrected translation';
    btnSuggest.classList.add('active');
    show(rvSuggestRow); show(btnSubmit);
  } else {
    setStatusBadge('pending');
    rvSuggestText.value = '';
    rvNoteText.value    = '';
  }
}

function setStatusBadge(status) {
  rvStatus.textContent = fmtStatus(status);
  rvStatus.className   = `badge ${STATUS_BADGE[status] || 'badge-pending'}`;
}

// ── Auto-save draft while typing ──────────────────────────────────────────────

rvSuggestText.addEventListener('input', () => {
  if (currentEl) drafts[currentEl.key] = { ...(drafts[currentEl.key] || {}), text: rvSuggestText.value };
});

rvNoteText.addEventListener('input', () => {
  if (currentEl) drafts[currentEl.key] = { ...(drafts[currentEl.key] || {}), note: rvNoteText.value };
});

// ── Action buttons ────────────────────────────────────────────────────────────

btnSuggest.addEventListener('click', () => {
  activateAction('suggested');
  rvSuggestLabel.textContent = 'Corrected translation';
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
  [btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));
  ({ suggested: btnSuggest, needs_review: btnIssue })[action]?.classList.add('active');
}

async function saveReview(status, suggestedText, note) {
  if (!currentEl) return;
  reviews[currentEl.key] = {
    key: currentEl.key, currentText: currentEl.currentText,
    suggestedText, note, status, url: currentEl.url || '',
    timestamp: new Date().toISOString(),
  };
  await storageSet({ reviews });
  delete drafts[currentEl.key];

  setStatusBadge(status);
  hide(rvSuggestRow); hide(rvNoteRow); hide(btnSubmit);
  [btnSuggest, btnIssue].forEach(b => b.classList.remove('active'));
  pendingAction = null;
  showToast(`Saved as "${fmtStatus(status)}"`);

  // Auto-advance to next unreviewed element after saving
  setTimeout(() => sendNavigate('next'), 700);
}

// ── History ───────────────────────────────────────────────────────────────────

function renderHistory() {
  const query = searchBox?.value.toLowerCase() || '';
  let items = Object.values(reviews);
  if (historyFilter !== 'all') items = items.filter(r => r.status === historyFilter);
  if (query) items = items.filter(r => r.key.toLowerCase().includes(query));
  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  items = items.slice(0, 10);

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

// ── Download modal ────────────────────────────────────────────────────────────

let sessionEndPending     = false;
let sessionRefreshPending = false;

function openDownloadModal(fromSessionEnd = false, fromRefresh = false) {
  const suggested = Object.values(reviews).filter(r => r.status === 'suggested');
  const flagged   = Object.values(reviews).filter(r => r.status === 'needs_review');

  dlSummary.innerHTML = `
    <div class="modal-stat"><span class="modal-stat-n">${suggested.length}</span> Suggested</div>
    <div class="modal-stat modal-stat-flag"><span class="modal-stat-n">${flagged.length}</span> Flagged</div>
  `;

  sessionEndPending     = fromSessionEnd;
  sessionRefreshPending = fromRefresh;

  if (fromSessionEnd || fromRefresh) {
    $('dlEndBtn').textContent = fromRefresh
      ? 'Restart without downloading'
      : 'End Session without downloading';
    show(dlEndRow);
  } else {
    hide(dlEndRow);
  }

  show(dlModal);
}

function _afterModal() {
  if (sessionEndPending)     { sessionEndPending     = false; endSession(); }
  else if (sessionRefreshPending) { sessionRefreshPending = false; doRefreshSession(); }
}

$('exportJson').addEventListener('click', () => {
  if (!Object.keys(reviews).length) { showToast('Nothing to export', false); return; }
  openDownloadModal(false);
});

$('dlClose').addEventListener('click', () => {
  hide(dlModal);
  sessionEndPending = sessionRefreshPending = false;
});

$('dlChangesBtn').addEventListener('click', () => {
  downloadChangesOnly();
  hide(dlModal);
  _afterModal();
});

$('dlMergedBtn').addEventListener('click', () => {
  downloadMerged();
  hide(dlModal);
  _afterModal();
});

$('dlEndBtn').addEventListener('click', () => {
  hide(dlModal);
  _afterModal();
});

function downloadChangesOnly() {
  const changes = {};
  Object.values(reviews).forEach(r => {
    if (r.status === 'suggested' && r.suggestedText) changes[r.key] = r.suggestedText;
  });
  if (!Object.keys(changes).length) { showToast('No suggested corrections to export', false); return; }
  downloadBlob(
    new Blob([JSON.stringify(changes, null, 2)], { type: 'application/json' }),
    `changes-${currentLocale || 'review'}-${Date.now()}.json`
  );
}

function downloadMerged() {
  const merged = { ...translations };
  Object.values(reviews).forEach(r => {
    if (r.status === 'suggested' && r.suggestedText) merged[r.key] = r.suggestedText;
  });
  downloadBlob(
    new Blob([JSON.stringify(unflattenObject(merged), null, 2)], { type: 'application/json' }),
    `merged-${currentLocale || 'review'}-${Date.now()}.json`
  );
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ── Session End ───────────────────────────────────────────────────────────────

$('btnSessionEnd').addEventListener('click', () => {
  const hasData = Object.keys(reviews).length > 0;

  if (hasData) {
    const download = confirm('Download your work before ending the session?');
    if (download) { openDownloadModal(true); return; }
  }

  if (confirm('End session? All review data will be cleared.')) endSession();
});

function refreshSession() {
  // If there are reviews, show the download modal first so nothing is lost
  if (Object.keys(reviews).length > 0) {
    openDownloadModal(false, true);
  } else {
    doRefreshSession();
  }
}

async function doRefreshSession() {
  resetNavToggle();
  hide($('langChangeBanner'));
  reviews = {};
  translations = {};
  englishTranslations = {};
  await new Promise(resolve =>
    chrome.storage.local.remove(['reviews', 'translations', 'englishTranslations'], resolve)
  );
  renderHistory();
  updateStats();
  hide(localePill);
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'RESET_SESSION' }).catch(() => {});
  });
  mainScreen.style.display = 'none';
  startScreen.style.display = '';
  setupStartScreen(currentLocale, currentOrigin);
}

async function endSession() {
  resetNavToggle();
  reviews = {};
  translations = {};
  englishTranslations = {};

  await new Promise(resolve => chrome.storage.local.remove(
    ['reviews', 'translations', 'englishTranslations'], resolve
  ));

  renderHistory();
  updateStats();
  hide(localePill);

  // Tell content script to remove all highlights
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'RESET_SESSION' }).catch(() => {});
  });

  // Return to start screen
  mainScreen.style.display = 'none';
  startScreen.style.display = '';
  const data = await storageGet(['detectedLocale', 'pageOrigin']);
  data.detectedLocale !== undefined
    ? setupStartScreen(data.detectedLocale, data.pageOrigin)
    : showState(stDetecting);
}

// ── Navigate / Review toggle ──────────────────────────────────────────────────

let interceptEnabled = true;
const btnToggleNav = $('btnToggleNav');

btnToggleNav.addEventListener('click', () => {
  interceptEnabled = !interceptEnabled;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_INTERCEPT', enabled: interceptEnabled }).catch(() => {});
  });
  btnToggleNav.textContent   = interceptEnabled ? '🔒 Review' : '🔓 Navigate';
  btnToggleNav.classList.toggle('nav-mode-active', !interceptEnabled);
});

function resetNavToggle() {
  interceptEnabled = true;
  btnToggleNav.textContent = '🔒 Review';
  btnToggleNav.classList.remove('nav-mode-active');
  hide(btnToggleNav);
}

// ── Lang change banner ────────────────────────────────────────────────────────

$('btnRefreshSession').addEventListener('click', refreshSession);
$('btnBannerDismiss').addEventListener('click', () => hide($('langChangeBanner')));

// ── Re-detect buttons (start screen) ─────────────────────────────────────────

function sendRedetect() {
  showState(stDetecting);
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'REDETECT' }).catch(() => {});
  });
}

$('btnRedetect').addEventListener('click', sendRedetect);
$('btnRedetectReady').addEventListener('click', sendRedetect);

// ── Init ──────────────────────────────────────────────────────────────────────

load();
