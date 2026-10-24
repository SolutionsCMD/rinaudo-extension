(function () {
  let lastStatusRef = '';
  let lastRetweetClick = { ref: '', at: 0 };
  const COMMENT_ID_RE = /^[\w.-]{1,120}$/;
  const adapter = {
    platform: 'x',
    actions: { like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/status\/(\d+)/); return m ? m[1] : ''; },
    getRef() {
      const r = this.refFromPath(location.pathname);
      if (r) { lastStatusRef = r; return r; }
      if (lastStatusRef && document.querySelector('[role="dialog"][aria-modal="true"] [data-testid^="tweetTextarea_"]')) {
        return lastStatusRef;
      }
      lastStatusRef = '';
      return '';
    },
    isLiked() { return !!document.querySelector('[data-testid="unlike"]'); },
    isLikedFocal() {
      const card = articleForRef(this.getRef());
      if (!card) return null;
      try { return !!card.querySelector('[data-testid="unlike"]'); } catch { return null; }
    },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') : null; },
    submitOnEnter: false,
    submitOnCtrlEnter: true,
    commentInputTarget(t) { return t && t.closest ? t.closest('[data-testid^="tweetTextarea_"], [role="textbox"]') : null; },
    composerSel: '[data-testid^="tweetTextarea_"], [role="textbox"]',
    commentText() {
      for (const el of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    repostTarget(t) { return t && t.closest ? t.closest('[data-testid="retweet"], [data-testid="retweetConfirm"]') : null; },
    isReposted(root) {
      try {
        const scope = root || articleForRef(this.getRef()) || document;
        return !!scope.querySelector('[data-testid="unretweet"]');
      } catch { return false; }
    },
    isRepostedFocal() {
      const card = articleForRef(this.getRef());
      if (!card) return null;
      try { return !!card.querySelector('[data-testid="unretweet"]'); } catch { return null; }
    },
    repostPresent() { try { return !!document.querySelector('[data-testid="retweet"], [data-testid="unretweet"]'); } catch { return false; } },
    likePointerTarget() {
      try {
        const card = focalCard();
        const c = card && ownControl(card, 'like');
        return c && pointerOk(c) ? c : null;
      } catch { return null; }
    },
    commentPointerTarget() {
      try {
        const card = focalCard();
        if (!card) return null;
        for (const box of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
          if (box.closest('[role="dialog"]')) continue;
          if (typeof card.compareDocumentPosition !== 'function' || !(card.compareDocumentPosition(box) & 4)) continue;
          if (pointerOk(box)) return box;
        }
        const r = ownControl(card, 'reply');
        return r && pointerOk(r) ? r : null;
      } catch { return null; }
    },
    repostPointerTarget() {
      try {
        const card = focalCard();
        if (!card) return null;
        const ref = adapter.getRef();
        if (lastRetweetClick.ref === ref && Date.now() - lastRetweetClick.at < 15000) {
          const confirm = document.querySelector('[data-testid="retweetConfirm"]');
          if (confirm && pointerOk(confirm)) return confirm;
        }
        const c = ownControl(card, 'retweet');
        return c && pointerOk(c) ? c : null;
      } catch { return null; }
    },
    commentLikePointerTarget() {
      try {
        if (!focalCard()) return null;
        const focal = adapter.getRef();
        const cards = outermostArticles();
        const focalC = cards.find((c) => ownTimeRef(c) === focal) || null;
        if (!focalC || typeof focalC.compareDocumentPosition !== 'function') return null;
        let stop = null;
        for (const hd of document.querySelectorAll('h2, [role="heading"]')) {
          if (hd.closest('article')) continue;
          if (focalC.compareDocumentPosition(hd) & 4) { stop = hd; break; }
        }
        let me = '';
        try {
          const nav = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
          me = ((nav && nav.getAttribute('href')) || '').replace(/^\//, '').split(/[/?#]/)[0].toLowerCase();
        } catch { me = ''; }
        for (const c of cards) {
          if (c === focalC || !(focalC.compareDocumentPosition(c) & 4)) continue;
          if (stop && (stop.compareDocumentPosition(c) & 4)) break;
          if (me) {
            let author = '';
            try {
              const a = c.querySelector('[data-testid="User-Name"] a[href^="/"]');
              author = ((a && a.getAttribute('href')) || '').replace(/^\//, '').split(/[/?#]/)[0].toLowerCase();
            } catch { author = ''; }
            if (author && author === me) continue;
          }
          const id = ownTimeRef(c);
          if (!id || id === focal || !COMMENT_ID_RE.test(id)) continue;
          const ctrl = likeControlIn(c);
          if (!ctrl || ctrl.getAttribute('data-testid') !== 'like') continue;
          if (pointerOk(ctrl)) return ctrl;
        }
        return null;
      } catch { return null; }
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    repostHighlightTarget() { return adapter.repostPointerTarget(); },
    isAdPlaying() { return false; },
    commentLikeRequiresFlip: true,
    commentLikeScan() {
      try {
        const focal = adapter.getRef();
        if (!focal) return [];
        const rows = [], seen = new Set();
        const cards = outermostArticles();
        const focalCard = cards.find((c) => ownTimeRef(c) === focal) || null;
        if (!focalCard || typeof focalCard.compareDocumentPosition !== 'function') return [];
        for (const card of cards) {
          if (card !== focalCard && (focalCard.compareDocumentPosition(card) & 2)) continue;
          try {
            const id = ownTimeRef(card);
            if (!id || id === focal) continue;
            if (!COMMENT_ID_RE.test(id)) continue;
            if (seen.has(id)) continue;
            const ctrl = likeControlIn(card);
            if (!ctrl) continue;
            seen.add(id);
            rows.push({ id, liked: ctrl.getAttribute('data-testid') === 'unlike' });
          } catch { continue; }
        }
        return rows;
      } catch { return []; }
    },
    commentLikeTarget(t) {
      try {
        if (!t || !t.closest) return null;
        const ctrl = t.closest('[data-testid="like"]');
        if (!ctrl) return null;
        const card = ctrl.closest('article');
        if (!card || !isOutermostArticle(card)) return null;
        const id = ownTimeRef(card);
        if (!id) return null;
        return adapter.commentLikeScan().some((r) => r.id === id) ? ctrl : null;
      } catch { return null; }
    },
    commentLikePresent() {
      try { return outermostArticles().some((c) => !!likeControlIn(c)); } catch { return false; }
    },
    getVideoEl() { return null; },
  };
  self.RGC_X_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  const onStatusPage = () => /\/status\/\d+/.test(location.pathname);

  function cardRef(fromEl) {
    const art = fromEl.closest && fromEl.closest('article');
    if (!art) return '';
    const timeLink = Array.from(art.querySelectorAll('a[href*="/status/"]'))
      .find((a) => a.querySelector('time') && a.closest('article') === art);
    const a = timeLink || art.querySelector('a[href*="/status/"]');
    const m = a && (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return m ? m[1] : '';
  }

  function isOutermostArticle(art) {
    try { return !art.parentElement || !art.parentElement.closest('article'); } catch { return false; }
  }
  function outermostArticles() {
    try { return Array.from(document.querySelectorAll('article')).filter(isOutermostArticle); }
    catch { return []; }
  }

  function ownTimeRef(card) {
    try {
      const ref = cardRef(card);
      if (!ref) return '';
      const own = Array.from(card.querySelectorAll('a[href*="/status/"]'))
        .find((a) => a.querySelector('time') && a.closest('article') === card);
      const m = own && (own.getAttribute('href') || '').match(/\/status\/(\d+)/);
      return m && m[1] === ref ? ref : '';
    } catch { return ''; }
  }

  function likeControlIn(card) {
    try {
      return Array.from(card.querySelectorAll('[data-testid="like"],[data-testid="unlike"]'))
        .find((b) => b.closest('article') === card) || null;
    } catch { return null; }
  }

  function focalCard() {
    try {
      const ref = adapter.getRef();
      if (!ref || adapter.refFromPath(location.pathname) !== ref) return null;
      return articleForRef(ref);
    } catch { return null; }
  }
  function ownControl(card, testid) {
    try {
      return Array.from(card.querySelectorAll(`[data-testid="${testid}"]`))
        .find((b) => b.closest('article') === card) || null;
    } catch { return null; }
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
        const st = n === el ? cs : gcs(n);
        if (st && parseFloat(st.opacity) < 0.05) return false;
        const root = !n.parentElement && typeof n.getRootNode === 'function' ? n.getRootNode() : null;
        n = n.parentElement || (root && root.host) || null;
      }
      return true;
    } catch { return false; }
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

  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#15202b;color:#fff;border:1px solid #38444d;border-radius:10px;padding:10px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);transition:opacity .2s;pointer-events:none;';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2500);
  }

  const xr = { like: 0, comment: 0, repost: 0 };
  async function refreshRewards() {
    try {
      const d = await sendMsg({ type: 's2Targets' });
      if (d) {
        xr.like = (d.xLikeReward != null ? d.xLikeReward : d.likeReward) || 0;
        xr.comment = (d.xCommentReward != null ? d.xCommentReward : d.commentReward) || 0;
        xr.repost = d.repostReward || 0;
      }
    } catch {   }
  }
  refreshRewards(); setInterval(refreshRewards, 5 * 60000);
  const rewardText = (n) => (n > 0 ? `🎟 +${n}` : '✓');

  function dbg(data) { sendMsg({ type: 's2Debug', kind: 'xcomment', data }); }
  function rdbg(data) { sendMsg({ type: 's2Debug', kind: 'xrepost', data }); }
  self.RGCXRepostDbg = rdbg;
  document.addEventListener('click', (e) => {
    if (fromOurUi(e)) return;
    const txt = (adapter.commentText() || '').trim();
    if (!txt) return;
    const el = e.target.closest && e.target.closest('[data-testid],[role="button"],button');
    const testid = el && (el.getAttribute('data-testid') || el.getAttribute('role') || el.tagName);
    dbg({ ev: 'click', onStatus: onStatusPage(), textLen: txt.length, clickedTestid: testid || null,
          submitMatched: !!adapter.commentSubmitTarget(e.target) });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || fromOurUi(e)) return;
    const txt = (adapter.commentText() || '').trim();
    if (!txt) return;
    dbg({ ev: 'key', onStatus: onStatusPage(), textLen: txt.length, meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey });
  }, true);

  function sendMsg(msg) {
    try { return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null); }
    catch { return Promise.resolve(null); }
  }

  const firedLike = new Set();
  document.addEventListener('click', async (e) => {
    if (fromOurUi(e)) return;
    if (onStatusPage()) return;
    const btn = e.target.closest && e.target.closest('[data-testid="like"]');
    if (!btn) return;
    const ref = cardRef(btn);
    if (!ref || firedLike.has(ref)) return;
    firedLike.add(ref);
    const r = await sendMsg({ type: 's2Engagement', platform: 'x', action: 'like', ref });
    if (r && !r.error) { if (r.credited && r.awarded) toast(`${rewardText(xr.like)} for liking`); }
    else firedLike.delete(ref);
  }, true);

  let replyRef = '';
  document.addEventListener('click', (e) => {
    if (fromOurUi(e)) return;
    const reply = e.target.closest && e.target.closest('[data-testid="reply"]');
    if (reply) {
      replyRef = cardRef(reply) || adapter.refFromPath(location.pathname);
      return;
    }
    if (onStatusPage()) return;
    const submit = e.target.closest && e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
    if (submit && replyRef) fireTimelineComment();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (onStatusPage() || fromOurUi(e)) return;
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !replyRef) return;
    fireTimelineComment();
  }, true);

  function fireTimelineComment() {
    const text = (adapter.commentText() || '').trim();
    const ref = replyRef; replyRef = '';
    if (!ref || text.length <= 5) return;
    sendMsg({ type: 's2Engagement', platform: 'x', action: 'comment', ref })
      .then((r) => { if (r && r.credited && r.awarded) toast(`${rewardText(xr.comment)} for commenting`); });
  }

  const firedRepost = new Set();
  let pendingRepost = null;
  const REPOST_WINDOW_MS = 90000;
  const FLIP_TRIES = 10, FLIP_INTERVAL_MS = 400;
  document.addEventListener('click', (e) => {
    if (fromOurUi(e)) return;
    const btn = e.target.closest && e.target.closest('[data-testid="retweet"]');
    if (!btn) return;
    const ref = cardRef(btn);
    lastRetweetClick = { ref: ref || '', at: Date.now() };
    if (ref) pendingRepost = { ref, until: Date.now() + REPOST_WINDOW_MS };
  }, true);

  function articleForRef(ref) {
    try {
      if (!/^\d+$/.test(ref)) return null;
      const link = document.querySelector(`a[href*="/status/${ref}"]`);
      const near = link && link.closest ? link.closest('article') : null;
      if (near && cardRef(near) === ref) return near;
      for (const art of document.querySelectorAll('article')) if (cardRef(art) === ref) return art;
    } catch {   }
    return null;
  }
  function repostedFor(ref) {
    const art = articleForRef(ref);
    if (art) return adapter.isReposted(art);
    if (adapter.refFromPath(location.pathname) === ref) return adapter.isReposted();
    return false;
  }
  function whenReposted(ref, onFlipped) {
    let tries = 0;
    (function tick() {
      let flipped = false;
      try { flipped = !!repostedFor(ref); } catch { flipped = false; }
      if (flipped) { try { onFlipped(); } catch {   } return; }
      if (++tries >= FLIP_TRIES) return;
      setTimeout(tick, FLIP_INTERVAL_MS);
    })();
  }

  window.addEventListener('message', (e) => {
    try {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.rgcObs !== 1 || d.ok !== true || d.platform !== 'x' || d.kind !== 'repost') return;
      if (!pendingRepost || Date.now() >= pendingRepost.until) return;
      const ref = d.ref == null ? '' : String(d.ref);
      if (!ref || ref !== pendingRepost.ref) return;
      const engage = self.RGCEngage;
      if (engage && typeof engage.ownsConfirmation === 'function' && engage.ownsConfirmation('repost', ref)) {
        pendingRepost = null;
        return;
      }
      if (firedRepost.has(ref)) return;
      whenReposted(ref, () => {
        if (firedRepost.has(ref)) return;
        firedRepost.add(ref);
        rdbg({ path: 'feed-confirm', ref, onStatus: onStatusPage(),
               cardFound: !!articleForRef(ref), focal: adapter.isRepostedFocal(),
               docWide: adapter.isReposted() });
        if (pendingRepost && pendingRepost.ref === ref) pendingRepost = null;
        sendMsg({ type: 's2Engagement', platform: 'x', action: 'repost', ref })
          .then((r) => {
            if (r && !r.error) { if (r.credited && r.awarded) toast(`${rewardText(xr.repost)} for reposting`); }
            else firedRepost.delete(ref);
          });
      });
    } catch {   }
  });
})();
