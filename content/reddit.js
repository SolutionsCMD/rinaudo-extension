(function () {
  const HANDLE = 'mizkif';

  function refFromPath(path) {
    const m = (path || '').match(/\/comments\/([a-z0-9]{4,13})(?:\/[^/?#]*(?:\/([a-z0-9]{4,13}))?)?/i);
    if (!m) return '';
    return (m[2] ? 't1_' + m[2] : 't3_' + m[1]).toLowerCase();
  }

  function nodeForRef(ref) {
    if (!ref) return null;
    try {
      return document.querySelector(
        `shreddit-post[id="${ref}"], shreddit-comment[thingid="${ref}"], [data-fullname="${ref}"], #thing_${ref}`)
        || null;
    } catch { return null; }
  }

  function deepFind(root, match, depth) {
    if (!root || depth > 5) return null;
    let nodes;
    try { nodes = root.querySelectorAll('*'); } catch { return null; }
    for (const el of nodes) {
      try { if (match(el)) return el; } catch {   }
      if (el.shadowRoot) {
        const hit = deepFind(el.shadowRoot, match, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  const isUpvoteBtn = (el) =>
    el.tagName === 'BUTTON' && el.hasAttribute && el.hasAttribute('upvote');

  function upvoteButton(ref) {
    const host = nodeForRef(ref);
    if (!host) return null;
    return deepFind(host.shadowRoot || host, isUpvoteBtn, 0)
      || (host.querySelector ? host.querySelector('.arrow.up, .arrow.upmod') : null);
  }

  function upvotedState(ref) {
    const btn = upvoteButton(ref);
    if (!btn) return null;
    const pressed = btn.getAttribute && btn.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    if (btn.classList && btn.classList.contains('upmod')) return true;
    return null;
  }


  function closestAcross(el, sel) {
    let n = el;
    for (let hops = 0; n && hops < 16; hops++) {
      const hit = n.closest ? n.closest(sel) : null;
      if (hit) return hit;
      const root = typeof n.getRootNode === 'function' ? n.getRootNode() : null;
      n = root && root.host ? root.host : null;
    }
    return null;
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

  const isEditable = (el) =>
    (el.getAttribute && el.getAttribute('contenteditable') === 'true') || el.tagName === 'TEXTAREA';

  function composerAccept(ref) {
    const isComment = ref.startsWith('t1_');
    const focal = isComment ? nodeForRef(ref) : null;
    return (el) => {
      const owner = closestAcross(el, 'shreddit-comment, .thing.comment');
      return isComment ? (!!focal && owner === focal) : !owner;
    };
  }

  const DEEP_RETRY_MS = 10000;
  let deepCache = { ref: '', el: null, at: 0 };
  let deepStale = true;
  const markDeepStale = () => { deepStale = true; };
  try {
    for (const t of ['scroll', 'click', 'focusin']) document.addEventListener(t, markDeepStale, { capture: true, passive: true });
    document.addEventListener('visibilitychange', markDeepStale);
  } catch {   }
  function deepComposer(ref, accept) {
    const c = deepCache;
    if (c.ref === ref && c.el && c.el.isConnected !== false && accept(c.el) && pointerOk(c.el)) return c.el;
    if (c.ref === ref && (!deepStale || Date.now() - c.at < DEEP_RETRY_MS)) return null;
    deepStale = false;
    const hit = deepFind(document, (el) => isEditable(el) && accept(el) && pointerOk(el), 0);
    deepCache = { ref, el: hit || null, at: Date.now() };
    return hit || null;
  }

  let lastUpvoteAt = 0;
  let lastUpvoteRef = '';
  let lastUpvoteBtn = null;
  document.addEventListener('click', (e) => {
    try {
      if (fromOurUi(e)) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const btn = path.find((el) => { try { return isUpvoteBtn(el); } catch { return false; } });
      if (!btn) return;
      lastUpvoteAt = Date.now();
      lastUpvoteBtn = btn;
      lastUpvoteRef = '';
      for (const el of path) {
        const tag = el && el.tagName;
        if (tag === 'SHREDDIT-POST' && el.getAttribute) { lastUpvoteRef = String(el.getAttribute('id') || '').toLowerCase(); break; }
        if (tag === 'SHREDDIT-COMMENT' && el.getAttribute) { lastUpvoteRef = String(el.getAttribute('thingid') || '').toLowerCase(); break; }
      }
    } catch {   }
  }, true);

  const adapter = {
    platform: 'reddit',
    actions: { like: true, comment: true },
    refFromPath,
    getRef() { return refFromPath(location.pathname); },

    isLiked() { return upvotedState(this.getRef()) === true; },
    isLikedFocal() { return upvotedState(this.getRef()); },
    likeTarget(t) {
      if (Date.now() - lastUpvoteAt > 2000) return null;
      const ref = this.getRef();
      if (lastUpvoteRef && lastUpvoteRef !== ref) return null;
      const host = nodeForRef(ref);
      if (!host) return null;
      if (!((t && host.contains && host.contains(t)) || t === host)) return null;
      return lastUpvoteBtn && lastUpvoteBtn.isConnected !== false ? lastUpvoteBtn : host;
    },

    commentSubmitTarget(t) {
      return t && t.closest
        ? t.closest('button[slot="submit-button"], button[type="submit"], .save, [data-testid="comment-submission-form-submit"]')
        : null;
    },
    submitOnEnter: false,
    submitOnCtrlEnter: true,
    commentInputTarget(t) {
      return t && t.closest ? t.closest('shreddit-composer, [contenteditable="true"], textarea[name="text"]') : null;
    },
    composerSel: 'shreddit-composer [contenteditable="true"], [contenteditable="true"], textarea[name="text"]',
    commentText() {
      try {
        for (const el of document.querySelectorAll(this.composerSel)) {
          const v = (el.value != null ? el.value : el.textContent || '').trim();
          if (v) return v;
        }
      } catch {   }
      return '';
    },

    notice() {
      const ref = this.getRef();
      if (!ref) return null;
      return ref.startsWith('t1_')
        ? 'This is one of his comments. The upvote pays here too.'
        : 'His replies pay too. Open a reply from the earn page to collect on it.';
    },

    likePointerTarget() {
      try {
        const btn = upvoteButton(adapter.getRef());
        if (!btn) return null;
        if (btn.getAttribute && btn.getAttribute('aria-pressed') === 'true') return null;
        if (btn.classList && btn.classList.contains('upmod')) return null;
        return pointerOk(btn) ? btn : null;
      } catch { return null; }
    },
    commentPointerTarget() {
      try {
        const ref = adapter.getRef();
        if (!ref) return null;
        const accept = composerAccept(ref);
        for (const el of document.querySelectorAll(adapter.composerSel)) {
          if (accept(el) && pointerOk(el)) return el;
        }
        const deep = deepComposer(ref, accept);
        if (deep) return deep;
        if (!ref.startsWith('t3_')) return null;
        const host = nodeForRef(ref);
        if (!host) return null;
        const BTN = 'button[aria-label*="omment" i], a[data-click-id="comments"]';
        const own = (host.querySelector && host.querySelector(BTN))
          || (host.shadowRoot ? deepFind(host.shadowRoot, (el) => el.matches && el.matches(BTN), 0) : null);
        return own && pointerOk(own) ? own : null;
      } catch { return null; }
    },
    likeHighlightTarget() { return adapter.likePointerTarget(); },
    commentHighlightTarget() { return adapter.commentPointerTarget(); },
    isAdPlaying() { return false; },
    getVideoEl() { return null; },
  };

  self.RGC_REDDIT_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  const onHisProfile = () =>
    new RegExp('^/(?:u|user)/' + HANDLE + '(?:/|$)', 'i').test(location.pathname);

  function visibleRefs() {
    const out = [];
    try {
      for (const a of document.querySelectorAll('a[href*="/comments/"]')) {
        const ref = refFromPath(a.getAttribute('href') || '');
        if (ref && out.indexOf(ref) === -1) out.push(ref);
        if (out.length >= 30) break;
      }
      for (const el of document.querySelectorAll('shreddit-post[id], [data-fullname]')) {
        const ref = String(el.getAttribute('id') || el.getAttribute('data-fullname') || '').toLowerCase();
        if (/^t[13]_[a-z0-9]{4,13}$/.test(ref) && out.indexOf(ref) === -1) out.push(ref);
        if (out.length >= 30) break;
      }
    } catch {   }
    return out;
  }

  let lastSent = '';
  function scan() {
    if (!onHisProfile() || document.visibilityState === 'hidden') return;
    const refs = visibleRefs();
    if (!refs.length) return;
    const key = refs.join(',');
    if (key === lastSent) return;
    lastSent = key;
    try {
      chrome.runtime.sendMessage({ type: 's2Discover', platform: 'reddit', refs })
        .then((r) => { if (!r || !r.ok) lastSent = ''; })
        .catch(() => { lastSent = ''; });
    } catch (_) { lastSent = ''; }
  }

  setInterval(scan, 60_000);
  scan();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scan(); });
})();
