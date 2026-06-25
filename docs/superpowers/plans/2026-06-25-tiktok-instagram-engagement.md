# TikTok + Instagram Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TikTok + Instagram like/comment/watch engagement to the extension, driven by a shared engine and thin per-platform adapters, reusing the existing widget frame and service-worker plumbing.

**Architecture:** A new `content/engage-core.js` generalizes the proven `content/youtube.js` logic (widget + watch loop + like/comment detection + SPA re-checks) into an adapter-driven engine exposing `self.EngageCore.init(adapter)`. Two thin adapters (`content/tiktok.js`, `content/instagram.js`) supply only platform name, which actions apply, and DOM selectors. `x.js`/`youtube.js` are left untouched (zero risk). The watch path carries a `platform` field and is forward-compatible: it no-ops until the backend (other chat) generalizes the watch routes off YouTube.

**Tech Stack:** Plain MV3 content scripts (no build, no framework). Verification = `node --check` + tiny framework-free `node:assert` tests for the pure ref-extraction + `package.sh` zip check. DOM detection + behavior are verified by the user in-browser (this environment can't run a browser); expect a selector-tuning pass.

**Scope note:** This plan covers the **extension** only. The backend (engagement allowlist + normalize, the 24h-window target model, watch generalization, auto-detect) is the other chat's, specified in `docs/superpowers/specs/2026-06-25-tiktok-instagram-engagement-design.md` → "Backend contract". Phase 1 (like/comment) lights up when the backend adds the platforms; Phase 2 (watch) when it generalizes the watch routes. The extension code here supports both from day one.

---

### Task 1: Shared engagement engine `content/engage-core.js`

**Files:**
- Create: `content/engage-core.js`
- Test: `test/engage-core.test.mjs`

- [ ] **Step 1: Write the failing smoke test**

Create `test/engage-core.test.mjs`:

```js
// Loads engage-core under a stubbed global and checks it exposes the init API.
// (Behavior is DOM/SW/timer heavy and verified in-browser; this only guards the contract.)
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const code = readFileSync('content/engage-core.js', 'utf8');
const self = {};
new Function('self', code)(self); // top-level only assigns self.EngageCore; init() is not called

assert.equal(typeof self.EngageCore, 'object', 'EngageCore global missing');
assert.equal(typeof self.EngageCore.init, 'function', 'EngageCore.init missing');
console.log('engage-core: loads + exposes init OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /opt/rinaudo-extension && node test/engage-core.test.mjs`
Expected: FAIL — `ENOENT … content/engage-core.js`.

- [ ] **Step 3: Implement the engine**

Create `content/engage-core.js`:

```js
// Shared engagement engine for per-platform content scripts (TikTok, Instagram;
// X/YouTube may migrate here later). An adapter supplies the platform name, which
// actions apply, and the DOM selectors; this engine does the widget, the watch
// session loop, like/comment detection (+ the >5-char comment gate), the SW wiring,
// and SPA re-checks. Loaded after config.js + widget-frame.js, before the adapter.
//
// Adapter shape:
//   { platform, actions:{watch,like,comment}, getRef()->string, isLiked()->bool,
//     commentSubmitTarget(eventTarget)->Element|null, commentText()->string,
//     getVideoEl()->HTMLVideoElement|null }
self.EngageCore = (function () {
  const ROW_CSS = `
    .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
    .row:first-child{margin-top:0}
    .row .amt{color:#A9A697;font-variant-numeric:tabular-nums}
    .done{color:#86D6A4}`;

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const watchEstimate = (sec, r) => Math.max(r.watchFloor || 5, Math.floor((sec || 0) / 60) * (r.watchPerMinute || 1));

  function init(A) {
    let frame = null, state = null, commentHooked = false, lastHb = 0;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1 };

    function ensureFrame() {
      if (frame) return;
      frame = self.RGCFrame.mount({ key: A.platform, title: 'Earn tickets', width: 240, pos: { top: 72, right: 16 }, css: ROW_CSS });
    }
    function rowEl(label, amt, done) {
      const r = document.createElement('div'); r.className = 'row';
      const l = document.createElement('span'); l.textContent = (done ? '✓ ' : '') + label; if (done) l.className = 'done';
      const a = document.createElement('span'); a.className = 'amt'; a.textContent = amt;
      r.append(l, a); return r;
    }
    function drawWidget() {
      if (!state) return;
      ensureFrame();
      const body = frame.body; body.replaceChildren();
      if (A.actions.watch && state.sessionId) {
        const amt = state.watchDone ? (state.awarded != null ? state.awarded : watchEstimate(state.watched, rewards)) : watchEstimate(state.watched, rewards);
        body.append(rowEl(state.watchDone ? 'Watched' : `Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}`, `+${amt}`, state.watchDone));
      }
      if (A.actions.like) body.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
      if (A.actions.comment) body.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
      const earned = (state.likeDone ? rewards.likeReward : 0) + (state.commentDone ? rewards.commentReward : 0) + (state.watchDone ? (state.awarded || 0) : 0);
      frame.setPill(earned ? `+${earned}` : '🎟');
    }
    function clearWidget() { if (frame) { frame.destroy(); frame = null; } state = null; }

    async function fireEngagement(action) {
      const ref = state && state.ref; if (!ref) return;
      const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: A.platform, action, ref }).catch(() => null);
      if (r && r.credited) { if (action === 'like') state.likeDone = true; if (action === 'comment') state.commentDone = true; drawWidget(); }
    }

    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      document.addEventListener('click', (e) => {
        if (!state || state.commentDone) return;
        const n = A.commentSubmitTarget(e.target);
        if (n) {
          if ((A.commentText() || '').trim().length <= 5) return; // >5-char gate
          setTimeout(() => fireEngagement('comment'), 600);
        }
      }, true);
    }

    async function startWatch() {
      if (!A.actions.watch) return;
      const v = A.getVideoEl();
      const dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
      const s = await chrome.runtime.sendMessage({ type: 's2WatchSession', platform: A.platform, videoRef: state.ref, playerDuration: dur }).catch(() => null);
      if (!s || s.error || !s.sessionId) return; // backend not ready / not the active target / not connected
      state.sessionId = s.sessionId; state.target = s.requiredWatchSeconds || 120; state.hbInterval = s.heartbeatIntervalSec || 20;
      drawWidget();
    }
    async function claimWatch() {
      if (!state || state.watchDone || state.claiming) return;
      state.claiming = true;
      const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', platform: A.platform, videoRef: state.ref }).catch(() => null);
      state.claiming = false;
      if (r && r.ok) { state.watchDone = true; state.awarded = (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)); drawWidget(); }
    }

    async function start(ref) {
      if (!ref) return clearWidget();
      const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
      rewards = {
        likeReward: (data && data.likeReward) || 0,
        commentReward: (data && data.commentReward) || 0,
        watchVideoReward: (data && data.watchVideoReward) || 0,
        watchFloor: (data && data.watchVideoFloor) || 5,
        watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
      };
      const eligible = !!(data && (data.targets || []).some((t) => t.platform === A.platform && t.ref === ref));
      if (!eligible) return clearWidget();
      state = { ref, watched: 0, target: 0, sessionId: null, watchDone: false, likeDone: false, commentDone: false };
      lastHb = 0; hookComment(); drawWidget();
      startWatch();
    }

    // Every 5s: detect a like, accrue focused-playing watch time, heartbeat, claim when ready.
    setInterval(() => {
      if (!state || state.ref !== A.getRef()) return;
      if (A.actions.like && !state.likeDone && A.isLiked()) fireEngagement('like');
      if (!A.actions.watch || !state.sessionId || state.watchDone) return;
      const v = A.getVideoEl();
      const playing = v && !v.paused && !v.ended && v.currentTime > 0;
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      if (playing && focused) {
        state.watched = (state.watched || 0) + 5;
        const now = Date.now();
        if (now - lastHb >= (state.hbInterval || 20) * 1000) { lastHb = now; chrome.runtime.sendMessage({ type: 's2WatchHeartbeat', platform: A.platform, sessionId: state.sessionId }).catch(() => {}); }
        drawWidget();
      }
      if ((state.watched || 0) >= (state.target || 120)) claimWatch();
    }, 5000);

    // SPA URL changes → re-evaluate eligibility for the new post.
    let lastUrl = location.href;
    setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(A.getRef()); } }, 1000);
    start(A.getRef());
  }

  return { init };
})();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /opt/rinaudo-extension && node test/engage-core.test.mjs && node --check content/engage-core.js`
Expected: `engage-core: loads + exposes init OK` and no `node --check` error.

- [ ] **Step 5: Commit**

```bash
cd /opt/rinaudo-extension
git add content/engage-core.js test/engage-core.test.mjs
git commit -m "feat(engage): shared engagement engine (generalizes youtube.js)"
```

---

### Task 2: TikTok adapter `content/tiktok.js`

**Files:**
- Create: `content/tiktok.js`, `test/_load.mjs`, `test/tiktok-refs.test.mjs`

- [ ] **Step 1: Write the shared test loader**

Create `test/_load.mjs`:

```js
// Loads an adapter IIFE under stubbed globals and returns the adapter object it
// registers. Only `self` matters at load time (the adapter assigns its global and
// checks self.EngageCore); DOM-touching methods are never called here.
import { readFileSync } from 'node:fs';

