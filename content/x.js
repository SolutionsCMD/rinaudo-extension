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
  const adapter = {
    platform: 'x',
    actions: { like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/status\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() { return !!document.querySelector('[data-testid="unlike"]'); },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') : null; },
    // On X, plain Enter is a newline — replies post via the Reply button OR Cmd/Ctrl+Enter.
    submitOnEnter: false,
    submitOnCtrlEnter: true,
    commentInputTarget(t) { return t && t.closest ? t.closest('[data-testid^="tweetTextarea_"], [role="textbox"]') : null; },
    commentText() {
      for (const el of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    // Repost, click half of the two-signal proof. BOTH testids arm the window: the action
    // bar button opens X's menu and "retweetConfirm" is the item inside it, and either
    // click is the member reaching for the control. "unretweet" is deliberately absent,
    // that one is the undo. Nothing credits until content/observe.js sees X's own
    // CreateRetweet request come back 2xx.
    repostTarget(t) { return t && t.closest ? t.closest('[data-testid="retweet"], [data-testid="retweetConfirm"]') : null; },
    repostPresent() { try { return !!document.querySelector('[data-testid="retweet"], [data-testid="unretweet"]'); } catch { return false; } },
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
  // server ignores non-target tweets (returns an error with no `credited` field), so only
  // in-window posts toast + credit; everything else is silent. Dedup per page session.
  const firedLike = new Set();
  document.addEventListener('click', async (e) => {
    if (onStatusPage()) return; // engage-core owns the single-post page
    const btn = e.target.closest && e.target.closest('[data-testid="like"]'); // "unlike" is a different testid
    if (!btn) return;
    const ref = cardRef(btn);
    if (!ref || firedLike.has(ref)) return;
    firedLike.add(ref);
    const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'x', action: 'like', ref }).catch(() => null);
    if (r && ('credited' in r)) { if (r.credited && r.awarded) toast(`${rewardText(xr.like)} for liking`); }
    else firedLike.delete(ref); // error / not a target → allow a later retry
  }, true);

  // Inline COMMENT (best-effort): note which tweet a reply was opened for, then credit that
  // tweet when the reply posts (>5 chars). X's reply composer is a modal, so we bind the ref
  // at reply-open and fire on the tweet-button submit.
  let replyRef = '';
  document.addEventListener('click', (e) => {
    if (onStatusPage()) return;
    const reply = e.target.closest && e.target.closest('[data-testid="reply"]');
    if (reply) { replyRef = cardRef(reply); return; }
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

  // Inline REPOST. engage-core runs the same two-signal rule but only has state on a
  // /status/ page whose id is an active target, and the feed is where most reposting
  // actually happens — so the timeline needs its own copy of both halves. Click half:
  // bind the card's tweet id when the action-bar repost control is pressed. Confirm half:
  // the message content/observe.js posts once X's own CreateRetweet request succeeds.
  const firedRepost = new Set();
  let pendingRepost = null;
  const REPOST_WINDOW_MS = 90000;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-testid="retweet"]'); // "unretweet" is the undo
    if (!btn) return;
    const ref = cardRef(btn);
    // X renders the confirm menu OUTSIDE the card, so its click has no article to read an
    // id from. The id therefore has to be bound here, at the action-bar click, and left
    // alone afterwards, which is why an empty read never overwrites a good one.
    if (ref) pendingRepost = { ref, until: Date.now() + REPOST_WINDOW_MS };
  }, true);

  window.addEventListener('message', (e) => {
    try {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.rgcObs !== 1 || d.ok !== true || d.platform !== 'x' || d.kind !== 'repost') return;
      if (!pendingRepost || Date.now() >= pendingRepost.until) return; // no click, no credit
      const ref = d.ref ? String(d.ref) : pendingRepost.ref;
      if (ref !== pendingRepost.ref) return; // confirmed a different tweet than the one clicked
      pendingRepost = null;
      if (ref === adapter.getRef()) return; // the post in the URL belongs to engage-core
      if (firedRepost.has(ref)) return;
      firedRepost.add(ref);
      chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'x', action: 'repost', ref })
        .then((r) => {
          if (r && ('credited' in r)) { if (r.credited && r.awarded) toast(`${rewardText(xr.repost)} for reposting`); }
          else firedRepost.delete(ref); // error / not a target: allow a later retry
        })
        .catch(() => { firedRepost.delete(ref); });
    } catch { /* a malformed page message must never break the timeline */ }
  });
})();
