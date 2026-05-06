'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let reviews = {};        // { [key]: ReviewEntry }
let translations = {};   // { [key]: string } flat map from imported JSON
let currentEl = null;    // element currently shown in the review pane
let pendingAction = null; // 'approved' | 'suggested' | 'needs_review'
let historyFilter = 'all';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const highlightToggle = $('highlightToggle');

// Review pane
const reviewEmpty = $('reviewEmpty');
const reviewForm  = $('reviewForm');
const rvKey       = $('rvKey');
const rvCurrentText = $('rvCurrentText');
const rvRefRow    = $('rvRefRow');
const rvRefText   = $('rvRefText');
const rvStatus    = $('rvStatus');
const rvSuggestRow  = $('rvSuggestRow');
const rvSuggestLabel = $('rvSuggestLabel');
const rvSuggestText = $('rvSuggestText');
const rvNoteRow   = $('rvNoteRow');
const rvNoteText  = $('rvNoteText');
const btnApprove  = $('btnApprove');
const btnSuggest  = $('btnSuggest');
const btnIssue    = $('btnIssue');
const btnSubmit   = $('btnSubmit');
const rvToast     = $('rvToast');

// History pane
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

function cls(el, ...classes) { el.classList.add(...classes); }
function uncls(el, ...classes) { el.classList.remove(...classes); }
function show(el) { uncls(el, 'hidden'); }
function hide(el) { cls(el, 'hidden'); }

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  suggested: 'Suggested',
  needs_review: 'Issue',
};

const STATUS_BADGE = {
  pending: 'badge-pending',
  approved: 'badge-approved',
  suggested: 'badge-suggested',
  needs_review: 'badge-needs_review',
};

function fmtStatus(s) { return STATUS_LABELS[s] ?? s; }

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

function showToast(msg, ok = true) {
  rvToast.className = ok ? 'toast toast-ok' : 'toast toast-err';
  rvToast.textContent = msg;
  show(rvToast);
  setTimeout(() => hide(rvToast), 2800);
}

// ── Load initial data ─────────────────────────────────────────────────────────

async function load() {
  const data = await storageGet(['reviews', 'translations', 'highlightEnabled']);
  reviews      = data.reviews      || {};
  translations = data.translations || {};
  highlightToggle.checked = data.highlightEnabled !== false;
  renderHistory();
  updateStats();
}

// ── Session storage listener → element selected on page ───────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ELEMENT_SELECTED') {
    currentEl = message.data;
    showReviewForm(currentEl);
    const reviewPane = $('reviewPane');
    if (!reviewPane.classList.contains('active')) {
      activateTab('reviewPane');
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.reviews) {
    reviews = changes.reviews.newValue || {};
    renderHistory();
    updateStats();
  }

  if (area === 'local' && changes.translations) {
    translations = changes.translations.newValue || {};
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function activateTab(paneId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.pane === paneId);
  });
  document.querySelectorAll('.pane').forEach((p) => {
    p.classList.toggle('active', p.id === paneId);
  });
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => activateTab(btn.dataset.pane));
});

// ── Highlight toggle ──────────────────────────────────────────────────────────

highlightToggle.addEventListener('change', () => {
  const enabled = highlightToggle.checked;
  storageSet({ highlightEnabled: enabled });
  chrome.runtime.sendMessage({ type: 'SET_HIGHLIGHT_ACTIVE_TAB', enabled });
});

// ── Review form ───────────────────────────────────────────────────────────────

function showReviewForm(el) {
  hide(reviewEmpty);
  show(reviewForm);

  rvKey.textContent = el.key;
  rvCurrentText.textContent = el.currentText;

  // Reference translation
  const ref = el.referenceTranslation || translations[el.key] || '';
  if (ref) {
    rvRefText.textContent = ref;
    show(rvRefRow);
  } else {
    hide(rvRefRow);
  }

  // Existing review for this key
  const existing = reviews[el.key];
  if (existing) {
    setStatusBadge(existing.status);
    if (existing.suggestedText) rvSuggestText.value = existing.suggestedText;
    else rvSuggestText.value = '';
    if (existing.note) rvNoteText.value = existing.note;
    else rvNoteText.value = '';
  } else {
    setStatusBadge('pending');
    rvSuggestText.value = '';
    rvNoteText.value = '';
  }

  // Reset action UI
  pendingAction = null;
  hide(rvSuggestRow);
  hide(rvNoteRow);
  hide(btnSubmit);
  hide(rvToast);
  [btnApprove, btnSuggest, btnIssue].forEach((b) => b.classList.remove('active'));
}

function setStatusBadge(status) {
  rvStatus.textContent = fmtStatus(status);
  rvStatus.className = `badge ${STATUS_BADGE[status] || 'badge-pending'}`;
}

// ── Action button handlers ────────────────────────────────────────────────────

btnApprove.addEventListener('click', () => {
  activateAction('approved');
  // Approve saves immediately — no extra input needed
  saveReview('approved', null, null);
});

btnSuggest.addEventListener('click', () => {
  activateAction('suggested');
  rvSuggestLabel.textContent = 'Suggested correction';
  show(rvSuggestRow);
  hide(rvNoteRow);
  show(btnSubmit);
  rvSuggestText.focus();
});

btnIssue.addEventListener('click', () => {
  activateAction('needs_review');
  rvSuggestLabel.textContent = 'Corrected text (optional)';
  show(rvSuggestRow);
  show(rvNoteRow);
  show(btnSubmit);
});