export function loadAdapter(file, globalName) {
  const code = readFileSync(file, 'utf8');
  const self = {};
  // location/document are referenced only inside methods we don't call; pass harmless stubs.
  new Function('self', 'location', 'document', code)(self, { pathname: '/' }, {});
  return self[globalName];
}
```

- [ ] **Step 2: Write the failing ref test**

Create `test/tiktok-refs.test.mjs`:

```js
import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const tt = loadAdapter('content/tiktok.js', 'RGC_TIKTOK_ADAPTER');

assert.equal(tt.platform, 'tiktok');
assert.equal(tt.refFromPath('/@realmizkif/video/7655132041440234766'), '7655132041440234766');
assert.equal(tt.refFromPath('/@realmizkif'), '');
assert.equal(tt.refFromPath('/foryou'), '');
assert.equal(tt.refFromPath(''), '');
console.log('tiktok ref extraction OK');
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /opt/rinaudo-extension && node test/tiktok-refs.test.mjs`
Expected: FAIL — `ENOENT … content/tiktok.js`.

- [ ] **Step 4: Implement the adapter**

Create `content/tiktok.js`:

```js
// TikTok adapter for engage-core. Selectors are best-effort and may need live tuning.
(function () {
  const adapter = {
    platform: 'tiktok',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/video\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      const btn = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
      if (!btn) return false;
      if (btn.getAttribute('aria-pressed') === 'true') return true;
      const path = btn.querySelector('svg path');
      const fill = path ? (path.getAttribute('fill') || getComputedStyle(path).fill || '') : '';
      return /254,\s*44,\s*85|#fe2c55|rgb\(254/i.test(fill);
    },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-e2e="comment-post"]') : null; },
    commentText() { const el = document.querySelector('[data-e2e="comment-input"]'); return el ? (el.textContent || el.value || '') : ''; },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
```

- [ ] **Step 5: Run tests + syntax check to verify they pass**

Run: `cd /opt/rinaudo-extension && node test/tiktok-refs.test.mjs && node --check content/tiktok.js`
Expected: `tiktok ref extraction OK` and no `node --check` error.

- [ ] **Step 6: Commit**

```bash
cd /opt/rinaudo-extension
git add content/tiktok.js test/_load.mjs test/tiktok-refs.test.mjs
git commit -m "feat(tiktok): TikTok engagement adapter"
```

---

### Task 3: Instagram adapter `content/instagram.js`

**Files:**
- Create: `content/instagram.js`, `test/instagram-refs.test.mjs`

- [ ] **Step 1: Write the failing ref test**

Create `test/instagram-refs.test.mjs`:

```js
import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const ig = loadAdapter('content/instagram.js', 'RGC_IG_ADAPTER');

assert.equal(ig.platform, 'instagram');
assert.equal(ig.refFromPath('/p/DZqNB9_zBcF/'), 'DZqNB9_zBcF');
assert.equal(ig.refFromPath('/reel/DABcd12-_Xy/'), 'DABcd12-_Xy');
assert.equal(ig.refFromPath('/tv/AbCdEf/'), 'AbCdEf');
assert.equal(ig.refFromPath('/realmizkif/'), '');
assert.equal(ig.refFromPath(''), '');
console.log('instagram ref extraction OK');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /opt/rinaudo-extension && node test/instagram-refs.test.mjs`
Expected: FAIL — `ENOENT … content/instagram.js`.

- [ ] **Step 3: Implement the adapter**

Create `content/instagram.js`:

```js
// Instagram adapter for engage-core. Selectors are best-effort and may need live tuning.
// Photo posts have no <video> so the watch row simply never appears (getVideoEl null).
(function () {
  const adapter = {
    platform: 'instagram',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() { return !!document.querySelector('svg[aria-label="Unlike"]'); },
    commentSubmitTarget(t) {
      const b = t && t.closest ? t.closest('[role="button"], button') : null;
      return b && (b.textContent || '').trim() === 'Post' ? b : null;
    },
    commentText() { const el = document.querySelector('textarea[aria-label*="comment" i]'); return el ? (el.value || el.textContent || '') : ''; },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
```

- [ ] **Step 4: Run tests + syntax check to verify they pass**

Run: `cd /opt/rinaudo-extension && node test/instagram-refs.test.mjs && node --check content/instagram.js`
Expected: `instagram ref extraction OK` and no `node --check` error.

- [ ] **Step 5: Commit**

```bash
cd /opt/rinaudo-extension
git add content/instagram.js test/instagram-refs.test.mjs
git commit -m "feat(instagram): Instagram engagement adapter"
```

---

### Task 4: Forward `platform` in the service-worker watch handlers

The engine sends `platform` in the watch messages, but `background.js` currently drops it. Forward it into the POST body for session + claim (heartbeat is session-keyed, no platform needed). Leaving `youtube.js` untouched is fine — it sends no `platform`, so the field is `undefined` and the backend defaults to YouTube.

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Thread `platform` through `s2WatchSession`**

Change:
```js
async function s2WatchSession(videoRef, playerDuration) {
```
to:
```js
async function s2WatchSession(platform, videoRef, playerDuration) {
```
and in the same function change the body:
```js
    body: JSON.stringify({ videoRef, playerDuration }),
```
to:
```js
    body: JSON.stringify({ platform, videoRef, playerDuration }),
```

- [ ] **Step 2: Thread `platform` through `s2WatchClaim`**

Change:
```js
async function s2WatchClaim(videoRef) {
```
to:
```js
async function s2WatchClaim(platform, videoRef) {
```
and change its body:
```js
    body: JSON.stringify({ videoRef }),
```
to:
```js
    body: JSON.stringify({ platform, videoRef }),
```

- [ ] **Step 3: Pass `platform` from the message handlers**

Change:
```js
    else if (msg.type === 's2WatchSession') { reply(await s2WatchSession(msg.videoRef, msg.playerDuration)); }
```
to:
```js
    else if (msg.type === 's2WatchSession') { reply(await s2WatchSession(msg.platform, msg.videoRef, msg.playerDuration)); }
```
and change:
```js
    else if (msg.type === 's2WatchClaim') { reply(await s2WatchClaim(msg.videoRef)); }
```
to:
```js
    else if (msg.type === 's2WatchClaim') { reply(await s2WatchClaim(msg.platform, msg.videoRef)); }
```

- [ ] **Step 4: Syntax check**

Run: `cd /opt/rinaudo-extension && node --check background.js`
Expected: no error.

- [ ] **Step 5: Commit**

```bash
cd /opt/rinaudo-extension
git add background.js
git commit -m "feat(sw): forward platform on watch session/claim (for TikTok/IG)"
```

---

### Task 5: Wire manifests, bump version, package + verify

**Files:**
- Modify: `manifest.json`, `manifest.firefox.json`

- [ ] **Step 1: Add host permissions to BOTH manifests**

In `manifest.json` and `manifest.firefox.json`, the `host_permissions` array ends with `"https://www.youtube.com/*"`. Add the two new hosts right after it, so it reads:

```json
"host_permissions": ["https://rinaudoglobal.com/*", "https://x.com/*", "https://twitter.com/*", "https://s2.jsolutions.dev/*", "https://kick.com/*", "https://www.youtube.com/*", "https://www.tiktok.com/*", "https://www.instagram.com/*"],
```

- [ ] **Step 2: Add the two content-script entries to BOTH manifests**

In each manifest's `content_scripts` array, the last entry is the YouTube one (ending `"run_at": "document_idle"` then `}`). Add these two entries after it (mind the comma after the YouTube entry's closing brace):

```json
    {
      "matches": ["https://www.tiktok.com/*"],
      "js": ["config.js", "content/widget-frame.js", "content/engage-core.js", "content/tiktok.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["config.js", "content/widget-frame.js", "content/engage-core.js", "content/instagram.js"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 3: Bump the version in BOTH manifests**

Change `"version": "0.6.0"` → `"version": "0.7.0"` in `manifest.json` and `manifest.firefox.json`.

- [ ] **Step 4: Verify everything + build the zips**

Run:
```bash
cd /opt/rinaudo-extension
node test/engage-core.test.mjs && node test/tiktok-refs.test.mjs && node test/instagram-refs.test.mjs
for f in content/engage-core.js content/tiktok.js content/instagram.js; do node --check "$f"; done
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest.json valid')"
node -e "JSON.parse(require('fs').readFileSync('manifest.firefox.json','utf8'));console.log('manifest.firefox.json valid')"
./package.sh
for z in chrome firefox; do unzip -l rinaudo-extension-$z.zip | grep -E 'engage-core|tiktok|instagram' && echo "$z: new files present"; done
```
Expected: all three ref tests print OK; no `node --check` errors; both manifests valid; both zips list `content/engage-core.js`, `content/tiktok.js`, `content/instagram.js`.

- [ ] **Step 5: Commit + push**

```bash
cd /opt/rinaudo-extension
git add manifest.json manifest.firefox.json
git commit -m "feat(manifest): load TikTok + Instagram engagement; bump 0.7.0"
git push origin master
```

---

## Out of this plan (tracked elsewhere)

- **Backend (other chat):** engagement allowlist + `normalizeTikTok`/`normalizeInstagram`; the 24h-window target model (with the single-latest-feed + IG-Reels-spotty caveats); watch-route generalization off YouTube; auto-detect publishing. See the spec's "Backend contract".
- **Live selector tuning:** `isLiked`, `commentSubmitTarget`, `commentText` are best-effort and unverifiable here. After loading unpacked and visiting a published TikTok/IG target, tune from what the user reports.
- **Store prep:** update `privacy.html` / `STORE.md` for the two new host permissions before submitting `0.7.0`.
- **Economy:** Mizkif to decide the short-video watch floor; confirm "24h window = all posts".
