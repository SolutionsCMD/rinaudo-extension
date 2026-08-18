// Ring the eligible videos in a YouTube / TikTok GRID (profile, home feed, search).
//
// Why: the desk's earn rows deliberately send members to @Mizkif / @MizkifLive /
// @realmizkif rather than to a direct video link, and once they land there nothing says
// which tiles actually pay. Owner, 2026-08-18: highlight them the same way we highlight
// buttons — every eligible tile, loud, the same pulsing gold ring, badge showing the exact
// ticket amount, and a tick on the ones already collected so the profile reads as a
// progress board.
//
// This is deliberately a SEPARATE module from engage-core's button rings, not a
// generalisation of them. The two never run on the same page (see PAGE SPLIT below), they
// answer different questions ("which post is this" vs "which of these many posts"), and
// keeping engage-core's credit path untouched means a bug here can never cost a member a
// ticket. The ring's look is copied verbatim from engage-core buildRing so the two are
// pixel-identical; if that styling ever changes, change it in both.
//
// Failure contract, same as the button rings: every entry point is wrapped, and ANY throw
// tears every ring down and stays quiet. A page with no rings is always better than a
// broken page.
(() => {
  'use strict';

  // Pure helpers, parameterised by platform and exported for the test harness the same way
  // the adapters export themselves (test/_load.mjs reads self[globalName]). They are the
  // parts most likely to break when a site changes a URL shape, so they are the parts that
  // get tested without a browser.
  function refFor(platform, href, origin) {
    try {
      const u = new URL(href, origin || 'https://example.com');
      if (platform === 'youtube') {
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
        if (u.pathname === '/watch') return u.searchParams.get('v') || '';
        return '';
      }
      const m = u.pathname.match(/^\/@[^/]+\/video\/(\d+)/);
      return m ? m[1] : '';
    } catch { return ''; }
  }
  // On a single-video page engage-core binds the post and draws the button rings, so the
  // grid module stays silent there and the two never double-ring one page.
  function isSingleVideoPath(platform, pathname) {
    const p = pathname || '';
    if (platform === 'youtube') return p === '/watch' || p.startsWith('/shorts/');
    return /^\/@[^/]+\/video\/\d+/.test(p);
  }
  // Owner: ring the collected ones too, as a progress board. The badge is what tells them
  // apart — the exact payout, or a tick once the watch is banked.
  function badgeText(hit) { return hit && hit.watchDone ? '✓' : '+' + ((hit && hit.reward) || 0); }
  try { self.RGC_GRID_HIGHLIGHT = { refFor, isSingleVideoPath, badgeText }; } catch { /* ignore */ }

  const HOST = location.hostname;
  const IS_YT = /(^|\.)youtube\.com$/.test(HOST);
  const IS_TT = /(^|\.)tiktok\.com$/.test(HOST);
  if (!IS_YT && !IS_TT) return;
  const PLATFORM = IS_YT ? 'youtube' : 'tiktok';

  // Look cloned from engage-core.js buildRing. Keep in step with it.
  const RING_GOLD = '#C9A766';
  const RING_CSS = `
    .ring{position:absolute;top:0;left:0;right:0;bottom:0;box-sizing:border-box;
      border:2px solid ${RING_GOLD};border-radius:12px;
      box-shadow:0 0 0 2px rgba(201,167,102,.28),0 0 14px rgba(201,167,102,.55);
      animation:rgcRingPulse 1.8s ease-in-out infinite}
    .badge{position:absolute;top:-11px;right:-11px;min-width:18px;height:20px;padding:0 6px;
      border-radius:999px;background:${RING_GOLD};color:#0E1B2C;
      font:700 12px/20px system-ui,-apple-system,sans-serif;text-align:center;
      box-shadow:0 3px 10px rgba(0,0,0,.45);white-space:nowrap}
    @keyframes rgcRingPulse{0%,100%{opacity:1}50%{opacity:.5}}
    @media (prefers-reduced-motion: reduce){.ring{animation:none}}`;

  // More than a screenful, so scrolling always has ringed tiles ahead of it, but a bounded
  // worst case on an endless-scroll feed. Nearest-to-viewport wins when there are more.
  const MAX_RINGS = 12;
  const RESCAN_MS = 500;        // DOM re-scan + SPA-navigation check (same budget as the button rings)
  const TARGETS_TTL_MS = 60_000; // re-ask for done-flags, so a video watched in another tab flips to ✓

  // Ref parsing mirrors the adapters (youtube.js refFromUrl / tiktok.js refFromPath) rather
  // than importing them: the adapters are IIFEs with no exports, and a short parser beats
  // widening their contract. Matching on HREF SHAPE is the point — both sites churn class
  // names constantly, but these URL shapes are effectively permanent.
  const isSingleVideoPage = () => isSingleVideoPath(PLATFORM, location.pathname);
  const refFromHref = (href) => refFor(PLATFORM, href, location.origin);

  const TILE_SELECTOR = IS_YT
    ? 'a[href*="/watch?v="], a[href^="/shorts/"], a[href*="youtube.com/shorts/"]'
    : 'a[href*="/video/"]';

  // The box to ring: the tile's thumbnail rather than the whole anchor, so the ring hugs
  // the image instead of swallowing the title and channel line beneath it. Falls back to
  // the anchor when no thumbnail wrapper is recognisable.
  function ringBox(anchor) {
    try {
      const img = anchor.querySelector('img');
      if (img) {
        // Walk up from the image to the largest ancestor still inside the anchor: that is
        // the thumbnail frame on both sites, whatever it happens to be called this week.
        let box = img;
        while (box.parentElement && box.parentElement !== anchor
               && anchor.contains(box.parentElement)) box = box.parentElement;
        const r = box.getBoundingClientRect();
        if (r.width > 40 && r.height > 40) return box;
      }
    } catch { /* fall through */ }
    return anchor;
  }

  let eligible = new Map();   // ref -> { reward, watchDone }
  let targetsAt = 0;
  let rings = new Map();      // ref -> { host, ring, badge, el, last }
  let raf = 0;
  let lastScan = 0;
  let lastHref = location.href;
  let observer = null;
  let scrollHooked = false;
  let stopped = false;

  async function loadTargets(force) {
    const now = Date.now();
    if (!force && eligible.size && now - targetsAt < TARGETS_TTL_MS) return;
    const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
    if (!data || !Array.isArray(data.targets)) return; // keep whatever we had; never clear on a blip
    const next = new Map();
    for (const t of data.targets) {
      // `listed === true` ONLY. A hidden target is deliberately unadvertised and a honeypot
      // is bait for scripted claimers — a gold ring on either would advertise exactly what
      // must stay quiet. Same gate engage-core uses before binding a post, and a payload
      // with no `listed` field counts as unlisted.
      if (t.platform !== PLATFORM || t.listed !== true || !t.ref) continue;
      next.set(String(t.ref), {
        reward: Number(t.reward) || 0,
        watchDone: !!(t.done && t.done.watch),
      });
    }
    eligible = next;
    targetsAt = now;
  }

  function buildRing(ref) {
    const host = document.createElement('div');
    host.id = 'rgc-grid-' + ref;
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;margin:0;padding:0;display:none';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = RING_CSS;
    const ring = document.createElement('div'); ring.className = 'ring';
    const badge = document.createElement('span'); badge.className = 'badge';
    ring.appendChild(badge); shadow.append(style, ring);
    (document.body || document.documentElement).appendChild(host);
    return { host, ring, badge, el: null, last: null };
  }

  function positionRing(r) {
    if (!r || !r.el) return;
    // A tile removed by the site's own virtualiser must not leave a ring floating over
    // nothing; the next scan drops it, this hides it immediately.
    if (!r.el.isConnected) { if (r.host.style.display !== 'none') r.host.style.display = 'none'; return; }
    const rect = r.el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const offscreen = (rect.width === 0 && rect.height === 0)
      || rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw;
    if (offscreen) { if (r.host.style.display !== 'none') r.host.style.display = 'none'; return; }
    const pad = 6;
    const left = Math.round(rect.left - pad), top = Math.round(rect.top - pad);
    const w = Math.round(rect.width + pad * 2), h = Math.round(rect.height + pad * 2);
    const last = r.last;
    if (r.host.style.display === 'block' && last
        && last.left === left && last.top === top && last.w === w && last.h === h) return;
    r.host.style.display = 'block';
    r.host.style.left = left + 'px'; r.host.style.top = top + 'px';
    r.host.style.width = w + 'px'; r.host.style.height = h + 'px';
    r.last = { left, top, w, h };
  }

  // What SHOULD be ringed right now: [{ ref, el, txt }], nearest-to-viewport first so the
  // cap keeps the rings the member can actually see.
  function scanSpecs() {
    const out = [];
    if (!eligible.size) return out;
    const seen = new Set();
    const vh = window.innerHeight;
    let anchors;
    try { anchors = document.querySelectorAll(TILE_SELECTOR); } catch { return out; }
    for (const a of anchors) {
      const ref = refFromHref(a.getAttribute('href') || '');
      if (!ref || seen.has(ref)) continue;      // one ring per video, not per nested anchor
      const hit = eligible.get(ref);
      if (!hit) continue;
      const el = ringBox(a);
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue; // collapsed / not laid out yet
      seen.add(ref);
      out.push({
        ref, el,
        txt: badgeText(hit),
        dist: rect.top < 0 ? -rect.top : (rect.top > vh ? rect.top - vh : 0),
      });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, MAX_RINGS);
  }

  function reconcile() {
    const specs = scanSpecs();
    const want = new Set(specs.map((s) => s.ref));
    for (const ref of Array.from(rings.keys())) {
      if (!want.has(ref)) { try { rings.get(ref).host.remove(); } catch { /* ignore */ } rings.delete(ref); }
    }
    for (const s of specs) {
      let r = rings.get(s.ref);
      if (!r) { r = buildRing(s.ref); rings.set(s.ref, r); }
      if (r.el !== s.el) { r.el = s.el; r.last = null; }
      if (r.badge.textContent !== s.txt) r.badge.textContent = s.txt;
      positionRing(r);
    }
    return rings.size > 0;
  }

  function teardown() {
    if (raf) { try { cancelAnimationFrame(raf); } catch { /* ignore */ } raf = 0; }
    rings.forEach((r) => { try { r.host.remove(); } catch { /* ignore */ } });
    rings.clear();
  }

  function stopAll() {
    stopped = true;
    teardown();
    if (observer) { try { observer.disconnect(); } catch { /* ignore */ } observer = null; }
    if (scrollHooked) {
      try { window.removeEventListener('scroll', onScroll, { capture: true }); } catch { /* ignore */ }
      try { window.removeEventListener('resize', onScroll); } catch { /* ignore */ }
      scrollHooked = false;
    }
  }

  function onScroll() { try { rings.forEach(positionRing); } catch { stopAll(); } }

  function tick() {
    raf = 0;
    try {
      // Cheap every frame: keep every ring hugging its tile. Expensive re-scan throttled.
      rings.forEach(positionRing);
      const now = Date.now();
      if (now - lastScan >= RESCAN_MS) {
        lastScan = now;
        // SPA navigation: cheapest reliable signal on both sites, no site-specific events.
        if (location.href !== lastHref) {
          lastHref = location.href;
          teardown();
          if (isSingleVideoPage()) { schedule(); return; }
          // Done-flags may have moved while they were away on the video page.
          void loadTargets(true).then(() => { try { reconcile(); } catch { stopAll(); } });
          schedule();
          return;
        }
        if (isSingleVideoPage()) { teardown(); schedule(); return; }
        void loadTargets(false);
        reconcile();
      }
    } catch { stopAll(); return; }
    schedule();
  }

  // The loop must keep running even with zero rings on screen: on these SPAs the grid
  // arrives after navigation, and a loop that stopped at "nothing to ring" would never see
  // it. rAF is already throttled to ~0 in a background tab, so an idle loop costs nothing.
  function schedule() {
    if (stopped || raf) return;
    raf = requestAnimationFrame(tick);
  }

  function start() {
    try {
      if (!scrollHooked) {
        window.addEventListener('scroll', onScroll, { passive: true, capture: true });
        window.addEventListener('resize', onScroll, { passive: true });
        scrollHooked = true;
      }
      if (!observer) {
        // Both sites render grids lazily and virtualise on infinite scroll. The observer
        // only nudges the next tick to re-scan sooner; it never scans inline, so a burst of
        // mutations cannot turn into a burst of DOM work.
        observer = new MutationObserver(() => { lastScan = 0; });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      void loadTargets(true).then(() => { try { reconcile(); } catch { stopAll(); } });
      schedule();
    } catch { stopAll(); }
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else start();
  } catch { /* stay quiet */ }
})();
