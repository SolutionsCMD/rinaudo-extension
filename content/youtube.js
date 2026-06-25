// YouTube adapter for engage-core. Selectors carried over verbatim from the prior
// bespoke youtube.js. Watch + like + comment. Runs on /watch and /shorts.
(function () {
  function likeButton() {
    return [...document.querySelectorAll('button[aria-pressed]')].find((b) => {
      const l = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
      return l.includes('like') && !l.includes('dislike');
    }) || null;
  }
  const adapter = {
    platform: 'youtube',
    actions: { watch: true, like: true, comment: true },
    refFromUrl(href) {
      try {
        const u = new URL(href);
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
        return u.searchParams.get('v') || '';
      } catch { return ''; }
    },
    getRef() { return this.refFromUrl(location.href); },
    isLiked() { const b = likeButton(); return !!(b && b.getAttribute('aria-pressed') === 'true'); },
    commentSubmitTarget(t) {
      return t && t.closest ? t.closest('#submit-button, ytd-commentbox #submit-button, ytd-comment-simplebox-renderer #submit-button') : null;
    },
    commentText() {
      for (const el of document.querySelectorAll('ytd-commentbox #contenteditable-root')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    getVideoEl() { return document.querySelector('video'); },
  };
  self.RGC_YT_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
