# TikTok + Instagram engagement (like / comment / watch → S2 tickets)

- **Date:** 2026-06-25
- **Repos:** `/opt/rinaudo-extension` (extension, mine) + `/opt/rinaudo-s2` (backend, other chat)
- **Status:** approved design, pre-implementation

## Goal

Credit Season-2 tickets when a connected member **likes**, **comments on** (>5 chars), or **watches** Mizkif's recent **TikTok** and **Instagram** posts — mirroring the existing X and YouTube engagement, reusing the draggable widget frame (`content/widget-frame.js`) and the service-worker engagement plumbing (`s2Engagement`, `s2Watch*`).

## Scope

- **Platforms:** TikTok (`tiktok.com`), Instagram (`instagram.com`).
- **Actions:** like, comment (>5 chars), watch (Reels/videos).
- **Phased delivery:** Phase 1 = like + comment (small backend lift). Phase 2 = watch (needs backend watch generalization).
- **Out of scope:** Facebook (deferred — opaque `pfbid` URLs, worst DOM); migrating `x.js`/`youtube.js` onto the shared core (optional, later); the rate **values** (backend config); the rates-display panel (separate task).

## Eligibility model (per platform)

The extension is agnostic to *how* a post becomes eligible — it matches whatever active targets the backend returns from `/api/extension/targets`. The window logic is entirely backend.

| Platform | Eligible target | Reward |
|---|---|---|
| X | most recent post only | full |
| YouTube | latest video/short | ≤24h full · 24h–7d = 1 · >7d = 0 (decay) |
| **TikTok / Instagram** | **any post from the last 24h** (rolling window; multiple can be active at once; auto-expire) | full within 24h · 0 after |

## Architecture (extension)

Shared engagement engine + thin per-platform adapters.

- **`content/engage-core.js`** — the engine: mounts the widget (via `RGCFrame`), runs the watch loop (focus+play-gated accrual, heartbeats, claim), detects like (poll) + comment (submit hook + >5-char gate), wires the SW messages (`s2Targets`, `s2Engagement`, `s2Watch*`), and handles SPA URL changes. Driven entirely by an adapter object.
- **`content/tiktok.js`, `content/instagram.js`** — adapters. Each provides selectors/logic; no widget or network code of its own:

  ```js
  {
    platform: 'tiktok' | 'instagram',
    actions: { watch: true, like: true, comment: true },
    getRef(): string,           // stable post id from location.* ('' if not on a post page)
    isLiked(): boolean,         // current like state from the DOM
    commentSubmitSel: string,   // selector for the comment-post button (delegated click)
    commentText(): string,      // current comment draft text (for the >5-char gate)
    getVideoEl(): HTMLVideoElement | null,  // for watch (default: document.querySelector('video'))
  }
  ```

