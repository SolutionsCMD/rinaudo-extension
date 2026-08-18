# Highlight eligible videos on YouTube and TikTok profile grids

Owner, 2026-08-18: the earn rows send members to @Mizkif / @MizkifLive / @realmizkif
profile pages, where nothing tells them which tiles actually pay. Ring the eligible
videos in the grid the same way we ring buttons. Decisions taken: ring EVERY eligible
tile (collected ones included, as a progress board), badge shows the exact ticket
amount, and the treatment is LOUD — the same pulsing gold ring as the button rings,
no calmer grid variant.

## Facts established (verified, do not re-derive)

- Content scripts already match all of `youtube.com/*`, `m.youtube.com/*`,
  `tiktok.com/*`, `m.tiktok.com/*` (manifest v1.138) — profile pages included, no new
  host permissions, no new API scopes. Store review sees only a new content file.
- The full target list is one message away from ANY content script:
  `chrome.runtime.sendMessage({ type: 's2Targets' })` (engage-core.js:935 uses it).
  Each target carries `platform`, `ref`, `listed`, `reward` (exact per-video watch
  payout — server-computed, minutes x rate with the floor), `done.watch` and the other
  per-user done flags.
- Ring look to clone (engage-core.js buildRing, ~line 310): shadow-DOM host,
  `position:fixed`, z-index 2147483646, `pointer-events:none`, 2px `#C9A766` border,
  radius 12, double gold box-shadow, `rgcRingPulse` 1.8s opacity pulse,
  `prefers-reduced-motion` disables the pulse, badge = gold pill top-right. rAF
  follow loop; expensive re-resolve throttled to ~500ms; ANY throw tears everything
  down (no ring beats a broken page).
- Ref extraction already exists per platform:
  - YouTube `A.refFromUrl(href)`: `/shorts/<id>` path or `?v=` param (youtube.js).
  - TikTok `refFromPath(pathname)` (tiktok.js) — profile tiles link to
    `/@handle/video/<id>`.
- House constraint: every change MUST keep working on mobile Firefox
  ([[extension-low-upkeep-mobile]]); rings already run there (the follow-loop comment
  says desktop and mobile Firefox alike).

## Design

New shared content module `content/grid-highlight.js`, added to the YouTube and TikTok
content-script groups only (after the adapter file so it can reuse its ref parser via a
window-scoped hook, or duplicate the two tiny parsers locally — prefer local copies:
adapters are IIFEs that do not export, and two 5-line parsers beat refactoring the
adapter contract).

Behaviour:

1. On load and on SPA navigation, fetch `s2Targets` once, build
   `Map<ref, {reward, watchDone}>` from targets where `platform` matches AND
   `listed === true`. The `listed` gate is non-negotiable: ringing a hidden target or a
   honeypot on the public grid would advertise exactly what must stay unadvertised
   (engage-core.js:953 documents the same rule for binding).
2. Scan the page for anchor tiles by HREF SHAPE, never by class name (both sites churn
   class names; href shapes are stable):
   - YouTube: `a[href*="/watch?v="]`, `a[href^="/shorts/"]` — dedupe per enclosing
     tile so one ring per video, not one per nested anchor (thumbnail + title both
     link). Anchor the ring to the tile's thumbnail container when present, else the
     anchor itself.
   - TikTok: `a[href*="/video/"]` on profile grids.
   Extract the ref, look it up in the map, collect `{ el, ref, reward, watchDone }`.
3. Ring every match with the SAME pulsing gold ring as the button rings (owner: loud,
   identical treatment). Badge:
   - not yet watched → `+N` (exact reward from the payload)
   - watch collected → `✓` (still ringed, still pulsing — progress board, owner said
     ring everything; the ✓ badge alone distinguishes it)
4. Lifecycle: single module-scoped Map keyed by ref; MutationObserver (childList,
   subtree) debounced ~500ms triggers re-scan — both sites render grids lazily and
   infinite-scroll; rAF loop repositions existing rings every frame (same pattern and
   budget as button rings: cheap reposition per frame, expensive re-scan throttled).
   Off-viewport tiles hide their ring host (`display:none`, same as positionRing does).
5. SPA navigation: watch `location.href` in the ~500ms re-scan tick (cheapest, no
   yt-specific events needed); on change, tear down all rings and re-fetch targets
   (done flags may have changed after the member watched one and navigated back).
6. Refresh of done state: re-fetch `s2Targets` at most every 60s while the tab is
   visible, so a video watched in another tab flips its badge to ✓ without a reload.
7. Cap: ring at most 12 tiles (more than one screenful) — a bounded worst case on
   endless-scroll pages; nearest-to-viewport wins on re-scan. Watching/collecting
   frees a slot for the next tile at the next scan.
8. Failure contract, verbatim from the button rings: every entry point wrapped; any
   throw → remove all hosts, stop the loop, stay quiet.

Scope guard: the module self-disables (returns early, no observers) on single-video
pages where engage-core binds — YouTube `/watch` and `/shorts/<id>` paths, TikTok
`/@x/video/<id>` — so the two ring systems never double-ring one page. Profile,
home-feed and search grids are all fair game (a ringed tile in search is a feature,
not a bug, and costs nothing extra).

Instagram/Facebook/X are OUT of scope: their earn rows link directly to the post, so
there is no "find it on the profile" step for a grid ring to solve.

## Tasks

1. **`content/grid-highlight.js`** — the module above. Reuse the exact ring CSS text
   from engage-core's buildRing (copy, not import — separate shadow hosts) so the look
   is pixel-identical, badge variant `✓` added.
2. **manifest.json** — add the file to the YouTube and TikTok content-script groups
   (after the adapter). Bump version to 1.139.
3. **Verify on live pages** (Playwright headless is NOT enough here — extension
   content scripts need the real browser): load unpacked in Chrome, check
   youtube.com/@Mizkif (grid rings with correct +N incl. the +55-class long video,
   watch-done shows ✓), youtube.com/@MizkifLive, tiktok.com/@realmizkif; open a video
   from the grid → grid module stays silent, button rings take over; navigate back →
   grid rings return with the watched one flipped to ✓. Scroll hard on TikTok to
   confirm the 12-ring cap and observer-driven re-scan. Then the same sanity pass on
   mobile Firefox (the house rule) — rings position correctly on the mobile grid,
   no horizontal overflow, page still scrolls smoothly.
4. **Store packaging** — build the Chrome + Firefox zips, changelog entry, hand to the
   owner for submission (server changes were instant; this one rides store review).

## Out of scope

- No engine/API change of any kind — the targets payload already carries everything.
- No portal change.
- No highlighting on Instagram/Facebook/X (direct links, see above).
