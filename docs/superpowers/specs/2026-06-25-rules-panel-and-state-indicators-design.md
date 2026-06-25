# Rules panel + earn-card state indicators

- **Date:** 2026-06-25
- **Repo:** `/opt/rinaudo-extension`
- **Status:** approved design, pre-implementation

## Goal

Two things: (1) show a live "How to earn" rules list in the extension, and (2) give the on-page earn card clear state indicators (eligible / playing / paused / processing / claimed) consistently across all four platforms (X, YouTube, TikTok, Instagram).

## Part A — "How to earn" list (popup + welcome page)

- New shared `rates-list.js` (extension page script) exposes `self.renderRates(el)`: fetches `GET https://s2.jsolutions.dev/api/extension/rates` (public, CORS-open) and renders a compact list into `el` (textContent only).
- **Popup** (`popup/popup.html` + `popup.js`): a "How to earn" container under the Connect button; `popup.js` calls `renderRates` after the auth state.
- **Welcome page** (`welcome.html` + `welcome.js`): replace the static `<ul>` capabilities list with a `renderRates` container.
- Rows from the live values: `Watch the stream {watchtimePerHour}→{watchtimeMaxPerHour}/hr · Watch a video {watchVideo.floor}+ · Like +{like} · Comment +{comment} · Vote +{vote} · Install +{extensionInstall}`, plus a one-line eligibility note ("Earn on his latest posts — X, YouTube, TikTok & Instagram"). Auto-updates when Mizkif retunes the economy (live fetch).
- `package.sh`: add `rates-list.js` to `SHARED`. Both pages include it via `<script>` (relative path differs: `../rates-list.js` from popup, `rates-list.js` from welcome). No manifest change (these are extension pages, not content scripts).

## Part B — earn-card state indicators (all 4 platforms)

**Architecture:** migrate `x.js` + `youtube.js` onto the shared `engage-core` engine as thin adapters (like `tiktok.js`/`instagram.js`), so all four platforms share one card + one set of indicators. Removes the duplicate widget code in `x.js`/`youtube.js`. Selectors are preserved verbatim from the current files.

**Adapters (pure ref fn + selectors):**
- `x.js` → `{ platform:'x', actions:{like,comment}, refFromPath(p)=/\/status\/(\d+)/, isLiked=[data-testid="unlike"], commentSubmitTarget=[data-testid="tweetButton"|"tweetButtonInline"], commentText=[data-testid^="tweetTextarea_"] }`
- `youtube.js` → `{ platform:'youtube', actions:{watch,like,comment}, refFromUrl(href) handles ?v= and /shorts/<id>, isLiked=like button aria-pressed, commentSubmitTarget=#submit-button variants, commentText=ytd-commentbox #contenteditable-root, getVideoEl }`
- Manifest: add `content/engage-core.js` to the `x.js` and `youtube.js` content-script `js` arrays in both manifests.

**State model in `engage-core`:** each action row has a state — `idle` → `pending` → `done`; watch has `playing` / `paused` derived from focus+play. The card renders:
- **Eligible** — card only appears on an active target; green dot + "Earn tickets" header.
- **Watch · playing/paused** — accruing: `▶ Watch m:ss / m:ss  +N`; paused/unfocused: `⏸ Watch m:ss / m:ss · paused` (greyed, not counting).
- **Processing** — like/comment/claim in flight: `⋯` on that row.
- **Claimed** — `✓ Like +1` / `✓ Watched +N` (green). Collapsed pill shows the running total `+N`.
- `fireEngagement(action)`: set row `pending` + redraw → await SW → `done` on credited, back to `idle` on failure. `claimWatch`: `pending` while claiming.

Not-connected case is out of scope for the card (eligibility needs a bearer; the "!" badge + popup already nudge connection).

## Testing

- `node --check` all touched JS; extend the framework-free ref tests for the new `x`/`youtube` adapters (`refFromPath`/`refFromUrl`); `package.sh` build + confirm `rates-list.js` + `engage-core.js` ship and the x/youtube content scripts load engage-core.
- DOM detection + the live rules fetch can't be verified here — the user loads unpacked and confirms the popup list renders + the card states behave; selectors already proven (carried over verbatim).

## Risks

- Migrating `x.js`/`youtube.js` touches working code; mitigated by preserving selectors verbatim + user re-test.
- `engage-core`'s like-poll is 5s (X was 1s) — slightly slower like detection on X, acceptable.

## Out of scope

Not-connected eligibility card; Facebook; the in-widget rules toggle (rules live in popup + welcome only).
