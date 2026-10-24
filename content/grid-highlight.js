(() => {
  'use strict';

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
      sel: 'a[href*="/status/"]',
      ref: (u) => (u.pathname.match(/\/status\/(\d+)/) || [])[1] || '',
      single: (p) => /\/status\/\d+/.test(p),
      card: 'article',
    },
    instagram: {
      sel: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
      ref: (u) => (u.pathname.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1] || '',
      single: (p) => /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/.test(p),
      card: 'article',
    },
    facebook: {
      sel: 'a[href*="/reel/"]',
      ref: (u) => (u.pathname.match(/\/reel\/(\d+)/) || [])[1] || '',
      single: (p) => /^\/reel\/\d+/.test(p) || /^\/[^/]+\/(videos|posts)\//.test(p) || /^\/watch\/?$/.test(p),
      grow: true,
    },
  };

  function refFor(platform, href, origin) {
    try {
      const cfg = PLATFORMS[platform];
      if (!cfg) return '';
      return cfg.ref(new URL(href, origin || 'https://example.com')) || '';
    } catch { return ''; }
  }
  function refCandidates(platform, href, origin) {
    const primary = refFor(platform, href, origin);
    return primary ? [primary] : [];
  }

  function isSingleVideoPath(platform, pathname) {
    const cfg = PLATFORMS[platform];
    return cfg ? !!cfg.single(pathname || '') : false;
  }
  function payRows(t, rates) {
    const out = [];
    if (!t) return out;
    const a = t.actions || {}, done = t.done || {}, r = rates || {};
    const isX = t.platform === 'x';
    const n = (v) => (Number(v) > 0 ? Number(v) : 0);
    const add = (label, v) => { if (v > 0) out.push({ label, n: v }); };
    if (a.watch && !done.watch) add('Watch', n(t.reward));
    if (a.like && !done.like) add('Like', n(isX ? r.xLikeReward : r.likeReward));
    if (a.comment && !done.comment) add('Comment', n(isX ? r.xCommentReward : r.commentReward));
    if (a.repost && !done.repost) add('Repost', n(r.repostReward));
    if (a.shareSend && !done.shareSend) add('Share', n(r.shareSendReward));
    if (a.commentLike) add('Comment likes', Math.max(0, n(r.commentLikeMax) - n(done.commentLike)) * n(r.commentLikeReward));
    if (out.length && !done.bonus && n(r.engageBonusReward) > 0
        && !(a.repost && r.repostBlocked) && !(a.shareSend && r.sendBlocked)) add('Do it all', n(r.engageBonusReward));
    return out;
  }
  function remainingFor(t, rates) {
    return payRows(t, rates).reduce((sum, row) => sum + row.n, 0);
  }
  function badgeText(hit) {
    const left = hit && Number(hit.remaining) > 0 ? Number(hit.remaining) : 0;
    return left > 0 ? '+' + left : '✓';
  }

  const RATE_KEYS = ['likeReward', 'commentReward', 'xLikeReward', 'xCommentReward',
    'repostReward', 'shareSendReward', 'commentLikeReward', 'commentLikeMax', 'engageBonusReward'];
  function effectiveRates(data, caps) {
    const r = {};
    for (const k of RATE_KEYS) r[k] = data ? data[k] : undefined;
    const c = caps || {};
    if (c.shareHidden === true || c.repost === false) { r.repostReward = 0; r.repostBlocked = true; }
    if (c.send === false) { r.shareSendReward = 0; r.sendBlocked = true; }
    if (c.commentLike === false) r.commentLikeReward = 0;
    return r;
  }
  function eligibleFrom(data, platform, caps) {
    const out = new Map();
    if (!data || !Array.isArray(data.targets)) return out;
    const rates = effectiveRates(data, caps);
    for (const t of data.targets) {
      if (!t || t.platform !== platform || t.listed !== true || !t.ref) continue;
      const rows = payRows(t, rates);
      out.set(String(t.ref), { remaining: rows.reduce((sum, row) => sum + row.n, 0), rows });
    }
    return out;
  }

  const TIMING = Object.freeze({
    debounceMs: 500,
    maxWaitMs: 2500,
    scrollQuietMs: 300,
    ttlMs: 60000,
    emptyTtlMs: 120000,
    minGapMs: 5000,
    retryMs: 15000,
    maxRetryMs: 300000,
    inflightMaxMs: 30000,
  });

  function createScheduler(run, opts) {
    const o = opts || {};
    const delay = Math.max(500, Number(o.delayMs) || TIMING.debounceMs);
    const maxWait = Math.max(delay, Number(o.maxWaitMs) || TIMING.maxWaitMs);
    const now = o.now || (() => Date.now());
    let timer = 0, armed = false, burstAt = 0, lastAt = 0, paused = false, dirty = false;
    function arm(ms) { armed = true; timer = setTimeout(fire, ms); }
    function poke() {
      if (paused) { dirty = true; return; }
      const t = now();
      lastAt = t;
      if (!armed) { burstAt = t; arm(delay); }
    }
    function fire() {
      armed = false; timer = 0;
      if (paused) { dirty = true; return; }
      const t = now();
      const quiet = t - lastAt, waited = t - burstAt;
      if (quiet < delay && waited < maxWait) {
        arm(Math.max(1, Math.min(delay - quiet, maxWait - waited)));
        return;
      }
      run();
    }
    function stopTimer() {
      if (armed) { try { clearTimeout(timer); } catch {   } }
      armed = false; timer = 0;
    }
    function pause() {
      if (paused) return;
      paused = true;
      if (armed) { stopTimer(); dirty = true; }
    }
    function resume() {
      if (!paused) return;
      paused = false;
      if (dirty) { dirty = false; poke(); }
    }
    function cancel() { stopTimer(); dirty = false; }
    return { poke, pause, resume, cancel, pending: () => armed, paused: () => paused };
  }

  const DEAD_RE = /context invalidated/i;
  function createTargetLoader(send, opts) {
    const o = opts || {};
    const T = Object.assign({}, TIMING, o.timing || {});
    const now = o.now || (() => Date.now());
    let data = null, loaded = false, loadedAt = 0, sent = false, sentAt = 0;
    let retryAt = 0, backoff = 0, inflight = null, seq = 0, dead = false, sends = 0;
    const idle = () => Promise.resolve(false);
    const ttl = () => (data && data.targets.length ? T.ttlMs : T.emptyTtlMs);
    function fail(t) {
      backoff = backoff ? Math.min(backoff * 2, T.maxRetryMs) : T.retryMs;
      retryAt = t + backoff;
    }
    function settle(my, d, err) {
      if (my !== seq) return false;
      inflight = null;
      const t = now();
      if (err && DEAD_RE.test(String((err && err.message) || err))) {
        dead = true;
        try { if (o.onDead) o.onDead(); } catch {   }
        return false;
      }
      if (!err && d && Array.isArray(d.targets) && (!d.error || d.connected === false)) {
        data = d; loaded = true; loadedAt = t; backoff = 0; retryAt = 0;
        return true;
      }
      fail(t);
      return false;
    }
    function load(force) {
      if (dead) return idle();
      const t = now();
      if (inflight) {
        if (t - sentAt < T.inflightMaxMs) return inflight;
        inflight = null; seq++; fail(t);
      }
      if (t < retryAt) return idle();
      if (sent && t - sentAt < T.minGapMs) return idle();
      if (!force && loaded && t - loadedAt < ttl()) return idle();
      const my = ++seq;
      sent = true; sentAt = t; sends++;
      let p;
      try { p = Promise.resolve(send()); } catch (e) { p = Promise.reject(e); }
      inflight = p.then((d) => settle(my, d, null), (e) => settle(my, null, e || new Error('send failed')));
      return inflight;
    }
    function invalidate() {
      loaded = false; sent = false; retryAt = 0; backoff = 0;
      if (inflight) { inflight = null; seq++; }
    }
    return {
      load, invalidate,
      data: () => data,
      stats: () => ({ sends, backoff, retryAt, loaded, inflight: !!inflight, dead }),
    };
  }

  const TICKET_AR = 111 / 200;
  const GRID_INSET = 8;
  function badgeSize(rect, card, done) {
    const base = card ? Math.min(Number(rect && rect.width) || 0, 250) : (Number(rect && rect.width) || 0);
    const w = Math.round(done ? Math.max(22, Math.min(64, base * 0.16)) : Math.max(44, Math.min(140, base * 0.28)));
    return { w, h: done ? w : Math.round(w * TICKET_AR), font: Math.max(11, Math.round(w * 0.26)) };
  }
  function badgePos(rect, card, w, h, vw, vh) {
    const x0 = card ? rect.right - w - 10 : rect.right - w - GRID_INSET;
    const y = Math.round(card ? rect.top - h / 2 : rect.top + GRID_INSET);
    const x = Math.round(Math.min(Math.max(x0, 4), Math.max(4, vw - w - 4)));
    const onScreen = y >= 0 && y + h <= vh
      && x >= rect.left - 1 && x + w <= rect.right + 1
      && rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
    return { x, y, onScreen };
  }

  function relatedHit(hit, anchor, box, rect) {
    if (!hit) return false;
    try {
      if (hit === anchor || hit === box) return true;
      if ((box && box.contains(hit)) || (anchor && anchor.contains(hit))) return true;
      if (box && hit.contains(box)) return true;
      const up = new Set();
      for (let n = hit, i = 0; n && i < 60; n = n.parentElement, i++) up.add(n);
      let lca = null;
      for (let n = anchor, i = 0; n && i < 60; n = n.parentElement, i++) { if (up.has(n)) { lca = n; break; } }
      if (!lca) return false;
      let r = lca.getBoundingClientRect();
      for (let n = lca, i = 0; (!(r.width > 0) || !(r.height > 0)) && n.parentElement && i < 20; i++) {
        n = n.parentElement;
        r = n.getBoundingClientRect();
      }
      if (!(r.width > 0) || !(r.height > 0)) return false;
      return r.width <= rect.width * 1.5 + 32 && r.height <= rect.height * 3 + 32;
    } catch { return true; }
  }

  try {
    self.RGC_GRID_HIGHLIGHT = {
      refFor, refCandidates, isSingleVideoPath, badgeText, remainingFor, payRows,
      effectiveRates, eligibleFrom, createScheduler, createTargetLoader, badgePos, badgeSize, relatedHit, TIMING,
    };
  } catch {   }

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


  const HOST_ID = 'rgc-tiles';
  const ORPHANS = '[id^="rgc-grid-"], #' + HOST_ID;
  const MIN_BOX = 40;
  const MAX_BADGES = 24;
  const PLAIN_W = 46, PLAIN_H = 24;
  const POP_RATIO = 0.6;
  const POP_MS = 900;
  const POP_EASE = 'cubic-bezier(.2,1.4,.4,1)';
  const TIP_W = 250;
  const ADAPTER_GLOBAL = { youtube: 'RGC_YT_ADAPTER', tiktok: 'RGC_TIKTOK_ADAPTER',
    instagram: 'RGC_IG_ADAPTER', facebook: 'RGC_FB_ADAPTER', x: 'RGC_X_ADAPTER' };

  const CSS = [
    '.w{all:initial;position:absolute;left:0;top:0;width:0;height:0;overflow:visible;',
    'pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;',
    'font-size:14px;font-weight:900;line-height:1;letter-spacing:0;direction:ltr;text-align:center;color:#fff}',
    '.w.off{visibility:hidden}',
    '.b{position:absolute;left:0;top:0;margin:0;padding:0;box-sizing:border-box;pointer-events:none;',
    'user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}',
    '.b.i{pointer-events:auto;cursor:pointer}',
    '.in{position:absolute;left:0;top:0;right:0;bottom:0;transform-origin:85% 15%}',
    '.b img{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;',
    'max-width:none;display:block;object-fit:contain;pointer-events:none}',
    '.b span{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;',
    'justify-content:center;font-weight:900;line-height:1;color:#fff;white-space:nowrap;letter-spacing:-.5px;',
    'text-shadow:0 2px 4px rgba(0,0,0,.7),0 0 2px #000;pointer-events:none}',
    '.b.plain .in{border-radius:6px;background:#d6002f;border:1.5px solid #fff}',
    '.b.plain.ok .in{background:#1a7f37}',
    '.b.plain span{font-size:12px;font-weight:800;text-shadow:none}',
    '.tip{position:absolute;left:0;top:0;width:' + TIP_W + 'px;padding:14px 16px 34px;box-sizing:border-box;',
    'color:#14171c;font-size:13px;line-height:19px;font-weight:600;text-align:left;pointer-events:none;',
    'opacity:0;visibility:hidden;transition:opacity .15s,visibility 0s linear .15s}',
    '.tip.show{opacity:1;visibility:visible;transition:opacity .15s}',
    '.tip.below{padding:34px 16px 14px}',
    '.tip .bg{position:absolute;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none}',
    '.tip.below .bg{transform:scaleY(-1)}',
    '.tip strong{display:block;font-size:14px;line-height:19px;font-weight:800;margin-bottom:2px}',
    '.tip .r{display:flex;justify-content:space-between;gap:12px}',
    '.tip .r span:last-child{font-weight:900;color:#b3002a}',
  ].join('');
  const HOST_STYLE = 'position:fixed!important;left:0!important;top:0!important;width:0!important;'
    + 'height:0!important;margin:0!important;padding:0!important;border:0!important;'
    + 'overflow:visible!important;z-index:2147483646!important;pointer-events:none!important;'
    + 'display:block!important;visibility:visible!important;opacity:1!important;transform:none!important';

  let stopped = false;
  let lastHref = location.href;
  let lastScrollAt = -Infinity;
  let shareHidden = false;
  let mode = '';
  let gridObs = null, navObs = null;
  let host = null, wrap = null, shown = true;
  const badges = new Map();
  let elig = new Map(), eligData = null, eligShare = null;
  let popped = new Set(), popWant = new Set();
  let io = null;
  let tileRef = typeof WeakMap === 'function' ? new WeakMap() : null;
  let tipEl = null, tipBody = null, tipRef = '', offTipOutside = null;

  const sched = createScheduler(() => cycle());
  const loader = createTargetLoader(sendTargets, { onDead: stopAll });
  try {
    if (self.RGC_GRID_HIGHLIGHT) {
      self.RGC_GRID_HIGHLIGHT.shared = { loader, eligible: () => currentEligible(), platform: PLATFORM };
    }
  } catch {   }

  function sendTargets() {
    const rt = typeof chrome !== 'undefined' && chrome ? chrome.runtime : null;
    if (!rt || ('id' in rt && !rt.id)) throw new Error('Extension context invalidated.');
    return rt.sendMessage({ type: 's2Targets' });
  }

  function asset(name) {
    try {
      const A = self.RGCGuideAssets;
      const t = A && (A[name] || (A.img && A.img[name]));
      return typeof t === 'string' && t.indexOf('data:image/') === 0 ? t : '';
    } catch { return ''; }
  }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  }
  function finePointer() {
    try { return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch { return false; }
  }

  function capsNow() {
    const caps = { shareHidden };
    try {
      const A = self[ADAPTER_GLOBAL[PLATFORM]];
      if (A) {
        caps.repost = typeof A.repostTarget === 'function';
        caps.send = typeof A.sendTarget === 'function';
        caps.commentLike = A.commentLikeConfirmNetwork
          ? typeof A.commentLikeTarget === 'function' : typeof A.commentLikeScan === 'function';
      }
    } catch {   }
    return caps;
  }

  function currentEligible() {
    const d = loader.data();
    if (d !== eligData || shareHidden !== eligShare) {
      eligData = d; eligShare = shareHidden;
      elig = eligibleFrom(d, PLATFORM, capsNow());
    }
    return elig;
  }

  function tileBox(anchor) {
    try {
      const own = anchor.getBoundingClientRect();
      if (CFG.grow && (own.width < MIN_BOX || own.height < MIN_BOX)) {
        const vh = window.innerHeight || 800;
        let el = anchor.parentElement;
        for (let hops = 0; el && hops < 16; el = el.parentElement, hops++) {
          const r = el.getBoundingClientRect();
          if (r.height > vh * 1.8) break;
          if (r.width >= 260 && r.height >= 180) return { el, card: true };
        }
      }
      if (CFG.card) {
        let card = null;
        for (let el = anchor.parentElement; el; el = el.parentElement) {
          if (el.matches && el.matches(CFG.card)) card = el;
        }
        if (card) {
          const cr = card.getBoundingClientRect();
          if (cr.width > MIN_BOX && cr.height > MIN_BOX) return { el: card, card: true };
        }
      }
      const img = anchor.querySelector('img');
      if (img) {
        let box = img;
        while (box.parentElement && box.parentElement !== anchor
               && anchor.contains(box.parentElement)) box = box.parentElement;
        const r = box.getBoundingClientRect();
        if (r.width > MIN_BOX && r.height > MIN_BOX) return { el: box, card: false };
      }
    } catch {   }
    return { el: anchor, card: false };
  }

  function pageHit(x, y) {
    try {
      if (typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(x, y) || [];
        for (let i = 0; i < stack.length && i < 12; i++) if (stack[i] !== host) return stack[i];
        return null;
      }
      const hit = document.elementFromPoint(x, y);
      return hit === host ? undefined : hit;
    } catch { return undefined; }
  }
  function clearAt(anchor, box, rect, pos, w, h, card) {
    if (typeof document.elementFromPoint !== 'function' && typeof document.elementsFromPoint !== 'function') return true;
    const inside = (px, py) => [Math.min(Math.max(px, rect.left + 1), rect.right - 1), Math.min(Math.max(py, rect.top + 1), rect.bottom - 1)];
    const pts = [inside(pos.x + w / 2, pos.y + h / 2)];
    if (!card) pts.push(inside(pos.x + 2, pos.y + 2), inside(pos.x + w - 2, pos.y + 2));
    for (const [px, py] of pts) {
      const hit = pageHit(px, py);
      if (hit === undefined) continue;
      if (!relatedHit(hit, anchor, box, rect)) return false;
    }
    return true;
  }

  function setShown(v) {
    if (shown === v) return;
    shown = v;
    if (wrap) wrap.className = v ? 'w' : 'w off';
    if (!v) hideTip();
  }

  function clearBadges() {
    badges.forEach((b) => { try { b.el.remove(); } catch {   } });
    badges.clear();
    hideTip();
    setShown(true);
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    if (host) { try { host.remove(); } catch {   } }
    badges.clear();
    tipEl = null; tipBody = null; tipRef = '';
    try { const stale = document.getElementById(HOST_ID); if (stale) stale.remove(); } catch {   }
    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = HOST_STYLE;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    wrap = document.createElement('div');
    wrap.className = shown ? 'w' : 'w off';
    root.appendChild(style);
    root.appendChild(wrap);
    try {
      wrap.addEventListener('click', onBadgeTap);
      wrap.addEventListener('mouseover', onBadgeOver);
      wrap.addEventListener('mouseout', onBadgeOut);
    } catch {   }
    (document.body || document.documentElement).appendChild(host);
  }

  function buildBadge(src, kind) {
    const el = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'in';
    const span = document.createElement('span');
    if (src) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.src = src;
      inner.appendChild(img);
    }
    inner.appendChild(span);
    el.appendChild(inner);
    wrap.appendChild(el);
    return { el, inner, span, plain: !src, kind, txt: null, cls: '', tf: '', sz: '', x: 0, y: 0, w: 0, h: 0, tile: null };
  }

  function popBadge(b) {
    if (!b || !b.inner || typeof b.inner.animate !== 'function' || reducedMotion()) return;
    try {
      b.inner.animate([
        { transform: 'scale(.3) rotate(-14deg)', opacity: 0 },
        { transform: 'scale(1.15) rotate(4deg)', opacity: 1, offset: 0.45 },
        { transform: 'scale(.95) rotate(-2deg)', opacity: 1, offset: 0.7 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ], { duration: POP_MS, easing: POP_EASE, iterations: 1, fill: 'none' });
    } catch {   }
  }
  function onIntersect(entries) {
    if (stopped) return;
    try {
      for (const e of entries || []) {
        if (!e || !(e.isIntersecting && e.intersectionRatio >= POP_RATIO - 0.01)) continue;
        const ref = tileRef ? tileRef.get(e.target) : '';
        try { io.unobserve(e.target); } catch {   }
        if (!ref || popped.has(ref)) continue;
        popped.add(ref);
        const b = badges.get(ref);
        if (b && shown) popBadge(b); else popWant.add(ref);
      }
    } catch {   }
  }
  function watchTile(el, ref, ratio) {
    if (popped.has(ref)) return;
    if (typeof IntersectionObserver === 'function' && tileRef) {
      try {
        if (!io) io = new IntersectionObserver(onIntersect, { threshold: POP_RATIO });
        if (tileRef.get(el) !== ref) { tileRef.set(el, ref); io.observe(el); }
        return;
      } catch { io = null; }
    }
    if (ratio >= POP_RATIO) { popped.add(ref); popWant.add(ref); }
  }

  function ensureTip() {
    if (tipEl && tipEl.isConnected !== false) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    const card = asset('card');
    if (card) {
      const bg = document.createElement('img');
      bg.className = 'bg'; bg.alt = ''; bg.decoding = 'async'; bg.src = card;
      tipEl.appendChild(bg);
    } else {
      tipEl.style.background = '#fff';
      tipEl.style.borderRadius = '12px';
    }
    tipBody = null;
    wrap.appendChild(tipEl);
    return tipEl;
  }
  function row(label, n) {
    const r = document.createElement('div');
    r.className = 'r';
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('span'); b.textContent = '+' + n;
    r.appendChild(a); r.appendChild(b);
    return r;
  }
  function showTip(ref) {
    const b = badges.get(ref);
    const hit = elig.get(ref);
    if (!b || !hit || !wrap || !shown) return;
    ensureTip();
    try { if (tipBody) tipBody.remove(); } catch {   }
    tipBody = document.createElement('div');
    tipEl.appendChild(tipBody);
    const head = document.createElement('strong');
    const rows = Array.isArray(hit.rows) ? hit.rows : [];
    if (Number(hit.remaining) > 0 && rows.length) {
      head.textContent = 'This post pays';
      tipBody.appendChild(head);
      for (const r of rows) tipBody.appendChild(row(r.label, r.n));
    } else {
      head.textContent = 'All collected';
      tipBody.appendChild(head);
      const p = document.createElement('div');
      p.textContent = 'You earned everything on this post.';
      tipBody.appendChild(p);
    }
    const de = document.documentElement || {};
    const vw = window.innerWidth || de.clientWidth || 1024;
    let th = 0;
    try { th = tipEl.offsetHeight || 0; } catch { th = 0; }
    if (!th) th = 60 + rows.length * 19;
    let y = b.y - th - 6, below = false;
    if (y < 8) { y = b.y + b.h + 6; below = true; }
    const x = Math.round(Math.max(8, Math.min(vw - TIP_W - 8, b.x + b.w / 2 - TIP_W / 2)));
    tipEl.className = 'tip show' + (below ? ' below' : '');
    tipEl.style.transform = 'translate(' + x + 'px,' + Math.round(y) + 'px)';
    tipRef = ref;
    if (!offTipOutside) {
      const outside = (e) => {
        try { if (e && typeof e.composedPath === 'function' && e.composedPath().indexOf(host) >= 0) return; } catch {   }
        hideTip();
      };
      try {
        document.addEventListener('pointerdown', outside, true);
        offTipOutside = () => { try { document.removeEventListener('pointerdown', outside, true); } catch {   } };
      } catch { offTipOutside = null; }
    }
  }
  function hideTip() {
    tipRef = '';
    if (tipEl) tipEl.className = 'tip';
    if (offTipOutside) { offTipOutside(); offTipOutside = null; }
  }
  function badgeRefOf(e) {
    for (let n = e && e.target, i = 0; n && n !== wrap && i < 6; n = n.parentNode, i++) {
      if (n.rgcRef) return n.rgcRef;
    }
    return '';
  }
  function onBadgeTap(e) {
    const ref = badgeRefOf(e);
    if (!ref) return;
    try { e.preventDefault(); e.stopPropagation(); } catch {   }
    if (tipRef === ref && !finePointer()) hideTip(); else showTip(ref);
  }
  function onBadgeOver(e) {
    if (!finePointer()) return;
    const ref = badgeRefOf(e);
    if (ref && ref !== tipRef) showTip(ref);
  }
  function onBadgeOut(e) {
    if (!finePointer() || !tipRef) return;
    const to = e && e.relatedTarget;
    for (let n = to, i = 0; n && i < 6; n = n.parentNode, i++) if (n.rgcRef === tipRef) return;
    hideTip();
  }

  function render(e, refs) {
    const de = document.documentElement || {};
    const vw = window.innerWidth || de.clientWidth || 0;
    const vh = window.innerHeight || de.clientHeight || 0;
    const tSrc = asset('ticket'), cSrc = asset('check');
    const specs = [];
    const seen = new Set();
    let anchors = [];
    try { anchors = document.querySelectorAll(CFG.sel); } catch { anchors = []; }
    for (const a of anchors) {
      if (specs.length >= MAX_BADGES) break;
      const href = a.getAttribute ? a.getAttribute('href') : '';
      if (!href || !refs.some((r) => href.indexOf(r) !== -1)) continue;
      let ref = '', hit = null;
      for (const cand of refCandidates(PLATFORM, href, location.origin)) {
        const got = e.get(cand);
        if (got) { ref = cand; hit = got; break; }
      }
      if (!ref || seen.has(ref)) continue;
      const done = !(Number(hit.remaining) > 0);
      const tb = tileBox(a);
      const rect = tb.el.getBoundingClientRect();
      if (rect.width < MIN_BOX || rect.height < MIN_BOX) continue;
      const src = done ? cSrc : tSrc;
      const sz = src ? badgeSize(rect, tb.card, done) : { w: PLAIN_W, h: PLAIN_H, font: 12 };
      const pos = badgePos(rect, tb.card, sz.w, sz.h, vw, vh);
      if (!pos.onScreen || !clearAt(a, tb.el, rect, pos, sz.w, sz.h, tb.card)) continue;
      seen.add(ref);
      const visH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const visW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const ratio = rect.width * rect.height > 0 ? (visH * visW) / (rect.width * rect.height) : 0;
      specs.push({ ref, done, src, txt: done ? (src ? '' : '✓') : badgeText(hit), x: pos.x, y: pos.y,
        w: sz.w, h: sz.h, font: sz.font, card: tb.card, tile: tb.el, ratio });
    }

    if (!specs.length) { clearBadges(); return; }
    ensureHost();
    const want = new Set(specs.map((s) => s.ref));
    badges.forEach((b, ref) => {
      if (!want.has(ref)) { try { b.el.remove(); } catch {   } badges.delete(ref); if (tipRef === ref) hideTip(); }
    });
    for (const s of specs) {
      const kind = s.done ? 'ok' : 'tk';
      let b = badges.get(s.ref);
      if (!b || b.plain !== !s.src || b.kind !== kind) {
        if (b) { try { b.el.remove(); } catch {   } }
        b = buildBadge(s.src, kind);
        b.el.rgcRef = s.ref;
        badges.set(s.ref, b);
      }
      if (b.txt !== s.txt) { b.span.textContent = s.txt; b.txt = s.txt; }
      const cls = 'b' + (b.plain ? ' plain' : '') + (s.done ? ' ok' : '') + (s.card ? '' : ' i');
      if (b.cls !== cls) { b.el.className = cls; b.cls = cls; }
      const sz = s.w + 'x' + s.h + 'x' + s.font;
      if (b.sz !== sz) {
        b.el.style.width = s.w + 'px';
        b.el.style.height = s.h + 'px';
        b.span.style.fontSize = (s.txt.length > 3 ? Math.round(s.font * 0.85) : s.font) + 'px';
        b.sz = sz;
      }
      const tf = 'translate(' + s.x + 'px,' + s.y + 'px)';
      if (b.tf !== tf) { b.el.style.transform = tf; b.tf = tf; }
      b.x = s.x; b.y = s.y; b.w = s.w; b.h = s.h; b.tile = s.tile;
      watchTile(s.tile, s.ref, s.ratio);
    }
    setShown(true);
    popWant.forEach((ref) => { const b = badges.get(ref); if (b) { popWant.delete(ref); popBadge(b); } });
    if (tipRef && badges.has(tipRef)) showTip(tipRef);
  }

  function setMode(m) {
    if (mode === m) return;
    mode = m;
    if (m === 'full') {
      if (!gridObs && typeof MutationObserver === 'function') {
        gridObs = new MutationObserver(onGridMutations);
        gridObs.observe(document.documentElement, { childList: true, subtree: true });
      }
    } else if (gridObs) {
      try { gridObs.disconnect(); } catch {   }
      gridObs = null;
    }
  }

  function hasElement(list) {
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n && n.nodeType === 1 && n !== host) return true;
    }
    return false;
  }
  function onGridMutations(records) {
    if (stopped) return;
    try {
      for (let i = 0; i < records.length; i++) {
        if (hasElement(records[i].addedNodes) || hasElement(records[i].removedNodes)) { sched.poke(); return; }
      }
    } catch { stopAll(); }
  }
  function onNavSignal() {
    if (!stopped && location.href !== lastHref) sched.poke();
  }
  function onScroll() {
    if (stopped) return;
    lastScrollAt = Date.now();
    if (badges.size && shown) setShown(false);
    if (mode === 'full' || location.href !== lastHref) sched.poke();
  }
  function onVisibility() {
    if (stopped) return;
    if (document.hidden) sched.pause();
    else { sched.resume(); sched.poke(); }
  }
  function onStorage(ch, area) {
    if (stopped || !ch || (area && area !== 'local')) return;
    if (ch.shareHidden) { shareHidden = ch.shareHidden.newValue === true; sched.poke(); }
    if (ch.s2Token) { loader.invalidate(); sched.poke(); }
  }
  function onLoaded(changed) {
    if (changed && !stopped) cycle();
  }

  function cycle() {
    if (stopped) return;
    try {
      if (document.hidden) { sched.pause(); sched.poke(); return; }
      if (Date.now() - lastScrollAt < TIMING.scrollQuietMs) { sched.poke(); return; }
      const href = location.href;
      const nav = href !== lastHref;
      if (nav) { lastHref = href; clearBadges(); resetPops(); }
      if (isSingleVideoPath(PLATFORM, location.pathname)) {
        clearBadges();
        setMode('light');
        return;
      }
      loader.load(nav).then(onLoaded, () => {});
      const e = currentEligible();
      const refs = [];
      e.forEach((v, ref) => { refs.push(ref); });
      setMode(refs.length ? 'full' : 'light');
      if (!refs.length) { clearBadges(); return; }
      render(e, refs);
    } catch { stopAll(); }
  }

  function resetPops() {
    popped = new Set(); popWant = new Set();
    if (io) { try { io.disconnect(); } catch {   } io = null; }
    tileRef = typeof WeakMap === 'function' ? new WeakMap() : null;
  }

  function stopAll() {
    if (stopped) return;
    stopped = true;
    try { resetPops(); } catch {   }
    try { sched.cancel(); } catch {   }
    try { if (gridObs) gridObs.disconnect(); } catch {   }
    try { if (navObs) navObs.disconnect(); } catch {   }
    gridObs = null; navObs = null;
    try {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('popstate', onNavSignal);
      document.removeEventListener('visibilitychange', onVisibility);
    } catch {   }
    try { chrome.storage.onChanged.removeListener(onStorage); } catch {   }
    try { clearBadges(); } catch {   }
    try { if (host) host.remove(); } catch {   }
    host = null; wrap = null;
  }

  function start() {
    try {
      try { document.querySelectorAll(ORPHANS).forEach((n) => { try { n.remove(); } catch {   } }); } catch {   }
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll, { passive: true });
      window.addEventListener('popstate', onNavSignal);
      document.addEventListener('visibilitychange', onVisibility);
      if (typeof MutationObserver === 'function') {
        navObs = new MutationObserver(onNavSignal);
        if (document.head) navObs.observe(document.head, { childList: true, subtree: true, characterData: true });
        else navObs.observe(document.documentElement, { childList: true, subtree: true });
      }
      try {
        chrome.storage.onChanged.addListener(onStorage);
        chrome.storage.local.get('shareHidden').then((o) => {
          if (o && o.shareHidden === true && !stopped) { shareHidden = true; sched.poke(); }
        }).catch(() => {});
      } catch {   }
      if (document.hidden) { sched.pause(); sched.poke(); } else cycle();
    } catch { stopAll(); }
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else start();
  } catch {   }
})();
