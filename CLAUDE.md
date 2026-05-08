# Translation Review Tool — Chrome Extension

In-context translation QA tool (Chrome MV3 side panel extension). Reviewers open the side panel on a live localised page, start a session, and step through every translated string to flag issues or suggest corrections.

## Commands

```bash
# Regenerate extension icons (maroon globe, white on #a31517)
python3 icons/create_icons.py

# Build production zip ready to share / install
python3 build.py

# Serve the demo page locally for development
python3 -m http.server 8080
# then open http://localhost:8080/demo.html
```

## Loading the extension in Chrome (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this directory
4. Open any page, click the extension toolbar icon → side panel opens

After any file change, click the **↺** reload button on the extension card.

## Key files

| File | Role |
|---|---|
| `manifest.json` | Extension config, permissions, content script registration |
| `background.js` | Service worker — opens side panel on toolbar click |
| `content.js` | Injected into every page — locale detection, element scanning, highlights |
| `content.css` | Injected styles for highlight states (element / hover / selected / navigate-mode) |
| `sidepanel.html` | Extension UI markup |
| `sidepanel.js` | All panel logic — state machine, fetch, reviews, download, messaging |
| `sidepanel.css` | Panel styles (Nuflights maroon `#a31517` theme) |
| `icons/create_icons.py` | Generates the three PNG icons programmatically (no external deps) |
| `build.py` | Packages the extension into a distributable zip |
| `TECHNICAL.md` | Full technical reference — architecture, message protocol, storage schema |

## How locale detection works

`detectLocale()` in `content.js` checks in order:
1. `document.documentElement.lang` attribute → `<html lang="fr">`
2. URL path prefix → `/fr/flights`
3. Query params → `?lang=fr`, `?locale=fr`, `?lng=fr`

Changes are watched via:
- `MutationObserver` on `<html lang>` attribute (SPA locale switches)
- Patched `history.pushState` / `history.replaceState` + `popstate` / `hashchange` (URL-based locale in SPAs)

## How translation elements are found

Two-pass scan on session start:

1. **Attribute scan** — `querySelectorAll('[data-i18n]')` — elements explicitly marked by the app
2. **Value-based fallback** — builds a reverse map `{translationValue → key}` from the loaded JSON, then walks all text nodes and matches visible text against translation values; matched elements get `data-i18n` set automatically

Both scans also run on newly added DOM nodes via `MutationObserver`.

## How the JSON is fetched

```
GET {pageOrigin}/locales/{locale}.json
e.g. http://localhost:3000/locales/fr.json
```

The `locales/` folder must be inside your app's `public/` directory so the dev server serves it as a static file. Falls back to manual file-import if the page is `file://` or the fetch fails.

## App integration requirements

The host app needs to:
1. Set `<html lang="fr">` (or use URL/query-param locale)
2. Add `data-i18n="key"` to translated elements (optional — value-matching covers elements without it)
3. Serve `public/locales/{locale}.json` as a static file

## Storage keys (`chrome.storage.local`)

| Key | Description |
|---|---|
| `detectedLocale` | Two-letter locale code |
| `pageOrigin` | `window.location.origin` or `"file://"` |
| `translations` | Flat `{key: value}` reference translation map |
| `englishTranslations` | Flat English source map (background-fetched) |
| `reviews` | All `ReviewRecord` objects keyed by i18n key |

## Message types

| Type | Direction | Purpose |
|---|---|---|
| `LOCALE_DETECTED` | content → panel | Page locale detected or changed |
| `ELEMENT_SELECTED` | content → panel | Clicked a translated element |
| `NAV_BOUNDARY` | content → panel | Hit first / last element |
| `START_SESSION` | panel → content | Start session, scan elements |
| `RESET_SESSION` | panel → content | Remove all highlights, clear state |
| `NAVIGATE` | panel → content | Move prev / next |
| `SET_INTERCEPT` | panel → content | Toggle review / navigate mode |
| `REDETECT` | panel → content | Re-run locale detection |

## Review statuses

| Status | Meaning |
|---|---|
| `pending` | Opened, not yet submitted |
| `suggested` | Reviewer provided a corrected translation |
| `needs_review` | Flagged with optional corrected text + reason |

## Build output

`python3 build.py` creates:
- `dist/` — clean copy of all extension files
- `translation-review-tool-v{version}.zip` — ready to share; unzip and **Load unpacked** in Chrome
