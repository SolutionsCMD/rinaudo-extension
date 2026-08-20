// Instagram adapter for engage-core. Selectors are best-effort and may need live tuning.
// Photo posts have no <video> so the watch row simply never appears (getVideoEl null).
(function () {
  // Every element Instagram might use for the comment composer, most specific first.
  const COMPOSER_SEL = [
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]',
    '[contenteditable="true"][aria-label*="comment" i]',
    '[role="textbox"][aria-label*="comment" i]',
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ].join(', ');

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
    // Broad on purpose — any button/svg click arms the sampler, but isLiked() (red heart)
    // is what actually credits, so a click on a non-like control never fires a like.
    //
    // EXCEPT the comment submit. engage-core uses likeTarget as an EARLY-RETURN GUARD in
    // its click path (a TikTok like sits in the same action bar as the comment box, so a
    // like click must not be read as a comment). Instagram's Post control is a
    // role="button", so this broad match claimed it, the handler returned, and neither
    // commentSubmitTarget nor the composer-cleared fallback ever ran: a comment posted by
    // CLICKING never credited, while one posted by pressing Enter did, because that is a
    // separate listener. Members saw it as "Instagram comments don't pay" — reported by
    // Dodger and by WalcoholicWalrus, who had 0 of 9 Instagram comments credited while
    // scoring 27/27 on YouTube, 12/12 on Facebook and 6/6 on X (2026-08-20).
    //
    // Deliberately narrow: only a control that IS the comment submit is refused, so every
    // other button and svg still arms the like sampler exactly as before.
    likeTarget(t) {
      if (!t || !t.closest) return null;
      const b = t.closest('[role="button"], button, svg');
      if (!b) return null;
      // Instagram's action-bar controls are ICONS (an svg heart, paper plane, bookmark);
      // the comment submit is a TEXT button ("Post", "Plaatsen", "Publier"). So an
      // icon-less control that also answers commentSubmitTarget is the submit, never a
      // like. Checking for the icon rather than the label keeps this language-agnostic,
      // and checking it BEFORE commentSubmitTarget matters: that helper only asks whether
      // the button shares an ancestor with the composer within 8 levels, and on a post
      // page the <article> contains both, so on its own it would disown the heart too
      // (caught in test, 2026-08-20).
      const isIcon = b.tagName.toLowerCase() === 'svg' || !!b.querySelector('svg');
      if (!isIcon) {
        try { if (this.commentSubmitTarget && this.commentSubmitTarget(t)) return null; } catch (e) { /* keep the like */ }
      }
      return b;
    },
    commentSubmitTarget(t) {
      const b = t && t.closest ? t.closest('[role="button"], button') : null;
      if (!b) return null;
      // Confirm the button shares a container with the composer (language-agnostic).
      // Instagram doesn't use <form> or class="comment", so walk up ~8 levels. The
      // composer is a contenteditable box on current Instagram, a <textarea> on older
      // markup, so accept either or the button is never recognised.
      let el = b;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement;
        if (!el) break;
        if (el.querySelector(COMPOSER_SEL)) return b;
      }
      return null;
    },
    commentInputTarget(t) { return t && t.closest ? t.closest(COMPOSER_SEL) : null; },
    composerSel: COMPOSER_SEL,
    commentText() {
      // Instagram now renders the comment box as a contenteditable div (role="textbox"),
      // not a <textarea>. Reading only textarea returned '' forever, so the >5-char gate
      // never passed and a comment could not credit. Prefer a labelled composer, fall
      // back to any contenteditable textbox, then to legacy textarea markup.
      for (const el of document.querySelectorAll(COMPOSER_SEL)) {
        const v = (el.value || el.textContent || el.innerText || '').trim();
        if (v) return v;
      }
      return '';
    },
    getVideoEl() { return document.querySelector('video'); },

    // --- Repost ---------------------------------------------------------------
    // Credit reposts from the confirmed network mutation alone, no click intent needed.
    // A viewer on a FRENCH Instagram reported 2026-08-11 that repost never paid: the
    // selectors below key on the ENGLISH aria-label "Repost", which is localized
    // ("Republier"), so the intent never armed and the confirmed mutation was thrown away.
    // usePolarisCreateMediaRepostMutation is language independent, and the widget only ever
    // binds on a single-post permalink (getRef parses /p/<shortcode>/), so a repost firing
    // while this target is bound belongs to this post. Same fix already proven for the
    // Facebook like. The selectors below stay for the highlight ring, which is cosmetic and
    // simply does not draw in other languages.
    repostNetworkPageScoped: true,
    // The repost control is svg[aria-label="Repost"] (role="img"), recorded live 2026-08-08.
    // The intent must arm ONLY on the repost control (its svg, or the wrapper button that
    // contains that svg), never on an arbitrary role=button, so a delayed confirmation from
    // an earlier post cannot be absorbed by a like/comment/menu click and credit the wrong post.
    repostTarget(t) {
      if (!t || !t.closest) return null;
      // The svg itself, if the click landed on it.
      const svg = t.closest('svg[aria-label="Repost"]');
      if (svg) return svg;
      // Otherwise the clickable wrapper, but ONLY when it actually contains the repost icon,
      // so a click on like/comment/menu (also role=button) never arms a repost intent and
      // cannot absorb a stray confirmation.
      const btn = t.closest('[role="button"], button');
      return btn && btn.querySelector('svg[aria-label="Repost"]') ? btn : null;
    },
    repostPresent() {
      try { return !!document.querySelector('svg[aria-label="Repost"]'); }
      catch (e) { return false; }
    },
    // The native control to ring for the FOCAL post: the same svg[aria-label="Repost"] that
    // repostTarget/repostPresent trust, preferring its clickable wrapper button so the ring
    // sits over what the user actually clicks. Instagram post pages are single-post surfaces,
    // so a non-empty getRef is the focal guard. Returns null when getRef is empty or the
    // control is absent, both safe no-rings.
    // --- Highlight rings ------------------------------------------------------
    // No-arg resolvers for the gold ring engage-core draws over the native control while
    // that action is still unearned. Same safe-degrade rule as the rest of the adapter:
    // return null and there is simply no ring.
    likeHighlightTarget() {
      try {
        const svg = document.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]');
        return svg ? (svg.closest('[role="button"], button') || svg) : null;
      } catch (e) { return null; }
    },
    commentHighlightTarget() {
      try { return document.querySelector(COMPOSER_SEL) || null; } catch (e) { return null; }
    },
    repostHighlightTarget() {
      try {
        if (!this.getRef()) return null;
        const svg = document.querySelector('svg[aria-label="Repost"]');
        if (!svg) return null;
        return svg.closest('[role="button"], button') || svg;
      } catch (e) { return null; }
    },
    // NO isReposted / isRepostedFocal by choice: the owner declined a reposted-state DOM
    // marker to keep maintenance low, so Instagram credits on two signals (the click intent
    // plus the confirmed usePolarisCreateMediaRepostMutation). engage-core now treats the
    // isReposted flip as optional, so omitting it is supported: no third signal, no self-heal.
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
