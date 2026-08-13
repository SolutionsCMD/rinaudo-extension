// Facebook adapter for engage-core. Selectors are best-effort and may need live tuning.
// His posts are Reels, so the canonical target is /reel/<numeric id> and getRef() must
// return that same numeric id the server's normalizeFacebook() parses out of the URL, or
// an engagement never matches a target. Shaped exactly like the Instagram adapter: a
// 2-signal repost (click intent + confirmed network mutation), NO third isReposted marker.
(function () {
  // Every element Facebook might use for the comment composer, most specific first. FB
  // renders the box as a contenteditable whose aria-label is "Comment as <name>" on a
  // post, "Write a comment" / "Write a public comment..." on others.
  const COMPOSER_SEL = [
    '[contenteditable="true"][aria-label^="Comment as " i]',
    '[contenteditable="true"][aria-label^="Write a comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '[role="textbox"][aria-label*="comment" i]',
    'div[contenteditable="true"][role="textbox"]',
  ].join(', ');

  // ── Logged-in check ───────────────────────────────────────────────────────
  // A logged-out viewer can still watch a reel, but a like or comment silently does
  // nothing, so they burn time earning zero. This tells them, and nothing more.
  //
  // Deliberately NOT selector-based. Facebook renders different markup per locale and
  // per surface — the same reason like-detection moved to network signals after the
  // French-account report. Both signals below are language-independent:
  //
  //   1. the `c_user` cookie. Facebook sets it to the logged-in account id and it is
  //      not httpOnly, so a content script can read it via document.cookie. Its mere
  //      presence is definitive proof of a session.
  //   2. `"USER_ID":"<digits>"` in the page's own bootstrap payload, which Facebook
  //      embeds on every page. It is exactly "0" when logged out.
  //
  // FAIL OPEN. Only signal 2 can prove logged-OUT, and only when it explicitly says
  // "0". Anything else — no cookie, no bootstrap, markup we don't recognise — is
  // treated as logged in and shows nothing. A false warning would train people to
  // ignore the widget, which is worse than staying quiet.
  function loginState() {
    try {
      if (/(^|;\s*)c_user=\d+/.test(document.cookie || '')) return 'in';
    } catch { /* cookie access can throw in odd embedding contexts */ }
    try {
      const html = document.documentElement ? document.documentElement.innerHTML : '';
      const m = html.match(/"USER_ID"\s*:\s*"(\d+)"/);
      if (m) return m[1] === '0' ? 'out' : 'in';
    } catch { /* ignore */ }
    return 'unknown';
  }

  const adapter = {
    platform: 'facebook',
    // HARD GATE: no tickets at all from Facebook without a signed-in session.
    // engage-core refuses to open a watch session (first or replay) while this returns
    // a reason, and shows it in place of the rows.
    //
    // Only a PROVEN signed-out state blocks. 'unknown' is allowed through on purpose:
    // the extension has to keep working on mobile Firefox and inside Facebook's various
    // surfaces, and wrongly blocking a real viewer costs them tickets they earned. A
    // signed-out session is the case that actually needed closing, and it is the one
    // this proves. See loginState() for the two signals.
    earnBlocked() {
      return loginState() === 'out'
        ? 'Sign in to Facebook to collect tickets. Nothing here will pay while you are signed out.'
        : null;
    },
    // Exposed so the popup / background can ask without duplicating the logic.
    loginState,
    // Likes credit from the page's own react mutation, page-scoped: a reel permalink is a
    // single-post surface, so a confirmed react while this target is bound belongs to it.
    // No DOM anchoring involved, which is what kept breaking per-surface and per-language.
    likeNetworkPageScoped: true,
    // Repost credits on the confirmed ComposerStoryCreateMutation ALONE, with no click
    // intent required. Reported 2026-08-12: everything else redeemed but the reshare never
    // did, on Chrome with 1.123 and signed in.
    //
    // Cause is the same shape as the French Instagram report. Facebook was a two-signal
    // repost, so the mutation only pays if repostTarget() armed an intent first, and that
    // target only matches controls inside the share DIALOG. His posts are Reels, and the
    // Reel share sheet is not that dialog, so the intent never armed and the mutation that
    // did arrive was thrown away.
    //
    // Safe for the same reason it is safe on Instagram: getRef() only resolves on a single
    // post permalink (/reel/<id>, /videos/<id>, /posts/<id>, ?v=, ?story_fbid=), so the
    // widget never binds on a feed. One post on the page means a reshare mutation firing
    // here belongs to it. The mutation itself is the proof of a real reshare, so a looser
    // intent cannot invent a credit.
    repostNetworkPageScoped: true,
    actions: { watch: true, like: true, comment: true },
    // Comments post on Enter (no Shift), same as Instagram/TikTok. Made explicit so the
    // intent is documented even though undefined already enables the Enter path.
    submitOnEnter: true,
    // The reel/post id. Order matters: /reel/<id> is the canonical Reel target (primary),
    // then the other post shapes. Returns '' when nothing matches, which parks the widget.
    // Must equal the server ref, which is the numeric reel id for a /reel/<id> URL.
    getRef() {
      try {
        const path = location.pathname || '';
        // /reel/<digits> — primary; his posts are Reels and this is the canonical target.
        let m = path.match(/\/reel\/(\d+)/);
        if (m) return m[1];
        // /<x>/videos/<digits>
        m = path.match(/\/[^/]+\/videos\/(\d+)/);
        if (m) return m[1];
        // /<x>/posts/<id> — the id may be numeric or a pfbid token; return it verbatim.
        m = path.match(/\/[^/]+\/posts\/([^/?#]+)/);
        if (m) return m[1];
        // /watch/?v=<digits> and permalinks carrying ?story_fbid=<digits>.
        const qs = new URLSearchParams(location.search || '');
        const v = qs.get('v');
        if (v && /^\d+$/.test(v)) return v;
        const story = qs.get('story_fbid');
        if (story && /^\d+$/.test(story)) return story;
        return '';
      } catch (e) { return ''; }
    },
    isLiked() {
      // FB toggles the like control's aria-label between "Like" and "Remove Like" (confirmed
      // live), and sets aria-pressed on the pressed state. Either signal means liked.
      // LANGUAGE: the label branches only ever match an ENGLISH interface. A French member
      // reported like and repost never crediting while watch worked fine (2026-08-09), which
      // is exactly this: "J'aime" matches nothing, so neither the click hook NOR this
      // self-heal could ever fire. aria-pressed is the same on every locale, so it carries
      // the non-English case below.
      try {
        for (const el of document.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
          const label = (el.getAttribute('aria-label') || '').trim();
          if (/^remove like$/i.test(label)) return true;
          if (/^(like|remove like)$/i.test(label) && el.getAttribute('aria-pressed') === 'true') return true;
        }
        // Language-neutral fallback. Deliberately conservative: this runs in the self-heal
        // poll where a false positive would credit a like the member never gave, so it only
        // answers when the page is UNAMBIGUOUS — exactly one pressed toggle. A reel page with
        // several (a muted video control, a follow toggle) returns false and we simply miss
        // the heal rather than pay for a like that did not happen.
        const pressed = document.querySelectorAll('[role="button"][aria-pressed="true"], button[aria-pressed="true"]');
        if (pressed.length === 1) return true;
        return false;
      } catch (e) { return false; }
    },
    // The like control is the button/[role=button] whose aria-label is Like or Remove Like.
    // The click may land on an inner span/svg, so resolve the labelled ancestor first, then
    // fall back to the nearest button when it carries the label itself.
    likeTarget(t) {
      if (!t || !t.closest) return null;
      const byLabel = t.closest('[aria-label="Like"], [aria-label="Remove Like"]');
      if (byLabel) return byLabel;
      const btn = t.closest('[role="button"], button');
      if (!btn) return null;
      if (/^(like|remove like)$/i.test((btn.getAttribute('aria-label') || '').trim())) return btn;
      // Language-neutral: on a non-English FB the label is localised ("J'aime"), but the
      // like control still carries aria-pressed. Safe here because this is a real click the
      // member just made on that control, and engage-core still reads isLiked() first so an
      // UN-like is never credited.
      if (btn.hasAttribute('aria-pressed')) return btn;
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest(COMPOSER_SEL) : null; },
    commentText() {
      // FB's composer is a contenteditable div, so read textContent (value only for the odd
      // legacy textarea). Prefer a labelled composer, fall back to any contenteditable box.
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.textContent || el.innerText || el.value || '').trim();
        if (v) return v;
      }
      return '';
    },
    // Comments submit on Enter (trusted via submitOnEnter above); this is only the click
    // fast path. Match FB's in-composer send control (aria-label Comment / Post / Send), but
    // ONLY when it shares a container with the composer, so the action-bar "Comment" button
    // (which just focuses the box, never submits) is never mistaken for a submit. Returns
    // null when there is no such control, and engage-core's composer-clear fallback covers it.
    commentSubmitTarget(t) {
      if (!t || !t.closest) return null;
      const b = t.closest('[role="button"], button');
      if (!b) return null;
      if (!/^(comment|post|send)$/i.test((b.getAttribute('aria-label') || '').trim())) return null;
      let el = b;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement; if (!el) break;
        if (el.querySelector(COMPOSER_SEL)) return b;
      }
      return null;
    },
    getVideoEl() { return document.querySelector('video'); },

    // --- Repost ---------------------------------------------------------------
    // Reshare is a two-step gesture: open the post's Share affordance, then click "Share now"
    // in the dialog. The intent arms ONLY on the "Share now" control (aria-label "Share now"),
    // never on the outer Share button or any role=button, so a delayed confirmation from an
    // earlier post cannot be absorbed by a like/comment/menu click and credit the wrong post.
    repostTarget(t) {
      if (!t || !t.closest) return null;
      const byLabel = t.closest('[aria-label="Share now"]');
      if (byLabel) return byLabel;
      const btn = t.closest('[role="button"], button');
      if (!btn) return null;
      if (/^share now$/i.test((btn.getAttribute('aria-label') || '').trim())) return btn;
      // LANGUAGE: "Share now" is English-only, so on a localised FB the intent could never
      // arm and the reshare never credited (French member, 2026-08-09). Widened to ANY
      // role=button inside the share DIALOG. This stays safe because Facebook is a TWO-signal
      // repost: the intent alone pays nothing, and the confirming
      // ComposerStoryCreateMutation only fires on a real reshare. A looser intent therefore
      // cannot create a false credit, it can only let a genuine reshare be recognised.
      const dlg = btn.closest('[role="dialog"]');
      return dlg ? btn : null;
    },
    // Whether the post's Share affordance exists at all, the honest answer to "could this
    // build repost here" and what the selector-health probe reports on. FB labels it "Share"
    // (older surfaces spell it out), and the dialog's "Share now" also counts as present.
    repostPresent() {
      try {
        // English labels first, then a language-neutral shape check: the reel action rail
        // exposes its share control with aria-haspopup, which is locale independent.
        return !!document.querySelector('[aria-label="Share"], [aria-label="Share now"], [aria-label="Send this to friends or post it on your profile."], [role="button"][aria-haspopup="dialog"]');
      } catch (e) { return false; }
    },
    // NO isReposted / isRepostedFocal by choice, same as Instagram: the owner declined a
    // reposted-state DOM marker to keep maintenance low, so Facebook credits on two signals
    // (the click intent plus the confirmed ComposerStoryCreateMutation). engage-core treats
    // the isReposted flip as optional, so omitting it is supported: no third signal, no self-heal.

    // The native control to ring for the FOCAL post. FB reshare is a two-step flow, so the
    // control to click FIRST is the entry Share button that opens the dialog, not the in-dialog
    // "Share now" (step two). Keyed on the same entry labels repostPresent trusts ("Share" /
    // "Send this to friends or post it on your profile."), preferring the clickable wrapper so
    // the ring sits over what the user clicks. A non-empty getRef is the focal guard; returns
    // null when getRef is empty or the entry control is absent, both safe no-rings.
    // --- Highlight rings ------------------------------------------------------
    // No-arg resolvers for the gold ring engage-core draws over the native control while
    // that action is still unearned. Same safe-degrade rule as the rest of the adapter:
    // return null and there is simply no ring.
    likeHighlightTarget() {
      try {
        for (const el of document.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
          if (/^(like|remove like)$/i.test((el.getAttribute('aria-label') || '').trim())) return el;
        }
        // Localised UI: the like control still carries aria-pressed (see isLiked).
        const pressed = document.querySelectorAll('[role="button"][aria-pressed], button[aria-pressed]');
        return pressed.length === 1 ? pressed[0] : null;
      } catch (e) { return null; }
    },
    commentHighlightTarget() {
      try { return document.querySelector(COMPOSER_SEL) || null; } catch (e) { return null; }
    },
    // Step two of a reshare: the options inside the open share sheet.
    repostDialogHighlightTargets() {
      try {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        return Array.from(dlg.querySelectorAll('[role="button"], button'))
          .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
          .slice(0, 3);
      } catch (e) { return null; }
    },
    repostHighlightTarget() {
      try {
        if (!this.getRef()) return null;
        const entry = document.querySelector('[aria-label="Share"], [aria-label="Send this to friends or post it on your profile."]');
        if (!entry) return null;
        return entry.closest('[role="button"], button') || entry;
      } catch (e) { return null; }
    },
  };
  self.RGC_FB_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
