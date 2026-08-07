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
  // Every element YouTube might use for the comment composer, most specific first
  // (same pattern as content/instagram.js). TWO layouts must both match: the /watch
  // page renders the composer under ytd-comments in the main column, while /shorts
  // renders it inside the engagement side panel with entirely different ancestry —
  // the old ytd-commentbox-scoped selector missed the shorts panel, so typed comments
  // read back as empty and could never credit there. Structural selectors only:
  // aria-label words and visible text localize and must never be matched.
  const COMPOSER_SEL = [
    // /watch page: classic commentbox markup.
    'ytd-commentbox #contenteditable-root[contenteditable="true"]',
    'ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]',
    // /shorts: the composer lives in the engagement side panel (comments section).
    'ytd-engagement-panel-section-list-renderer #contenteditable-root[contenteditable="true"]',
    'ytd-engagement-panel-section-list-renderer ytd-commentbox [contenteditable="true"]',
    'ytd-engagement-panel-section-list-renderer [contenteditable="true"][role="textbox"]',
    'ytd-shorts [contenteditable="true"][role="textbox"]',
    // Ancestry we did not predict: the id tends to survive renderer swaps, and any
    // contenteditable inside a commentbox is the composer whatever wraps it.
    '#contenteditable-root[contenteditable="true"]',
    '#contenteditable-root',
    'ytd-commentbox [contenteditable="true"]',
  ].join(', ');
  const adapter = {
    platform: 'youtube',
    actions: { watch: true, like: true, comment: true },
    // YouTube's comment box inserts a newline on Enter; you must click "Comment" to post.
    // So don't trust Enter as a submit here — only the Comment-button click credits it.
    submitOnEnter: false,
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
      if (!t || !t.closest) return null;
      // Fast path: on both layouts the submit control keeps id submit-button (watch
      // page commentbox and the shorts engagement panel commentbox alike).
      const direct = t.closest('#submit-button');
      if (direct) return direct;
      // No broad fallback on purpose: matching any commentbox button here would credit
      // instantly on emoji-picker or toolbar clicks (a real reviewer-found scenario).
      // Clicks that are not the #submit-button fall through to engage-core's
      // composer-clear confirmation, which only credits when the composer empties,
      // i.e. when a comment was genuinely posted. Slightly slower, cannot mis-credit.
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest('#contenteditable-root, [contenteditable="true"]') : null; },
    commentText() {
      // Scan every candidate composer and return the first with text (instagram.js
      // pattern). Covers the /watch composer, /shorts side-panel composer, and open
      // reply boxes, whichever the member actually typed into.
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.textContent || el.innerText || '').trim();
        if (v) return v;
      }
      return '';
    },
    // Selector-health probes for engage-core's telemetry sample: can the adapter
    // currently see a comment composer / a like control on this page at all?
    composerPresent() { try { return !!document.querySelector(COMPOSER_SEL); } catch { return false; } },
    likePresent() { try { return !!likeControl(); } catch { return false; } },
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
