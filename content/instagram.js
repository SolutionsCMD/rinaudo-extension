// Instagram adapter for engage-core. Selectors are best-effort and may need live tuning.
// Photo posts have no <video> so the watch row simply never appears (getVideoEl null).
(function () {
  const adapter = {
    platform: 'instagram',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() { return !!document.querySelector('svg[aria-label="Unlike"]'); },
    commentSubmitTarget(t) {
      const b = t && t.closest ? t.closest('[role="button"], button') : null;
      return b && (b.textContent || '').trim() === 'Post' ? b : null;
    },
    commentText() { const el = document.querySelector('textarea[aria-label*="comment" i]'); return el ? (el.value || el.textContent || '') : ''; },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
