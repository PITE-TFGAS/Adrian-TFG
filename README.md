# Workflow Recording & Playback — Architecture

## Project Summary

Two independent Chrome extensions that together form a guided-tour system:

- **WorkflowsRecorder** — Injects a content script that intercepts user clicks, generates CSS selectors, snapshots DOM state before and after each interaction, and produces a structured workflow (drawflow JSON). The popup controls recording start/stop, authentication (Supabase), cloud upload, and tag management.

- **WorkflowsPlayer** — Injects a content script that queries Supabase for workflows matching the current URL, displays a selection overlay, and plays back the selected tour using Shepherd.js. Step progression is driven by real user clicks on the target elements, with expected-state validation and error recovery.

They interact indirectly through the shared data format (drawflow JSON uploaded to Supabase by the Recorder, retrieved by the Player).

**Technologies:** Chrome Extensions (Manifest V3), Supabase (auth + data API), Shepherd.js (tour UI), vanilla JavaScript (no framework).

---

## Project Structure — Complete Directory Tree

```
Adrian-TFG/
│
├── .gitignore                                              # Git ignore rules for *.txt and *.zip
├── README.md                                               # Architecture documentation (this file)
│
│
├── WorkflowsRecorder/                                      # Chrome extension: records user workflows as guided tours
│   ├── manifest.json                                       # Manifest V3: permissions (activeTab, scripting, storage), content scripts
│   ├── auth/                                               # Authentication module
│   │   ├── auth.js                                         # AuthManager object: login, register, logout, getCurrentUser, onAuthStateChange
│   │   └── supabase-client.js                              # Creates supabaseClient from URL + anon key; validation guard
│   ├── content/                                            # Content scripts injected into web pages
│   │   ├── content.js                                      # Main recording engine: message listener, start/stop/clear, click capture, step creation, overlay management
│   │   ├── content.css                                     # Recording overlay, badge, checkmark animation, modal and step-description dialog styles
│   │   ├── dom/                                            # DOM selector strategies
│   │   │   └── selector-engine.js                          # Generates CSS selectors: unique ID path → attribute selectors → XPath fallback → temp data attribute
│   │   └── utils/                                          # DOM analysis utilities
│   │       └── dom-analyzer.js                             # DOM snapshotting, diff computation, mutation stability detection, waiting indicator, expected-state prompt bar
│   ├── libs/                                               # Third-party libraries
│   │   └── supabase.min.js                                 # Supabase JS client (minified, loaded as web-accessible resource)
│   ├── popup/                                              # Extension popup UI
│   │   ├── popup.html                                      # Popup layout: auth form, workflow name/description, tags, recording/upload/clear buttons
│   │   ├── popup.js                                        # Popup logic: auth UI binding, recording start/stop, tag management, cloud upload, UI mode switching
│   │   └── popup.css                                       # Popup styles: form fields, buttons, status indicators, tag chips, auth container
│   └── storage/                                            # Storage abstraction layer
│       └── storage-utils.js                                # chrome.storage.local wrapper: CRUD, search by URL/name, stats, import/export, clear all
│
└── WorkflowsPlayer/                                        # Chrome extension: plays back guided tours using Shepherd.js
    ├── manifest.json                                       # Manifest V3: permissions, content scripts (runs at document_end), web-accessible resources
    ├── auth/                                               # Authentication module (mirrors recorder structure)
    │   ├── auth.js                                         # AuthManager object: same API as recorder but with English error messages
    │   └── supabase-client.js                              # Creates supabaseClient, exposes it on window; validation guard (English messages)
    ├── content/                                            # Content scripts injected into web pages
    │   ├── content.js                                      # Tour playback engine: init, tour state management, URL matching, workflow fetching, overlay creation, Shepherd tour builder, scroll/click handling, error recovery
    │   └── validation/                                     # Expected-state validation
    │       └── expected-state.js                           # DOM state checker: visible/hidden element verification, text content matching, polling with timeout, error highlighting with pulse animation
    ├── libs/                                               # Third-party libraries
    │   ├── supabase.min.js                                 # Supabase JS client (minified)
    │   └── shepherd.min.js                                 # Shepherd.js tour framework (minified, loaded as web-accessible resource)
    ├── popup/                                              # Extension popup UI
    │   ├── popup.html                                      # Popup layout: auth form, user info, sync button
    │   ├── popup.js                                        # Popup logic: auth UI binding, workflow sync from Supabase to local storage
    │   └── popup.css                                       # Popup styles: gradient background, auth cards, status indicators
    ├── storage/                                            # Storage abstraction layer (identical to recorder)
    │   └── storage-utils.js                                # chrome.storage.local wrapper: CRUD, search, stats, import/export
    └── styles/                                             # Player-specific stylesheets
        ├── overlay.css                                     # Full-screen dimming overlay, cutout highlight box, modal styles, fade/slide/keyframe animations
        └── shepherd.css                                    # Shepherd.js default theme styles
```

