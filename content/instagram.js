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
    likeTarget(t) { return t && t.closest ? t.closest('[role="button"], button, svg') : null; },
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
    // The repost control is svg[aria-label="Repost"] (role="img"), recorded live 2026-08-08.
    // repostTarget stays lenient so the clickable wrapper around that svg arms the click
    // intent too, same spirit as the TikTok repostTarget.
    repostTarget(t) { return t && t.closest ? t.closest('svg[aria-label="Repost"], [role="button"]') : null; },
    repostPresent() {
      try { return !!document.querySelector('svg[aria-label="Repost"]'); }
      catch (e) { return false; }
    },
    // NO isReposted / isRepostedFocal by choice: the owner declined a reposted-state DOM
    // marker to keep maintenance low, so Instagram credits on two signals (the click intent
    // plus the confirmed usePolarisCreateMediaRepostMutation). engage-core now treats the
    // isReposted flip as optional, so omitting it is supported: no third signal, no self-heal.
  };
  self.RGC_IG_ADAPTER = adapter;
  if (self.EngageCore) self.EngageCore.init(adapter);
})();
