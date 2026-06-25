# Rules panel + earn-card state indicators — Implementation Plan

> Executed inline by the author. Full design: `docs/superpowers/specs/2026-06-25-rules-panel-and-state-indicators-design.md`.

**Goal:** live "How to earn" list in the popup + welcome page; clear earn-card states (eligible / playing / paused / processing / claimed) across all 4 platforms by migrating `x.js`/`youtube.js` onto `engage-core`.

---

### Task 1: `rates-list.js` (shared) + popup + welcome wiring
- Create `rates-list.js`: `self.renderRates(el)` fetches `/api/extension/rates`, renders rows (watchtime, video, like, comment, vote, install) + eligibility note, textContent only.
- `popup/popup.html`: add `#rates` container + styles + `<script src="../rates-list.js">`; `popup.js` calls `renderRates($('rates'))`.
- `welcome.html`: replace the static `<ul>` with `<div id="rates">` + `<script src="rates-list.js">` call.
- `package.sh`: add `rates-list.js` to `SHARED`.
- Verify: `node --check rates-list.js popup/popup.js welcome.js`. Commit.

### Task 2: `engage-core.js` state indicators
- Add per-row state: `state.likeS/commentS ∈ idle|pending|done`; `state.watchPlaying` (set in the 5s interval); claim uses `state.claiming`.
- `rowEl(label, amt, status)` renders: `idle` → `label … amt`; `pending` → `label … ⋯`; `done` → `✓ label … amt` (green). Watch row adds `▶`/`⏸ · paused` prefixes.
- `fireEngagement`: set `pending` + redraw before the SW call; `done` on credited else `idle`.
- Verify: `node test/engage-core.test.mjs && node --check content/engage-core.js`. Commit.

### Task 3: migrate `x.js` → adapter
- Rewrite `content/x.js` as an X adapter (platform 'x', actions {like,comment}, `refFromPath`, `isLiked`, `commentSubmitTarget`, `commentText`) registering `self.RGC_X_ADAPTER` + `EngageCore.init`. Selectors verbatim from the current file.
- Add `test/x-refs.test.mjs` (refFromPath on `/user/status/<id>`).
- Verify test + `node --check`. Commit.

### Task 4: migrate `youtube.js` → adapter
- Rewrite `content/youtube.js` as a YouTube adapter (platform 'youtube', actions {watch,like,comment}, `refFromUrl(href)` for `?v=`+`/shorts/`, `isLiked`, `commentSubmitTarget`, `commentText`, `getVideoEl`) registering `self.RGC_YT_ADAPTER` + `EngageCore.init`.
- Add `test/youtube-refs.test.mjs` (refFromUrl on watch + shorts URLs).
- Verify test + `node --check`. Commit.

### Task 5: manifests + package + verify + push
- Both manifests: add `content/engage-core.js` to the `x.js` and `youtube.js` content-script `js` arrays; bump version 0.7.0 → 0.8.0.
- Verify: all ref/smoke tests, `node --check` all, both manifests valid (x + youtube entries include engage-core), `package.sh`, zips contain `rates-list.js` + `engage-core.js`. Commit + push.
