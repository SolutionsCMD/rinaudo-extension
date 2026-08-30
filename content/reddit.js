// Reddit adapter for engage-core, plus the discovery scan.
//
// Owner, 2026-08-29: members earn for UPVOTING and COMMENTING on u/mizkif's posts and his
// replies. The upvote is sent as the 'like' action — same one-per-post rule, same ledger
// dedup — so nothing new had to be invented server-side.
//
// Two paths, mirroring the X adapter:
//  1) On a comments permalink → engage-core drives the single-post widget for the thing in
//     the URL (a post t3_, or a comment t1_ when the permalink points at one).
//  2) On his profile → the DISCOVERY scan reports the ids it can see, because this box is
//     blocked from Reddit outright and a member's own browser is not.
//
// Shreddit is web components, so every selector below has a plain-DOM fallback and returns
// null rather than throwing when the markup moves under us; selector_health telemetry
// reports what stopped matching.
(function () {
  const HANDLE = 'mizkif';

  // ---- ref reading ---------------------------------------------------------
  // The canonical ref is Reddit's own thing id: t3_<id> for a post, t1_<id> for a comment.
  // The kind prefix matters — a post and a comment can share a base36 id, and the server
  // keys targets on the full thing id.
  function refFromPath(path) {
    const m = (path || '').match(/\/comments\/([a-z0-9]{4,13})(?:\/[^/?#]*(?:\/([a-z0-9]{4,13}))?)?/i);
    if (!m) return '';
    return (m[2] ? 't1_' + m[2] : 't3_' + m[1]).toLowerCase();
  }

  /** The <shreddit-post> / comment node for a thing id, when one is on the page. */
  function nodeForRef(ref) {
    if (!ref) return null;
    try {
      return document.querySelector(
        `shreddit-post[id="${ref}"], shreddit-comment[thingid="${ref}"], [data-fullname="${ref}"], #thing_${ref}`)
        || null;
    } catch { return null; }
  }

  // SHADOW DOM. Reddit renders the vote controls inside <shreddit-post>'s shadow root, so
  // document.querySelector cannot see them and a click on one retargets to the host
  // element — which is why the first cut of this adapter never credited an upvote
  // (2026-08-30). Both the state read and the click matcher have to descend deliberately.
  //
  // The discriminator is the button's `upvote` ATTRIBUTE, not its aria-label: Reddit ships
  // these buttons with an EMPTY aria-label, and `<button upvote>` / `<button downvote>` is
  // what tells the pair apart. aria-pressed carries the state.
  function deepFind(root, match, depth) {
    if (!root || depth > 5) return null;
    let nodes;
    try { nodes = root.querySelectorAll('*'); } catch { return null; }
    for (const el of nodes) {
      try { if (match(el)) return el; } catch { /* keep looking */ }
      if (el.shadowRoot) {
        const hit = deepFind(el.shadowRoot, match, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  const isUpvoteBtn = (el) =>
    el.tagName === 'BUTTON' && el.hasAttribute && el.hasAttribute('upvote');

  /** The upvote button for one thing, reached through its shadow root. */
  function upvoteButton(ref) {
    const host = nodeForRef(ref);
    if (!host) return null;
    return deepFind(host.shadowRoot || host, isUpvoteBtn, 0)
      // Old reddit has no shadow DOM and no attribute, only a class on an <a>.
      || (host.querySelector ? host.querySelector('.arrow.up, .arrow.upmod') : null);
  }

  /** Upvoted? true / false / null when it cannot be judged (never guess). */
  function upvotedState(ref) {
    const btn = upvoteButton(ref);
    if (!btn) return null;
    const pressed = btn.getAttribute && btn.getAttribute('aria-pressed');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
    if (btn.classList && btn.classList.contains('upmod')) return true;  // old reddit
    return null;
  }

  // The click bridge. engage-core hands its matcher the RETARGETED event target (the shadow
  // host), so the button itself never reaches it. This capture listener reads
  // composedPath(), which does include the shadow-internal node, and remembers that an
  // upvote was pressed a moment ago; likeTarget() below answers from that memory.
  //
  // Belt and braces on purpose: if this listener loses the race to register, engage-core's
  // own 5s poll still credits off upvotedState() alone, just a few seconds later.
  let lastUpvoteAt = 0;
  document.addEventListener('click', (e) => {
    try {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.some(isUpvoteBtn)) lastUpvoteAt = Date.now();
    } catch { /* ignore */ }
  }, true);

  const adapter = {
    platform: 'reddit',
    // No watch, no repost: a crosspost is a new submission by the member, not a toggle on
    // his post, and nothing here could confirm it. Matches the server's AVAILABLE matrix.
    actions: { like: true, comment: true },
    refFromPath,
    getRef() { return refFromPath(location.pathname); },

    // The upvote is the like. Document-wide read for the click path (a click says which
    // thing is meant); the focal read below is what the self-heal poll uses.
    isLiked() { return upvotedState(this.getRef()) === true; },
    // Null means "cannot judge, do not self-heal", which is what engage-core wants when a
    // poll credits with no click behind it.
    isLikedFocal() { return upvotedState(this.getRef()); },
    // Answers from the composedPath listener above rather than the retargeted node: a click
    // that landed on the upvote within the last two seconds counts as this post's upvote.
    // Scoped to the focal thing so an upvote on a COMMENT further down the page can never
    // credit the post.
    likeTarget(t) {
      if (Date.now() - lastUpvoteAt > 2000) return null;
      const host = nodeForRef(this.getRef());
      if (!host) return null;
      return (t && host.contains && host.contains(t)) || t === host ? host : null;
    },

    // Comments: Reddit posts a reply with the "Comment"/"Reply" button; Enter is a newline.
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
      } catch { /* fall through */ }
      return '';
    },

    // Advisory line above the rows. Reddit is the one platform here where the earning does
    // not stop at the post: his replies in the thread are targets of their own, and their
    // upvote pays the same. Nothing on the page says so, and a member who upvotes the post
    // and leaves never finds out (owner, 2026-08-30).
    notice() {
      const ref = this.getRef();
      if (!ref) return null;
      return ref.startsWith('t1_')
        ? 'This is one of his comments. The upvote pays here too.'
        : 'Check the comments for his replies. Upvoting those pays tickets as well.';
    },

    // ---- highlight rings -----------------------------------------------------
    // The ring goes on the REAL button, shadow root and all. The first cut queried the
    // light DOM, which finds nothing on shreddit, so the upvote credited (the state read
    // descends) while no gold ring ever appeared (owner, 2026-08-30).
    // getBoundingClientRect works through a shadow boundary, so the overlay lands right.
    likeHighlightTarget() { return upvoteButton(this.getRef()); },
    // Same shadow-root descent as the upvote: Reddit's composer sits inside
    // <shreddit-composer>, so a light-DOM query finds nothing and the gold ring never
    // appears. The plain query stays first for old reddit, which has no shadow DOM.
    commentHighlightTarget() {
      try {
        const light = document.querySelector(this.composerSel);
        if (light) return light;
        const deep = deepFind(document, (el) =>
          (el.getAttribute && el.getAttribute('contenteditable') === 'true')
          || el.tagName === 'TEXTAREA', 0);
        if (deep) return deep;
        return document.querySelector('button[aria-label*="omment" i], a[data-click-id="comments"]') || null;
      } catch { return null; }
    },
    getVideoEl() { return null; },
  };

  self.RGC_REDDIT_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  // ---- discovery scan ------------------------------------------------------
  // Only on HIS pages, and ids only: nothing about the member's own browsing leaves the
  // browser. The server re-checks every id against Reddit itself for authorship before it
  // can become a target, so this cannot invent one — same safety property as the TikTok
  // scan this mirrors.
  //
  // Reddit blocks the server's datacenter IP outright, which is why the member's browser
  // does the looking. A proxy lane on the server does the same scan when one is configured;
  // whichever sees a post first wins and the other's report is a no-op.
  const onHisProfile = () =>
    new RegExp('^/(?:u|user)/' + HANDLE + '(?:/|$)', 'i').test(location.pathname);

  function visibleRefs() {
    const out = [];
    try {
      // Every permalink on the page that belongs to him. The profile lists his posts AND
      // his comments, which is exactly the pair the owner asked for.
      for (const a of document.querySelectorAll('a[href*="/comments/"]')) {
        const ref = refFromPath(a.getAttribute('href') || '');
        if (ref && out.indexOf(ref) === -1) out.push(ref);
        if (out.length >= 30) break;
      }
      // Shreddit hangs the id on the element itself, which survives markup churn better
      // than link shapes do.
      for (const el of document.querySelectorAll('shreddit-post[id], [data-fullname]')) {
        const ref = String(el.getAttribute('id') || el.getAttribute('data-fullname') || '').toLowerCase();
        if (/^t[13]_[a-z0-9]{4,13}$/.test(ref) && out.indexOf(ref) === -1) out.push(ref);
        if (out.length >= 30) break;
      }
    } catch { /* whatever was collected still goes */ }
    return out;
  }

  let lastSent = '';
  function scan() {
    if (!onHisProfile() || document.visibilityState === 'hidden') return;
    const refs = visibleRefs();
    if (!refs.length) return;
    // The scan re-reads the same page every minute, so only a CHANGED set is worth a
    // request: re-reporting settled ids forever is the exact mistake the TikTok lane made
    // (31,605 pointless upserts in nineteen hours, fixed in 1.164).
    const key = refs.join(',');
    if (key === lastSent) return;
    lastSent = key;
    chrome.runtime.sendMessage({ type: 's2Discover', platform: 'reddit', refs }).catch(() => {});
  }

  setInterval(scan, 60_000);
  scan();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scan(); });
})();