---

## File Inventory

### WorkflowsRecorder

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (V3): permissions, content script injection order, popup entry |
| `auth/auth.js` | `AuthManager` singleton: delegating Supabase Auth API calls (login, register, logout, session queries, state listeners) |
| `auth/supabase-client.js` | Initializes `supabaseClient` from hardcoded URL + anon key, validates configuration, alerts on mismatch |
| `content/content.js` | Main recording engine: message broker, click capture with highlight/overlay prevention, step creation, programmatic click replay, expected-state diff pipeline, state persistence |
| `content/content.css` | Styles for the recording overlay badge, pulsing dot, checkmark pop animation, step-description modal and form elements |
| `content/dom/selector-engine.js` | Multi-strategy CSS selector generation: stable ID, DOM path with class filtering, attribute matching, XPath fallback, temporary data attribute as last resort |
| `content/utils/dom-analyzer.js` | DOM introspection: element visibility, input detection, tooltip position heuristics, dynamic container detection, full DOM snapshot, before/after diff computation, MutationObserver stability waiter, change indicator, expected-state save prompt bar |
| `libs/supabase.min.js` | Supabase JavaScript client library (minified, third-party) |
| `popup/popup.html` | Popup HTML structure: authentication login/register/logout, workflow name/description inputs, tag chip editor, status indicators, start/stop/upload/clear buttons |
| `popup/popup.js` | Popup UI logic: state restoration from content script, recording activation/deactivation UI, tag CRUD, cloud upload with Supabase API call, auth event binding |
| `popup/popup.css` | Popup visual styles: button variants (start/stop/download/clear), status panels, form inputs, tag chips, auth container layout |
| `storage/storage-utils.js` | Storage abstraction: `loadAllWorkflows`, `loadWorkflowById`, `deleteWorkflow`, `findWorkflowsByUrl`, `searchWorkflowsByName`, `getWorkflowStats`, `clearAllWorkflows`, `exportAllWorkflows`, `importWorkflows` |

### WorkflowsPlayer

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (V3): permissions, content script injection at `document_end` with Shepherd dependency, web-accessible library resources |
| `auth/auth.js` | `AuthManager` singleton — identical API to recorder's version, error messages in English |
| `auth/supabase-client.js` | Supabase client initialization + `window.supabaseClient` export, validation guard in English |
| `content/content.js` | Tour playback engine: init with pending-validation recovery, tour state persistence, URL matching, Supabase workflow fetch, selection overlay, detail modal, Shepherd tour builder with click-intercepted step progression, scroll/resize tracking, error/recovery modals |
| `content/validation/expected-state.js` | DOM state validator: `checkExpectedState` for visible/hidden/text conditions, `waitForExpectedState` with polling + timeout, `highlightElement` with red outline + opacity pulse |
| `libs/supabase.min.js` | Supabase JavaScript client library (minified, third-party) |
| `libs/shepherd.min.js` | Shepherd.js tour framework (minified, third-party) |
| `popup/popup.html` | Popup HTML structure: authentication form, user info display, sync trigger button |
| `popup/popup.js` | Popup logic: auth UI binding, `syncWorkflows` fetching workflows from Supabase by user ID, storing to local storage, status reporting |
| `popup/popup.css` | Popup visual styles: gradient background, card layout, form inputs, status success/error indicators |
| `storage/storage-utils.js` | Storage abstraction — identical function set to recorder's version |
| `styles/overlay.css` | Cutout highlight overlay styles, modal centering, fade/slide/keyframe animations for overlays and modals |
| `styles/shepherd.css` | Shepherd.js default theme (third-party styles, minimally modified) |


---

## WorkflowsRecorder Architecture

### Entry Points

