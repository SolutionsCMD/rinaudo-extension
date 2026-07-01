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
  };
  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
