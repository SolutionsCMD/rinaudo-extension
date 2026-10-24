(function () {
  const COMPOSER_SEL = [
    '[contenteditable="true"][aria-label^="Comment as " i]',
    '[contenteditable="true"][aria-label^="Write a comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '[role="textbox"][aria-label*="comment" i]',
    'div[contenteditable="true"][role="textbox"]',
  ].join(', ');
  const TOP_COMPOSER_SEL = [
    '[contenteditable="true"][aria-label^="Comment as " i]',
    '[contenteditable="true"][aria-label^="Write a comment" i]',
    '[contenteditable="true"][aria-label^="Write a public comment" i]',
  ].join(', ');

  function loginState() {
    try {
      if (/(^|;\s*)c_user=\d+/.test(document.cookie || '')) return 'in';
    } catch {   }
    try {
      const html = document.documentElement ? document.documentElement.innerHTML : '';
      const m = html.match(/"USER_ID"\s*:\s*"(\d+)"/);
      if (m) return m[1] === '0' ? 'out' : 'in';
    } catch {   }
    return 'unknown';
  }

  let shareClickAt = 0;
  const SHARE_SHEET_MS = 20000;
  function isShareControl(t) {
    try {
      const el = t && t.closest ? t.closest('[role="button"], button, [aria-label]') : null;
      if (!el || el.closest('[role="dialog"]')) return false;
      return /share|send this/i.test((el.getAttribute('aria-label') || '').trim());
    } catch { return false; }
  }
  let likeClickAt = 0;
  try {
    document.addEventListener('click', (e) => {
      if (fromOurUi(e)) return;
      try { if (isShareControl(e.target)) shareClickAt = Date.now(); } catch {   }
      try {
        const like = adapter.likeTarget(e.target);
        if (like && inRoot(focalRoot(), like)) likeClickAt = Date.now();
      } catch {   }
    }, true);
  } catch {   }

  let lastWatchDiag = 0;
  function watchDiag(chosen) {
    try {
      if (Date.now() - lastWatchDiag < 30000) return;
      lastWatchDiag = Date.now();
      const vids = Array.from(document.querySelectorAll('video')).slice(0, 6);
      const shot = vids.map((v, i) => {
        const r = v.getBoundingClientRect();
        return {
          i,
          paused: !!v.paused, ended: !!v.ended, muted: !!v.muted,
          vol: Math.round((v.volume || 0) * 10) / 10,
          t: Math.round(v.currentTime || 0),
          dur: isFinite(v.duration) ? Math.round(v.duration) : null,
          w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
          picked: v === chosen,
        };
      });
      chrome.runtime.sendMessage({ type: 's2Debug', kind: 'fbwatch',
        data: { n: document.querySelectorAll('video').length, path: location.pathname, vids: shot } });
    } catch {   }
  }
  self.RGCFbWatchDiag = watchDiag;

  const LIKE_SEL = '[aria-label="Like"], [aria-label="Remove Like"]';
  const LIKE_RE = /^(like|remove like)$/i;
  const labelOf = (el) => { try { return (el.getAttribute('aria-label') || '').trim(); } catch { return ''; } };
  function englishUi() {
    try { return /^en\b/i.test((document.documentElement && document.documentElement.lang) || ''); }
    catch { return false; }
  }

  function fromOurUi(e) {
    try {
      const g = self.RGCGuide;
      if (g && typeof g.ownsEvent === 'function' && g.ownsEvent(e)) return true;
      const path = e && typeof e.composedPath === 'function' ? e.composedPath() : [];
      for (const n of path) {
        const id = n && n.id;
        if (typeof id === 'string' && id.slice(0, 4) === 'rgc-') return true;
      }
    } catch {   }
    return false;
  }

  function inRoot(root, el) {
    try { return root === document || (!!root && typeof root.contains === 'function' && root.contains(el)); }
    catch { return false; }
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
  function playerBoxes() {
    const out = [];
    try {
      for (const v of Array.from(document.querySelectorAll('video')).slice(0, 8)) {
        let b = videoBox(v);
        if (b === v) b = v.parentElement;
        if (b) out.push(b);
      }
    } catch {   }
    return out;
  }
  function inPlayer(el, boxes) {
    try { return (boxes || playerBoxes()).some((b) => b !== el && b.contains(el)); }
    catch { return false; }
  }

  function inComment(el) {
    try {
      if (el.closest('[aria-label^="Comment by " i], [aria-label^="Reply by " i]')) return true;
      const art = el.closest('[role="article"]');
      if (!art) return false;
      for (const a of art.querySelectorAll('a[href*="comment_id="]')) {
        if (a.closest('[role="article"]') === art) return true;
      }
      return false;
    } catch { return false; }
  }

  function hasLikeCandidate(n, boxes) {
    for (const el of n.querySelectorAll(LIKE_SEL)) if (!inComment(el)) return true;
    if (englishUi()) return false;
    for (const el of n.querySelectorAll('[role="button"][aria-pressed], button[aria-pressed]')) {
      if (!inPlayer(el, boxes) && !inComment(el)) return true;
    }
    return false;
  }

  function postDialog() {
    try {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = dialogs.length - 1; i >= 0; i--) {
        const d = dialogs[i];
        if (d.querySelector('video') || d.querySelector(LIKE_SEL)
            || d.querySelector('[contenteditable="true"][aria-label*="comment" i]')) return d;
      }
    } catch {   }
    return null;
  }

  function focalRoot() {
    try {
      const dlg = postDialog();
      if (dlg) return dlg;
      const v = adapter.getVideoEl();
      if (v) {
        const boxes = playerBoxes();
        for (let n = v.parentElement, i = 0; n && i < 25; n = n.parentElement, i++) {
          if (n === document.body || n === document.documentElement) break;
          if (hasLikeCandidate(n, boxes)) return n;
        }
      }
      return document.querySelector('[role="main"]') || document.body || document;
    } catch { return document; }
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

  function actionBarCommentIn(root) {
    for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
      if (!/(^comments?$)|(^leave a comment)|(^write a comment)/i.test(labelOf(el))) continue;
      let inComposer = false, up = el;
      for (let i = 0; i < 8 && up; i++) {
        up = up.parentElement;
        if (!up || up === document.body || up === document.documentElement) break;
        if (up.querySelector && up.querySelector(COMPOSER_SEL)) { inComposer = true; break; }
      }
      if (inComposer || inComment(el)) continue;
      if (pointerOk(el)) return el;
    }
    return null;
  }

  const adapter = {
    platform: 'facebook',
    earnBlocked() {
      return loginState() === 'out'
        ? 'Sign in to Facebook to collect tickets. Nothing here will pay while you are signed out.'
        : null;
    },
    loginState,
    likeNetworkPageScoped: true,
    repostNetworkPageScoped: true,
    actions: { watch: true, like: true, comment: true },
    submitOnEnter: true,
    getRef() {
      try {
        const path = location.pathname || '';
        let m = path.match(/\/reel\/(\d+)/);
        if (m) return m[1];
        m = path.match(/\/[^/]+\/videos\/(\d+)/);
        if (m) return m[1];
        m = path.match(/\/[^/]+\/posts\/([^/?#]+)/);
        if (m) return m[1];
        const qs = new URLSearchParams(location.search || '');
        const v = qs.get('v');
        if (v && /^\d+$/.test(v)) return v;
        const story = qs.get('story_fbid');
        if (story && /^\d+$/.test(story)) return story;
        return '';
      } catch (e) { return ''; }
    },
    isLiked() {
      try {
        const root = focalRoot();
        let sawLabelled = false;
        for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
          const label = labelOf(el);
          if (!LIKE_RE.test(label) || inComment(el)) continue;
          sawLabelled = true;
          if (/^remove like$/i.test(label)) return true;
          if (el.getAttribute('aria-pressed') === 'true') return true;
        }
        if (sawLabelled) return false;
        if (englishUi()) return false;
        const boxes = playerBoxes();
        let n = 0;
        for (const el of root.querySelectorAll('[role="button"][aria-pressed="true"], button[aria-pressed="true"]')) {
          if (inPlayer(el, boxes) || inComment(el)) continue;
          if (++n > 1) return false;
        }
        return n === 1;
      } catch (e) { return false; }
    },
    likeTarget(t) {
      try {
        if (!t || !t.closest) return null;
        const byLabel = t.closest(LIKE_SEL);
        if (byLabel) return inComment(byLabel) ? null : byLabel;
        const btn = t.closest('[role="button"], button');
        if (!btn) return null;
        if (LIKE_RE.test(labelOf(btn))) return inComment(btn) ? null : btn;
        if (!btn.hasAttribute('aria-pressed')) return null;
        if (englishUi() || inPlayer(btn) || inComment(btn)) return null;
        return btn;
      } catch (e) { return null; }
    },
    likeIntentWithin(ms) {
      const win = typeof ms === 'number' && ms > 0 ? ms : 20000;
      return likeClickAt > 0 && Date.now() - likeClickAt <= win;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest(COMPOSER_SEL) : null; },
    composerSel: COMPOSER_SEL,
    commentText() {
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.textContent || el.innerText || el.value || '').trim();
        if (v) return v;
      }
      return '';
    },
    commentSubmitTarget(t) {
      if (!t || !t.closest) return null;
      const b = t.closest('[role="button"], button');
      if (!b) return null;
      if (!/^(comment|post|send)$/i.test((b.getAttribute('aria-label') || '').trim())) return null;
      let el = b;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement; if (!el) break;
        if (el.querySelector(COMPOSER_SEL)) return b;
      }
      return null;
    },
    watchDiag(chosen) { try { watchDiag(chosen); } catch {   } },
    getVideoEl() {
      try {
        const vids = Array.from(document.querySelectorAll('video'));
        if (vids.length <= 1) return vids[0] || null;
        const onScreen = (v) => {
          const r = v.getBoundingClientRect();
          const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
          const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
          return h * w;
        };
        const playing = vids.filter((v) => !v.paused && !v.ended);
        const pool = playing.length ? playing : vids;
        return pool.reduce((best, v) => (onScreen(v) > onScreen(best) ? v : best), pool[0]);
      } catch (e) { return document.querySelector('video'); }
    },

    repostTarget(t) {
      if (!t || !t.closest) return null;
      const byLabel = t.closest('[aria-label="Share now"]');
      if (byLabel) return byLabel;
      const btn = t.closest('[role="button"], button');
      if (!btn) return null;
      if (/^share now$/i.test((btn.getAttribute('aria-label') || '').trim())) return btn;
      const dlg = btn.closest('[role="dialog"]');
      if (dlg) return btn;
      const sheet = btn.closest('[role="menu"], [role="listbox"], [data-visualcompletion="ignore-dynamic"]');
      return sheet ? btn : null;
    },
    repostPresent() {
      try {
        return !!document.querySelector('[aria-label="Share"], [aria-label="Share now"], [aria-label="Send this to friends or post it on your profile."], [role="button"][aria-haspopup="dialog"]');
      } catch (e) { return false; }
    },
    repostToastRe: /shared to your (profile|story|feed)|shared to news ?feed|posted to your (profile|story)/i,


    likePointerTarget() {
      try {
        if (!adapter.getRef()) return null;
        const root = focalRoot();
        for (const el of root.querySelectorAll('[aria-label="Like"]')) {
          const ctrl = el.closest('[role="button"], button') || el;
          if (ctrl.getAttribute('aria-pressed') === 'true' || inComment(ctrl)) continue;
          if (pointerOk(ctrl)) return ctrl;
        }
      } catch (e) {   }
      return null;
    },
    commentPointerTarget() {
      try {
        if (!adapter.getRef()) return null;
        const root = focalRoot();
        for (const box of root.querySelectorAll(COMPOSER_SEL)) {
          if (!inComment(box) && pointerOk(box)) return box;
        }
        if (/\/reel\/|\/videos\/|^\/watch\/?$/.test(location.pathname || '')) {
          for (const box of document.querySelectorAll(TOP_COMPOSER_SEL)) {
            if (!inComment(box) && pointerOk(box)) return box;
          }
        }
        return actionBarCommentIn(root);
      } catch (e) { return null; }
    },
    repostPointerTarget() {
      try {
        if (!adapter.getRef()) return null;
        if (Date.now() - shareClickAt <= SHARE_SHEET_MS) {
          for (const el of document.querySelectorAll('[aria-label="Share now"]')) {
            const ctrl = el.closest('[role="button"], button') || el;
            if (pointerOk(ctrl)) return ctrl;
          }
        }
        const root = focalRoot();
        const ok = (el) => {
          const ctrl = el.closest('[role="button"], button') || el;
          const dlg = ctrl.closest('[role="dialog"]');
          if (dlg && dlg !== root && !dlg.contains(root)) return null;
          if (inComment(ctrl)) return null;
          return pointerOk(ctrl) ? ctrl : null;
        };
        for (const el of root.querySelectorAll('[aria-label="Share"], [aria-label="Send this to friends or post it on your profile."]')) {
          const c = ok(el); if (c) return c;
        }
        for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
          if (!/^share\b|^send this/i.test(labelOf(el))) continue;
          const c = ok(el); if (c) return c;
        }
      } catch (e) {   }
      return null;
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    repostHighlightTarget() { return adapter.repostPointerTarget(); },
    repostDialogHighlightTargets() {
      try {
        if (!this.getRef()) return null;
        if (Date.now() - shareClickAt > SHARE_SHEET_MS) return null;
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        return Array.from(dlg.querySelectorAll('[role="button"], button'))
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
          .slice(0, 3);
      } catch (e) { return null; }
    },

    watchPillFixed: true,
    playerHost() {
      try {
        const v = adapter.getVideoEl();
        if (!v) return null;
        const dlg = postDialog();
        if (dlg && !dlg.contains(v)) return null;
        return videoBox(v);
      } catch (e) { return null; }
    },
    isAdPlaying() { return false; },
    muteControl() { return null; },
    playControl() { return null; },
  };
  self.RGC_FB_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
