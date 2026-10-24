(function () {
  function insideComment(el) {
    try { return !!(el && el.closest && el.closest(COMMENT_EL_SEL)); } catch (e) { return false; }
  }
  const LIKE_HOST_SEL = 'like-button-view-model, #segmented-like-button, #like-button, ytm-like-button-renderer';
  const DISLIKE_SEL = 'dislike-button-view-model, #segmented-dislike-button, #dislike-button';
  function isDislike(el) {
    try {
      if (el.closest(DISLIKE_SEL)) return true;
      const pair = el.closest('ytm-like-button-renderer');
      if (pair) {
        const first = pair.querySelector('ytm-toggle-button-renderer') || pair.querySelector('button');
        if (first && first !== el && !first.contains(el)) return true;
      }
      return false;
    } catch (e) { return true; }
  }
  function onShortsPage() {
    try { return /^\/shorts\//.test(location.pathname || ''); } catch (e) { return false; }
  }
  function rendered(el) {
    try {
      const r = el.getBoundingClientRect();
      return !!(r && r.width > 0 && r.height > 0);
    } catch (e) { return false; }
  }
  function viewport() {
    const de = document.documentElement || {};
    return { w: window.innerWidth || de.clientWidth || 0, h: window.innerHeight || de.clientHeight || 0 };
  }
  function onScreen(el) {
    try {
      const r = el.getBoundingClientRect();
      if (!r || !(r.width > 0) || !(r.height > 0)) return false;
      const vp = viewport();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return x >= 0 && y >= 0 && x <= vp.w && y <= vp.h;
    } catch (e) { return false; }
  }
  function activeReel() {
    try {
      const v = adapter.getVideoEl();
      const own = v && v.closest ? v.closest('ytd-reel-video-renderer') : null;
      if (own) return own;
      const active = document.querySelectorAll('ytd-reel-video-renderer[is-active]');
      if (active.length === 1) return active[0];
      const shown = Array.prototype.filter.call(document.querySelectorAll('ytd-reel-video-renderer'), rendered);
      return shown.length === 1 ? shown[0] : null;
    } catch (e) { return null; }
  }
  function likeControl() {
    const shorts = onShortsPage();
    const reel = shorts ? activeReel() : null;
    const root = reel || document;
    const loose = shorts && !reel;
    for (const sel of [
      'like-button-view-model button[aria-pressed]',
      'segmented-like-dislike-button-view-model button[aria-pressed]',
      '#segmented-like-button button[aria-pressed]',
      '#like-button button[aria-pressed]',
      'ytm-like-button-renderer button[aria-pressed]',
      'ytm-slim-video-action-bar-renderer button[aria-pressed]',
      'ytd-segmented-like-dislike-button-renderer button[aria-pressed]',
      'ytd-like-button-renderer button[aria-pressed]',
      'ytd-reel-player-overlay-renderer button[aria-pressed]',
      'ytd-watch-metadata button[aria-pressed]',
      '#top-level-buttons-computed button[aria-pressed]',
    ]) {
      let pick = null;
      for (const el of root.querySelectorAll(sel)) {
        if (insideComment(el) || isDislike(el)) continue;
        if (reel) return el;
        if (!rendered(el) || (!shorts && el.closest('ytd-shorts, ytd-reel-video-renderer'))) continue;
        if (!loose) return el;
        if (!onScreen(el)) continue;
        if (pick) return null;
        pick = el;
      }
      if (pick) return pick;
    }
    return null;
  }
  const COMPOSER_SEL = [
    'ytd-commentbox #contenteditable-root[contenteditable="true"]',
    'ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]',
    'ytd-engagement-panel-section-list-renderer #contenteditable-root[contenteditable="true"]',
    'ytd-engagement-panel-section-list-renderer ytd-commentbox [contenteditable="true"]',
    'ytd-engagement-panel-section-list-renderer [contenteditable="true"][role="textbox"]',
    'ytd-shorts [contenteditable="true"][role="textbox"]',
    '#contenteditable-root[contenteditable="true"]',
    '#contenteditable-root',
    'ytd-commentbox [contenteditable="true"]',
    'ytm-commentbox textarea',
    'ytm-comment-simplebox-renderer textarea',
    'ytm-commentbox [contenteditable="true"]',
    'ytm-comment-dialog-renderer textarea',
    'ytm-comment-dialog-renderer [contenteditable="true"]',
  ].join(', ');
  const COMMENT_EL_SEL = [
    'ytd-comment-view-model',
    'ytd-comment-renderer',
    'ytd-comment-thread-renderer',
    'ytm-comment-renderer',
  ].join(', ');
  const COMMENT_ROW_SEL = 'ytd-comment-view-model, ytd-comment-renderer, ytm-comment-renderer';
  const COMMENT_ID_RE = /^[\w.-]{1,120}$/;
  function commentLikeControl(el) {
    try {
      return el.querySelector('#like-button button[aria-pressed]') || null;
    } catch (e) { return null; }
  }
  function avatarKey(src) {
    try {
      const s = String(src || '');
      if (!/^https?:\/\//.test(s)) return '';
      return s.split('?')[0].split('=')[0];
    } catch (e) { return ''; }
  }
  function ownAvatarKey() {
    try {
      for (const sel of ['#avatar-btn img', 'ytd-comment-simplebox-renderer #author-thumbnail img',
        'ytd-comments-header-renderer #author-thumbnail img', 'ytm-comment-simplebox-renderer img', 'ytm-topbar-menu-button-renderer img']) {
        const img = document.querySelector(sel);
        const k = img ? avatarKey(img.getAttribute('src') || img.src) : '';
        if (k) return k;
      }
    } catch (e) {   }
    return '';
  }
  function isOwnComment(el, mine) {
    if (!mine) return false;
    try {
      const img = el.querySelector('#author-thumbnail img, #author-thumbnail-button img, ytm-profile-icon img, img');
      return !!img && avatarKey(img.getAttribute('src') || img.src) === mine;
    } catch (e) { return false; }
  }
  function commentOwnRef(el) {
    try {
      const a = el.querySelector('a[href*="lc="]');
      const href = a ? (a.getAttribute('href') || '') : '';
      if (!href) return '';
      return adapter.refFromUrl(new URL(href, location.href).href) || '';
    } catch (e) { return ''; }
  }

  function styleOf(el) {
    try { return typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null; } catch (e) { return null; }
  }
  function upOne(n) { return n.parentElement || (n.parentNode && n.parentNode.host) || null; }
  function within(outer, node) {
    for (let n = node, i = 0; n && i < 80; n = n.parentNode || n.host || null, i++) {
      if (n === outer) return true;
    }
    return false;
  }
  function ours(el) { const id = el && el.id; return typeof id === 'string' && id.indexOf('rgc-') === 0; }
  function hitAt(x, y) {
    let hit = null;
    if (typeof document.elementsFromPoint === 'function') {
      for (const h of document.elementsFromPoint(x, y) || []) { if (h && !ours(h)) { hit = h; break; } }
    } else if (typeof document.elementFromPoint === 'function') {
      hit = document.elementFromPoint(x, y);
      if (ours(hit)) hit = null;
    }
    for (let i = 0; hit && hit.shadowRoot && typeof hit.shadowRoot.elementFromPoint === 'function' && i < 8; i++) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }
  function pointState(el, hitScope) {
    try {
      if (!el || el.nodeType !== 1 || el.isConnected === false) return 'none';
      const r = el.getBoundingClientRect();
      if (!r || !(r.width >= 2) || !(r.height >= 2)) return 'hidden';
      const vp = viewport();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!(x >= 0 && y >= 0 && x <= vp.w && y <= vp.h)) return 'offscreen';
      const s = styleOf(el);
      if (s && (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse')) return 'hidden';
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 80; n = upOne(n), i++) {
        const ns = n === el ? s : styleOf(n);
        if (ns && parseFloat(ns.opacity) < 0.05) return 'transparent';
      }
      const hit = hitAt(x, y);
      if (!hit) return 'covered';
      if (within(hitScope || el, hit)) return 'ok';
      if (!hitScope && within(hit, el)) {
        const hr = hit.getBoundingClientRect();
        if (hr && hr.width * hr.height <= 4 * r.width * r.height + 1) return 'ok';
      }
      return 'covered';
    } catch (e) { return 'none'; }
  }
  function pointable(el) { return pointState(el) === 'ok'; }

  const MUTE_SEL = [
    'button.ytp-unmute',
    'ytm-muted-autoplay-overlay',
    '.ytp-mute-button',
    'volume-controls button.ytdVolumeControlsMuteIconButton',
    'button.ytdVolumeControlsMuteIconButton',
    'ytm-mute-button button.ytmMuteButtonButton',
    'button.ytmMuteButtonButton',
  ];
  const PLAY_SEL = [
    '.ytp-large-play-button',
    '.ytp-play-button',
    '#play-pause-button-shape button',
    '#play-pause-button-shape',
    '.player-control-play-pause-icon',
  ];
  const MWEB_AD_SEL = '.ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-skip-button-container, .ytp-skip-ad-button, .videoAdUiSkipContainer';
  function playerCtx(v) {
    v = v || adapter.getVideoEl();
    if (!v || !v.closest) return null;
    const player = v.closest('.html5-video-player');
    const mweb = v.closest('#player-container-id');
    const reel = v.closest('ytd-reel-video-renderer');
    const scope = reel || v.closest('ytw-player-with-controls') || mweb || player;
    return scope ? { v, player, mweb, reel, scope } : null;
  }
  function controlIn(scope, sels) {
    let seen = false, faded = null;
    for (const sel of sels) {
      for (const el of scope.querySelectorAll(sel)) {
        seen = true;
        const st = pointState(el);
        if (st === 'ok') return { el, seen, faded };
        if (st === 'transparent' && !faded) faded = el;
      }
    }
    return { el: null, seen, faded };
  }
  function controlOrVideo(ctx, sels) {
    const got = controlIn(ctx.scope, sels);
    if (got.el) return got.el;
    if (got.faded && !ctx.mweb) return got.faded;
    if (!got.seen && !ctx.mweb) return null;
    return pointState(ctx.v, ctx.scope) === 'ok' ? ctx.v : null;
  }
  function paintsOutside(n, x, y, w, h) {
    if (x < 0 || y < 0) return false;
    for (let a = n, i = 0; a && a.nodeType === 1 && i < 40; a = a.parentElement, i++) {
      const cs = styleOf(a);
      if (!cs) continue;
      const clips = (cs.overflowX && cs.overflowX !== 'visible') || (cs.overflowY && cs.overflowY !== 'visible')
        || /paint|strict|content/.test(cs.contain || '');
      if (!clips) continue;
      const r = a.getBoundingClientRect();
      if (!(r && x >= r.left && y >= r.top && x + w <= r.right && y + h <= r.bottom)) return false;
    }
    return true;
  }
  const LIKE_BLOCK_TAGS = new Set(['like-button-view-model', 'dislike-button-view-model', 'segmented-like-dislike-button-view-model']);
  function shortsCommentsButton() {
    try {
      const reel = activeReel();
      if (!reel) return null;
      for (const sel of ['#comments-button button', '#comments-button yt-button-shape button', '#comments-button']) {
        for (const el of reel.querySelectorAll(sel)) if (pointable(el)) return el;
      }
      for (const bar of reel.querySelectorAll('reel-action-bar-view-model')) {
        let pastLike = false;
        for (const kid of Array.from(bar.children || [])) {
          const tag = String(kid.tagName || '').toLowerCase();
          if (LIKE_BLOCK_TAGS.has(tag)) { pastLike = true; continue; }
          if (!pastLike || tag !== 'button-view-model') continue;
          const btn = kid.querySelector('button');
          if (btn && pointable(btn)) return btn;
          break;
        }
      }
      return null;
    } catch (e) { return null; }
  }
  function shortsPanelOpen() {
    try {
      for (const el of document.querySelectorAll('ytd-engagement-panel-section-list-renderer')) {
        if (rendered(el) && el.querySelector(COMMENT_ROW_SEL)) return true;
      }
      return false;
    } catch (e) { return false; }
  }
  const adapter = {
    platform: 'youtube',
    actions: { watch: true, like: true, comment: true },
    submitOnEnter: false,
    commentConfirmNetwork: true,
    refFromUrl(href) {
      try {
        const u = new URL(href);
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
        return u.searchParams.get('v') || '';
      } catch { return ''; }
    },
    getRef() { return this.refFromUrl(location.href); },
    isLiked() {
      const b = likeControl();
      return !!(b && b.getAttribute('aria-pressed') === 'true');
    },
    likeTarget(t) {
      if (!t || !t.closest || insideComment(t)) return null;
      if (!t.closest('like-button-view-model, #segmented-like-button, #like-button, ytm-like-button-renderer')) return null;
      if (isDislike(t)) return null;
      const ctrl = likeControl();
      if (!ctrl || !(ctrl === t || ctrl.contains(t))) return null;
      return ctrl;
    },
    commentSubmitTarget(t) {
      if (!t || !t.closest) return null;
      const direct = t.closest('#submit-button');
      if (direct) return direct;
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('#contenteditable-root, [contenteditable="true"]') : null; },

    commentDeleteHooks: true,

    commentIdFromNode(node) {
      try {
        if (!node || !node.matches) return null;
        const el = node.matches(COMMENT_EL_SEL) ? node
          : (node.querySelector ? node.querySelector(COMMENT_EL_SEL) : null);
        if (!el) return null;
        const a = el.querySelector('a[href*="lc="]');
        if (a) {
          const m = /[?&]lc=([^&#"']+)/.exec(a.getAttribute('href') || '');
          if (m) { try { return decodeURIComponent(m[1]); } catch (e2) { return m[1]; } }
        }
        return '';
      } catch (e) { return null; }
    },

    commentIdFromDom(text) {
      try {
        const want = String(text || '').trim().slice(0, 80);
        if (!want) return null;
        for (const el of document.querySelectorAll(COMMENT_EL_SEL)) {
          const body = el.querySelector('#content-text, .comment-text, yt-attributed-string');
          const got = ((body && (body.textContent || body.innerText)) || '').trim();
          if (!got || got.slice(0, 80) !== want) continue;
          const a = el.querySelector('a[href*="lc="]');
          const m = a ? /[?&]lc=([\w.-]+)/.exec(a.getAttribute('href') || '') : null;
          if (m) return m[1];
        }
        return null;
      } catch (e) { return null; }
    },

    commentMenuTarget(t) {
      try {
        if (!t || !t.closest) return null;
        const btn = t.closest('#action-menu button, ytd-menu-renderer button, ytm-menu button');
        if (!btn) return null;
        const el = btn.closest(COMMENT_EL_SEL);
        if (!el) return null;
        const a = el.querySelector('a[href*="lc="]');
        const m = a ? /[?&]lc=([\w.-]+)/.exec(a.getAttribute('href') || '') : null;
        return { id: m ? m[1] : null };
      } catch (e) { return null; }
    },

    commentConfirmTarget(t) {
      try {
        if (!t || !t.closest) return null;
        return t.closest(
          'yt-confirm-dialog-renderer #confirm-button,'
          + 'ytd-confirm-dialog-renderer #confirm-button,'
          + 'tp-yt-paper-dialog #confirm-button,'
          + 'ytm-confirm-dialog-renderer .confirm-button,'
          + 'yt-confirm-dialog-renderer button[aria-label], ytm-confirm-dialog-renderer button'
        );
      } catch (e) { return null; }
    },


    commentLikeScan() {
      const rows = [];
      try {
        const ref = adapter.getRef();
        const seen = new Set();
        for (const el of document.querySelectorAll(COMMENT_ROW_SEL)) {
          const own = commentOwnRef(el);
          if (ref && own && own !== ref) continue;
          const id = adapter.commentIdFromNode(el);
          if (!id || !COMMENT_ID_RE.test(id) || seen.has(id)) continue;
          seen.add(id);
          const ctrl = commentLikeControl(el);
          rows.push({ id, liked: !!(ctrl && ctrl.getAttribute('aria-pressed') === 'true') });
        }
      } catch (e) { return []; }
      return rows;
    },

    commentLikePresent() {
      try {
        const el = document.querySelector(COMMENT_ROW_SEL);
        return !!(el && commentLikeControl(el));
      } catch (e) { return false; }
    },

    commentLikeTarget(t) {
      try {
        if (!t || !t.closest) return null;
        if (!insideComment(t)) return null;
        return t.closest('#like-button') || null;
      } catch (e) { return null; }
    },

    composerSel: '#contenteditable-root, [contenteditable="true"]',
    commentText() {
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.textContent || el.innerText || '').trim();
        if (v) return v;
      }
      return '';
    },

    muteControl(v) {
      try { const ctx = playerCtx(v); return ctx ? controlOrVideo(ctx, MUTE_SEL) : null; } catch (e) { return null; }
    },
    playControl(v) {
      try { const ctx = playerCtx(v); return ctx ? controlOrVideo(ctx, PLAY_SEL) : null; } catch (e) { return null; }
    },
    isAdPlaying(v) {
      try {
        const ctx = playerCtx(v);
        if (!ctx) return false;
        const cl = ctx.player && ctx.player.classList;
        if (cl && (cl.contains('ad-showing') || cl.contains('ad-interrupting'))) return true;
        const reel = ctx.reel || (onShortsPage() ? activeReel() : null);
        if (reel) {
          if (reel.hasAttribute('is-ads-overlay')) return true;
          for (const el of reel.querySelectorAll('.ytdShortsPlayerControlsIsAdsOverlay, ytd-shorts-player-controls[is-ads-overlay], ytd-ad-slot-renderer')) {
            if (rendered(el)) return true;
          }
        }
        if (ctx.mweb) {
          for (const el of ctx.mweb.querySelectorAll(MWEB_AD_SEL)) { if (rendered(el)) return true; }
        }
        return false;
      } catch (e) { return false; }
    },
    hudAnchor(v) {
      try {
        const ctx = playerCtx(v);
        if (!ctx || ctx.mweb) return null;
        if (!ctx.reel) return ctx.player ? { el: ctx.player, o: null } : null;
        const vr = ctx.v.getBoundingClientRect();
        if (!vr || !(vr.width > 0)) return null;
        const PW = 170, GAP = 12;
        for (let n = ctx.v.parentElement, i = 0; n && i < 14; n = n.parentElement, i++) {
          const r = n.getBoundingClientRect();
          const atCorner = r && Math.abs(r.left - vr.left) <= 3 && Math.abs(r.top - vr.top) <= 3;
          if (atCorner && paintsOutside(n, r.left - GAP - PW, r.top, PW, 38)) return { el: n, o: { outsideLeft: true } };
          if (n === ctx.reel) break;
        }
        const host = ctx.player || ctx.v.parentElement;
        if (!host) return null;
        const hr = host.getBoundingClientRect();
        let top = 12;
        for (const sel of PLAY_SEL.concat(MUTE_SEL)) {
          for (const el of ctx.scope.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r && r.height > 0 && r.top - hr.top < 120 && r.left - hr.left < 240) top = Math.max(top, Math.round(r.bottom - hr.top + 8));
          }
        }
        return { el: host, o: { top } };
      } catch (e) { return null; }
    },
    playerHost(v) {
      try {
        v = v || adapter.getVideoEl();
        if (!v || !v.closest) return null;
        return v.closest('#player-container-id') || v.closest('.html5-video-player') || null;
      } catch (e) { return null; }
    },
    likePointerTarget() {
      try {
        const b = likeControl();
        if (!b || !b.closest(LIKE_HOST_SEL) || isDislike(b)) return null;
        return pointable(b) ? b : null;
      } catch (e) { return null; }
    },
    commentPointerTarget() {
      try {
        const shorts = onShortsPage();
        for (const sel of [COMPOSER_SEL, 'ytd-comment-simplebox-renderer #simplebox-placeholder']) {
          for (const el of document.querySelectorAll(sel)) {
            if (insideComment(el)) continue;
            if (!shorts && el.closest('ytd-shorts')) continue;
            if (pointable(el)) return el;
          }
        }
        return shorts ? shortsCommentsButton() : null;
      } catch (e) { return null; }
    },
    commentLikePointerTarget() {
      try {
        const ref = adapter.getRef();
        const mine = ownAvatarKey();
        for (const el of document.querySelectorAll(COMMENT_ROW_SEL)) {
          const ctrl = commentLikeControl(el);
          if (!ctrl || ctrl.getAttribute('aria-pressed') !== 'false' || !onScreen(ctrl)) continue;
          if (isOwnComment(el, mine)) continue;
          const own = commentOwnRef(el);
          if (ref && own && own !== ref) continue;
          const id = adapter.commentIdFromNode(el);
          if (!id || !COMMENT_ID_RE.test(id)) continue;
          if (pointable(ctrl)) return ctrl;
        }
        return onShortsPage() && !shortsPanelOpen() ? shortsCommentsButton() : null;
      } catch (e) { return null; }
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    composerPresent() { try { return !!document.querySelector(COMPOSER_SEL); } catch { return false; } },
    likePresent() { try { return !!likeControl(); } catch { return false; } },
    getVideoEl() {
      const vids = Array.from(document.querySelectorAll('video'));
      if (vids.length <= 1) return vids[0] || null;
      const visibleArea = (v) => {
        const r = v.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        return w * h;
      };
      let best = null, bestScore = -1;
      for (const v of vids) {
        const score = visibleArea(v) + (!v.paused ? 1e9 : 0);
        if (score > bestScore) { bestScore = score; best = v; }
      }
      return best || vids[0] || null;
    },
  };
  self.RGC_YT_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  try {
    if (location.hostname === 'm.youtube.com') {
      let sent = 0;
      const MAX = 5;
      const TAG_RE = /comment|like|engagement|reply|toggle-button/i;
      const sample = (why) => {
        try {
          if (sent >= MAX) return;
          if (!/^\/(watch|shorts\/)/.test(location.pathname)) return;
          const counts = {};
          for (const el of document.getElementsByTagName('*')) {
            const t = el.tagName.toLowerCase();
            if (t.indexOf('-') > 0 && TAG_RE.test(t)) counts[t] = (counts[t] || 0) + 1;
          }
          let shape = null;
          const c = document.querySelector('[class*="comment" i] button, ytm-comment-renderer button, [class*="Comment"] button');
          const host = c && (c.closest('[class*="comment" i]') || c.parentElement);
          if (host) {
            shape = { tag: host.tagName.toLowerCase(), buttons: [] };
            for (const b of Array.from(host.querySelectorAll('button')).slice(0, 4)) {
              shape.buttons.push({
                attrs: Array.from(b.attributes).map((a) => a.name).filter((n) => !/^(style|data-.*-id)$/.test(n)).slice(0, 8).join(','),
                pressed: b.hasAttribute('aria-pressed') ? b.getAttribute('aria-pressed') === 'true' : null,
                parent: b.parentElement ? b.parentElement.tagName.toLowerCase() : '',
              });
            }
          }
          sent++;
          chrome.runtime.sendMessage({ type: 's2Debug', kind: 'ytmdiag', data: {
            why, path: location.pathname.split('/')[1] || '',
            tags: Object.keys(counts).sort().slice(0, 24).map((t) => t + ':' + counts[t]).join(' '),
            rows: document.querySelectorAll('ytd-comment-view-model, ytd-comment-renderer, ytm-comment-renderer').length,
            composer: !!document.querySelector('ytm-commentbox textarea, ytm-comment-simplebox-renderer textarea, ytm-commentbox [contenteditable="true"], ytm-comment-dialog-renderer textarea, ytm-comment-dialog-renderer [contenteditable="true"]'),
            hearts: document.querySelectorAll('#like-button button[aria-pressed]').length,
            shape,
          } });
        } catch (e) {   }
      };
      setTimeout(() => sample('t15'), 15000);
      setTimeout(() => sample('t45'), 45000);
      setTimeout(() => sample('t90'), 90000);
      let taps = 0;
      document.addEventListener('click', (e) => {
        try {
          if (taps >= 2) return;
          const t = e.target;
          if (!t || !t.closest) return;
          const near = t.closest('[class*="comment" i], ytm-comment-renderer, [aria-label*="omment"]');
          if (!near) return;
          taps++;
          setTimeout(() => sample('tap' + taps), 2500);
        } catch (e2) {   }
      }, true);
    }
  } catch (e) {   }
})();
