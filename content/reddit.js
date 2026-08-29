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
      const direct = document.querySelector(
        `shreddit-post[id="${ref}"], shreddit-comment[thingid="${ref}"], [data-fullname="${ref}"], #thing_${ref}`);
      if (direct) return direct;
      // Old reddit and some embeds hang the id off a permalink instead.
      const bare = ref.replace(/^t[13]_/, '');
      return document.querySelector(`shreddit-post[id$="${bare}"], [id$="${bare}"][class*="thing"]`) || null;
    } catch { return null; }
  }

  /** Is the vote control in its upvoted state? Null = cannot tell, never guess. */
  function upvotedIn(scope) {
    if (!scope) return null;
    try {
      const btn = scope.querySelector(
        'button[aria-label*="pvote" i]:not([aria-label*="Down" i]),'
        + ' [data-post-click-location="upvote"], .arrow.up, .arrow.upmod');
      if (!btn) return null;
      if (btn.getAttribute('aria-pressed') != null) return btn.getAttribute('aria-pressed') === 'true';
      if (btn.classList && btn.classList.contains('upmod')) return true;
      // Shreddit flips a CSS custom state rather than aria on some builds; the icon's fill
      // is the only tell left, and an unreadable tell is null, not false.
      const filled = btn.querySelector('svg[fill]:not([fill="none"]), .icon-upvote-fill');
      return filled ? true : null;
    } catch { return null; }
  }

  const adapter = {
    platform: 'reddit',
    // No watch, no repost: a crosspost is a new submission by the member, not a toggle on
    // his post, and nothing here could confirm it. Matches the server's AVAILABLE matrix.
    actions: { like: true, comment: true },
    refFromPath,
    getRef() { return refFromPath(location.pathname); },

    // The upvote is the like. Document-wide read for the click path (a click says which
    // thing is meant); the focal read below is what the self-heal poll uses.
    isLiked() {
      const scoped = upvotedIn(nodeForRef(this.getRef()));
      if (scoped != null) return scoped;
      return upvotedIn(document) === true;
    },
    isLikedFocal() { return upvotedIn(nodeForRef(this.getRef())); },
    likeTarget(t) {
      return t && t.closest
        ? t.closest('button[aria-label*="pvote" i]:not([aria-label*="Down" i]), [data-post-click-location="upvote"], .arrow.up, .arrow.upmod')
        : null;
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

    // ---- highlight rings -----------------------------------------------------
    likeHighlightTarget() {
      try {
        const scope = nodeForRef(this.getRef()) || document;
        return scope.querySelector(
          'button[aria-label*="pvote" i]:not([aria-label*="Down" i]), [data-post-click-location="upvote"], .arrow.up') || null;
      } catch { return null; }
    },
    commentHighlightTarget() {
      try {
        return document.querySelector(this.composerSel)
          || document.querySelector('button[aria-label*="omment" i], a[data-click-id="comments"]') || null;
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
