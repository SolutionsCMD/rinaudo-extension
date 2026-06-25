// X (Twitter) adapter for engage-core. Selectors carried over verbatim from the
// prior bespoke x.js. Like + comment only (no watch). Runs on /status/ pages.
(function () {
  const adapter = {
    platform: 'x',
    actions: { like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/status\/(\d+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() { return !!document.querySelector('[data-testid="unlike"]'); },
    commentSubmitTarget(t) { return t && t.closest ? t.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]') : null; },
    commentText() {
      for (const el of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    getVideoEl() { return null; },
  };
  self.RGC_X_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