- **Popup `popup/popup.html`** — User-facing UI. Loaded when the user clicks the extension toolbar icon. Loads `supabase.min.js`, `supabase-client.js`, `auth.js`, and `popup.js`.
- **Content scripts** — Injected by the manifest into every page (`<all_urls>`) at `document_idle`. Load order: `dom-analyzer.js` → `selector-engine.js` → `content.js`. These share the page's global scope.

### Main Modules

| Module | Role |
|--------|------|
| `popup.js` | UI controller: orchestrates recording start/stop via `chrome.tabs.sendMessage`, manages tags, handles cloud upload |
| `content.js` | Recording core: intercepts clicks (capture phase), determines step type (click/input/dynamic), creates step objects, runs the DOM diff pipeline, persists state |
| `selector-engine.js` | Generates robust CSS selectors with 4 fallback strategies |
| `dom-analyzer.js` | Takes DOM snapshots, detects changes, waits for mutations to settle, shows the "analyzing" indicator and the expected-state save prompt bar |

### Storage Flow

- **Recording state** persisted to `chrome.storage.local` under key `recorder_state` every time a step is added or recording starts/stops. Contains `{ isRecording, workflow }`.
- **Pending snapshot** persisted under `pending_snapshot` key during click steps that expect DOM changes. Contains visible selectors, text, step index, and timestamp. Re-evaluated on page reload within 15 seconds.
- **Workflow upload** uses `supabaseClient.from('workflows').insert()` to push the workflow JSON to the remote Supabase database.

### Lifecycle

1. Popup opens → queries content script for current recording state via `getRecordingState`.
2. User enters workflow name → clicks "Iniciar Grabación" → sends `startRecording` with workflow object.
3. Content script creates overlay, attaches event listeners (click capture, mouseover highlight).
4. User interacts with the page; each click is captured, described, and stored as a step.
5. User clicks "Detener Grabación" → popup sends `stopRecording` → content script detaches listeners, removes overlay, saves state.
6. Popup displays upload/clear options. User may add tags.
7. User clicks "Guardar en la Nube" → popup calls Supabase API to insert the workflow, then sends `clearRecording`.

---

## WorkflowsPlayer Architecture

### Entry Points

- **Popup `popup/popup.html`** — User-facing UI for authentication and workflow synchronization. Loads `supabase.min.js`, `supabase-client.js`, `auth.js`, and `popup.js`.
- **Content scripts** — Injected by the manifest into every page (`<all_urls>`) at `document_end`. Load order: `auth.js` → `supabase-client.js` → `storage-utils.js` → `supabase.min.js` → `shepherd.min.js` → `expected-state.js` → `content.js`.

### Main Modules

| Module | Role |
|--------|------|
| `popup.js` | UI controller: manages auth state, triggers workflow sync from Supabase to local storage |
| `content.js` | Tour engine: initializes state recovery, fetches matching workflows, builds Shepherd tour, intercepts user clicks for step progression, handles validation and errors |
| `expected-state.js` | Validates DOM against expected visible/hidden elements and text content with polling |
| `storage-utils.js` | Local storage CRUD for synced workflow data |

### Storage Flow

- **Active tour state** under `active_tour` key: `{ isActive, workflow, currentStepIndex, isExpectedNavigation, pendingValidationIdx, lastUpdated }`. Saved before every step transition.
- **Synced workflows** under `workflowList` (index array) and individual `workflow_{id}` keys. Populated by `syncWorkflows()` from the popup.

### Lifecycle

1. Page loads → `init()` runs. Checks for saved active tour.
2. If active tour found with pending validation: re-validates expected state. On failure, navigates back and shows error. On success, resumes tour.
3. If no active tour: waits 2s, fetches workflows from Supabase, filters by URL match, shows overlay grid.
4. User selects a workflow → detail modal → starts Shepherd tour.
5. Tour progresses via user clicks on highlighted elements. Each click saves state, validates expected state, and advances.
6. On validation failure: error modal with retry button → resets to step 0.
7. On navigation step: state saved, tour cancelled, browser navigates, `init()` resumes on new page.
8. On last step: state cleared, completion modal shown.

---

## Execution Flow

### WorkflowsRecorder — Step by Step

