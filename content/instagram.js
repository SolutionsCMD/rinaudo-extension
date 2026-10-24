(function () {
  const COMPOSER_SEL = [
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '[role="textbox"][aria-label*="comment" i]',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ].join(', ');

  const LIKE_LABEL_RE = /^(like|unlike)$/i;
  const ACTION_ICON_MIN = 18;
  const LIKED_RED_RE = /rgb\(255,\s*4[0-8],\s*6[0-4]\)|#[Ff][Ff][23][0-9A-Fa-f]{4}/;

  function postRoot() {
    try {
      const m = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(location.pathname || '');
      const own = m ? 'a[href*="/' + m[1] + '"]' : '';
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = dialogs.length - 1; i >= 0; i--) {
        const d = dialogs[i];
        if (d.querySelector('article, video, svg[aria-label="Like"], svg[aria-label="Unlike"]')) return d;
        if (own && d.querySelector(COMPOSER_SEL) && d.querySelector(own)) return d;
      }
    } catch {   }
    return document;
  }
  function inRoot(root, el) {
    try { return root === document || (!!root && typeof root.contains === 'function' && root.contains(el)); }
    catch { return false; }
  }
  function iconOf(ctrl) {
    try {
      if (!ctrl) return null;
      return String(ctrl.tagName || '').toLowerCase() === 'svg' ? ctrl : ctrl.querySelector('svg');
    } catch { return null; }
  }
  function iconLabel(svg) {
    try {
      const a = (svg.getAttribute('aria-label') || '').trim();
      if (a) return a;
      const t = svg.querySelector('title');
      return t ? (t.textContent || '').trim() : '';
    } catch { return ''; }
  }
  function iconSize(svg, renderedOnly) {
    try {
      const r = svg.getBoundingClientRect();
      let w = r ? r.width : 0, hgt = r ? r.height : 0;
      if (!(w > 0 && hgt > 0)) {
        if (renderedOnly) return 0;
        w = parseFloat(svg.getAttribute('width')) || 0;
        hgt = parseFloat(svg.getAttribute('height')) || 0;
      }
      return Math.max(w, hgt);
    } catch { return 0; }
  }
  const isPostHeart = (svg) => !!svg && LIKE_LABEL_RE.test(iconLabel(svg)) && iconSize(svg) >= ACTION_ICON_MIN;
  function isRedHeart(svg) {
    const gcs = typeof getComputedStyle === 'function' ? getComputedStyle : null;
    if (LIKED_RED_RE.test(svg.getAttribute('fill') || '')) return true;
    for (const p of svg.querySelectorAll('path')) {
      const fill = p.getAttribute('fill') || (gcs ? (gcs(p).fill || '') : '');
      if (LIKED_RED_RE.test(fill)) return true;
    }
    return false;
  }

  function pointerOk(el) {
    try {
      if (!el || typeof el.getBoundingClientRect !== 'function' || el.isConnected === false) return false;
      const r = el.getBoundingClientRect();
      if (!r || !(r.width >= 1) || !(r.height >= 1)) return false;
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
      if (vw > 0 && vh > 0 && (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw)) return false;
      const gcs = typeof getComputedStyle === 'function' ? getComputedStyle : null;
      if (!gcs) return true;
      const cs = gcs(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      for (let n = el, hops = 0; n && hops < 25; hops++) {
        const s = n === el ? cs : gcs(n);
        if (s && parseFloat(s.opacity) < 0.05) return false;
        const root = !n.parentElement && typeof n.getRootNode === 'function' ? n.getRootNode() : null;
        n = n.parentElement || (root && root.host) || null;
      }
      return true;
    } catch { return false; }
  }

  function videoBox(v) {
    try {
      const vr = v.getBoundingClientRect();
      if (!(vr.width > 0 && vr.height > 0)) return v.parentElement || v;
      let box = v;
      for (let n = v.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) {
        if (n === document.body || n === document.documentElement) break;
        const r = n.getBoundingClientRect();
        if (Math.abs(r.width - vr.width) > 2 || Math.abs(r.height - vr.height) > 2
            || Math.abs(r.left - vr.left) > 2 || Math.abs(r.top - vr.top) > 2) break;
        box = n;
      }
      return box;
    } catch { return null; }
  }

  function focalIconControl(sel, { allowLink = false, heart = false } = {}) {
    const root = postRoot();
    for (const svg of root.querySelectorAll(sel)) {
      if (heart ? !isPostHeart(svg) : iconSize(svg) < ACTION_ICON_MIN) continue;
      if (!allowLink && svg.closest('a')) continue;
      const ctrl = svg.closest(allowLink ? '[role="button"], button, a' : '[role="button"], button') || svg;
      if (pointerOk(ctrl)) return ctrl;
    }
    return null;
  }

  const adapter = {
    platform: 'instagram',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      try {
        const root = postRoot();
        for (const svg of root.querySelectorAll('[role="button"] svg, button svg, article svg')) {
          if (iconSize(svg, true) < ACTION_ICON_MIN) continue;
          if (isRedHeart(svg)) return true;
        }
      } catch {   }
      return false;
    },
    likeTarget(t) {
      if (!t || !t.closest) return null;
      const b = t.closest('[role="button"], button, svg');
      if (!b) return null;
      const svg = iconOf(b);
      if (!svg) return null;
      if (!isPostHeart(svg)) return null;
      return inRoot(postRoot(), b) ? b : null;
    },
    commentClickGuard(t) {
      try {
        if (!t || !t.closest) return null;
        const b = t.closest('[role="button"], button, svg');
        return b && iconOf(b) ? b : null;
      } catch { return null; }
    },
    commentSubmitTarget(t) {
      const b = t && t.closest ? t.closest('[role="button"], button') : null;
      if (!b) return null;
      if (iconOf(b)) return null;
      let el = b;
      for (let i = 0; i < 4 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        for (const child of el.children) {
          try { if (child.matches && child.matches(COMPOSER_SEL)) return b; } catch (e) {   }
        }
      }
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest(COMPOSER_SEL) : null; },
    composerSel: COMPOSER_SEL,
    commentText() {
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.value || el.textContent || el.innerText || '').trim();
        if (v) return v;
      }
      return '';
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

    repostNetworkPageScoped: true,
    repostTarget(t) {
      if (!t || !t.closest) return null;
      const svg = t.closest('svg[aria-label="Repost"]');
      if (svg) return svg;
      const btn = t.closest('[role="button"], button');
      return btn && btn.querySelector('svg[aria-label="Repost"]') ? btn : null;
    },
    repostPresent() {
      try { return !!document.querySelector('svg[aria-label="Repost"]'); }
      catch (e) { return false; }
    },

    sendClickOnly: true,
    sendTarget(t) {
      if (!t || !t.closest) return null;
      try {
        const svg = t.closest('svg[aria-label="Share Post"], svg[aria-label="Share"], svg[aria-label="Copy link"]');
        if (svg) return svg;
        const a = t.closest('a[href*="twitter.com/share"], a[href*="x.com/share"], a[href*="facebook.com/sharer"], a[href*="api.whatsapp.com/send"]');
        if (a) return a;
        const btn = t.closest('[role="button"], button, a');
        if (!btn) return null;
        if (btn.querySelector('svg[aria-label="Share Post"], svg[aria-label="Share"], svg[aria-label="Copy link"]')) return btn;
        const label = (btn.textContent || '').trim().toLowerCase();
        if (label === 'send' || label === 'copy link') return btn;
        return null;
      } catch (e) { return null; }
    },
    sendPresent() {
      try {
        return !!document.querySelector(
          'svg[aria-label="Share Post"], svg[aria-label="Share"], svg[aria-label="Copy link"]');
      } catch (e) { return false; }
    },
    likePointerTarget() {
      try { return adapter.getRef() ? focalIconControl('svg[aria-label="Like"]', { heart: true }) : null; }
      catch (e) { return null; }
    },
    commentPointerTarget() {
      try {
        if (!adapter.getRef()) return null;
        const root = postRoot();
        for (const el of root.querySelectorAll(COMPOSER_SEL)) if (pointerOk(el)) return el;
        return focalIconControl('svg[aria-label="Comment"]', { allowLink: true });
      } catch (e) { return null; }
    },
    repostPointerTarget() {
      try { return adapter.getRef() ? focalIconControl('svg[aria-label="Repost"]') : null; }
      catch (e) { return null; }
    },
    sendPointerTarget() {
      try { return adapter.getRef() ? focalIconControl('svg[aria-label="Share Post"], svg[aria-label="Share"]') : null; }
      catch (e) { return null; }
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    repostHighlightTarget() { return adapter.repostPointerTarget(); },
    sendHighlightTarget() { return adapter.sendPointerTarget(); },

    watchPillFixed: true,
    playerHost() {
      try {
        const v = adapter.getVideoEl();
        if (!v) return null;
        if (!inRoot(postRoot(), v)) return null;
        return videoBox(v);
      } catch (e) { return null; }
    },
    isAdPlaying() { return false; },
    muteControl() { return null; },
    playControl() { return null; },
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  const IG_HANDLE = 'realmizkif';
  const igReported = Object.create(null);

  const onHisProfile = () => {
    const p = (location.pathname || '').toLowerCase();
    return p === '/' + IG_HANDLE || p === '/' + IG_HANDLE + '/' || p.startsWith('/' + IG_HANDLE + '/reels');
  };

  function igScan() {
    try {
      if (document.visibilityState === 'hidden') return;
      const refs = [];
      const seen = Object.create(null);
      const take = (href) => {
        const m = String(href || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,})/);
        if (!m || seen[m[1]]) return;
        seen[m[1]] = 1; refs.push(m[1]);
      };
      if (onHisProfile()) {
        document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]').forEach((a) => take(a.getAttribute('href')));
      }
      const own = adapter.refFromPath(location.pathname);
      if (own) {
        let mine = false;
        try {
          mine = !!document.querySelector('a[href="/' + IG_HANDLE + '/"], a[href="/' + IG_HANDLE + '"]');
        } catch { mine = false; }
        if (mine) take(location.pathname);
      }
      const fresh = refs.filter((r) => !igReported[r]).slice(0, 30);
      if (!fresh.length) return;
      fresh.forEach((r) => { igReported[r] = 1; });
      chrome.runtime.sendMessage({ type: 's2Discover', platform: 'instagram', refs: fresh })
        .then((r) => { if (!r || !r.ok) fresh.forEach((x) => { delete igReported[x]; }); })
        .catch(() => { fresh.forEach((x) => { delete igReported[x]; }); });
    } catch (e) {   }
  }
  setTimeout(igScan, 4000);
  setInterval(igScan, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') igScan(); });
})();
