// X (Twitter) adapter for engage-core + a TIMELINE mode.
//
// Two paths:
//  1) On a /status/<id> page → engage-core drives the single-post widget (like/comment for
//     the tweet in the URL), same as before.
//  2) On his profile / any feed → a delegated watcher lets you like (and reply) tweets
//     INLINE, without opening each. It reads the tweet's id from its card and credits it;
//     the server validates the id is an active target (the 24h window), so non-target
//     tweets are silently ignored.
(function () {
  // Last /status/ id we were actually on — see getRef(), which keeps reporting it while
  // X's reply modal is open and the URL has moved off the tweet.
  let lastStatusRef = '';
  const adapter = {
    platform: 'x',
    actions: { like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/status\/(\d+)/); return m ? m[1] : ''; },
    getRef() {
      const r = this.refFromPath(location.pathname);
      if (r) { lastStatusRef = r; return r; }
      // X moves the URL off /status/ while its reply modal is open, but the page underneath
      // is still that tweet. Without this the ref vanishes mid-reply and engage-core clears
      // the card, which is the "extension pop up disappears" members reported on 2026-08-18.
      // Deliberately narrow: only while a modal dialog containing a tweet composer is open,
      // so a composer on the home feed can never resurrect a stale ref.
      if (lastStatusRef && document.querySelector('[role="dialog"][aria-modal="true"] [data-testid^="tweetTextarea_"]')) {
        return lastStatusRef;
      }
      lastStatusRef = '';
      return '';
    },
    isLiked() { return !!document.querySelector('[data-testid="unlike"]'); },
    // Strict focal read for the like SELF-HEAL, the same shape as isRepostedFocal below.
    // isLiked() above is document-wide, which is fine for the click-driven path (a click
    // says which post is meant) but wrong for a poll that credits with no click behind it:
    // a /status/ page carries the whole reply thread, and once the reply-modal fallback in
    // getRef() keeps a ref alive on the HOME FEED, "any [data-testid=unlike] in the
    // document" is true as soon as the member has liked anything on screen. That credited
    // the focal post for a like it never got. Null means "cannot judge, do not heal".
    isLikedFocal() {
      const card = articleForRef(this.getRef());
      if (!card) return null;
      try { return !!card.querySelector('[data-testid="unlike"]'); } catch { return null; }
    },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') : null; },
    // On X, plain Enter is a newline — replies post via the Reply button OR Cmd/Ctrl+Enter.
    submitOnEnter: false,
    submitOnCtrlEnter: true,
    commentInputTarget(t) { return t && t.closest ? t.closest('[data-testid^="tweetTextarea_"], [role="textbox"]') : null; },
    // Selector shared with commentInputTarget so the ring and the credit path can never
    // disagree about what the composer is.
    composerSel: '[data-testid^="tweetTextarea_"], [role="textbox"]',
    commentText() {
      for (const el of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    // Repost, click half of the proof. BOTH testids arm the window: the action bar button
    // opens X's menu and "retweetConfirm" is the item inside it, and either click is the
    // member reaching for the control. "unretweet" is deliberately absent, that one is the
    // undo. Nothing credits until content/observe.js sees X's own CreateRetweet request
    // come back 2xx AND isReposted() below says the control flipped.
    repostTarget(t) { return t && t.closest ? t.closest('[data-testid="retweet"], [data-testid="retweetConfirm"]') : null; },
    // Did the repost actually land? X swaps the action bar's "retweet" control for
    // "unretweet" once it did, exactly as it swaps "like" for "unlike", so this reads the
    // same way isLiked() does. This is the signal a 2xx cannot give: X answers a refused
    // retweet with HTTP 200 and an errors[] array in a body we are not allowed to read.
    // `root` narrows the read to a single timeline card. With no root (engage-core, which
    // only ever runs on a /status/ page) it scopes itself to the card for the tweet in the
    // URL, so a reposted REPLY further down the conversation is not mistaken for the post
    // itself; if that card cannot be identified it falls back to the whole document, the
    // same scope isLiked() has always used.
    isReposted(root) {
      try {
        const scope = root || articleForRef(this.getRef()) || document;
        return !!scope.querySelector('[data-testid="unretweet"]');
      } catch { return false; }
    },
    // Strict variant for the self-heal poll: reports the flip ONLY when the focal card for
    // this page's own post can be resolved. Null means "cannot judge, do not self-heal":
    // on a thread page the document-wide fallback would read a reposted REPLY as the focal
    // post, and self-heal has no click intent or confirmed ref to correct that. The
    // confirmation path keeps the wider isReposted(): it already requires a matching
    // confirmed ref, so the fallback cannot mis-attribute there.
    isRepostedFocal() {
      const card = articleForRef(this.getRef());
      if (!card) return null;
      try { return !!card.querySelector('[data-testid="unretweet"]'); } catch { return null; }
    },
    repostPresent() { try { return !!document.querySelector('[data-testid="retweet"], [data-testid="unretweet"]'); } catch { return false; } },
    // The native control to ring for the FOCAL post: the action-bar "retweet" button on the
    // card for the tweet in the URL (getRef), the exact button repostPresent/repostTarget key
    // on. Scoped through articleForRef so a repost button on another card in a timeline is
    // never ringed, and so a reposted REPLY further down a thread is not mistaken for the
    // post itself. Returns null when getRef is empty, the focal card cannot be resolved, or
    // the control is gone (already reposted shows "unretweet", a different testid) — every
    // one of those is a safe no-ring.
    // --- Highlight rings ------------------------------------------------------
    // No-arg resolvers for the gold ring engage-core draws over the native control while
    // that action is still unearned. Same safe-degrade rule as the rest of the adapter:
    // return null and there is simply no ring.
    likeHighlightTarget() {
      try { return document.querySelector('[data-testid="like"]') || null; } catch (e) { return null; }
    },
    commentHighlightTarget() {
      try { return document.querySelector('[data-testid="reply"], [data-testid^="tweetTextarea_"]') || null; } catch (e) { return null; }
    },
    repostHighlightTarget() {
      try {
        const ref = this.getRef();
        if (!ref) return null;
        const card = articleForRef(ref);
        if (!card) return null;
        return card.querySelector('[data-testid="retweet"]');
      } catch { return null; }
    },
    getVideoEl() { return null; },
  };
  self.RGC_X_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);

  // ---- Timeline mode -------------------------------------------------------
  const onStatusPage = () => /\/status\/\d+/.test(location.pathname);

  // The tweet's OWN status id from its timeline card: prefer the header timestamp link
  // (an <a> wrapping a <time>) that belongs to THIS card, not a nested quoted tweet.
  function cardRef(fromEl) {
    const art = fromEl.closest && fromEl.closest('article');
    if (!art) return '';
    const timeLink = Array.from(art.querySelectorAll('a[href*="/status/"]'))
      .find((a) => a.querySelector('time') && a.closest('article') === art);
    const a = timeLink || art.querySelector('a[href*="/status/"]');
    const m = a && (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return m ? m[1] : '';
  }

  // Corner toast — the feed has no per-tweet widget, so confirm inline credits here.
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#15202b;color:#fff;border:1px solid #38444d;border-radius:10px;padding:10px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);transition:opacity .2s;';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2500);
  }

  // Cache the X like/comment/repost reward for the toast text (like and comment fall back
  // to the global amount; a repost has one global amount and no per-platform override).
  const xr = { like: 0, comment: 0, repost: 0 };
  async function refreshRewards() {
    try {
      const d = await chrome.runtime.sendMessage({ type: 's2Targets' });
      if (d) {
        xr.like = (d.xLikeReward != null ? d.xLikeReward : d.likeReward) || 0;
        xr.comment = (d.xCommentReward != null ? d.xCommentReward : d.commentReward) || 0;
        xr.repost = d.repostReward || 0;
      }
    } catch { /* keep last */ }
  }
  refreshRewards(); setInterval(refreshRewards, 5 * 60000);
  const rewardText = (n) => (n > 0 ? `🎟 +${n}` : '✓');

  // ---- Auto diagnostics (temporary) ---------------------------------------
  // While a reply is being composed, report what the user clicks/keys so we can see which
  // control X uses to submit — element testids + lengths ONLY, never the comment text.
  function dbg(data) { try { chrome.runtime.sendMessage({ type: 's2Debug', kind: 'xcomment', data }); } catch { /* ignore */ } }
  // Repost diagnostics. X reposts started crediting 2026-08-17 and immediately ran ~80% of
  // likers, well above the repost count on the posts themselves, with no way to tell which
  // code path claimed each one. Every repost credit now records the path and what the DOM
  // said at that moment, the same way xcomment made the reply bug visible.
  function rdbg(data) { try { chrome.runtime.sendMessage({ type: 's2Debug', kind: 'xrepost', data }); } catch { /* ignore */ } }
  self.RGCXRepostDbg = rdbg;
  document.addEventListener('click', (e) => {
    const txt = (adapter.commentText() || '').trim();
    if (!txt) return; // only while writing a reply
    const el = e.target.closest && e.target.closest('[data-testid],[role="button"],button');
    const testid = el && (el.getAttribute('data-testid') || el.getAttribute('role') || el.tagName);
    dbg({ ev: 'click', onStatus: onStatusPage(), textLen: txt.length, clickedTestid: testid || null,
          submitMatched: !!adapter.commentSubmitTarget(e.target) });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const txt = (adapter.commentText() || '').trim();
    if (!txt) return;
    dbg({ ev: 'key', onStatus: onStatusPage(), textLen: txt.length, meta: !!e.metaKey, ctrl: !!e.ctrlKey, shift: !!e.shiftKey });
  }, true);

  // Inline LIKE: clicking a not-yet-liked like button on any card credits that tweet. The
  // server ignores non-target tweets, which comes back as an `error` (see the response
  // contract on background.js s2Engagement), so only in-window posts toast + credit;
  // everything else is silent and stays retryable. Dedup per page session.
  const firedLike = new Set();
  document.addEventListener('click', async (e) => {
    if (onStatusPage()) return; // engage-core owns the single-post page
    const btn = e.target.closest && e.target.closest('[data-testid="like"]'); // "unlike" is a different testid
    if (!btn) return;
    const ref = cardRef(btn);
    if (!ref || firedLike.has(ref)) return;
    firedLike.add(ref);
    const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'x', action: 'like', ref }).catch(() => null);
    // A failure always carries `error`; a success always carries `credited`.
    if (r && !r.error) { if (r.credited && r.awarded) toast(`${rewardText(xr.like)} for liking`); }
    else firedLike.delete(ref); // error / not a target → allow a later retry
  }, true);

  // Inline COMMENT (best-effort): note which tweet a reply was opened for, then credit that
  // tweet when the reply posts (>5 chars). X's reply composer is a modal, so we bind the ref
  // at reply-open and fire on the tweet-button submit.
  let replyRef = '';
  document.addEventListener('click', (e) => {
    const reply = e.target.closest && e.target.closest('[data-testid="reply"]');
    if (reply) {
      // Bind on EVERY page, a /status/ page INCLUDED. Clicking Reply there opens X's modal
      // composer and swaps the URL off /status/, so by the time the reply is posted this is
      // no longer a status page: engage-core has already torn its card down and the submit
      // below finds nothing bound. That path credited NOTHING — 72 reply clicks on a status
      // page against 78 modal submits with no ref bound, in ten hours of field diagnostics
      // (2026-08-18, reported in Discord as "the extension pop up disappears and in turn
      // doesn't register your reply"). cardRef first (it reads the card the click came
      // from); the URL is the fallback for the focused tweet on its own page.
      replyRef = cardRef(reply) || adapter.refFromPath(location.pathname);
      return;
    }
    if (onStatusPage()) return; // engage-core owns the inline composer on the single-post page
    const submit = e.target.closest && e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
    if (submit && replyRef) fireTimelineComment();
  }, true);

  // Same inline reply, submitted via Cmd/Ctrl+Enter instead of the button.
  document.addEventListener('keydown', (e) => {
    if (onStatusPage()) return;
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || !replyRef) return;
    fireTimelineComment();
  }, true);

  function fireTimelineComment() {
    const text = (adapter.commentText() || '').trim();
    const ref = replyRef; replyRef = '';
    if (!ref || text.length <= 5) return; // quality gate — must be MORE than 5 chars
    chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'x', action: 'comment', ref })
      .then((r) => { if (r && r.credited && r.awarded) toast(`${rewardText(xr.comment)} for commenting`); })
      .catch(() => {});
  }

  // Inline REPOST. engage-core runs the same three-signal rule but only has state on a
  // /status/ page whose id is an active target, and the feed is where most reposting
  // actually happens — so the timeline needs its own copy of all three. Click: bind the
  // card's tweet id when the action-bar repost control is pressed. Confirm: the message
  // content/observe.js posts once X's own CreateRetweet request comes back 2xx. Flip: the
  // card's control has actually become "unretweet" (a 2xx only proves X accepted the
  // request; a refusal arrives as HTTP 200 with an errors[] array in a body nobody here is
  // allowed to read).
  const firedRepost = new Set();
  let pendingRepost = null;
  const REPOST_WINDOW_MS = 90000;
  const FLIP_TRIES = 10, FLIP_INTERVAL_MS = 400; // ~4s of grace for the control to flip
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-testid="retweet"]'); // "unretweet" is the undo
    if (!btn) return;
    const ref = cardRef(btn);
    // X renders the confirm menu OUTSIDE the card, so its click has no article to read an
    // id from. The id therefore has to be bound here, at the action-bar click, and left
    // alone afterwards, which is why an empty read never overwrites a good one.
    if (ref) pendingRepost = { ref, until: Date.now() + REPOST_WINDOW_MS };
  }, true);

  // The card for one tweet id, so the flip is read on THAT tweet and not on any reposted
  // tweet that happens to share the page.
  function articleForRef(ref) {
    try {
      if (!/^\d+$/.test(ref)) return null;
      const link = document.querySelector(`a[href*="/status/${ref}"]`);
      const near = link && link.closest ? link.closest('article') : null;
      if (near && cardRef(near) === ref) return near;
      for (const art of document.querySelectorAll('article')) if (cardRef(art) === ref) return art;
    } catch { /* selector drift must never throw */ }
    return null;
  }
  function repostedFor(ref) {
    const art = articleForRef(ref);
    if (art) return adapter.isReposted(art);
    // No card on screen for that id. On a /status/ page the tweet in the URL is the page
    // itself, so the document-wide read is the right one (and the only one available);
    // anywhere else the control cannot be attributed, so it does not count.
    if (adapter.refFromPath(location.pathname) === ref) return adapter.isReposted();
    return false;
  }
  function whenReposted(ref, onFlipped) {
    let tries = 0;
    (function tick() {
      let flipped = false;
      try { flipped = !!repostedFor(ref); } catch { flipped = false; }
      if (flipped) { try { onFlipped(); } catch { /* never throw out of a timer */ } return; }
      if (++tries >= FLIP_TRIES) return; // never flipped: X refused the repost
      setTimeout(tick, FLIP_INTERVAL_MS);
    })();
  }

  window.addEventListener('message', (e) => {
    try {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.rgcObs !== 1 || d.ok !== true || d.platform !== 'x' || d.kind !== 'repost') return;
      if (!pendingRepost || Date.now() >= pendingRepost.until) return; // no click, no credit
      // A confirmation we cannot attribute is DROPPED, never guessed onto whatever this
      // surface last bound: a missing id means observe.js could not read one out of the
      // request, and taking it on trust would dissolve the click/confirm binding entirely.
      const ref = d.ref == null ? '' : String(d.ref);
      if (!ref || ref !== pendingRepost.ref) return; // unattributable, or a different tweet
      // Deterministic hand-off with engage-core, which shares this page during an SPA
      // navigation. It answers whether it is taking this confirmation: yes when it has an
      // active target for this exact id and can credit a repost for it, either from its own
      // click intent or from the self-heal in its poll. Only then is the intent retired
      // here. When it says no, this path credits, which is the /status/ case where its
      // targets fetch has not resolved or failed: previously the intent was dropped before
      // asking, and since X never re-sends a confirmation the repost was simply lost.
      // Exactly one path fires for a click-driven repost. The
    // self-heal poll in engage-core sits outside that hand-off; a duplicate it produces is
    // deduped by the server (ledger lookup plus the repost unique index) rather than
    // prevented, and answers credited:true with awarded:false.
      const engage = self.RGCEngage;
      if (engage && typeof engage.ownsConfirmation === 'function' && engage.ownsConfirmation('repost', ref)) {
        pendingRepost = null;
        return;
      }
      if (firedRepost.has(ref)) return;
      // Third signal: credit only once X's own control has flipped for this tweet. The
      // intent deliberately stays armed until then, so nothing is lost if it never does.
      whenReposted(ref, () => {
        if (firedRepost.has(ref)) return;
        firedRepost.add(ref);
        rdbg({ path: 'feed-confirm', ref, onStatus: onStatusPage(),
               cardFound: !!articleForRef(ref), focal: adapter.isRepostedFocal(),
               docWide: adapter.isReposted() });
        if (pendingRepost && pendingRepost.ref === ref) pendingRepost = null;
        chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'x', action: 'repost', ref })
          .then((r) => {
            // A failure always carries `error`; a success always carries `credited`.
            if (r && !r.error) { if (r.credited && r.awarded) toast(`${rewardText(xr.repost)} for reposting`); }
            else firedRepost.delete(ref); // error / not a target: allow a later retry
          })
          .catch(() => { firedRepost.delete(ref); });
      });
    } catch { /* a malformed page message must never break the timeline */ }
  });
})();
