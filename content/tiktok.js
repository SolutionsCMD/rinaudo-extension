// TikTok adapter for engage-core. Selectors are best-effort and may need live tuning.
(function () {
  const adapter = {
    platform: 'tiktok',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/video\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      // *= matches BOTH TikTok layouts: the full-page "like-icon" and the browse/popup
      // "browse-like-icon" (the one you get clicking a video from a profile).
      const btn = document.querySelector('[data-e2e*="like-icon"]');
      if (!btn) return false;
      if (btn.getAttribute('aria-pressed') === 'true') return true;
      const path = btn.querySelector('svg path');
      const fill = path ? (path.getAttribute('fill') || getComputedStyle(path).fill || '') : '';
      return /254,\s*44,\s*85|#fe2c55|rgb\(254/i.test(fill);
    },
    // TikTok likes are TWO-signal: the heart click arms an intent and the credit waits
    // for the page's own digg mutation (observe.js). A signed-out click opens the login
    // sheet and no digg ever fires, so it can never credit.
    likeConfirmNetwork: true,
    // Comments are two-signal as well (2026-08-23): observe.js matches TikTok's own
    // /api/comment/publish/ request, carrying this video's aweme_id and the typed text,
    // and engage-core credits on that alone. The DOM hooks below no longer credit here;
    // see hookComment in engage-core for the three ways they paid for nothing.
    commentConfirmNetwork: true,
    likeTarget(t) { return t && t.closest ? t.closest('[data-e2e*="like-icon"]') : null; },
    commentSubmitTarget(t) {
      if (!t || !t.closest) return null;
      const direct = t.closest('[data-e2e*="comment-post"]'); // both layouts' post button
      if (direct) return direct;
      // Fallback for layout variants whose post button isn't tagged: a clicked button that
      // shares a container with the comment box.
      const b = t.closest('[role="button"], button');
      if (!b) return null;
      if (b.closest('[data-e2e*="like-icon"]')) return null; // the like control is never a comment submit
      // Two ancestors, not eight. Eight reached a container holding the whole video page,
      // so the mute button, the player and most of the action bar all read as a comment
      // submit. The Post button sits beside the editor inside one small flex row; two
      // levels is all that relationship needs.
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
      // Read the EDITOR, never the wrapper. [data-e2e="comment-input"] is the DraftJS
      // wrapper, and its textContent includes the placeholder ("Add comment...", 14
      // characters), so an untouched box used to read as a comment long enough to pass
      // the gate. No editor found reads as empty, never as the placeholder.
      const wrap = document.querySelector('[data-e2e*="comment-input"]');
      const ed = wrap ? wrap.querySelector('[contenteditable="true"], textarea') : null;
      if (!ed) return '';
      if (ed.tagName === 'TEXTAREA') return ed.value || '';
      return ed.textContent || '';
    },
    getVideoEl() {
      const vids = Array.from(document.querySelectorAll('video'));
      if (vids.length <= 1) return vids[0] || null;
      // TikTok keeps more than one <video> alive: the neighbouring clips in the feed,
      // and a second element for the expanded/theatre player. Taking the FIRST one in the
      // document meant reading a preloaded, paused, off-screen video while the member
      // watched a different one, so the timer sat at "paused" and never accrued. Reported
      // twice: a stuck 0:05 counter (2026-08-22) and "it isnt saying im watching when they
      // are in a bigger form, then when i reset the page it makes the video smaller and
      // adds it" (2026-08-23) — reloading collapsed the extra element, which is why it
      // started working again.
      //
      // Same scorer YouTube and Facebook already use: visible area, with a playing element
      // beating any paused one. NOT currentTime, which resets to 0 at every loop boundary
      // and would drop the active clip for a preloaded neighbour.
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

    // --- Repost ---------------------------------------------------------------
    // TikTok's repost lives inside the share panel, and the control that gets clicked is
    // a bare <svg> with no data-e2e, no testid and no label (recorded live 2026-08-08), so
    // there is nothing stable to anchor a tight selector on. That is survivable here in a
    // way it would not be elsewhere: the network confirmation carries the video id in
    // item_id, and engage-core only credits when that id equals the post this card is for.
    // So the click's job is just to prove a human did something on this page inside the
    // last 90 seconds; the id match does the real work. Anything clicked in the modal or
    // the action bar arms it.
    repostTarget(t) {
      if (!t || !t.closest) return null;
      return t.closest('[role="dialog"], [data-e2e*="share"], [data-e2e*="video-share"], button, [role="button"], svg');
    },
    // The share control is always present on a video page, which is the honest answer to
    // "could this build repost here": it is what the telemetry probe reports on.
    repostPresent() {
      try { return !!document.querySelector('[data-e2e*="share"], [data-e2e*="video-share"], video'); }
      catch (e) { return false; }
    },
    // The third signal. Recorded live 2026-08-08: reposting makes TikTok insert
    // [data-e2e="repost-tag"] and [data-e2e="repost-action-tag"] (with the words "You
    // reposted"), and nothing is removed. This matters because /upvote/publish answers
    // HTTP 200 even when TikTok refuses the action, so status alone would pay for a
    // repost that never happened; the tag only appears when it really did.
    isReposted() {
      try { return !!document.querySelector('[data-e2e="repost-tag"], [data-e2e="repost-action-tag"]'); }
      catch (e) { return false; }
    },
    // Strict variant for the self-heal, which has no click intent or confirmed id to
    // correct a mis-read. The tags are page-level, not per-card, so they are only
    // trustworthy while the URL IS the post in question: on a feed or profile they could
    // belong to any video on screen. null means "cannot judge here, do not self-heal".
    isRepostedFocal() {
      try {
        if (this.refFromPath(location.pathname) !== this.getRef() || !this.getRef()) return null;
        return !!document.querySelector('[data-e2e="repost-tag"], [data-e2e="repost-action-tag"]');
      } catch (e) { return null; }
    },
    // The native control to ring for the FOCAL post. TikTok reshare is a two-step flow, so the
    // control to click FIRST is the Share affordance that opens the panel, the same selector
    // repostPresent detects (video is excluded here: it is a presence proxy, not a button).
    // Prefer the clickable wrapper so the ring sits over what the user clicks. A video page
    // has a non-empty getRef, the focal guard; returns null when getRef is empty or no share
    // control is found, both safe no-rings.
    // --- Highlight rings ------------------------------------------------------
    // No-arg resolvers for the gold ring engage-core draws over the native control while
    // that action is still unearned. Same safe-degrade rule as the rest of the adapter:
    // return null and there is simply no ring.
    likeHighlightTarget() {
      try { return document.querySelector('[data-e2e*="like-icon"]') || null; } catch (e) { return null; }
    },
    commentHighlightTarget() {
      try { return document.querySelector('[data-e2e*="comment-input"], [contenteditable="true"]') || null; } catch (e) { return null; }
    },
    repostDialogHighlightTargets() {
      try {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        return Array.from(dlg.querySelectorAll('[role="button"], button'))
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
          .slice(0, 3);
      } catch (e) { return null; }
    },
    repostHighlightTarget() {
      try {
        if (!this.getRef()) return null;
        const share = document.querySelector('[data-e2e*="video-share"], [data-e2e*="share"]');
        if (!share) return null;
        return share.closest('[role="button"], button') || share;
      } catch (e) { return null; }
    },
  };
  // CHANNEL DISCOVERY. TikTok reaches the server through an IFTTT webhook that misses
  // posts: on 2026-08-23 it delivered the 20:00 video and never delivered the 23:44 one,
  // so the feed sat stale for 14 hours and a real post earned nobody anything. Every
  // server-side route to TikTok is gated from the server, so a member's own browser is the
  // only thing that can see the channel.
  //
  // What is sent: video ids, and only from the CHANNEL's own pages (a /@handle profile or
  // one of its video pages). Nothing about anything else the member looks at. The server
  // publishes none of them directly; it re-checks each through oEmbed and requires the
  // author to be the channel, so this can only ever surface a genuine post sooner.
  //
  // Once per page with a short settle for the grid to render, then on SPA navigation, and
  // never more often than the cooldown, so browsing the profile is a handful of requests.
  const CHANNEL = 'realmizkif';
  // Ids this page has already sent. The scan re-reads the whole visible grid every minute,
  // and without this it re-sent the same settled ids forever: five members produced 31,605
  // server-side upserts in nineteen hours, one id counted 4,679 times. The server now
  // ignores ids it has already judged, and this stops them being sent in the first place.
  // A page load starts with a clean set, which is exactly one report per channel visit.
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
      // No time-based cooldown: the interval below sets how often we LOOK, and the
      // reported set decides whether anything is SENT. A cooldown on top of both did
      // nothing except make the dedupe untestable, and it hid the case that matters, a
      // post appearing while the member has the tab open.
      const refs = [];
      const seen = Object.create(null);
      document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
        const m = String(a.getAttribute('href') || '').match(/\/@([^/]+)\/video\/(\d{15,25})/);
        if (!m) return;
        if (String(m[1]).toLowerCase() !== CHANNEL) return; // only this channel's posts
        if (seen[m[2]]) return;
        seen[m[2]] = 1;
        refs.push(m[2]);
      });
      // The video page itself, which a member reaches straight from a notification.
      const own = (location.pathname || '').match(/\/@([^/]+)\/video\/(\d{15,25})/);
      if (own && String(own[1]).toLowerCase() === CHANNEL && !seen[own[2]]) refs.push(own[2]);
      // Only what this page has not sent yet. No new ids means no request at all, so a
      // member sitting on the channel costs one report, not one a minute forever.
      const fresh = refs.filter((r) => !reported[r]);
      if (!fresh.length) return;
      // Marked reported ONLY when the server took the batch: marking first meant a report
      // dropped for want of a token (fresh install, not yet connected) or a network blip
      // was never re-sent by this client (review finding, 2026-08-31). On failure the ids
      // stay fresh and the next 60s pass retries.
      fresh.forEach((r) => { reported[r] = 1; });
      chrome.runtime.sendMessage({ type: 's2Discover', platform: 'tiktok', refs: fresh.slice(0, 30) })
        .then((r) => { if (!r || !r.ok) fresh.forEach((x) => { delete reported[x]; }); })
        .catch(() => { fresh.forEach((x) => { delete reported[x]; }); });
    } catch (e) { /* discovery is optional; it must never break the page */ }
  }
  setTimeout(scanChannel, 4000);
  setInterval(scanChannel, 60000);

  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
