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
      // m.youtube.com: mobile action bar keeps aria-pressed on the like button.
      'ytm-like-button-renderer button[aria-pressed]',
      'ytm-slim-video-action-bar-renderer button[aria-pressed]',
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
    // m.youtube.com (Firefox on Android is mostly mobile web): ytm-* markup, and the
    // composer is a plain textarea or contenteditable inside the comment dialog.
    'ytm-commentbox textarea',
    'ytm-comment-simplebox-renderer textarea',
    'ytm-commentbox [contenteditable="true"]',
    'ytm-comment-dialog-renderer textarea',
    'ytm-comment-dialog-renderer [contenteditable="true"]',
  ].join(', ');
  // One rendered comment, across the watch page, Shorts panel and m.youtube.
  const COMMENT_EL_SEL = [
    'ytd-comment-view-model',
    'ytd-comment-renderer',
    'ytd-comment-thread-renderer',
    'ytm-comment-renderer',
  ].join(', ');
  const adapter = {
    platform: 'youtube',
    actions: { watch: true, like: true, comment: true },
    // YouTube's comment box inserts a newline on Enter; you must click "Comment" to post.
    // So don't trust Enter as a submit here — only the Comment-button click credits it.
    submitOnEnter: false,
    // COMMENTS CREDIT ONLY ON YOUTUBE'S OWN create_comment REQUEST (observe.js), never
    // from this page's DOM. The DOM paths engage-core would otherwise run paid for
    // comments nobody posted (owner, 2026-09-08: "you might be crediting them before
    // they comment"), and the audit that followed found more comment credits on a video
    // than the video has comments at all:
    //   · watchForPostedComment credits when the composer reads EMPTY within 4s of any
    //     click while gate-passing text sits in any contenteditable. Clicking CANCEL
    //     empties the composer, so Cancel was a credit.
    //   · commentSubmitTarget matches #submit-button anywhere on the page and
    //     commentText() reads any contenteditable, so an unrelated submit with a stale
    //     reply box open credited too.
    // TikTok had the identical bug and was fixed the identical way in 1.161 (2,148
    // tickets in two days). The network signature is also language-proof, which the
    // composer selectors never were — they kept missing on localized layouts.
    commentConfirmNetwork: true,
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
      return t && t.closest ? t.closest('like-button-view-model, segmented-like-dislike-button-view-model, #segmented-like-button, #like-button, ytd-like-button-renderer, ytd-reel-player-overlay-renderer, ytm-like-button-renderer, ytm-slim-video-action-bar-renderer button') : null;
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

    // --- Comment identity and deletion ------------------------------------------------
    // Everything here is read STRUCTURALLY: element names, ids and hrefs, never button
    // text. Labels are localized, and the composer selectors already proved what trusting
    // wording costs (Serbian members, 2026-08-09: selector_health flooded with misses).
    commentDeleteHooks: true,

    /** A comment's own id, from the permalink YouTube hangs off every comment (?lc=<id>). */
    commentIdFromNode(node) {
      try {
        if (!node || !node.matches) return null;
        const el = node.matches(COMMENT_EL_SEL) ? node
          : (node.querySelector ? node.querySelector(COMMENT_EL_SEL) : null);
        if (!el) return null;
        const a = el.querySelector('a[href*="lc="]');
        if (a) {
          const m = /[?&]lc=([\w.-]+)/.exec(a.getAttribute('href') || '');
          if (m) return m[1];
        }
        // Present but unreadable id still counts as "a comment left the page", which is
        // the signal the delete detector actually needs. Empty string, not null: null
        // means "this was not a comment at all".
        return '';
      } catch (e) { return null; }
    },

    /** The id of the comment whose text matches what was just posted. Best effort. */
    commentIdFromDom(text) {
      try {
        const want = String(text || '').trim().slice(0, 80);
        if (!want) return null;
        for (const el of document.querySelectorAll(COMMENT_EL_SEL)) {
          const body = el.querySelector('#content-text, .comment-text, yt-attributed-string');
          const got = ((body && (body.textContent || body.innerText)) || '').trim();
          if (!got || got.slice(0, 80) !== want) continue;
          const a = el.querySelector('a[href*="lc="]');
          const m = a ? /[?&]lc=([\w.-]+)/.exec(a.getAttribute('href') || '') : null;
          if (m) return m[1];
        }
        return null;
      } catch (e) { return null; }
    },

    /** The three-dot menu on a comment. Gives us which comment is being acted on. */
    commentMenuTarget(t) {
      try {
        if (!t || !t.closest) return null;
        const btn = t.closest('#action-menu button, ytd-menu-renderer button, ytm-menu button');
        if (!btn) return null;
        const el = btn.closest(COMMENT_EL_SEL);
        if (!el) return null;
        const a = el.querySelector('a[href*="lc="]');
        const m = a ? /[?&]lc=([\w.-]+)/.exec(a.getAttribute('href') || '') : null;
        return { id: m ? m[1] : null };
      } catch (e) { return null; }
    },

    /** Confirming YouTube's "delete this comment?" dialog. Structure, not wording. */
    commentConfirmTarget(t) {
      try {
        if (!t || !t.closest) return null;
        return t.closest(
          'yt-confirm-dialog-renderer #confirm-button,'
          + 'ytd-confirm-dialog-renderer #confirm-button,'
          + 'tp-yt-paper-dialog #confirm-button,'
          + 'ytm-confirm-dialog-renderer .confirm-button,'
          + 'yt-confirm-dialog-renderer button[aria-label], ytm-confirm-dialog-renderer button'
        );
      } catch (e) { return null; }
    },
    composerSel: '#contenteditable-root, [contenteditable="true"]',
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
    // --- Highlight rings ------------------------------------------------------
    // No-arg resolvers for the gold ring engage-core draws over the native control while
    // that action is still unearned. Same safe-degrade rule as the rest of the adapter:
    // return null and there is simply no ring.
    likeHighlightTarget() {
      try {
        return document.querySelector('ytd-watch-metadata like-button-view-model button, #top-level-buttons-computed button[aria-label*="like" i]') || null;
      } catch (e) { return null; }
    },
    commentHighlightTarget() {
      try { return document.querySelector(COMPOSER_SEL) || document.querySelector('#simplebox-placeholder') || null; } catch (e) { return null; }
    },
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
