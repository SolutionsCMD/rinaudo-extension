# Highlight every paying post and every paying control, all platforms

Owner, 2026-08-18: "highlight any posts that give tickets and highlight any button
input box that gives tickets, on all platforms." Same loud treatment as everything else:
the pulsing gold ring (owner picked it over a calmer grid variant on the grid-highlight
work earlier today).

## What already exists (verified, do not rebuild)

- **Button rings on the bound single-post page** (engage-core ringSpecs, ~line 262):
  like / comment / repost / open-share-dialog controls, gold ring + `+N` badge, on every
  platform. All five adapters implement `likeHighlightTarget` and
  `commentHighlightTarget`; x/tiktok/instagram/facebook implement
  `repostHighlightTarget`; tiktok/facebook add `repostDialogHighlightTargets`. YouTube
  has no repost hook because YouTube has no repost action. So "buttons that pay" is DONE
  on the post page — this plan does not touch that machinery except task 3.
- **Grid rings on YouTube + TikTok** (content/grid-highlight.js, shipped 1.139): rings
  eligible video tiles on profiles/feeds/search, `+N` or `✓` badge, `listed===true` gate, MAX 12 rings, href-shape matching, silent on single-post pages.

## The gaps this plan closes

1. Post-level rings exist only on YouTube/TikTok. Missing: X timeline cards, Instagram
   grids/feed, Facebook reels links.
2. The comment INPUT BOX is not ringed — only the comment button is. Owner explicitly
   asked for input boxes.
3. Grid badges show only the watch payout (`t.reward`). On X there is no watch, and
   `reward` degrades to the watch floor (targets route computes `watchReward(t)` =
   floor for a ref with no learned length) — badging an X post `+5` would be a lie.

## Design

### Task 1 — extend grid-highlight.js to X, Instagram, Facebook

Same module, three more platform configs (it is already parameterised by PLATFORM /
TILE_SELECTOR / refFor). Manifest: add `content/grid-highlight.js` to the x, instagram
and facebook content-script groups in ALL THREE manifests (chrome, firefox, safari —
build.sh checks host coverage but not js-list parity; release-checks will catch drift).

Per platform, all matching by HREF SHAPE (never class names):

- **X**: anchor `a[href*="/status/"]` — the card's timestamp link. Ref =
  `/status/(\d+)/` (same regex as x.js `refFromPath`). Ring box: walk up from the
  anchor to the enclosing `article` (the tweet card) rather than the tiny timestamp;
  fall back to the anchor. Skip pages where `/status/\d+` is in the URL path
  (engage-core owns those; same page-split rule as YouTube/TikTok). Quoted tweets nest
  an inner timestamp link — dedupe by ref keeps one ring, and preferring the OUTERMOST
  matching article avoids ringing the quote block inside a card.
- **Instagram**: anchors `a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]`. Ref =
  `/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/` (instagram.js refFromPath). Covers the profile
  grid (tiles are permalink anchors) AND the home feed (the timestamp under each post
  links to the permalink; ring walks up to the enclosing `article`). Single-post rule:
  silent when the URL itself matches `/p|reel|tv/`.
- **Facebook**: anchors `a[href*="/reel/"]`. Ref = `/reel\/(\d+)/`. Silent on
  `/reel/<id>` pages. Facebook feed markup is the most hostile of the five; if the
  anchor walk finds no box ≥40px the tile simply doesn't ring (safe degrade, same as
  everywhere else). Do NOT chase FB's virtualised feed beyond that — the reels TARGETS
  we publish are what members are sent to, and those land on /reel/ pages where
  engage-core already takes over.

### Task 2 — honest badge: what the post still pays in total

`loadTargets` currently keeps `{reward, watchDone}`. Extend to compute, per target,
**the sum of every action still uncollected**, from fields already in the payload:

- watch: `t.reward` where the platform has watch (not X), unless `done.watch`
- like: `likeReward` (X: `xLikeReward`) unless `done.like`
- comment: `commentReward` unless `done.comment`, only if the platform is in
  `commentPlatforms`-equivalent gating the payload exposes (`commentMinWords` presence
  is NOT the gate — use the same `noComment`/reward>0 logic the popup uses; if the
  payload lacks a usable flag, fall back to commentReward>0)
- repost: `repostReward` unless `done.repost`, only where `actions.repost`
- share_send: `shareSendReward` unless `done.shareSend`, tiktok only

Badge = `+total` when anything is left, `✓` when nothing is. This CHANGES the existing
YouTube/TikTok badges (today: watch payout only) — deliberate, one number meaning one
thing everywhere: "this post still pays N". The aria label and the earn-toast copy are
untouched.

Keep `badgeText` pure and exported; extend the test with the X case (no watch), a
partially-collected case, and an all-collected case.

### Task 3 — ring the comment input box (engage-core)

In ringSpecs, alongside the existing comment-button ring: when the comment is
outstanding AND the composer is on screen, ring the composer too. Resolve it with a new
optional adapter hook `commentComposerHighlightTarget()`; default fallback = the first
visible element matching the adapter's own composer detection (`commentInputTarget`
applied to a `document.querySelector` of each adapter's known composer selector is NOT
generic — so the hook is implemented per adapter, five small functions returning the
composer element or null, reusing each adapter's existing COMPOSER_SEL / testid
constants). Key `commentbox`, same badge amount as the comment ring. The ring must not
swallow typing: rings are pointer-events:none overlays, so nothing changes for input.
X caveat: inside the reply modal the composer lives in a dialog — the hook must find it
there too (`[role="dialog"] [data-testid^="tweetTextarea_"]` first, page-level second),
which also gives the modal a visible ring for the path fixed in 1.140.

### Explicitly kept rules

- `listed === true` only — anything the server has not listed must never ring anywhere.
- MAX_RINGS 12 per page, nearest-viewport first (grid module).
- Any throw tears all rings down. No ring beats a broken page.
- Single-post pages: grid module silent, engage-core owns.
- Ring look stays the verbatim clone of engage-core's (one visual language).

## Tasks in order

1. grid-highlight.js: platform table (selector + refFor + single-page test per
   platform), X/IG/FB entries, outermost-article ring-box walk for X/IG.
2. grid-highlight.js: remaining-total badge model (task 2 above) + tests
   (test/grid-highlight.test.mjs: refFor for the three new platforms, page-split rules,
   badge math with partial collection).
3. engage-core: composer ring via `commentComposerHighlightTarget`; implement the hook
   in all five adapters; X modal-dialog resolution.
4. Manifests: grid-highlight.js into x/instagram/facebook groups, all three manifests.
   Version 1.141.
5. `for t in test/*.test.mjs; do node "$t"; done` all green, then `./build.sh` (release
   checks) and `./build.sh --publish` + portal build/restart to put 1.141 on /downloads.
6. Real-browser pass (release-time hand check, can't be headless): X home timeline and
   @REALMizkif profile, IG feed + profile grid, FB reel link from the earn page, plus
   regression on YT/TikTok grids and one bound post per platform for the composer ring.
   Then the same on mobile Firefox (house rule) — composer ring especially, since the
   on-screen keyboard changes viewport height while typing.

## Out of scope

- No engine/server change: every number the badges need is already in the targets
  payload.
- No change to what pays or to crediting paths.
- FB feed coverage beyond reel links (see task 1 rationale).