- **`x.js` / `youtube.js` stay as-is** for now (zero risk to what's shipped). They can migrate onto `engage-core.js` later.

### Adapter specifics (best-effort selectors — to be tuned after a live check)

**TikTok**
- `getRef`: `location.pathname` match `/\/video\/(\d+)/` → numeric video id. Only matches on a video page.
- `isLiked`: like button `[data-e2e="like-icon"]` / `browse-like-icon` — liked when its SVG fill is the TikTok red (`rgb(254,44,85)`) or the button reports pressed. (Tune live.)
- `commentSubmitSel`: `[data-e2e="comment-post"]`.
- `commentText`: `[data-e2e="comment-input"]` (contenteditable) `textContent`.
- `getVideoEl`: `document.querySelector('video')`.

**Instagram**
- `getRef`: `location.pathname` match `/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/` → shortcode. On a post/reel page.
- `isLiked`: presence of `svg[aria-label="Unlike"]` within the post (liked) vs `[aria-label="Like"]`.
- `commentSubmitSel`: the comment **Post** button (a `[role="button"]` with text "Post" near the comment textarea). (Tune live.)
- `commentText`: `textarea[aria-label*="comment" i]` value/`textContent`.
- `getVideoEl`: `document.querySelector('video')` (Reels/video; photo posts have no `<video>` → no watch row shown).

## Watch flow (Phase 2)

Reuse the existing session → heartbeat → claim machinery unchanged. The only extension difference vs `youtube.js`: the watch messages carry a **`platform`** field. The watch loop is identical (5s tick, accrue focused+playing seconds, heartbeat every `hbInterval`, claim when `watched >= target`). Short looping videos cap at the learned duration server-side and bottom out at the floor.

## >5-char comment gate

Carried over from X/YouTube: at comment-submit, read `adapter.commentText()`; skip crediting if the trimmed length ≤ 5.

## Manifest changes (both `manifest.json` + `manifest.firefox.json`)

- `host_permissions` += `"https://www.tiktok.com/*"`, `"https://www.instagram.com/*"`.
- `content_scripts` += two entries (note load order — config, frame, core, then adapter):
  - `{ matches: ["https://www.tiktok.com/*"], js: ["config.js","content/widget-frame.js","content/engage-core.js","content/tiktok.js"], run_at: "document_idle" }`
  - `{ matches: ["https://www.instagram.com/*"], js: ["config.js","content/widget-frame.js","content/engage-core.js","content/instagram.js"], run_at: "document_idle" }`
- `package.sh` already ships `content/` — `engage-core.js` is included automatically.
- Bump version.

## Backend contract (other chat — `/opt/rinaudo-s2`)

**Phase 1 (engagement / like + comment):**
- Add `'tiktok'`, `'instagram'` to the `/api/extension/engagement` platform allowlist (currently `x|youtube`).
- `normalizeTikTok(url|id)` → numeric video id; `normalizeInstagram(url|code)` → shortcode. Used in engagement + targets.
- `isActiveTarget` + `listActiveTargets` are already platform-agnostic; `/api/extension/targets` already returns all platforms.

**Target model (24h window) for TikTok/IG:**
- Auto-detect publishes each new TikTok/IG post (the mizdaq-prod `/api/extension/status` feed already surfaces latest TikTok + IG via IFTTT — confirmed: it returns `@realmizkif` TikTok + IG `/p/` URLs) with a **24h expiry**.
- `listActiveTargets` / `isActiveTarget` filter out targets past their `expires_at` (24h).
- **Caveat 1 — feed holds only the single latest per platform** (`social_latest` upserts on url change). To accumulate a 24h window of *multiple* posts, the auto-detect job must capture each post into `engagement_targets` as the feed rotates through them (frequent enough poll to not miss posts), not rely on the feed to hold a day's history.
- **Caveat 2 — IFTTT's IG trigger favors feed photos, Reels are spotty.** Since *watch* targets are Reels, IG watch may not auto-detect reliably; keep manual admin publish as a backstop (and consider a better IG source if watch matters there).

**Authorship verification (recommended — reduces IFTTT trust + flakiness):**
- Before publishing a candidate **TikTok** post as a target, verify it's really @realmizkif's via TikTok's **public, no-auth oEmbed**: `GET https://www.tiktok.com/oembed?url=<post url>` → check `author_url` / `author_name` matches his handle. This lets the backend accept a candidate ref from *any* source — IFTTT, a scraper, or an extension hint — **without trusting the source**, because the server independently confirms authorship (and that the post exists). It's the clean fix for flaky IFTTT.
- **Instagram** oEmbed needs a Facebook Graph token (public access deprecated), so IG verification requires a token or a scraper API; otherwise keep IG on the IFTTT feed + manual admin publish.
- **Security invariant:** the extension must NEVER be trusted to *assert* a post's authorship — it runs on the user's machine and is forgeable. It may only *suggest* a candidate ref; the server must verify (oEmbed/API) before publishing it as a target. Awards are always gated on the server's verified target list (`isActiveTarget`), never on an extension claim.

**Phase 2 (watch generalization):**
- `publicEngagement()` exposes active `tiktok`/`instagram` targets (not just `youtube`).
- `/api/watch/{session,heartbeat,claim}` accept a `platform` field and match "is this ref an active target on this platform?" instead of `== eng.youtube.ref`.
- `video-watch` normalizes per platform (reuse `normalizeTikTok`/`normalizeInstagram`).

## Reward / economy (backend config — Mizkif's call, flagged not decided)

- **Short-video watch floor:** a 15–60s TikTok/Reel bottoms out at the watch floor (~5) for ~20s of watching — more than a like (1) for near-zero effort, and farmable by leaving it looping. Consider a lower floor for short-video platforms, or treat short-video watch as a small flat bonus.
- **Confirm 24h window semantics:** all posts in the window are active (multiple), not just the newest.

## Testing / verification

- `node --check` on all new JS; JSON-validate both manifests; `package.sh` build + confirm the new files land in both zips.
- Detection is **best-effort and cannot be verified in this environment** (the browser is remote/Windows). Real verification = the user loads unpacked, visits a published TikTok/IG target, and confirms like/comment/watch credit; selectors are then tuned from what they report.

## Risks

- **Per-site DOM volatility** (TikTok/IG change frequently) → detection breaks; mitigated by isolating selectors in small adapters.
- **Login-walled content** (IG especially) → the content script only works when the member is logged in and on the post page.
- **Forgeable engagement** (same as X/YouTube) — the server gates on active-target + once-per-(user,target,action) idempotency; the gate is honesty, not security.
- **More host permissions** widen store-review scrutiny + the privacy disclosure → update `privacy.html` / `STORE.md` before submit.

## Out of scope / later

Facebook · migrating `x.js`/`youtube.js` onto `engage-core.js` · the rates-display panel · the rate values.
