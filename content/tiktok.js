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
      let el = b;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement; if (!el) break;
        if (el.querySelector('[data-e2e*="comment-input"], [contenteditable="true"], textarea')) return b;
      }
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('[data-e2e*="comment-input"], [contenteditable="true"], textarea') : null; },
    composerSel: '[data-e2e*="comment-input"], [contenteditable="true"], textarea',
    commentText() {
      const el = document.querySelector('[data-e2e*="comment-input"]')
        || document.querySelector('[placeholder*="comment" i][contenteditable], [placeholder*="comment" i]');
      return el ? (el.textContent || el.value || el.innerText || '') : '';
    },
    getVideoEl() { return document.querySelector('video'); },

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
  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
