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
  // One table per platform. Every ref is read from the LINK SHAPE, never from a class
  // name: both the markup and the class names on all five sites churn constantly, while
  // these URL shapes are effectively permanent. Each `single` test marks the page where
  // engage-core binds the post itself, so the two ring systems never share a page.
  const PLATFORMS = {
    youtube: {
      sel: 'a[href*="/watch?v="], a[href^="/shorts/"], a[href*="youtube.com/shorts/"]',
      ref: (u) => (u.pathname.startsWith('/shorts/') ? (u.pathname.split('/')[2] || '')
        : u.pathname === '/watch' ? (u.searchParams.get('v') || '') : ''),
      single: (p) => p === '/watch' || p.startsWith('/shorts/'),
    },
    tiktok: {
      sel: 'a[href*="/video/"]',
      ref: (u) => (u.pathname.match(/^\/@[^/]+\/video\/(\d+)/) || [])[1] || '',
      single: (p) => /^\/@[^/]+\/video\/\d+/.test(p),
    },
    x: {
      // The card's timestamp link is the only stable permalink on a timeline tweet.
      sel: 'a[href*="/status/"]',
      ref: (u) => (u.pathname.match(/\/status\/(\d+)/) || [])[1] || '',
      single: (p) => /\/status\/\d+/.test(p),
      card: 'article',
    },
    instagram: {
      // Profile grid tiles AND the feed's permalink/timestamp link are both these shapes.
      sel: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
      ref: (u) => (u.pathname.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1] || '',
      single: (p) => /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/.test(p),
      card: 'article',
    },
    facebook: {
      // Every post shape, not just /reel/. The targets ARE reels, but Facebook does not
      // link to them as reels everywhere: on his page the same reel appears in the Posts
      // feed as /<page>/videos/<id> or a ?v= watch link, so a reel-only selector matched
      // nothing there and his profile highlighted none of them (owner, 2026-08-19).
      // These are exactly the shapes facebook.js getRef already accepts, kept in step so
      // a page the grid module rings is a page engage-core can then bind.
      sel: 'a[href*="/reel/"], a[href*="/videos/"], a[href*="/posts/"], a[href*="v="], a[href*="story_fbid="]',
      ref: (u) => {
        const path = u.pathname || '';
        let m = path.match(/\/reel\/(\d+)/);
        if (m) return m[1];
        m = path.match(/\/[^/]+\/videos\/(\d+)/);
        if (m) return m[1];
        m = path.match(/\/[^/]+\/posts\/([^/?#]+)/);
        if (m) return m[1];
        // Read from the URL's own params, never a regex over the whole href: a
        // ?comment_id= or a tracking param carries digits too, and the last long number
        // in a link is not the post.
        const v = u.searchParams.get('v');
        if (v && /^\d+$/.test(v)) return v;
        const story = u.searchParams.get('story_fbid');
        if (story && /^\d+$/.test(story)) return story;
        return '';
      },
      single: (p) => /^\/reel\/\d+/.test(p) || /^\/[^/]+\/(videos|posts)\//.test(p) || /^\/watch\/?$/.test(p),
    },
  };

  function refFor(platform, href, origin) {
    try {
      const cfg = PLATFORMS[platform];
      if (!cfg) return '';
      return cfg.ref(new URL(href, origin || 'https://example.com')) || '';
    } catch { return ''; }
  }
  // On a single-post page engage-core binds the post and draws the button rings, so the
  // grid module stays silent there and the two never double-ring one page.
  function isSingleVideoPath(platform, pathname) {
    const cfg = PLATFORMS[platform];
    return cfg ? !!cfg.single(pathname || '') : false;
  }
  // What this post STILL pays this member: every action the platform offers, at its real
  // rate, minus what they have already collected. One number meaning one thing on all five
  // platforms. It replaced badging the watch payout alone, which was fine on YouTube but a
  // lie on X — X has no watch, and the payload's per-target `reward` degrades to the watch
  // floor for a ref with no learned length, so an X post would have advertised a watch
  // reward that does not exist.
  function remainingFor(t, rates) {
    if (!t) return 0;
    const a = t.actions || {}, done = t.done || {}, r = rates || {};
    const isX = t.platform === 'x';
    const n = (v) => (Number(v) > 0 ? Number(v) : 0);
    let total = 0;
    if (a.watch && !done.watch) total += n(t.reward);
    if (a.like && !done.like) total += n(isX ? r.xLikeReward : r.likeReward);
    // `actions.comment` already has the server's per-platform comment switch applied.
    if (a.comment && !done.comment) total += n(isX ? r.xCommentReward : r.commentReward);
    if (a.repost && !done.repost) total += n(r.repostReward);
    if (a.shareSend && !done.shareSend) total += n(r.shareSendReward);
    return total;
  }
  // Owner: ring the collected ones too, as a progress board. The badge is what tells them
  // apart — what is still on the table, or a tick once nothing is.
  function badgeText(hit) {
    const left = hit && Number(hit.remaining) > 0 ? Number(hit.remaining) : 0;
    return left > 0 ? '+' + left : '✓';
  }
  try { self.RGC_GRID_HIGHLIGHT = { refFor, isSingleVideoPath, badgeText, remainingFor }; } catch { /* ignore */ }

  const HOST = location.hostname;
  const PLATFORM =
      /(^|\.)youtube\.com$/.test(HOST) ? 'youtube'
    : /(^|\.)tiktok\.com$/.test(HOST) ? 'tiktok'
    : /(^|\.)(x|twitter)\.com$/.test(HOST) ? 'x'
    : /(^|\.)(instagram\.com|instagr\.am)$/.test(HOST) ? 'instagram'
    : /(^|\.)facebook\.com$/.test(HOST) ? 'facebook'
    : '';
  if (!PLATFORM) return;
  const CFG = PLATFORMS[PLATFORM];

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

  const TILE_SELECTOR = CFG.sel;

  const MIN_BOX = 40; // below this the tile is collapsed or not laid out yet

  // What the ring should hug. Two shapes, because the five sites split cleanly:
  //  - GRID sites (YouTube, TikTok, Instagram profile): the anchor IS the tile, so ring
  //    its thumbnail rather than the anchor, or the ring swallows the title beneath it.
  //  - CARD sites (X, Instagram feed): the anchor is a tiny timestamp permalink, so ring
  //    the enclosing post card instead — a 20px ring on a date would be useless.
  // Anything unresolvable falls back to the anchor, and a box under MIN_BOX is skipped by
  // the caller, so a layout we do not recognise simply does not ring.
  function ringBox(anchor) {
    try {
      if (CFG.card) {
        // OUTERMOST matching card: a quoted tweet nests an <article> inside the real one,
        // and ringing the quote block instead of the tweet would point at the wrong post.
        let card = null;
        for (let el = anchor.parentElement; el; el = el.parentElement) {
          if (el.matches && el.matches(CFG.card)) card = el;
        }
        if (card) {
          const cr = card.getBoundingClientRect();
          if (cr.width > MIN_BOX && cr.height > MIN_BOX) return card;
        }
      }
      const img = anchor.querySelector('img');
      if (img) {
        // Walk up from the image to the largest ancestor still inside the anchor: that is
        // the thumbnail frame on these sites, whatever it happens to be called this week.
        let box = img;
        while (box.parentElement && box.parentElement !== anchor
               && anchor.contains(box.parentElement)) box = box.parentElement;
        const r = box.getBoundingClientRect();
        if (r.width > MIN_BOX && r.height > MIN_BOX) return box;
      }
    } catch { /* fall through */ }
    return anchor;
  }

  let eligible = new Map();   // ref -> { remaining }
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
      // `listed === true` ONLY. The server decides what may be shown to a member, and a
      // target it has not listed must never be surfaced anywhere in the UI. Same gate
      // engage-core uses before binding a post, and a payload with no `listed` field
      // counts as unlisted.
      if (t.platform !== PLATFORM || t.listed !== true || !t.ref) continue;
      next.set(String(t.ref), { remaining: remainingFor(t, data) });
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
      if (rect.width < MIN_BOX || rect.height < MIN_BOX) continue; // collapsed / not laid out yet
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
