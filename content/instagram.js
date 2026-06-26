// Instagram adapter for engage-core. Selectors are best-effort and may need live tuning.
// Photo posts have no <video> so the watch row simply never appears (getVideoEl null).
(function () {
  const adapter = {
    platform: 'instagram',
    actions: { watch: true, like: true, comment: true },
    refFromPath(path) { const m = (path || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : ''; },
    getRef() { return this.refFromPath(location.pathname); },
    isLiked() {
      // Language-agnostic: the liked heart SVG path turns red (#ff3040 / rgb(255,48,64)).
      // Checking fill color avoids relying on aria-label text which varies by UI language.
      for (const path of document.querySelectorAll('article svg path, [role="button"] svg path')) {
        const fill = path.getAttribute('fill') || getComputedStyle(path).fill || '';
        if (/rgb\(255,\s*4[0-8],\s*6[0-4]\)|#[Ff][Ff][23][0-9A-Fa-f]{4}/.test(fill)) return true;
      }
      return false;
    },
    commentSubmitTarget(t) {
      // Language-agnostic: the Post/submit button is always the only [role="button"] or
      // button directly inside the comment form, not matched by text content.
      const b = t && t.closest ? t.closest('[role="button"], button') : null;
      return (b && b.closest('form, [class*="comment" i]')) ? b : null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('textarea, [contenteditable="true"]') : null; },
    commentText() { const el = document.querySelector('textarea[aria-label*="comment" i], textarea[placeholder*="comment" i]'); return el ? (el.value || el.textContent || '') : ''; },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
