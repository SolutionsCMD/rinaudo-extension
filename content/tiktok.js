(function () {
  const COMMENT_ROW_SEL = '[class*="DivCommentObjectWrapper"]';
  const COMMENT_LIST_SEL = '[class*="DivCommentListContainer"]';
  const COMMENT_LIKE_SEL = '[class*="DivLikeContainer"][role="button"]';

  const LIKE_ICON_SEL = '[data-e2e="like-icon"], [data-e2e="browse-like-icon"]';
  const ITEM_SEL = '[id^="one-column-item-"]';
  const PLAYER_SEL = '.xgplayer-container, [id^="xgwrapper-"]';
  function inCommentPanel(el) {
    try { return !!(el.closest(COMMENT_LIST_SEL) || el.closest(COMMENT_ROW_SEL)); } catch (e) { return true; }
  }
  function videoLikesIn(root) {
    return Array.prototype.filter.call(root.querySelectorAll(LIKE_ICON_SEL), (el) => !inCommentPanel(el));
  }
  let sharingSeen = false;
  function sharingApp() {
    if (sharingSeen) return true;
    try {
      sharingSeen = /^m\./.test(location.hostname || '')
        || !!document.querySelector('script[data-chunk="webapp-sharing"], script[src*="/webapp-sharing/"]');
    } catch (e) { return false; }
    return sharingSeen;
  }
  function activeItem(v) {
    v = v || adapter.getVideoEl();
    if (!v || !v.closest) return null;
    for (let n = v.closest(ITEM_SEL), i = 0; n && i < 4; i++) {
      if (videoLikesIn(n).length === 1) return n;
      n = n.parentElement ? n.parentElement.closest(ITEM_SEL) : null;
    }
    const top = document.body || document.documentElement;
    for (let n = v.parentElement, i = 0; n && n !== top && i < 16; n = n.parentElement, i++) {
      const k = videoLikesIn(n).length;
      if (k === 1) return n;
      if (k > 1) return null;
    }
    return null;
  }
  function itemShowsRef(item) {
    const ref = adapter.getRef();
    if (!ref) return false;
    let other = false;
    for (const a of item.querySelectorAll('a[href*="/video/"]')) {
      const m = /\/video\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      if (m[1] === ref) return true;
      other = true;
    }
    return !other;
  }
  function isOtherPost(item) {
    return !!(item.matches && item.matches(ITEM_SEL) && !itemShowsRef(item));
  }
  function focalItem(v) {
    const item = activeItem(v);
    return item && !isOtherPost(item) ? item : null;
  }

  function styleOf(el) {
    try { return typeof window.getComputedStyle === 'function' ? window.getComputedStyle(el) : null; } catch (e) { return null; }
  }
  function upOne(n) { return n.parentElement || (n.parentNode && n.parentNode.host) || null; }
  function viewport() {
    const de = document.documentElement || {};
    return { w: window.innerWidth || de.clientWidth || 0, h: window.innerHeight || de.clientHeight || 0 };
  }
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
  function pointable(el) {
    try {
      if (!el || el.nodeType !== 1 || el.isConnected === false) return false;
      const r = el.getBoundingClientRect();
      if (!r || !(r.width >= 2) || !(r.height >= 2)) return false;
      const vp = viewport();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!(x >= 0 && y >= 0 && x <= vp.w && y <= vp.h)) return false;
      const s = styleOf(el);
      if (s && (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse')) return false;
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 80; n = upOne(n), i++) {
        const ns = n === el ? s : styleOf(n);
        if (ns && parseFloat(ns.opacity) < 0.05) return false;
      }
      const hit = hitAt(x, y);
      if (!hit) return false;
      if (within(el, hit)) return true;
      if (within(hit, el)) {
        const hr = hit.getBoundingClientRect();
        return !!(hr && hr.width * hr.height <= 4 * r.width * r.height + 1);
      }
      return false;
    } catch (e) { return false; }
  }
  function firstPointable(root, sel, skip) {
    for (const el of root.querySelectorAll(sel)) {
      if (skip && skip(el)) continue;
      if (pointable(el)) return el;
    }
    return null;
  }
  function heartOn(btn) {
    if (btn.getAttribute('aria-pressed') === 'true') return true;
    const path = btn.querySelector('svg path');
    let fill = path ? (path.getAttribute('fill') || '') : '';
    if (path && !fill) { const s = styleOf(path); fill = (s && s.fill) || ''; }
    return /254,\s*44,\s*85|#fe2c55|rgb\(254/i.test(fill);
  }

  const adapter = {
    platform: 'tiktok',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/video\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      const btn = document.querySelector('[data-e2e*="like-icon"]');
      if (!btn) return false;
      if (btn.getAttribute('aria-pressed') === 'true') return true;
      const path = btn.querySelector('svg path');
      const fill = path ? (path.getAttribute('fill') || getComputedStyle(path).fill || '') : '';
      return /254,\s*44,\s*85|#fe2c55|rgb\(254/i.test(fill);
    },
    isLikedFocal() {
      try {
        if (!adapter.getRef()) return null;
        const item = activeItem();
        if (item && isOtherPost(item)) return null;
        const likes = videoLikesIn(item || document);
        if (likes.length !== 1) return null;
        return heartOn(likes[0]);
      } catch (e) { return null; }
    },
    likeConfirmNetwork: true,
    likeKnownNetwork: true,
    commentConfirmNetwork: true,
    likeTarget(t) {
      if (!t || !t.closest) return null;
      if (t.closest(COMMENT_LIST_SEL) || t.closest(COMMENT_ROW_SEL)) return null;
      return t.closest('[data-e2e*="like-icon"]');
    },
    commentSubmitTarget(t) {
      if (!t || !t.closest) return null;
      const direct = t.closest('[data-e2e*="comment-post"]');
      if (direct) return direct;
      const b = t.closest('[role="button"], button');
      if (!b) return null;
      if (b.closest('[data-e2e*="like-icon"]')) return null;
      let el = b;
      for (let i = 0; i < 2; i++) {
        el = el.parentElement; if (!el) break;
        if (el.querySelector('[data-e2e*="comment-input"], [contenteditable="true"], textarea')) return b;
      }
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('[data-e2e*="comment-input"], [contenteditable="true"], textarea') : null; },
    composerSel: '[data-e2e*="comment-input"], [contenteditable="true"], textarea',
    commentText() {
      const wrap = document.querySelector('[data-e2e*="comment-input"]');
      const ed = wrap ? wrap.querySelector('[contenteditable="true"], textarea') : null;
      if (!ed) return '';
      if (ed.tagName === 'TEXTAREA') return ed.value || '';
      return ed.textContent || '';
    },

    commentLikeConfirmNetwork: true,
    commentLikeTarget(t) {
      try {
        if (!t || !t.closest) return null;
        const ctrl = t.closest(COMMENT_LIKE_SEL);
        if (!ctrl) return null;
        const row = ctrl.closest(COMMENT_ROW_SEL);
        if (!row) return null;
        return ctrl;
      } catch (e) { return null; }
    },

    commentLikePresent() {
      try { return !!document.querySelector(COMMENT_ROW_SEL + ' ' + COMMENT_LIKE_SEL); }
      catch (e) { return false; }
    },

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

    repostTarget(t) {
      if (!t || !t.closest) return null;
      return t.closest('[role="dialog"], [data-e2e*="share"], [data-e2e*="video-share"], button, [role="button"], svg');
    },
    repostPresent() {
      try { return !!document.querySelector('[data-e2e*="share"], [data-e2e*="video-share"], video'); }
      catch (e) { return false; }
    },
    repostTrustNetwork: true,
    isReposted() {
      try { return !!document.querySelector('[data-e2e="repost-tag"], [data-e2e="repost-action-tag"]'); }
      catch (e) { return false; }
    },
    isRepostedFocal() {
      try {
        if (this.refFromPath(location.pathname) !== this.getRef() || !this.getRef()) return null;
        return !!document.querySelector('[data-e2e="repost-tag"], [data-e2e="repost-action-tag"]');
      } catch (e) { return null; }
    },

    muteControl(v) {
      try {
        if (sharingApp()) return null;
        const item = focalItem(v);
        return item ? firstPointable(item, '[data-e2e="video-sound"]') : null;
      } catch (e) { return null; }
    },
    playControl(v) {
      try {
        if (sharingApp()) return null;
        const item = focalItem(v);
        return item ? firstPointable(item, '[data-e2e="video-play"]') : null;
      } catch (e) { return null; }
    },
    isAdPlaying(v) {
      try {
        v = v || adapter.getVideoEl();
        const item = v && v.closest ? v.closest(ITEM_SEL) : null;
        return !!(item && item.querySelector('[data-e2e="ttam-ads-cta"]'));
      } catch (e) { return false; }
    },
    watchPillFixed: true,
    playerHost(v) {
      try {
        if (sharingApp()) return null;
        v = v || adapter.getVideoEl();
        return v && v.closest ? (v.closest(PLAYER_SEL) || null) : null;
      } catch (e) { return null; }
    },
    likePointerTarget() {
      try {
        if (sharingApp() || !adapter.getRef()) return null;
        const item = focalItem();
        const likes = item ? videoLikesIn(item) : [];
        return likes.length === 1 && pointable(likes[0]) ? likes[0] : null;
      } catch (e) { return null; }
    },
    commentPointerTarget() {
      try {
        if (sharingApp() || !adapter.getRef()) return null;
        const box = firstPointable(document, '[data-e2e*="comment-input"]');
        if (box) return box;
        const item = focalItem();
        return item ? firstPointable(item, '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]', inCommentPanel) : null;
      } catch (e) { return null; }
    },
    repostPointerTarget() {
      try {
        if (sharingApp() || !adapter.getRef()) return null;
        const item = focalItem();
        if (!item) return null;
        const control = (el) => el.closest('button, [role="button"]') || el;
        for (const el of item.querySelectorAll('[data-e2e="share-icon"], [data-e2e="browse-share-icon"], [data-e2e="video-share"]')) {
          if (inCommentPanel(el)) continue;
          const c = control(el);
          if (pointable(c)) return c;
        }
        const found = new Set();
        for (const el of item.querySelectorAll('[data-e2e*="share"]')) {
          if (inCommentPanel(el) || /count/i.test(el.getAttribute('data-e2e') || '')) continue;
          found.add(control(el));
        }
        if (found.size !== 1) return null;
        const only = found.values().next().value;
        return pointable(only) ? only : null;
      } catch (e) { return null; }
    },
    commentLikePointerTarget() {
      try {
        if (sharingApp() || !adapter.getRef()) return null;
        for (const row of document.querySelectorAll(COMMENT_ROW_SEL)) {
          const ctrl = row.querySelector(COMMENT_LIKE_SEL);
          if (!ctrl || ctrl.getAttribute('aria-pressed') !== 'false') continue;
          if (pointable(ctrl)) return ctrl;
        }
        return null;
      } catch (e) { return null; }
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    repostHighlightTarget() { return adapter.repostPointerTarget(); },
    repostDialogHighlightTargets() {
      try {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        return Array.from(dlg.querySelectorAll('[role="button"], button'))
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
          .slice(0, 3);
      } catch (e) { return null; }
    },
  };
  const CHANNEL = 'realmizkif';
  const reported = Object.create(null);
  function onChannelPage() {
    try {
      const p = (location.pathname || '').toLowerCase();
      return p.startsWith('/@' + CHANNEL);
    } catch (e) { return false; }
  }
  function scanChannel() {
    try {
      if (!onChannelPage()) return;
      const refs = [];
      const seen = Object.create(null);
      document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
        const m = String(a.getAttribute('href') || '').match(/\/@([^/]+)\/video\/(\d{15,25})/);
        if (!m) return;
        if (String(m[1]).toLowerCase() !== CHANNEL) return;
        if (seen[m[2]]) return;
        seen[m[2]] = 1;
        refs.push(m[2]);
      });
      const own = (location.pathname || '').match(/\/@([^/]+)\/video\/(\d{15,25})/);
      if (own && String(own[1]).toLowerCase() === CHANNEL && !seen[own[2]]) refs.push(own[2]);
      const fresh = refs.filter((r) => !reported[r]);
      if (!fresh.length) return;
      fresh.forEach((r) => { reported[r] = 1; });
      chrome.runtime.sendMessage({ type: 's2Discover', platform: 'tiktok', refs: fresh.slice(0, 30) })
        .then((r) => { if (!r || !r.ok) fresh.forEach((x) => { delete reported[x]; }); })
        .catch(() => { fresh.forEach((x) => { delete reported[x]; }); });
    } catch (e) {   }
  }
  setTimeout(scanChannel, 4000);
  setInterval(scanChannel, 60000);

  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
