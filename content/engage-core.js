// Shared engagement engine for per-platform content scripts (X, YouTube, TikTok,
// Instagram). An adapter supplies the platform name, which actions apply, and the
// DOM selectors; this engine does the widget, the watch session loop, like/comment
// detection (+ the >5-char comment gate), the SW wiring, SPA re-checks, and the
// per-row state indicators (idle / pending / done, plus watch playing / paused).
// Loaded after config.js + widget-frame.js, before the adapter.
//
// Adapter shape:
//   { platform, actions:{watch,like,comment}, getRef()->string, isLiked()->bool,
//     commentSubmitTarget(eventTarget)->Element|null, commentText()->string,
//     getVideoEl()->HTMLVideoElement|null }
// Optional, for the three-signal repost / in-platform send (engagement v2):
//   { repostTarget(eventTarget)->Element|null, sendTarget(eventTarget)->Element|null,
//     isReposted()->bool, isRepostedFocal()->bool|null, repostPresent()->bool,
//     sendPresent()->bool }
// An adapter that omits repostTarget/sendTarget simply never offers that row and never
// credits it, which is how a platform whose controls have not been mapped yet degrades.
// isReposted() is OPTIONAL hardening for a repost: where an adapter exposes it (X, TikTok),
// crediting waits for the platform's own control to flip to its undo state, which proves the
// platform really did it (see the repost section below). Where it is absent (Instagram, by
// owner decision) a repost credits on two signals, the click intent plus the confirmed
// network mutation, the same way a send does. isRepostedFocal() is the optional strict
// variant used only by the self-heal poll: bool when it can resolve the card for this page's
// own post, null when it cannot judge. Adapters that omit it keep the wider isReposted(), and
// adapters that omit both (Instagram) have no self-heal.
self.EngageCore = (function () {
  const ROW_CSS = `
    .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
    .row:first-child{margin-top:0}
    .lbl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .amt{color:#A9A697;font-variant-numeric:tabular-nums;flex:none;margin-left:8px}
    .done{color:#86D6A4}
    .row.pending .lbl,.row.pending .amt{color:#8A8678}
    .row.paused .lbl{color:#8A8678}
    .amt.req{color:#E8B339}
    .hint{font-size:11px;color:#6B6960;margin:2px 0 6px;line-height:1.3}
    .warn{font-size:11.5px;color:#F5C77E;background:rgba(245,199,126,.10);border:1px solid rgba(245,199,126,.32);border-radius:7px;padding:7px 9px;margin:0 0 8px;line-height:1.35}`;

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const watchEstimate = (sec, r) => Math.max(r.watchFloor || 5, Math.floor((sec || 0) / 60) * (r.watchPerMinute || 1));
  // Credit needs `reqHb` well-spaced heartbeats (first ~a tick in, then every hbInterval),
  // which for short videos takes longer than requiredWatchSeconds. Target that
  // heartbeat-limited time (+~2 ticks of slack) so the bar doesn't read "done" before the
  // claim can land. For long videos requiredWatchSeconds dominates, so it's unchanged.
  const effectiveTarget = (reqSec, reqHb, hbInterval) => Math.max(reqSec || 120, 10 + ((reqHb || 2) - 1) * (hbInterval || 20));

  function init(A) {
    let frame = null, state = null, commentHooked = false, likeHooked = false, lastHb = 0;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1,
      repostReward: 0, shareSendReward: 0, engageBonusReward: 0 };

    // Admin "hide the repost / share row" switch — same public S2 status feed the Kick
    // watchtime widget uses (the SW's 30s status poll writes chrome.storage.local.shareHidden).
    // When set, the repost row is not drawn AND every repost credit path stands down (see
    // repostCapable below), so a hidden row can never silently credit. Like / comment / watch /
    // replay / send are untouched. Absent flag (default false) keeps the row shown, so older
    // servers stay backwards compatible.
    let shareHidden = false;
    chrome.storage.local.get('shareHidden').then(({ shareHidden: sh }) => {
      shareHidden = sh === true;
      if (frame) drawWidget();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((ch) => {
      if (!ch.shareHidden) return;
      shareHidden = ch.shareHidden.newValue === true;
      // Re-draw so a toggle lands within a poll cycle with no page reload: the repost row
      // appears or disappears and the earned pill recomputes.
      if (frame) drawWidget();
    });

    // Locally remember what's already credited per (platform, post) so the ✓ state
    // survives a refresh (the server is idempotent; this is purely the display).
    // Shape: { like, comment, watch, awarded, repost, send, bonus }.
    const doneKey = (ref) => `rgcDone:${A.platform}:${ref}`;
    async function getDone(ref) { try { const k = doneKey(ref); return (await chrome.storage.local.get(k))[k] || {}; } catch { return {}; } }
    async function setDone(ref, patch) { try { const k = doneKey(ref); const cur = (await chrome.storage.local.get(k))[k] || {}; await chrome.storage.local.set({ [k]: { ...cur, ...patch } }); } catch { /* ignore */ } }

    function ensureFrame() {
      if (frame) return;
      frame = self.RGCFrame.mount({ key: A.platform, title: '🎟 Earn Tickets', width: 300, pos: { bottom: 16, right: 16 }, css: ROW_CSS });
    }
    // status: 'idle' | 'pending' | 'done'
    function rowEl(label, amt, status) {
      const r = document.createElement('div'); r.className = 'row' + (status === 'pending' ? ' pending' : '');
      const l = document.createElement('span'); l.className = 'lbl';
      l.textContent = (status === 'done' ? '✓ ' : '') + label; if (status === 'done') l.classList.add('done');
      const a = document.createElement('span'); a.className = 'amt';
      a.textContent = status === 'pending' ? '⋯' : amt;
      if (amt === 'Required') a.classList.add('req');
      r.append(l, a); return r;
    }
    // Like/comment amount text. When the action earns no tickets of its own (reward 0),
    // it's a gate for the watch reward, so show 'Required' instead of a pointless '+0'.
    function socialAmt(reward, status) {
      if (reward > 0) return `+${reward}`;
      return status === 'done' ? '' : 'Required';
    }
    // The video's full-watch reward, shown as the headline so a long video reads "+33" not
    // "+5" (the floor). The amount actually credited comes from the claim.
    //
    // The SERVER's per-target figure wins when we have it: it is the same formula plus
    // anything this client cannot see, today the early-watch bonus (a video in its first
    // half hour pays extra). Computing it locally understated that — the toast said 25 while
    // this row said 15 for the same video (owner, 2026-08-18). The local calculation stays
    // as the fallback for an older server that sends no per-target reward.
    function watchPotential() {
      const srv = Number(state && state.targetReward);
      if (Number.isFinite(srv) && srv > 0) return srv;
      const v = A.getVideoEl();
      const durMin = (v && isFinite(v.duration) && v.duration > 0) ? Math.floor(v.duration / 60) : 0;
      return Math.max(rewards.watchFloor || 5, durMin * (rewards.watchPerMinute || 1));
    }
    /** Is this video inside its early-watch window? Server-driven: the per-target reward
     *  exceeds what length alone explains, by exactly the published bonus. */
    function earlyBonusNow() {
      const bonus = Number(rewards.watchEarlyBonus) || 0;
      if (bonus <= 0) return 0;
      const srv = Number(state && state.targetReward);
      if (!Number.isFinite(srv) || srv <= 0) return 0;
      const v = A.getVideoEl();
      const durMin = (v && isFinite(v.duration) && v.duration > 0) ? Math.floor(v.duration / 60) : 0;
      const base = Math.max(rewards.watchFloor || 5, durMin * (rewards.watchPerMinute || 1));
      return srv - base === bonus ? bonus : 0;
    }
    function watchRow() {
      if (state.watchDone) return rowEl('Watched', `+${state.awarded != null ? state.awarded : watchPotential()}`, 'done');
      if (state.claiming) return rowEl(`Watch ${fmt(state.watched)} / ${fmt(state.target)}`, '', 'pending');
      const playing = state.watchPlaying;
      const suffix = playing ? '' : (state.watchMuted ? ' · unmute to earn' : ' · paused');
      const icon = playing ? '▶' : (state.watchMuted ? '🔇' : '⏸');
      // Say WHY it pays more while the early window is open, or the bigger number just
      // reads as a mistake and nobody hurries for a bonus they cannot see.
      const early = earlyBonusNow();
      const label = `${icon} Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}${suffix}`
        + (early > 0 ? ` · +${early} early bonus` : '');
      const r = rowEl(label, `+${watchPotential()}`, 'idle');
      if (!playing) r.classList.add('paused');
      return r;
    }
    // "Watch again for +N" — a second timer shown once the base watch is done, for eligible
    // targets (TikTok / YouTube Shorts). The clip just loops, so this is seamless: the timer
    // reads as a continuation of the first (base → 2×base) even though the extra watch needed
    // is only one more base length.
    function replayRow() {
      const rw = state.replayReward || 1;
      if (state.replayAllDone) return rowEl('Watched again', `+${rw * (state.replayUsed || 1)}`, 'done');
      const base = state.baseTarget || state.target || 0;
      const shownWatched = base + (state.watched || 0);
      const shownTarget = base + (state.target || base); // ≈ 2×base
      if (state.claiming) return rowEl(`Watch again ${fmt(shownWatched)} / ${fmt(shownTarget)}`, '', 'pending');
      const playing = state.watchPlaying;
      const suffix = playing ? '' : (state.watchMuted ? ' · unmute to earn' : ' · paused');
      const icon = playing ? '▶' : (state.watchMuted ? '🔇' : '⏸');
      const r = rowEl(`${icon} Watch again ${fmt(shownWatched)} / ${fmt(shownTarget)}${suffix}`, `+${rw}`, 'idle');
      if (!playing) r.classList.add('paused');
      return r;
    }
    // Does this target offer a second-watch reward the user hasn't exhausted?
    function replayAvailable() {
      return !!(state && state.replayEligible && (state.replayMax || 0) > 0);
    }
    function hint(text) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = text; return h; }
    function warn(text) { const w = document.createElement('div'); w.className = 'warn'; w.textContent = text; return w; }
    // Can THIS build actually perform the action on this platform? The server's capability
    // matrix (state.canRepost / state.canSend) says the platform offers it; these say the
    // adapter in front of us can see the control that starts it. For a repost, isReposted()
    // is optional extra proof (the flipped control), NOT a gate: adapters that expose it (X,
    // TikTok) wait for the flip before paying, adapters that do not (Instagram) credit on the
    // click intent plus the confirmed network mutation. An adapter that cannot see the control
    // can never credit, so nothing that depends on it may be advertised.
    // shareHidden (admin kill switch) forces NOT capable. This is the single chokepoint every
    // repost path funnels through, so gating it here drops the row in drawWidget, stands the 5s
    // self-heal down, and makes the network-confirmation owner/credit checks bail — a hidden row
    // therefore cannot silently credit. bonusReachable() keys off this too, so "Do it all" also
    // hides while the set is unreachable. Like / comment / watch / replay / send are unaffected.
    const repostCapable = () => !!(state && state.canRepost) && !shareHidden
      && typeof A.repostTarget === 'function';
    const sendCapable = () => !!(state && state.canSend) && typeof A.sendTarget === 'function';
    // Read the adapter's repost state without ever letting selector drift throw.
    // Strict focal read for the self-heal, wrapped like every other adapter DOM call so
    // selector drift cannot throw out of the 5s tick and take watch accrual down with it.
    // The adapter's null ("cannot judge this page") must never self-heal.
    const focalReposted = () => {
      try {
        if (typeof A.isRepostedFocal !== 'function') return adapterReposted();
        return A.isRepostedFocal() === true;
      } catch { return false; }
    };
    const adapterReposted = () => { try { return typeof A.isReposted === 'function' && !!A.isReposted(); } catch { return false; } };
    // The all-done bonus pays only for the COMPLETE set, so the row may only appear when
    // every action the server counts on this platform is reachable in this build. TikTok
    // and Instagram advertise repost / send in their capability matrix, but their adapters
    // have no such controls mapped yet, so the set cannot be finished there and the row
    // would be advertising a bonus nobody could collect.
    function bonusReachable() {
      if (!state) return false;
      if (state.canRepost && !repostCapable()) return false;
      if (state.canSend && !sendCapable()) return false;
      return true;
    }
    function drawWidget() {
      if (!state) return;
      ensureFrame();
      const body = frame.body; body.replaceChildren();
      // Optional per-adapter notice, drawn above the rows. Advisory ONLY: it never
      // gates a row, disables a button or blocks a claim, so a wrong answer can
      // cost a viewer nothing. Adapters without notice() are unaffected.
      const blocked = earnBlocked();
      if (blocked) {
        body.append(warn(blocked));
        // Nothing else is drawn: showing rows that cannot pay would be a lie.
        return;
      }
      if (typeof A.notice === 'function') {
        let n = null;
        try { n = A.notice(); } catch { n = null; }
        if (n) body.append(warn(n));
      }
      if (A.actions.watch && (state.sessionId || state.watchDone)) {
        body.append(watchRow());
        if (state.watchError && !state.watchDone) body.append(hint(watchErrText(state.watchError)));
        else if (!state.watchDone) body.append(hint('Keep tab open & unmuted while watching'));
        // Second-watch row: appears seamlessly once the base watch is collected.
        if (state.watchDone && replayAvailable()) {
          body.append(replayRow());
          if (!state.replayAllDone) body.append(hint('Keep watching for one more ticket'));
        }
      }
      if (A.actions.like) body.append(rowEl('Like', socialAmt(rewards.likeReward, state.likeS), state.likeS));
      // The server can switch commenting off per platform (targets route sends
      // commentEnabled:false). When that happens the comment row is HIDDEN entirely,
      // not shown as off, so nothing dangles a reward nobody can collect. Undefined
      // means an older server, so default to enabled.
      if (A.actions.comment && state.commentEnabled !== false) {
        body.append(rowEl('Comment something meaningful', socialAmt(rewards.commentReward, state.commentS), state.commentS));
        // No hint line: the row label itself is the owner's full instruction ("Comment
        // something meaningful"). The word-count floor and the banned-words list are
        // enforced silently by passesGate; naming them was bad optics and a dodge guide.
      }
      // Repost / send. Two gates, both required, and the reward gate is the dark-ship
      // contract: the server says the platform offers the action AND this adapter can do
      // and prove it (repostCapable / sendCapable), and the tariff pays more than 0 for
      // it. A reward of 0 means the action is not earning yet, so the row must not render
      // at all; an adapter that cannot see the control could never keep the promise.
      if (repostCapable() && rewards.repostReward > 0) {
        body.append(rowEl('Repost it', `+${rewards.repostReward}`, state.repostS));
      }
      if (sendCapable() && rewards.shareSendReward > 0) {
        body.append(rowEl('Send it to a friend', `+${rewards.shareSendReward}`, state.sendS));
      }
      // All-done bonus. The server computes and pays it; this row only reports it. Shown
      // only when the whole set is actually reachable here (or has already been earned,
      // in which case it plainly was).
      if (rewards.engageBonusReward > 0 && (state.bonusDone || bonusReachable())) {
        body.append(rowEl('Do it all', `+${rewards.engageBonusReward}`, state.bonusDone ? 'done' : 'idle'));
      }
      const earned = (state.likeS === 'done' ? rewards.likeReward : 0) + (state.commentS === 'done' ? rewards.commentReward : 0)
        + (state.repostS === 'done' ? rewards.repostReward : 0) + (state.sendS === 'done' ? rewards.shareSendReward : 0)
        + (state.bonusDone ? rewards.engageBonusReward : 0)
        + (state.watchDone ? (state.awarded || 0) : 0) + ((state.replayReward || 0) * (state.replayUsed || 0));
      frame.setPill(earned ? `+${earned}` : '🎟');
      // Keep the on-page share-highlight ring in sync with this draw (repost done,
      // shareHidden toggle, ref change, etc.). Never let a ring error break the widget.
      try { ensureShareRing(); } catch { /* safe degrade: no ring */ }
    }
    function clearWidget() { try { teardownShareRing(); } catch { /* safe degrade */ } if (frame) { frame.destroy(); frame = null; } state = null; }

    // --- On-page SHARE-HIGHLIGHT ring -------------------------------------------
    // A gold ring + "+N" badge drawn OVER the platform's own Share / Repost control so
    // the member can see which native button starts the reshare that is still owed. This
    // is purely an on-page indicator, entirely separate from the draggable widget: the
    // overlay is pointer-events:none and never restyles the host button, so it can never
    // intercept the click or disturb the confirmation flow.
    //
    // It shows only when a repost is bound for THIS post, the server says the platform
    // offers it (state.canRepost), the tariff pays for it (rewards.repostReward > 0), the
    // repost is not already done (state.repostS !== 'done'), the admin kill switch is off
    // (!shareHidden), and the adapter can point at the control (A.repostHighlightTarget()
    // returns an element for the focal post). Anything missing, or any throw anywhere,
    // means no ring (safe degrade). Gold #C9A766 matches the widget chrome. A rAF follow
    // loop keeps the ring hugging the control across scroll / resize / SPA relayout on
    // desktop and mobile Firefox alike; the expensive re-resolve + gate re-check is
    // throttled to ~500ms while the cheap per-frame reposition just tracks the rect.
    const RING_GOLD = '#C9A766';
    // One highlight per action that is still OUTSTANDING on this post: like, comment,
    // repost, and every button inside an OPEN share dialog (the second step of a reshare,
    // which is where members get stuck). Each ring is an independent overlay so they can
    // show together. Same contract as the original single share ring: pointer-events:none
    // so the click always falls through, a rAF loop keeps each ring hugging its control,
    // the expensive re-resolve is throttled to ~500ms, and ANY throw tears everything down
    // (no ring is always better than a broken page).
    let rings = new Map();      // key -> { host, ring, badge, el, last }
    let ringsRaf = 0;
    let ringsLastResolve = 0;

    function ringCall(fn) {
      try { return typeof A[fn] === 'function' ? A[fn]() : null; } catch { return null; }
    }
    // The comment composer, from the adapter's OWN selector (A.composerSel), so the ring
    // and the credit path can never disagree about what the composer is. A composer inside
    // an open dialog wins: X posts replies from a modal, and Instagram and Facebook open
    // one over the feed, so the modal copy is the one the member is actually typing into.
    // Returns null when nothing is laid out, which simply means no ring.
    function composerEl() {
      try {
        const sel = A.composerSel;
        if (!sel) return null;
        const inDialog = sel.split(',')
          .map((s) => '[role="dialog"] ' + s.trim()).join(', ');
        const visible = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return (r.width > 20 && r.height > 10) ? el : null;
        };
        for (const q of [inDialog, sel]) {
          for (const el of document.querySelectorAll(q)) {
            const ok = visible(el);
            if (ok) return ok;
          }
        }
      } catch { /* safe degrade */ }
      return null;
    }
    // What SHOULD be ringed right now: [{ key, el, txt }].
    function ringSpecs() {
      const out = [];
      try {
        if (!state || state.ref !== A.getRef()) return out;
        const push = (key, el, n) => {
          if (el && el.nodeType === 1) out.push({ key, el, txt: '+' + (n || 0) });
        };
        if (A.actions.like && rewards.likeReward > 0 && state.likeS !== 'done') {
          push('like', ringCall('likeHighlightTarget'), rewards.likeReward);
        }
        if (A.actions.comment && state.commentEnabled !== false
            && rewards.commentReward > 0 && state.commentS !== 'done') {
          push('comment', ringCall('commentHighlightTarget'), rewards.commentReward);
          // The BOX as well as the button (owner, 2026-08-18: highlight any button or input
          // box that pays). On several platforms the Post control only appears once there is
          // text in the composer, so ringing the button alone left nothing to aim at until
          // after you had already started typing. pointer-events:none, so the ring never
          // intercepts a click or a keystroke.
          push('commentbox', composerEl(), rewards.commentReward);
        }
        if (state.canRepost === true && rewards.repostReward > 0
            && state.repostS !== 'done' && !shareHidden) {
          push('repost', ringCall('repostHighlightTarget'), rewards.repostReward);
          // Second step: the options inside the open share sheet. Capped so a dialog full
          // of controls cannot carpet the screen in gold.
          let list = null;
          try {
            list = typeof A.repostDialogHighlightTargets === 'function'
              ? A.repostDialogHighlightTargets() : null;
          } catch { list = null; }
          if (list && list.length) {
            Array.prototype.slice.call(list, 0, 3)
              .forEach((el, i) => push('dlg' + i, el, rewards.repostReward));
          }
        }
      } catch { return []; }
      return out;
    }
    function buildRing(key) {
      const host = document.createElement('div');
      host.id = 'rgc-ring-' + key;
      host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;margin:0;padding:0;display:none';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        .ring{position:absolute;top:0;left:0;right:0;bottom:0;box-sizing:border-box;
          border:2px solid ${RING_GOLD};border-radius:12px;
          box-shadow:0 0 0 2px rgba(201,167,102,.28),0 0 14px rgba(201,167,102,.55);
          animation:rgcRingPulse 1.8s ease-in-out infinite}
        .badge{position:absolute;top:-11px;right:-11px;min-width:18px;height:20px;padding:0 6px;
          border-radius:999px;background:${RING_GOLD};color:#0E1B2C;
          font:700 12px/20px system-ui,-apple-system,sans-serif;text-align:center;
          box-shadow:0 3px 10px rgba(0,0,0,.45);white-space:nowrap}
        @keyframes rgcRingPulse{0%,100%{opacity:1}50%{opacity:.5}}
        @media (prefers-reduced-motion: reduce){.ring{animation:none}}`;
      const ring = document.createElement('div'); ring.className = 'ring';
      const badge = document.createElement('span'); badge.className = 'badge';
      ring.appendChild(badge); shadow.append(style, ring);
      (document.body || document.documentElement).appendChild(host);
      return { host, ring, badge, el: null, last: null };
    }
    function positionRing(r) {
      if (!r || !r.el) return;
      const rect = r.el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const offscreen = (rect.width === 0 && rect.height === 0)
        || rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw;
      if (offscreen) { if (r.host.style.display !== 'none') r.host.style.display = 'none'; return; }
      const pad = 6;
      const left = Math.round(rect.left - pad), top = Math.round(rect.top - pad);
      const w = Math.round(rect.width + pad * 2), h = Math.round(rect.height + pad * 2);
      const last = r.last;
      if (r.host.style.display === 'block' && last
          && last.left === left && last.top === top && last.w === w && last.h === h) return;
      r.host.style.display = 'block';
      r.host.style.left = left + 'px'; r.host.style.top = top + 'px';
      r.host.style.width = w + 'px'; r.host.style.height = h + 'px';
      r.last = { left, top, w, h };
    }
    function reconcileRings() {
      const specs = ringSpecs();
      const want = new Set(specs.map((x) => x.key));
      for (const key of Array.from(rings.keys())) {
        if (!want.has(key)) { try { rings.get(key).host.remove(); } catch { /* ignore */ } rings.delete(key); }
      }
      for (const spec of specs) {
        let r = rings.get(spec.key);
        if (!r) { r = buildRing(spec.key); rings.set(spec.key, r); }
        if (r.el !== spec.el) { r.el = spec.el; r.last = null; }
        if (r.badge.textContent !== spec.txt) r.badge.textContent = spec.txt;
        positionRing(r);
      }
      return rings.size > 0;
    }
    function ringsTick() {
      ringsRaf = 0;
      try {
        if (!rings.size) return;
        rings.forEach(positionRing);
        const now = Date.now();
        if (now - ringsLastResolve >= 500) {
          ringsLastResolve = now;
          if (!reconcileRings()) { teardownShareRing(); return; }
        }
      } catch { teardownShareRing(); return; }
      if (rings.size) ringsRaf = requestAnimationFrame(ringsTick);
    }
    let ringsScrollHooked = false;
    function onRingScroll() { try { rings.forEach(positionRing); } catch { /* safe degrade */ } }
    function teardownShareRing() {
      if (ringsRaf) { try { cancelAnimationFrame(ringsRaf); } catch { /* ignore */ } ringsRaf = 0; }
      rings.forEach((r) => { try { r.host.remove(); } catch { /* ignore */ } });
      rings.clear();
      if (ringsScrollHooked) {
        try { window.removeEventListener('scroll', onRingScroll, { capture: true }); } catch { /* ignore */ }
        try { window.removeEventListener('resize', onRingScroll); } catch { /* ignore */ }
        ringsScrollHooked = false;
      }
    }
    // Reactive entry point, unchanged name so every existing call site still works:
    // drawWidget (state changes) and the 5s poll (controls that render late). Idempotent.
    function ensureShareRing() {
      try {
        ringsLastResolve = Date.now();
        if (!reconcileRings()) { teardownShareRing(); return; }
        if (!ringsScrollHooked) {
          try { window.addEventListener('scroll', onRingScroll, { passive: true, capture: true }); } catch { /* ignore */ }
          try { window.addEventListener('resize', onRingScroll, { passive: true }); } catch { /* ignore */ }
          ringsScrollHooked = true;
        }
        if (!ringsRaf && rings.size) ringsRaf = requestAnimationFrame(ringsTick);
      } catch { teardownShareRing(); }
    }

    // Server action name -> widget state key and local-cache flag.
    const ACTION_KEY = { like: 'likeS', comment: 'commentS', repost: 'repostS', share_send: 'sendS' };
    const ACTION_FLAG = { like: 'like', comment: 'comment', repost: 'repost', share_send: 'send' };
    async function fireEngagement(action) {
      const ref = state && state.ref; if (!ref) return;
      const key = ACTION_KEY[action]; if (!key) return;
      if (state[key] !== 'idle') return; // already pending or done
      state[key] = 'pending'; drawWidget();
      const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: A.platform, action, ref }).catch(() => null);
      // Response contract (background.js s2Engagement): a FAILURE always carries `error`
      // and never `credited`; a success is the server's own JSON and always carries
      // `credited`. So an error means "we do not know" and must stay idle and retryable,
      // while credited:false means the server already has this one.
      const failed = !r || !!r.error;
      if (!failed && r.credited) { state[key] = 'done'; setDone(ref, { [ACTION_FLAG[action]]: true }); }
      // Already-earned (HTTP 200, credited:false) on a like or a repost → show done.
      // Repost needs this as much as like does: without it the repost self-heal in the
      // poll below would re-fire forever at a server that already recorded the credit.
      // Marking done on an ERROR instead would stick the action "done" in local storage
      // and it could never credit later, which is exactly what the old
      // `'credited' in r` test did once background.js started answering every failure
      // with { credited: false }.
      else if (!failed && (action === 'like' || action === 'repost')) { state[key] = 'done'; setDone(ref, { [ACTION_FLAG[action]]: true }); }
      else state[key] = 'idle';
      // The all-done bonus is computed and paid by the server on whichever credit
      // completed the set, and reported back here, so the row can tick in the same draw.
      if (r && r.bonus && r.bonus.credited) { state.bonusDone = true; setDone(ref, { bonus: true }); }
      // The watch gate is like-only (comments stopped earning 2026-08-08). If a claim
      // already bounced off the gate, the like that just landed is exactly what it was
      // waiting for: clear the error and retry now rather than sitting out the backoff.
      if (state[key] === 'done' && (action === 'like' || action === 'comment') && state.watchError === 'engagement_required') {
        state.watchError = null;
        claimWatch();
      }
      drawWidget();
    }

    // --- Repost / in-platform send: click, confirmation, flipped control --------------
    // Signal one, here: the member clicked the platform's own repost or send control,
    // which opens a 90 second window. Signal two: content/observe.js watches the PAGE's
    // own request for that action come back 2xx and posts the confirmation back. Signal
    // three, repost only: the platform's own control flipped to its undo state.
    //
    // Why the third signal exists. HTTP 2xx proves the request was ACCEPTED, nothing more.
    // X's GraphQL answers a REFUSED retweet (rate limited, tweet deleted, author
    // suspended) with HTTP 200 and an errors[] array in the body, and observe.js may not
    // read that body, it would consume the stream the page itself is about to read. So we
    // ask the page instead of the response: the repost control turns into the un-repost
    // control only when the platform really did it. Status = accepted, flipped control =
    // actually done. The DOM can flip a beat after the response lands, hence the short
    // retry window below; if it never flips, nothing is credited.
    //
    // None of the three credits alone: a menu opened and abandoned earns nothing, and a
    // forged message with no preceding click and no flipped control earns nothing either.
    const CONFIRM_WINDOW_MS = 90000;
    const FLIP_TRIES = 10, FLIP_INTERVAL_MS = 400; // ~4s of grace for the control to flip
    function whenFlipped(probe, onFlipped) {
      let tries = 0;
      (function tick() {
        let flipped = false;
        try { flipped = !!probe(); } catch { flipped = false; }
        if (flipped) { try { onFlipped(); } catch { /* never throw out of a timer */ } return; }
        if (++tries >= FLIP_TRIES) return; // never flipped: the platform refused it
        setTimeout(tick, FLIP_INTERVAL_MS);
      })();
    }
    let pendingRepostUntil = 0, pendingSendUntil = 0, intentHooked = false;
    // Hard cap on the Facebook reshare diagnostic below. The X reply diagnostic was also
    // "temporary" and has since written 614,279 rows, over half the database, on a disk at
    // 88%. A capped counter costs nothing and makes that impossible to repeat.
    let fbDiagSent = 0;
    const FB_DIAG_MAX = 6;
    function hookIntent() {
      if (intentHooked) return; intentHooked = true;
      if (typeof A.repostTarget !== 'function' && typeof A.sendTarget !== 'function') return;
      document.addEventListener('click', (e) => {
        try { if (typeof A.repostTarget === 'function' && A.repostTarget(e.target)) pendingRepostUntil = Date.now() + CONFIRM_WINDOW_MS; } catch { /* selector drift must never throw */ }
        try { if (typeof A.sendTarget === 'function' && A.sendTarget(e.target)) pendingSendUntil = Date.now() + CONFIRM_WINDOW_MS; } catch { /* same */ }
      }, true);
    }
    // What this surface has taken responsibility for, so another surface running the same
    // rule (X's timeline) can tell whether to stay out of the way. Short-lived on purpose.
    let lastTaken = null; // { kind, ref, at }
    const TAKEN_MEMORY_MS = 30000;
    // Deterministic hand-off, asked by that other surface. True means engage-core is
    // handling this confirmation, or is about to (whichever of the two window listeners
    // runs first), so the other surface must not send a second credit for the same post.
    // False means engage-core will never take it, which is exactly the /status/ case where
    // the targets fetch has not resolved or failed, and the other surface must credit it
    // or the repost is lost. So exactly one of the two paths credits a CONFIRMATION.
    // The 5s self-heal poll below sits outside that guarantee: it reads the flipped
    // control instead of a confirmation, so it can still re-send a repost the other
    // surface already credited (its state arrived after the hand-off was answered).
    // That duplicate is made harmless, not impossible: the server looks the credit up in
    // the ledger before writing, and a unique index on (season, user, ref) catches the
    // race, so the second request pays no second ticket. It answers credited:true with
    // awarded:false, which this client already reads as "done, nothing new".
    function ownsConfirmation(kind, ref) {
      try {
        if (!ref) return false;
        if (lastTaken && lastTaken.kind === kind && lastTaken.ref === ref
            && Date.now() - lastTaken.at < TAKEN_MEMORY_MS) return true;
        if (!state || state.ref !== ref) return false;
        // Repost: only claim a confirmation this card can actually act on. A live click
        // intent is one route; the 5s self-heal is the other, but the heal now requires the
        // adapter to resolve THIS post's own card, and where it cannot (isRepostedFocal
        // returns null) it declines forever. Claiming on repostCapable() alone would drop
        // the repost twice over: this surface never credits it, and the timeline surface
        // stood down because we said we had it.
        if (kind === 'repost') {
          if (!repostCapable()) return false;
          if (Date.now() < pendingRepostUntil) return true;
          return typeof A.isRepostedFocal !== 'function' || A.isRepostedFocal() !== null;
        }
        // Send leaves no state behind to self-heal from, so ownership needs a live intent.
        if (kind === 'send') return sendCapable() && Date.now() < pendingSendUntil;
        return false;
      } catch { return false; }
    }
    try { self.RGCEngage = { ownsConfirmation }; } catch { /* the hand-off is optional */ }
    // The confirmation half. Validated strictly: same window, same origin, our marker,
    // our platform, and the platform's own request must have been ACCEPTED. Whole body
    // inside try/catch because this runs for every message the page posts to itself.
    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window || e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.rgcObs !== 1 || d.ok !== true || d.platform !== A.platform) return;
        if (!state || !state.ref) return; // no active target on this page
        // DIAGNOSTIC ONLY, never a credit. A share-shaped Facebook mutation that is not the
        // one we credit, seen while this member is standing on a target post whose repost is
        // still unearned. That is the exact moment the reported bug happens, so it is the
        // only moment worth recording. Names only, capped per page, and it returns before
        // every crediting branch below.
        if (d.kind === 'fbdiag') {
          try {
            if (fbDiagSent < FB_DIAG_MAX && repostCapable() && state.repostS === 'idle') {
              fbDiagSent++;
              chrome.runtime.sendMessage({
                type: 's2Debug',
                kind: 'fbrepost',
                data: {
                  name: (d.meta && d.meta.name) || '',
                  ref: state.ref,
                  armed: Date.now() < pendingRepostUntil, // did they click inside the share sheet
                },
              });
            }
          } catch (e) { /* diagnostics are optional, crediting is not */ }
          return;
        }
        // Attribute the confirmation to a post. Normally observe.js read the post id out of
        // the request and it must equal this card's target, or the message is DROPPED (an
        // unattributable confirmation must never be guessed onto whatever this surface has
        // bound). Some mutations carry only an id we cannot map to our shortcode target
        // (Instagram's numeric media_id), so they arrive ref-less; for an adapter with no
        // isReposted flip to lean on (Instagram, owner decision) a ref-less confirmation is
        // attributed to the post on screen through the armed click intent alone, which is
        // page-scoped and expires in 90s. Adapters that DO parse a ref (X, TikTok) are
        // unchanged: a present ref must match, and a ref-less confirmation there is still
        // dropped.
        // Network-confirmed COMMENT (YouTube): create_comment fired while this page's
        // target is bound. Language and markup independent, which the composer DOM path
        // is not (localized layouts kept missing it). The typed text rides along, so the
        // same quality gate applies: too short or a banned word means no credit, exactly
        // as if the member had typed it into a detected composer. Ref-less by nature, so
        // it is page-scoped like Instagram's repost confirmation.
        // Network-confirmed LIKE (TikTok two-signal): pays only when the click intent is
        // still armed for THIS post and the mutation's aweme_id agrees.
        if (d.kind === 'like') {
          const now2 = Date.now();
          const okRef = !d.ref || String(d.ref) === state.ref;
          if (A.likeConfirmNetwork && okRef && pendingLikeRef === state.ref
              && now2 < pendingLikeUntil && state.likeS === 'idle') {
            pendingLikeUntil = 0;
            fireEngagement('like');
          } else if (A.likeNetworkPageScoped && okRef && state.likeS === 'idle') {
            // Reported 2026-08-13: credited on opening a post, without liking it. This
            // branch pays on the mutation alone, so record what the mutation looked like
            // at the moment it paid. Shapes only, no content: enough to tell a real react
            // from whatever Facebook fires on open, which is what the fix needs.
            try {
              chrome.runtime.sendMessage({
                type: 's2Debug',
                kind: 'fblike',
                data: Object.assign({ ev: 'paid', ref: state.ref }, d.meta || {}),
              });
            } catch (e) { /* diagnostics are optional, crediting is not */ }
            // Page-scoped (Facebook): no click intent required, because the DOM anchors are
            // exactly what keeps failing on localized / reel-rail surfaces. The mutation is
            // ref-less, so this only ever runs while THIS post's target is bound, and the
            // server stays idempotent per (user, post, action) regardless.
            fireEngagement('like');
          }
          return;
        }
        if (d.kind === 'comment') {
          if (A.actions.comment && state.commentEnabled !== false && state.commentS === 'idle'
              && typeof d.txt === 'string' && passesGate(d.txt.trim())) {
            fireEngagement('comment');
          }
          return;
        }
        let ref = d.ref == null ? '' : String(d.ref);
        if (!ref && typeof A.isReposted !== 'function') ref = state.ref;
        if (!ref || ref !== state.ref) return;
        const now = Date.now();
        // Page-scoped repost (Instagram): credit on the confirmed mutation ALONE, with no
        // click intent required. Reported 2026-08-11 by a viewer on a FRENCH Instagram:
        // repost never credited because repostTarget() matches svg[aria-label="Repost"],
        // and the label is localized ("Republier" etc), so the intent never armed and the
        // mutation that did arrive was discarded. Same failure the Facebook like had.
        //
        // Safe because the widget only binds on a single-post permalink: getRef() parses
        // /p/<shortcode>/ out of the path, so on a feed or profile there is no ref and no
        // widget. One post on the page means a repost mutation firing here belongs to it.
        // isLiked-style DOM checks are not available for repost, which is why this leans
        // on the network signal rather than adding another localized selector.
        if (d.kind === 'repost' && repostCapable() && A.repostNetworkPageScoped
            && state.repostS === 'idle' && now >= pendingRepostUntil) {
          lastTaken = { kind: 'repost', ref, at: now };
          fireEngagement('repost');
        } else if (d.kind === 'repost' && repostCapable() && now < pendingRepostUntil) {
          pendingRepostUntil = 0;
          lastTaken = { kind: 'repost', ref, at: now };
          // Signal three, repost only and only where the adapter exposes isReposted (X,
          // TikTok): credit once the platform's own control has actually flipped to its undo
          // state. Adapters without it (Instagram) have no flip to wait on, so the click
          // intent plus this confirmed mutation are the two signals and the credit fires here.
          if (typeof A.isReposted === 'function') {
            whenFlipped(() => !!state && state.ref === ref && adapterReposted(), () => fireEngagement('repost'));
          } else {
            fireEngagement('repost');
          }
        } else if (d.kind === 'send' && sendCapable() && now < pendingSendUntil) {
          pendingSendUntil = 0;
          lastTaken = { kind: 'send', ref, at: now };
          // A send leaves no state on the post to read back, so it stays at two signals.
          fireEngagement('share_send');
        }
      } catch { /* a malformed page message must never break earning */ }
    });

    // GESTURE-TRUST: credit the comment when the user SUBMITS one with 6+ characters typed.
    // We no longer wait to confirm the box cleared (that re-derivation of platform state was
    // the brittle part that broke across UIs). We still read the typed text — but only to
    // enforce the "more than 5 characters" quality gate.
    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      // Quality gate: YouTube (or any target) may require a minimum word count; else >5 chars.
      // A target can also ban words outright (YouTube comments must never mention tickets).
      // Matched whole-word and case-insensitively, with an optional trailing "s", so
      // "ticket" / "Tickets" are blocked while a longer word like "ticketing" is not.
      function bannedHit(text) {
        const banned = (state && state.commentBannedWords) || [];
        if (!banned.length) return null;
        const lower = text.toLowerCase();
        return banned.find((w) => new RegExp(`\\b${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(lower)) || null;
      }
      function passesGate(text) {
        if (bannedHit(text)) return false;
        const minWords = (state && state.commentMinWords) || 0;
        if (minWords > 0) return text.split(/\s+/).filter(Boolean).length > minWords;
        return text.length > 5;
      }
      function trySubmit() {
        if (!state || state.commentS !== 'idle') return;
        if (state.commentEnabled === false) return; // switched off server-side
        if (!passesGate((A.commentText() || '').trim())) return;
        fireEngagement('comment');
      }
      // Robust fallback: some reply/submit controls (esp. X's) aren't caught by the exact
      // selectors below. So after any plausible submit gesture we CONFIRM the post by watching
      // the composer clear — a successful submit empties it regardless of how it was triggered.
      // Guarded: only arms when a gate-passing reply is already typed; gives up after ~4s.
      let confirmIv = null;
      function watchForPostedComment() {
        if (confirmIv || !state || state.commentS !== 'idle') return;
        if (!passesGate((A.commentText() || '').trim())) return; // only a real, qualifying reply
        let ticks = 0;
        confirmIv = setInterval(() => {
          ticks++;
          if (!state || state.commentS !== 'idle') { clearInterval(confirmIv); confirmIv = null; return; }
          const now = (A.commentText() || '').trim();
          if (now.length === 0) { clearInterval(confirmIv); confirmIv = null; fireEngagement('comment'); } // posted
          else if (ticks > 16) { clearInterval(confirmIv); confirmIv = null; } // ~4s: not a submit
        }, 250);
      }
      // Click path: the post/submit button was pressed.
      document.addEventListener('click', (e) => {
        // A like (or other action-bar) click must never be mistaken for a comment submit —
        // on TikTok the like control shares the action bar with the comment box, so without
        // this guard clicking Like would auto-credit the comment too.
        if (A.likeTarget && A.likeTarget(e.target)) return;
        if (A.commentSubmitTarget(e.target)) { trySubmit(); return; } // fast path (known button)
        watchForPostedComment(); // fallback: this click may be an unrecognized submit control
      }, true);
      // Keyboard path: Enter in the comment input box. Only for platforms that actually
      // submit on Enter (TikTok, Instagram). YouTube inserts a newline on Enter and posts
      // only via the Comment button (submitOnEnter:false) — so crediting on Enter there
      // would falsely mark a comment the moment the user starts a second line.
      if (A.submitOnEnter !== false) {
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (!A.commentInputTarget || !A.commentInputTarget(e.target)) return;
          trySubmit();
        }, true);
      }
      // Ctrl/Cmd+Enter submit — X posts replies (including thread replies) this way, and
      // plain Enter there is just a newline. Opt-in per adapter so it never misfires elsewhere.
      if (A.submitOnCtrlEnter) {
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
          if (A.commentInputTarget && !A.commentInputTarget(e.target)) return;
          trySubmit();
        }, true);
      }
      // Fallback for ALL keyboard submit styles (plain Enter, ⌘/Ctrl+Enter): arm the
      // composer-clear confirmation. Safe on plain Enter where it's a newline — the box won't
      // clear, so nothing credits.
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter') watchForPostedComment(); }, true);
    }

    // GESTURE-TRUST: credit the like the instant the user clicks the like control from a
    // not-liked state. We no longer sample the heart's color afterward (brittle across UIs
    // and platform reverts) — the click IS the signal. The pre-click isLiked() read only
    // guards against crediting an un-like; if it can't tell, we still credit the intent.
    let pendingLikeUntil = 0, pendingLikeRef = '';
    function hookLike() {
      if (likeHooked || !A.actions.like || !A.likeTarget) return; likeHooked = true;
      document.addEventListener('click', (e) => {
        if (!A.likeTarget(e.target)) return;
        if (!state || state.likeS !== 'idle') return;
        // Captured during the capture phase, BEFORE the page toggles the like, so this is
        // the pre-click state. Skip only when we're clearly already liked (an un-like).
        if (A.isLiked()) return;
        if (A.likeConfirmNetwork) {
          // Two-signal like (TikTok): the click only ARMS. Credit waits for the page's own
          // like mutation via observe.js; a signed-out click never produces one, so the
          // 90 second window just expires and nothing pays.
          pendingLikeUntil = Date.now() + 90 * 1000;
          pendingLikeRef = state.ref;
          return;
        }
        fireEngagement('like');
      }, true);
    }

    // An adapter can refuse to earn. Returns a reason string to block, or null to allow.
    // Used by Facebook to require a signed-in session before any ticket is collected.
    function earnBlocked() {
      if (typeof A.earnBlocked !== 'function') return null;
      try { return A.earnBlocked() || null; } catch { return null; }
    }

    async function startWatch() {
      if (!A.actions.watch) return;
      // Never open a watch session while the adapter says earning is blocked. Watch is
      // the one thing a signed-out viewer could otherwise still collect: likes and
      // comments already fail on their own, because their second signal is the site's
      // own network mutation and that never fires without a session.
      if (earnBlocked()) return;
      // Guard against overlapping attempts so the load watchdog can't spawn duplicate
      // sessions while a prior attempt is still in its metadata wait.
      if (!state || state.watchStarting || state.sessionId || state.watchDone) return;
      state.watchStarting = true;
      // Wait up to ~10s for video metadata so the backend gets the real duration and
      // returns accurate requirements. Sending duration=0 causes the backend to use
      // a 120s floor, but then raises requirements at claim time once other users
      // report the real length — leading to not_qualified claims.
      let dur = 0;
      for (let i = 0; i < 5 && dur === 0; i++) {
        const v = A.getVideoEl();
        dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
        if (dur === 0) await new Promise(r => setTimeout(r, 2000));
        if (!state || state.ref !== A.getRef()) { if (state) state.watchStarting = false; return; } // navigated away while waiting
      }
      const s = await chrome.runtime.sendMessage({ type: 's2WatchSession', platform: A.platform, videoRef: state.ref, playerDuration: dur }).catch(() => null);
      if (!state || state.ref !== A.getRef()) return;
      state.watchStarting = false;
      if (!s || s.error || !s.sessionId) return; // backend not ready / not the active target / not connected — watchdog will retry
      state.sessionId = s.sessionId; state.hbInterval = s.heartbeatIntervalSec || 20;
      state.target = effectiveTarget(s.requiredWatchSeconds, s.requiredHeartbeats, state.hbInterval);
      // Resume the timer where earlier sittings left off — watch time now accumulates across
      // refreshes on the server, so the card should reflect the banked progress, not restart at 0.
      if (s.priorSeconds) state.watched = Math.max(state.watched || 0, s.priorSeconds);
      drawWidget();
    }
    // Why a claim was refused, in plain language. Without this the card just sits at
    // "Watch 1:00 / 0:52" forever retrying — the timer is local, so a user whose heartbeats
    // never reach the server sees a full bar and no explanation.
    function watchErrText(reason) {
      if (reason === 'engagement_required') return 'Like this post to collect its watch tickets.';
      if (reason === 'not_qualified') return 'No watch time counted yet. Keep this tab visible with the video playing and unmuted.';
      if (reason === 'no_reward') return 'This video is too old to earn tickets.';
      if (reason === 'no_target') return 'This video is not collectable right now.';
      return 'Could not collect. Check your connection, then reload the page.';
    }
    async function claimWatch() {
      if (!state || state.watchDone || state.claiming) return;
      // Back off after a failure instead of hammering the claim every 5s.
      if (state.watchError && Date.now() - (state.lastClaimTry || 0) < 15000) return;
      state.lastClaimTry = Date.now();
      state.claiming = true; drawWidget();
      const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', platform: A.platform, videoRef: state.ref }).catch(() => null);
      state.claiming = false;
      // Credit on a successful claim OR if it was already claimed earlier (don't blink forever).
      if (r && (r.ok || r.reason === 'already_claimed')) {
        state.watchDone = true;
        state.watchError = null;
        state.awarded = r.ok ? (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)) : null;
        setDone(state.ref, { watch: true, awarded: state.awarded });
        // Seamlessly roll into the second-watch timer if this target offers replays.
        if (replayAvailable() && (state.replayUsed || 0) < (state.replayMax || 0)) maybeStartReplay();
        else if (replayAvailable()) state.replayAllDone = true;
        // The watch paths pay the all-done bonus too (a double watch can be the action
        // that completes a set), so tick the row when the claim reports one.
        if (r.bonus && r.bonus.credited) { state.bonusDone = true; setDone(state.ref, { bonus: true }); }
      } else {
        // not_qualified / no_reward / no_target / network — tell the user instead of stalling.
        state.watchError = (r && r.reason) || 'network';
      }
      drawWidget();
    }

    // Open a fresh watch session for a "watch again" pass. The base watch's target is saved
    // as baseTarget (for the continuation display) before state.target is reset to the new
    // session's requirement. Idempotent-ish: guarded so the 5s loop can safely re-attempt.
    async function maybeStartReplay() {
      if (earnBlocked()) return;   // same gate as the first watch
      if (!state || !state.watchDone || !replayAvailable()) return;
      if (state.replaying || state.replayStarting || state.replayAllDone) return;
      if ((state.replayUsed || 0) >= (state.replayMax || 0)) { state.replayAllDone = true; return; }
      state.replayStarting = true;
      if (!state.baseTarget) state.baseTarget = state.target || 0;
      const v = A.getVideoEl();
      const dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
      const s = await chrome.runtime.sendMessage({ type: 's2WatchSession', platform: A.platform, videoRef: state.ref, playerDuration: dur }).catch(() => null);
      if (!state || state.ref !== A.getRef()) return;
      state.replayStarting = false;
      if (!s || s.error || !s.sessionId) return; // backend not ready — the loop will retry
      state.sessionId = s.sessionId; state.hbInterval = s.heartbeatIntervalSec || state.hbInterval || 20;
      state.watched = 0;
      state.target = effectiveTarget(s.requiredWatchSeconds, s.requiredHeartbeats, state.hbInterval);
      if (!state.baseTarget) state.baseTarget = state.target;
      state.replaying = true;
      drawWidget();
    }
    async function claimReplayWatch() {
      if (!state || !state.replaying || state.claiming) return;
      state.claiming = true; drawWidget();
      const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', platform: A.platform, videoRef: state.ref, mode: 'replay' }).catch(() => null);
      state.claiming = false;
      if (r && (r.ok || r.reason === 'replay_exhausted')) {
        state.replaying = false;
        state.sessionId = null;
        state.replayUsed = r.ok ? (r.used != null ? r.used : (state.replayUsed || 0) + 1) : (state.replayMax || 0);
        if ((state.replayUsed || 0) >= (state.replayMax || 0)) state.replayAllDone = true;
        else maybeStartReplay(); // more slots left — roll straight into the next pass
        // The double watch is part of the all-done set on TikTok, Instagram and Shorts.
        if (r.bonus && r.bonus.credited) { state.bonusDone = true; setDone(state.ref, { bonus: true }); }
      }
      // not_qualified / transient: keep accruing; the 5s loop retries the claim.
      drawWidget();
    }

    // --- Selector health telemetry (fail-soft, one sample per page load) ---
    // ~15s after an active target's card is set up, record which adapter capabilities
    // could NOT resolve on this page, so the day a platform changes its DOM it shows
    // up in OUR telemetry instead of user reports. Samples land in storage under
    // selHealth; the background worker ships them on its poll cadence. Every step is
    // wrapped: a telemetry bug must never break earning.
    let healthSampled = false;
    function scheduleHealthSample() {
      if (healthSampled) return;
      healthSampled = true;
      setTimeout(() => { sampleSelectorHealth().catch(() => { /* fail-soft */ }); }, 15000);
    }
    async function sampleSelectorHealth() {
      try {
        if (!state || !state.ref) return; // target went away while we waited
        const ref = state.ref;
        const failures = [];
        // watch: the page should have a findable <video> when the watch action applies.
        // Instagram and Facebook are exempt: photo and text posts legitimately have no
        // video (the watch row simply never appears there), so a missing video is normal,
        // not selector drift, and would otherwise flood the table with permanent noise.
        if (A.actions.watch && A.platform !== 'instagram' && A.platform !== 'facebook') {
          let v = null; try { v = A.getVideoEl(); } catch { v = null; }
          if (!v) failures.push('video');
        }
        // composer: does the adapter's composer selector find any element? Only
        // adapters exposing composerPresent() can answer (commentText() cannot tell
        // "no composer on the page" apart from "composer present but empty").
        // Note: a lazily rendered comments section (unopened shorts panel, unscrolled
        // watch page) reports as a miss too; the backend reads rates, not single hits.
        if (A.actions.comment && state.commentEnabled !== false && typeof A.composerPresent === 'function') {
          let ok = false; try { ok = !!A.composerPresent(); } catch { ok = false; }
          if (!ok) failures.push('composer');
        }
        // like: is there a like control to observe? Same optional-probe contract;
        // isLiked() alone cannot tell "not liked" apart from "control not found".
        if (A.actions.like && typeof A.likePresent === 'function') {
          let ok = false; try { ok = !!A.likePresent(); } catch { ok = false; }
          if (!ok) failures.push('like');
        }
        // repost / in-platform send: same optional-probe contract. Sampled only when the
        // server says this platform offers the action AND the adapter can answer, so a
        // platform whose controls are not mapped yet reports nothing instead of flooding
        // the table with a permanent miss.
        if (state.canRepost && typeof A.repostPresent === 'function') {
          let ok = false; try { ok = !!A.repostPresent(); } catch { ok = false; }
          if (!ok) failures.push('repost');
        }
        if (state.canSend && typeof A.sendPresent === 'function') {
          let ok = false; try { ok = !!A.sendPresent(); } catch { ok = false; }
          if (!ok) failures.push('share');
        }
        if (!failures.length) return;
        const cur = (await chrome.storage.local.get('selHealth')).selHealth;
        const arr = Array.isArray(cur) ? cur : [];
        for (const kind of failures) arr.push({ platform: A.platform, kind, ref });
        while (arr.length > 50) arr.shift(); // cap at 50, drop oldest
        await chrome.storage.local.set({ selHealth: arr });
      } catch { /* fail-soft: telemetry must never break earning */ }
    }

    async function start(ref) {
      if (!ref) return clearWidget();
      if (state && state.ref === ref) return; // same video — don't reset progress on minor URL tweaks
      const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
      // X has its own like/comment reward (falls back to global when the server omits it).
      // Show the per-platform amount so an X post reads "+3 / +2", not "Required".
      const isX = A.platform === 'x';
      const likeR = isX && data && data.xLikeReward != null ? data.xLikeReward : (data && data.likeReward);
      const commentR = isX && data && data.xCommentReward != null ? data.xCommentReward : (data && data.commentReward);
      rewards = {
        likeReward: likeR || 0,
        commentReward: commentR || 0,
        watchVideoReward: (data && data.watchVideoReward) || 0,
        watchEarlyBonus: (data && data.watchEarlyBonus) || 0,
        watchFloor: (data && data.watchVideoFloor) || 5,
        watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
        // One global amount each, no per-platform override. All three are 0 until the
        // tariff flip, and every row that reads 0 stays off the card.
        repostReward: (data && data.repostReward) || 0,
        shareSendReward: (data && data.shareSendReward) || 0,
        engageBonusReward: (data && data.engageBonusReward) || 0,
      };
        // ONLY a `listed` target may bind to the page. Binding is what makes crediting
        // passive: once bound, a normal like or watch on this page earns without the member
        // ever knowing the post was eligible. For an unlisted target that passivity is
        // exactly wrong: the server has not offered it, so a member who lands on it
        // organically must NOT be credited for it. With this gate, the only way to earn on
        // an unlisted ref is to fabricate the claim outside this extension. A payload with
        // no `listed` field counts as unlisted, same as background.js (owner, 2026-08-16).
      const target = data && (data.targets || []).find((t) => t.platform === A.platform && t.ref === ref && t.listed === true);
      if (!target) return clearWidget();
      // Merge server done flags (bearer-scoped, authoritative) with local cache.
      const local = await getDone(ref);
      const srv = target.done || {};
      // Like: trust the server's per-user flag as authoritative. ORing the local cache
      // would let a stale local "done" (written by the old transient-error bug) keep
      // suppressing the like even after the server says it was never earned.
      // All three flags are server-authoritative (bearer-scoped). ORing the local cache
      // would let a stale local "done" keep suppressing an action the server says is NOT
      // earned — which also breaks target RE-RUNS: when a video is re-opened, the server
      // reports the new epoch's like/comment/watch as not-done, and the card must reset so
      // the member can earn again. Local cache is only used to heal toward the server value.
      const likeDone = !!srv.like;
      const commentDone = !!srv.comment;
      const watchDone = !!srv.watch;
      const repostDone = !!srv.repost;
      const sendDone = !!srv.shareSend;
      if (!srv.like && local.like) setDone(ref, { like: false }); // heal a stale cached "done"
      if (srv.like && !local.like) setDone(ref, { like: true });
      if (!srv.comment && local.comment) setDone(ref, { comment: false });
      if (srv.comment && !local.comment) setDone(ref, { comment: true });
      if (!srv.watch && local.watch) setDone(ref, { watch: false });
      if (srv.watch && !local.watch) setDone(ref, { watch: true });
      if (!srv.repost && local.repost) setDone(ref, { repost: false });
      if (srv.repost && !local.repost) setDone(ref, { repost: true });
      if (!srv.shareSend && local.send) setDone(ref, { send: false });
      if (srv.shareSend && !local.send) setDone(ref, { send: true });
      if (!srv.bonus && local.bonus) setDone(ref, { bonus: false });
      if (srv.bonus && !local.bonus) setDone(ref, { bonus: true });
      // Which rows this platform may show at all, straight from the server's capability
      // matrix. Absent (an older server) means no repost and no send, which is the safe
      // direction: nothing is advertised and nothing is sent that would be refused.
      const acts = target.actions || {};
      // "Watch again" replay config for this target (server-gated: present only for eligible
      // TikTok / YouTube Shorts). Absent → the second-watch timer never shows.
      const rep = srv.replay || null;
      const replayUsed = rep ? (rep.used || 0) : 0;
      const replayMax = rep ? (rep.max || 0) : 0;
      // A click intent belongs to the post that was on screen when it happened. Moving to
      // a different post retires it, so a confirmation that arrives late (or without a
      // readable post id) can never land on the post the member has since navigated to.
      pendingRepostUntil = 0; pendingSendUntil = 0;
      state = { ref, watched: 0, target: 0, sessionId: null,
        watchDone, awarded: local.awarded != null ? local.awarded : null,
        watchPlaying: false, watchMuted: false, claiming: false,
        likeS: likeDone ? 'done' : 'idle', commentS: commentDone ? 'done' : 'idle',
        repostS: repostDone ? 'done' : 'idle', sendS: sendDone ? 'done' : 'idle',
        repostHealAt: 0, // next moment the repost self-heal may re-fire (see the 5s poll)
        bonusDone: !!srv.bonus,
        canRepost: acts.repost === true, canSend: acts.shareSend === true,
        commentMinWords: (typeof target.commentMinWords === 'number' ? target.commentMinWords : 0),
        commentEnabled: target.commentEnabled !== false,
        commentBannedWords: Array.isArray(target.commentBannedWords) ? target.commentBannedWords : [],
        replayEligible: !!(rep && rep.eligible), replayMax, replayUsed,
        replayReward: rep ? (rep.reward || 1) : 1,
        // Server's exact payout for THIS video, including anything the client cannot
        // compute (the early-watch bonus). Drives the watch row's headline number.
        targetReward: Number(target.reward) || 0,
        replaying: false, replayStarting: false, replayAllDone: replayMax > 0 && replayUsed >= replayMax,
        baseTarget: 0 };
      lastHb = 0; hookComment(); hookLike(); hookIntent(); drawWidget();
      scheduleHealthSample(); // target is ACTIVE here; take the one health sample soon
      if (!state.watchDone) startWatch();
    }

    // Every 5s: detect a like, accrue focused-playing watch time, heartbeat, claim when ready.
    setInterval(() => {
      // Safety net for the on-page share ring: catches a control that renders after the
      // last drawWidget (e.g. a comments panel opened) and drops a stale ring when state
      // has gone. Cheap: one throttled selector resolve. Wrapped so it can never break the
      // watch loop below.
      try { ensureShareRing(); } catch { /* safe degrade: no ring */ }
      if (!state || state.ref !== A.getRef()) return;
      if (A.actions.like && state.likeS === 'idle' && A.isLiked()) fireEngagement('like');
      // Self-heal a repost the platform shows as done but the server never recorded: the
      // credit request failed (network blip, token refresh, a 500), or the member reposted
      // before this card finished setting up. Same idea as the like poll above, and the
      // reason a failed repost is no longer unrecoverable. Cooldown so a credit that keeps
      // failing is retried on the minute instead of every tick.
      // The DOM read here is the STRICT one where the adapter offers it: with no click
      // intent and no confirmed ref behind it, self-heal must not credit off a control it
      // cannot attribute to this post (isRepostedFocal returns null for "cannot judge",
      // which is not true and so heals nothing). The confirmation path above keeps the
      // wider adapterReposted(); tightening it there would drop legitimate credits.
      if (repostCapable() && state.repostS === 'idle' && Date.now() >= (state.repostHealAt || 0)
          && focalReposted()) {
        state.repostHealAt = Date.now() + 60000;
        fireEngagement('repost');
      }
      if (!A.actions.watch) return;
      // Seamless second watch: once the base watch is done and slots remain, keep a replay
      // session alive (self-heals if the session start ever failed) until one is running.
      if (state.watchDone && !state.replaying && !state.replayAllDone && replayAvailable()
          && (state.replayUsed || 0) < (state.replayMax || 0) && !state.replayStarting) {
        maybeStartReplay();
      }
      if (!state.sessionId) return;
      // Pause accrual between the base watch finishing and a replay session being active
      // (and forever once all replays are used up).
      if (state.watchDone && !state.replaying) return;
      const v = A.getVideoEl();
      const live = v && !v.paused && !v.ended && v.currentTime > 0;
      const audible = !!(v && !v.muted && v.volume > 0); // must be watching with sound, not idling muted
      const visible = document.visibilityState === 'visible'; // tab must be visible, but window focus doesn't matter
      const wasPlaying = state.watchPlaying;
      state.watchPlaying = !!(live && audible && visible);
      state.watchMuted = !!(live && visible && !audible);
      if (state.watchPlaying) {
        state.watched = (state.watched || 0) + 5;
        const now = Date.now();
        if (now - lastHb >= (state.hbInterval || 20) * 1000) { lastHb = now; chrome.runtime.sendMessage({ type: 's2WatchHeartbeat', platform: A.platform, sessionId: state.sessionId }).catch(() => {}); }
        drawWidget();
      } else if (wasPlaying) {
        drawWidget(); // playing -> paused: redraw once
      }
      // Claim once watched enough. The server gate is LIKE-ONLY (comments stopped earning
      // everywhere on 2026-08-08): a claim before the like bounces with engagement_required,
      // shows "Like this post to collect", and the like's success handler retries it.
      if ((state.watched || 0) >= (state.target || 120)) {
        if (state.replaying) claimReplayWatch();
        else claimWatch();
      }
    }, 5000);

    // SPA URL changes → re-evaluate eligibility for the new post.
    // Plus a cold-load WATCHDOG: on a direct/fresh load, start() (or the session start)
    // can bail before the video, the targets list, or the service worker are ready, and
    // with no URL change it would never retry — the user had to refresh. So while we're on
    // a fresh ref but haven't established a watch session yet, re-attempt a few times with
    // backoff, then stop (so we don't hammer on a page that simply isn't a target).
    let lastUrl = location.href;
    let wdRef = null, wdTries = 0, wdNextAt = 0;
    setInterval(() => {
      const ref = A.getRef();
      const now = Date.now();
      if (location.href !== lastUrl) {
        lastUrl = location.href; wdRef = ref; wdTries = 0; wdNextAt = 0;
        start(ref);
        return;
      }
      if (!ref) return;
      if (ref !== wdRef) { wdRef = ref; wdTries = 0; wdNextAt = 0; } // a fresh ref to settle
      // Established = we have state for this ref and (no watch, or a session/terminal state).
      const established = state && state.ref === ref &&
        (!A.actions.watch || state.sessionId || state.watchDone);
      if (established || wdTries >= 6 || now < wdNextAt) return;
      wdTries++; wdNextAt = now + 2000 * wdTries; // 2s, 4s, 6s … backoff
      if (!state || state.ref !== ref) start(ref);          // setup never took — redo it
      else if (A.actions.watch && !state.sessionId) startWatch(); // session never started — retry it
    }, 1000);
    start(A.getRef());
  }

  return { init, effectiveTarget };
})();