btnSubmit.addEventListener('click', () => {
  if (!pendingAction) return;

  const suggested = rvSuggestText.value.trim();
  const note      = rvNoteText.value.trim();

  if (pendingAction === 'suggested' && !suggested) {
    cls(rvSuggestText, 'error');
    rvSuggestText.focus();
    setTimeout(() => uncls(rvSuggestText, 'error'), 1500);
    return;
  }

  saveReview(pendingAction, suggested || null, note || null);
});

function activateAction(action) {
  pendingAction = action;
  [btnApprove, btnSuggest, btnIssue].forEach((b) => b.classList.remove('active'));
  const map = { approved: btnApprove, suggested: btnSuggest, needs_review: btnIssue };
  map[action]?.classList.add('active');
}

async function saveReview(status, suggestedText, note) {
  if (!currentEl) return;

  const entry = {
    key: currentEl.key,
    currentText: currentEl.currentText,
    suggestedText,
    note,
    status,
    url: currentEl.url || '',
    timestamp: new Date().toISOString(),
  };

  reviews[currentEl.key] = entry;
  await storageSet({ reviews });

  setStatusBadge(status);
  hide(rvSuggestRow);
  hide(rvNoteRow);
  hide(btnSubmit);
  [btnApprove, btnSuggest, btnIssue].forEach((b) => b.classList.remove('active'));
  pendingAction = null;

  showToast(`Saved as "${fmtStatus(status)}"`);
}

// ── History rendering ─────────────────────────────────────────────────────────

function renderHistory() {
  const query = searchBox.value.toLowerCase();
  let items = Object.values(reviews);

  if (historyFilter !== 'all') {
    items = items.filter((r) => r.status === historyFilter);
  }

  if (query) {
    items = items.filter((r) => r.key.toLowerCase().includes(query));
  }

  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  reviewList.innerHTML = '';

  if (items.length === 0) {
    show(listEmpty);
    return;
  }

  hide(listEmpty);

  items.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div class="review-card-header">
        <span class="review-card-key">${esc(r.key)}</span>
        <span class="badge ${STATUS_BADGE[r.status] || 'badge-pending'}">${fmtStatus(r.status)}</span>
      </div>
      <div class="review-card-text">${esc(r.currentText)}</div>
      ${r.suggestedText
        ? `<div class="review-card-suggested">→ ${esc(r.suggestedText)}</div>`
        : ''}
      ${r.note
        ? `<div class="review-card-suggested" style="color:#64748b">📝 ${esc(r.note)}</div>`
        : ''}
      <div class="review-card-time">${fmtTime(r.timestamp)}${r.url ? ` · ${esc(new URL(r.url).pathname)}` : ''}</div>
    `;

    card.addEventListener('click', () => {
      // Load this entry into the review pane
      currentEl = {
        key: r.key,
        currentText: r.currentText,
        referenceTranslation: translations[r.key] || '',
        url: r.url,
      };
      showReviewForm(currentEl);
      activateTab('reviewPane');
    });

    reviewList.appendChild(card);
  });
}

function updateStats() {
  const vals = Object.values(reviews);
  stApproved.textContent  = vals.filter((r) => r.status === 'approved').length;
  stSuggested.textContent = vals.filter((r) => r.status === 'suggested').length;
  stIssue.textContent     = vals.filter((r) => r.status === 'needs_review').length;
  stTotal.textContent     = vals.length;
}

// Filter chips
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    historyFilter = chip.dataset.filter;
    renderHistory();
  });
});

// Search
searchBox.addEventListener('input', renderHistory);

// ── Import ────────────────────────────────────────────────────────────────────

function setupImport(btnId, fileId) {
  const btn  = $(btnId);
  const file = $(fileId);
  if (!btn || !file) return;

  btn.addEventListener('click', () => file.click());

  file.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;

    try {
      const text = await f.text();
      const json = JSON.parse(text);
      const flat = flattenObject(json);
      await storageSet({ translations: flat });
      translations = flat;
      showToast(`Imported ${Object.keys(flat).length} keys`);
    } catch {
      showToast('Invalid JSON file', false);
    }

    file.value = '';
  });
}

setupImport('importBtnReview', 'importFileReview');
setupImport('importBtnHistory', 'importFileHistory');

// ── Export ────────────────────────────────────────────────────────────────────

$('exportJson').addEventListener('click', () => {
  const data = Object.values(reviews);
  if (!data.length) { showToastGlobal('Nothing to export', false); return; }
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `translations-review-${Date.now()}.json`
  );
});

$('exportCsv').addEventListener('click', () => {
  const data = Object.values(reviews);
  if (!data.length) { showToastGlobal('Nothing to export', false); return; }
  const header = ['key', 'currentText', 'suggestedText', 'note', 'status', 'url', 'timestamp'];
  const rows = data.map((r) =>
    header.map((h) => csvEsc(r[h] ?? '')).join(',')
  );
  downloadBlob(
    new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' }),
    `translations-review-${Date.now()}.csv`
  );
});

function csvEsc(val) {
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clear all ─────────────────────────────────────────────────────────────────

$('clearAll').addEventListener('click', async () => {
  if (!confirm('Delete all review data? This cannot be undone.')) return;
  reviews = {};
  await storageSet({ reviews: {} });
  renderHistory();
  updateStats();
});

// Global toast (used from history pane)
function showToastGlobal(msg, ok = true) {
  showToast(msg, ok); // reuse review pane toast (acceptable UX)
}

// ── Init ──────────────────────────────────────────────────────────────────────

load();
