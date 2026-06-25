// TikTok adapter for engage-core. Selectors are best-effort and may need live tuning.
(function () {
  const adapter = {
    platform: 'tiktok',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/video\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      const btn = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
      if (!btn) return false;
      if (btn.getAttribute('aria-pressed') === 'true') return true;
      const path = btn.querySelector('svg path');
      const fill = path ? (path.getAttribute('fill') || getComputedStyle(path).fill || '') : '';
      return /254,\s*44,\s*85|#fe2c55|rgb\(254/i.test(fill);
    },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-e2e="comment-post"]') : null; },
    commentText() { const el = document.querySelector('[data-e2e="comment-input"]'); return el ? (el.textContent || el.value || '') : ''; },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_TIKTOK_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
