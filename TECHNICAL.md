# Translation Review Tool — Technical Reference

A Chrome Extension (Manifest V3) for in-context translation QA. Reviewers open the side panel, start a session, and click through every localised string on the live page to flag issues or suggest corrections.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                 │
│                                                         │
│  ┌──────────────┐   messages   ┌──────────────────────┐ │
│  │ content.js   │ ◄──────────► │ sidepanel.js / .html │ │
│  │ (page world) │              │ (extension UI)       │ │
│  └──────┬───────┘              └──────────┬───────────┘ │
│         │  chrome.storage.local           │             │
│         └────────────────────────────────┘             │
│                                                         │
│  background.js  — service worker (opens side panel)     │
│  content.css    — injected styles for highlight states  │
└─────────────────────────────────────────────────────────┘
```

**Files**

| File | Role |
|---|---|
| `manifest.json` | Extension config, permissions, content script registration |
| `background.js` | Service worker — configures side panel to open on toolbar click |
| `content.js` | Injected into every page — locale detection, element scanning, highlight management |
| `content.css` | Injected styles for `trt-i18n-element`, hover, selected, and navigate-mode states |
| `sidepanel.html` | Extension UI markup |
| `sidepanel.js` | All panel logic — state machine, fetch, reviews, download, messaging |
| `sidepanel.css` | Panel styles (Nuflights maroon theme) |
| `icons/create_icons.py` | Pure-stdlib Python script to generate the three PNG icons |

---

## Locale Detection

Locale detection runs in `content.js` via `detectLocale()` and is triggered in three situations:

1. **Page load** — `init()` runs once at `document_idle`
2. **`<html lang>` attribute change** — a `MutationObserver` watches the attribute; fires when an SPA switches locale by mutating the `lang` attribute on the root element
3. **URL change** — `history.pushState` / `history.replaceState` are patched, and `popstate` / `hashchange` events are listened to; any URL change re-runs locale detection

### Detection priority (first match wins)

```
1. document.documentElement.lang   →  <html lang="fr">  →  "fr"
2. URL path prefix                 →  /fr/flights        →  "fr"
3. Query parameter                 →  ?lang=fr           →  "fr"
                                      ?locale=fr
                                      ?lng=fr
4. null  (no locale found)
```

All results are normalised to lowercase two-letter codes (`fr-FR` → `fr`).

After detection the result is written to `chrome.storage.local` (`detectedLocale`, `pageOrigin`) and broadcast to the side panel via `chrome.runtime.sendMessage({ type: 'LOCALE_DETECTED' })`.

---

## Translation JSON — Fetching

Once the side panel knows the locale and origin, it constructs a URL and fetches the reference translation file:

```
GET {pageOrigin}/locales/{locale}.json
e.g. http://localhost:3000/locales/fr.json
```

**Requirements for auto-fetch to work**

- The app's dev server must serve static files from the `public/` directory
- The `locales/` folder must be inside `public/` — e.g. `public/locales/fr.json`
- The URL must be reachable from the browser (no auth, no CORS block on `localhost`)

**Fallback — manual import**

If the page is `file://`, or the fetch returns a non-2xx response, the panel falls back to a file-picker that accepts any `.json` file.

**English source (background fetch)**

After the primary locale JSON loads, the panel silently attempts a second fetch for `en.json` to populate the "English (source)" reference field in the review form. This fetch is non-blocking and failures are silently ignored.

### JSON format

The extension accepts both flat and nested JSON. Nested objects are flattened internally using dot notation:

```json
// nested input
{ "search": { "heading": "Rechercher des vols" } }

// stored internally as
{ "search.heading": "Rechercher des vols" }
```

The `flattenObject` / `unflattenObject` utility functions in `sidepanel.js` handle this conversion. Merged downloads are written back as nested JSON.

---

## Start Screen State Machine

The panel's start screen has five states managed by `setupStartScreen()`:

```
stDetecting  →  waiting for first LOCALE_DETECTED message (spinner)
stReady      →  locale found on an http/https page (shows URL, Start button)
stFileLocal  →  page is file:// (no auto-fetch possible, import only)
stNoLocale   →  page loaded but no locale could be detected (import only)
stFetching   →  fetch in progress (spinner)
stError      →  fetch returned a non-2xx (shows error URL, retry + import)
```