1. **User opens popup** → `popup.js` queries the active tab's content script via `chrome.tabs.sendMessage({ action: 'getRecordingState' })` to restore UI if already recording.
2. **Authentication** → `AuthManager.getCurrentUser()` checks Supabase session. `onAuthStateChange` keeps the UI synced. Login/Register buttons call `AuthManager.login()` / `register()`.
3. **User enters workflow name** → Validated; a workflow object is created with `{ name, description, url, steps: [], createdAt }`.
4. **Recording starts** → `chrome.tabs.sendMessage({ action: 'startRecording', workflow })`. Content script's message handler calls `startRecording()`: creates the overlay, attaches capture-phase click/mouseover/mouseout listeners, saves state.
5. **Content script captures interactions** → Each user click is intercepted, a CSS selector is generated (4-strategy fallback), the user is prompted for a description via a modal, and a step object is recorded. For click-type steps, the DOM is snapshotted before and after the simulated click, and a diff is computed. If expected state tracking is enabled, the diff is stored on the step.
6. **Workflow is stored** → State is persisted to `chrome.storage.local` after every mutation (`saveState()`).
7. **Workflow is uploaded** → User clicks "Guardar en la Nube". Popup transforms the workflow into drawflow format and calls `supabaseClient.from('workflows').insert()`. On success, the recording is cleared and UI resets.

### WorkflowsPlayer — Step by Step

1. **User opens popup** → Authentication UI binds. On login, `syncWorkflows()` fetches `user_id`-filtered workflows from Supabase and stores them in `chrome.storage.local`.
2. **Workflows are synchronized** → `syncWorkflows()` queries `client.from('workflows').select('*').eq('user_id', id)`, iterates rows with valid `drawflow`, stores index in `workflowList` and data in `workflow_{id}` keys.
3. **Content scripts initialize** → On any page load, `init()` runs. Recovers any active tour from `chrome.storage.local` (checking `active_tour`). Handles pending step validation if the page matches the expected URL. After 2s, `fetchAndShowWorkflows()` queries Supabase's `workflows` table, filters by `urlsMatch(row.url, location.href)`, and shows either a workflow selection grid or a "no guides" toast.
4. **User selects a workflow** → `createTourOverlay()` renders a full-screen modal with a grid of workflow buttons. Each shows name, tags, and a CTA.
5. **User clicks "Iniciar Tour"** → `showTourDetailsModal()` shows name, tags, description. Clicking start calls `startTourFromJSON(workflowData)`.
6. **Guided tour starts** → `startTourFromJSON()` builds a Shepherd.Tour from sorted drawflow nodes. Each step has a `beforeShowPromise` that retries selector lookup for 2s and scrolls out-of-view elements. The `show` event attaches a capture-phase click handler to the target element.
7. **User progresses through steps** → The click handler intercepts real clicks, saves tour state, simulates native events, validates expected state (with timeout), handles errors with a retry modal, and advances to the next step or navigates to a new URL. The last step clears state and shows a completion modal.

---

## Developer Quick Reference

### WorkflowsRecorder

| If you want to... | File |
|---|---|
| Modify authentication logic | `auth/auth.js` |
| Change Supabase project credentials | `auth/supabase-client.js` |
| Modify recording capture logic | `content/content.js` |
| Change selector generation strategy | `content/dom/selector-engine.js` |
| Modify DOM diff or stability detection | `content/utils/dom-analyzer.js` |
| Change popup layout or controls | `popup/popup.html` + `popup/popup.js` + `popup/popup.css` |
| Modify workflow persistence | `storage/storage-utils.js` |
| Adjust recording overlay styles | `content/content.css` |

### WorkflowsPlayer

| If you want to... | File |
|---|---|
| Modify authentication logic | `auth/auth.js` |
| Change tour initialization or recovery | `content/content.js` (function `init`) |
| Modify Shepherd tour construction | `content/content.js` (function `startTourFromJSON`) |
| Change expected-state validation | `content/validation/expected-state.js` |
| Modify error handling flow | `content/content.js` (functions `handleError`, `showErrorMessage`) |
| Adjust overlay/modal appearance | `styles/overlay.css` |
| Change workflow sync logic | `popup/popup.js` (function `syncWorkflows`) |
| Modify popup layout or controls | `popup/popup.html` + `popup/popup.js` + `popup/popup.css` |
| Modify workflow persistence | `storage/storage-utils.js` |

### Cross-cutting

| If you want to... | File |
|---|---|
| Change workflow data format (drawflow) | Both `popup/popup.js` files (upload / sync transformation) |
| Modify shared Supabase schema interaction | Both `auth/supabase-client.js` (connection) + popup files (queries) |
