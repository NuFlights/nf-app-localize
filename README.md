# Translation Review Tool — Chrome Extension

An in-context translation review tool for QA teams. It highlights every translatable element on a live page, lets reviewers click them to approve, suggest corrections, or flag issues, and exports the results as JSON or CSV.

Built for Nuflights French localisation QA.

---

## Features

- Scans any page for `data-i18n` attributes and highlights them with a blue dashed outline
- Side panel shows the current text, the imported reference translation, and review status
- Three review actions: **Approve**, **Suggest** (with corrected text), **Issue** (with optional note)
- History tab with stats, search, and status filters (All / Approved / Suggested / Issue)
- Import a reference translations JSON file (nested or flat)
- Export all reviews as **JSON** or **CSV**
- MutationObserver support — works on SPAs where content loads dynamically
- Highlight toggle to switch the overlays on/off without closing the panel

---

## Tech Stack

### Language & Runtime
| Layer | Technology |
|-------|-----------|
| Extension logic | Vanilla JavaScript (ES2020 — `async/await`, optional chaining) |
| UI markup | HTML5 |
| Styling | CSS3 (custom properties, flexbox, CSS animations) |
| Icon generation | Python 3 (stdlib only — `struct`, `zlib`, `os`) |

### Extension Platform
| Item | Detail |
|------|--------|
| Platform | Chrome Extension — **Manifest V3** |
| Minimum Chrome | 116+ (Side Panel API requirement) |
| Build tools | None — no bundler, no npm, no transpiler |
| External packages | None — zero dependencies |

### Chrome Extension APIs Used
| API | Used for |
|-----|----------|
| `chrome.sidePanel` | Opens and manages the review panel |
| `chrome.storage.local` | Persists reviews, imported translations, and highlight toggle state |
| `chrome.runtime.sendMessage` | Sends clicked-element data from content script to side panel |
| `chrome.runtime.onMessage` | Side panel receives element selection events |
| `chrome.runtime.onInstalled` | Sets default storage values on first install |
| `chrome.tabs` | Queries the active tab to forward the highlight toggle message |
| `chrome.scripting` | Declared for content script injection |
| `chrome.action` | Toolbar icon and click-to-open-panel behaviour |

---

## File Structure

```
nf-app-localize/
├── manifest.json        # Extension config — MV3, permissions, content script rules
├── background.js        # Service worker — opens side panel, forwards highlight toggle
├── content.js           # Injected into every page — scans data-i18n, handles clicks
├── content.css          # Highlight, hover, and selected-state styles for i18n elements
├── sidepanel.html       # Side panel markup — Review tab + History tab
├── sidepanel.js         # Side panel logic — import, review form, history, export
├── sidepanel.css        # Full side panel stylesheet
├── demo.html            # Demo page with French Nuflights UI (data-i18n attributes)
├── demo.json            # Reference English translations matching all demo.html keys
└── icons/
    ├── icon16.png       # Toolbar icon (16×16)
    ├── icon48.png       # Extension management page icon (48×48)
    ├── icon128.png      # Chrome Web Store / install icon (128×128)
    └── create_icons.py  # Pure-Python PNG generator — run to regenerate icons
```

---

## Permissions

| Permission | Reason |
|-----------|--------|
| `sidePanel` | Required to register and open the side panel |
| `storage` | Stores reviews and imported translations locally |
| `activeTab` | Lets the background worker reference the current tab |
| `scripting` | Content script injection |
| `tabs` | Forward highlight toggle changes to the active tab |
| `host_permissions: <all_urls>` | Inject the content script into any page |

> **Note:** To use the extension on local `file://` pages (e.g. `demo.html`), go to `chrome://extensions` → Details → enable **"Allow access to file URLs"**.

---

## How to Install (Local / Development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder
4. The **Translation Review Tool** icon appears in the Chrome toolbar

To pick up any file changes: click the **reload (↺)** button on the extension card, then refresh the target page.

---

## How to Use with demo.html

1. Open `demo.html` in Chrome (File → Open File)
2. Click the extension icon to open the **Side Panel**
3. Click **Import Translations JSON** and select `demo.json`
4. Hover over any blue-outlined French text — click it to open the review form
5. Choose **Approve**, **Suggest**, or **Issue**, fill in any details, and save
6. Switch to the **History** tab to see all reviews and export results

---

## Regenerating Icons

```bash
python3 icons/create_icons.py
```

No external packages needed. Outputs `icon16.png`, `icon48.png`, `icon128.png` directly into the `icons/` folder.