Only one state panel is visible at a time; all others have the `hidden` class.

---

## Session Lifecycle

```
Start Session
    │
    ├─ fetch {origin}/locales/{locale}.json
    ├─ flattenObject(json) → translations
    ├─ chrome.storage.local.set({ translations })
    ├─ chrome.tabs.sendMessage → START_SESSION (sends translations to content.js)
    ├─ show mainScreen, show localePill + toggle button
    └─ content.js: scanAndAttach(document.documentElement)
                   navigateTo(0)  ← auto-selects first element

Active Session
    │
    ├─ reviewer clicks elements / uses Prev–Next / keyboard arrows
    ├─ reviews saved to chrome.storage.local.reviews { [key]: ReviewRecord }
    └─ draft text auto-saved in-memory (lost on session end)

End Session
    │
    ├─ (optional) download modal → Download Changes / Download Merged
    ├─ chrome.storage.local.remove([reviews, translations, englishTranslations])
    ├─ chrome.tabs.sendMessage → RESET_SESSION
    └─ return to start screen
```

---

## Element Scanning & Highlighting

`content.js` scans `document.documentElement` for every element carrying a `data-i18n` attribute.

```js
root.querySelectorAll('[data-i18n]').forEach(attachEl);
```

Each matched element gets:
- `data-trt-attached="1"` — idempotency guard (prevents double-attaching)
- Class `trt-i18n-element` — triggers the maroon dashed outline from `content.css`
- `mouseenter` / `mouseleave` listeners — toggle `trt-i18n-hover`
- `click` listener (capture phase) — calls `selectElement()` when intercept is enabled

**Highlight CSS states**

| Class | Visible effect |
|---|---|
| `trt-i18n-element` | Faint maroon dashed outline, crosshair cursor |
| `trt-i18n-hover` | Stronger maroon outline + very light maroon background tint |
| `trt-i18n-selected` | Solid maroon outline + slightly stronger background tint |

**Navigate mode** — when the user toggles `🔓 Navigate` in the header, `trt-navigate-mode` is added to `<html>`. The CSS overrides reduce all outlines to near-invisible and reset the cursor, so normal app interaction is fully restored.

**Dynamic content (SPA route changes)**

A second `MutationObserver` watches `childList` + `subtree` on `document.documentElement`. Any newly added DOM nodes are passed to `scanAndAttach()` so dynamically rendered translations are picked up without a page reload.

---

## Navigation

The `elements[]` array in `content.js` holds all attached `[data-i18n]` elements in **DOM order** (rebuilt via `document.querySelectorAll` after every scan).

`currentIndex` tracks the selected position. Navigation is purely index-based:

```
NAVIGATE { direction: 'next' | 'prev', skipKeys: [] }
    → step = +1 or -1
    → navigateTo(currentIndex + step)
        → el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        → selectElement(el)
            → chrome.runtime.sendMessage(ELEMENT_SELECTED)
```

Boundary hits (`idx < 0` or `idx >= elements.length`) send a `NAV_BOUNDARY` message back to the panel, which shows a toast.

**Keyboard shortcuts (side panel)**

| Key | Action |
|---|---|
| `→` | Next element |
| `←` | Previous element |
| `⌘ / Ctrl + Enter` | Submit current review |

---

## Review Workflow

Each element review is stored as a `ReviewRecord`:

```js
{
  key: "search.heading",
  currentText: "Chercher des Vols",   // text visible on page
  suggestedText: "Rechercher des vols", // reviewer's correction
  note: "capitalisation issue",         // optional flag reason
  status: "suggested" | "needs_review" | "pending",
  url: "http://localhost:3000/fr/search",
  timestamp: "2026-05-07T09:30:00.000Z"
}
```

All records are persisted to `chrome.storage.local.reviews` keyed by `data-i18n` key. In-memory `drafts` object preserves unsaved textarea content during navigation (not persisted; lost on session end).

**Status values**

| Status | Meaning |
|---|---|
| `pending` | Opened but not submitted |
| `suggested` | Reviewer provided a corrected translation |
| `needs_review` | Reviewer flagged an issue (optional corrected text + reason note) |

---

## Language Change Detection (SPA)

When a user switches the app locale without a full page reload, the extension detects the change through two parallel mechanisms:

