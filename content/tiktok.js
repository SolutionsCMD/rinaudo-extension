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
    // NOTE: no isReposted()/isRepostedFocal() yet. TikTok gives the reposted state no
    // marked element we could find, so the flip check X uses is not available here and the
    // 5s self-heal deliberately stays off for TikTok (engage-core treats a missing
    // isRepostedFocal as "cannot judge" only when the method exists; with neither method
    // present it falls back to the click plus confirmation path, which is what we want).
    // A 200 on /upvote/publish with a matching item_id is the whole proof on this platform.
  };
  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
