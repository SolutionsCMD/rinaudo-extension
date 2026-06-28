// YouTube adapter for engage-core. Selectors carried over verbatim from the prior
// bespoke youtube.js. Watch + like + comment. Runs on /watch and /shorts.
(function () {
  // The video's like toggle. Uses language-agnostic structural selectors — the like
  // button always lives in #segmented-like-button / #like-button regardless of UI
  // language, and aria-pressed is always present. Avoids aria-label text matching
  // which breaks on non-English YouTube (e.g. Portuguese "Gostei").
  function likeControl() {
    for (const sel of [
      // Current YouTube (2024+) renders like/dislike as web-component view-models with
      // no stable id. like-button-view-model wraps ONLY the like button; the segmented
      // wrapper lists like before dislike, so the first aria-pressed match is the like.
      'like-button-view-model button[aria-pressed]',
      'segmented-like-dislike-button-view-model button[aria-pressed]',
      '#segmented-like-button button[aria-pressed]',
      '#like-button button[aria-pressed]',
      'ytd-segmented-like-dislike-button-renderer button[aria-pressed]',
      // Shorts player: like button lives in ytd-like-button-renderer inside the overlay
      'ytd-like-button-renderer button[aria-pressed]',
      'ytd-reel-player-overlay-renderer button[aria-pressed]',
    ]) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallbacks: first aria-pressed button in the watch metadata block, then the legacy
    // actions bar (like always precedes dislike in DOM order).
    return document.querySelector('ytd-watch-metadata button[aria-pressed]')
      || document.querySelector('#top-level-buttons-computed button[aria-pressed]') || null;
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
    isLiked() {
      const b = likeControl();
      return !!(b && b.getAttribute('aria-pressed') === 'true');
    },
    likeTarget(t) {
      return t && t.closest ? t.closest('like-button-view-model, segmented-like-dislike-button-view-model, #segmented-like-button, #like-button, ytd-like-button-renderer, ytd-reel-player-overlay-renderer') : null;
    },
    commentSubmitTarget(t) {
      return t && t.closest ? t.closest('#submit-button, ytd-commentbox #submit-button, ytd-comment-simplebox-renderer #submit-button') : null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('#contenteditable-root, [contenteditable="true"]') : null; },
    commentText() {
      for (const el of document.querySelectorAll('ytd-commentbox #contenteditable-root')) {
        const v = (el.textContent || '').trim();
        if (v) return v;
      }
      return '';
    },
    getVideoEl() {
      const vids = Array.from(document.querySelectorAll('video'));
      if (vids.length <= 1) return vids[0] || null;
      // Shorts preloads several <video>s (prev/next reels). The ACTIVE short is the one
      // filling the viewport. Score by visible area and strongly prefer a playing one —
      // NOT by currentTime, which resets to 0 at every loop boundary and would otherwise
      // make us drop the active short and grab a preloaded paused reel (timer freezes).
      const visibleArea = (v) => {
        const r = v.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        return w * h;
      };
      let best = null, bestScore = -1;
      for (const v of vids) {
        const score = visibleArea(v) + (!v.paused ? 1e9 : 0); // playing wins over any paused
        if (score > bestScore) { bestScore = score; best = v; }
      }
      return best || vids[0] || null;
    },
  };
  self.RGC_YT_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