**1. `<html lang>` MutationObserver**
```js
new MutationObserver(mutations => {
  for (const m of mutations) {
    if (m.attributeName === 'lang') { /* re-detect and broadcast */ }
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
```

**2. URL change detection**

`history.pushState` and `history.replaceState` are monkey-patched to call `checkUrlChange()` after every invocation. `popstate` and `hashchange` events cover browser back/forward navigation.

**Behaviour in active session**

If locale changes while a session is running, a warning banner appears in the panel header:

> *"Language changed to French (FR) — refresh to start a new session."*

Clicking **Refresh Session** opens the download modal if there are unsaved reviews, allowing the reviewer to download their work before the session resets to the new locale.

---

## Download Formats

**Download Changes Only**
```json
{
  "search.heading": "Rechercher des vols",
  "booking.confirm": "Confirmer la réservation"
}
```
Flat `key → suggestedText` pairs for all `suggested` status items. Designed to be fed directly into a diff/merge tool.

**Download Merged File**
Takes the full reference translation object, applies all suggested corrections, then runs `unflattenObject()` to produce a valid nested JSON file ready to drop into the codebase.

---

## Navigate / Review Toggle

The `🔒 Review` / `🔓 Navigate` button in the extension header lets reviewers temporarily disable click interception so they can interact with the app normally (dropdowns, nav links, etc.).

| State | Button label | `interceptEnabled` | `<html>` class |
|---|---|---|---|
| Review mode | `🔒 Review` | `true` | — |
| Navigate mode | `🔓 Navigate` | `false` | `trt-navigate-mode` |

When `interceptEnabled = false`, the `onClick` handler in `content.js` returns immediately without calling `preventDefault`, so all app click events propagate normally.

---

## Chrome Storage Schema

All data lives in `chrome.storage.local`.

| Key | Type | Written by | Description |
|---|---|---|---|
| `detectedLocale` | `string \| null` | `content.js` | Two-letter locale code detected from the page |
| `pageOrigin` | `string` | `content.js` | `window.location.origin` or `"file://"` |
| `translations` | `object` | `sidepanel.js` | Flat key→value reference translation map |
| `englishTranslations` | `object` | `sidepanel.js` | Flat key→value English source map |
| `reviews` | `object` | `sidepanel.js` | All `ReviewRecord` objects keyed by i18n key |

---

## Message Protocol

All messages pass through `chrome.runtime.sendMessage` (content → panel) and `chrome.tabs.sendMessage` (panel → content).

| Message type | Direction | Payload | Description |
|---|---|---|---|
| `LOCALE_DETECTED` | content → panel | `{ locale, origin }` | Page locale detected or changed |
| `ELEMENT_SELECTED` | content → panel | `{ key, currentText, referenceTranslation, url, index, total }` | User clicked a `[data-i18n]` element |
| `NAV_BOUNDARY` | content → panel | `{ boundary: 'start' \| 'end' }` | Navigation hit first/last element |
| `START_SESSION` | panel → content | `{ translations }` | Activate session, scan elements |
| `RESET_SESSION` | panel → content | — | Remove all highlights, clear state |
| `NAVIGATE` | panel → content | `{ direction, skipKeys }` | Move to next/previous element |
| `SET_INTERCEPT` | panel → content | `{ enabled: boolean }` | Toggle review/navigate mode |
| `REDETECT` | panel → content | — | Re-run `init()` to refresh locale detection |

---

## Extension Icons

Icons are generated programmatically using only Python's standard library (no Pillow or external deps). The script at `icons/create_icons.py` draws a **globe with latitude/longitude grid lines** — the universal i18n symbol — in white on a Nuflights maroon (`#a31517`) rounded-rectangle background.

Run to regenerate:
```bash
python3 icons/create_icons.py
```

Outputs: `icon16.png`, `icon48.png`, `icon128.png`.

---

## App Integration Requirements

For the extension to work on an app, the app must:

1. Set the `lang` attribute on `<html>` reflecting the active locale  
   `<html lang="fr">`

2. Add `data-i18n` attributes to every translated text element  
   `<h1 data-i18n="search.heading">Rechercher des vols</h1>`

3. Serve translation JSON files as static assets  
   `public/locales/fr.json` → accessible at `{origin}/locales/fr.json`
