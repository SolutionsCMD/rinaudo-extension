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
self.EngageCore = (function () {
  const ROW_CSS = `
    .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
    .row:first-child{margin-top:0}
    .lbl{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .amt{color:#A9A697;font-variant-numeric:tabular-nums;flex:none;margin-left:8px}
    .done{color:#86D6A4}
    .row.pending .lbl,.row.pending .amt{color:#8A8678}
    .row.paused .lbl{color:#8A8678}
    .row.blocked .lbl{color:#E8B339}
    .row.blocked .amt{color:#E8B339}
    .amt.req{color:#E8B339}
    .hint{font-size:11px;color:#6B6960;margin:2px 0 6px;line-height:1.3}`;

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const watchEstimate = (sec, r) => Math.max(r.watchFloor || 5, Math.floor((sec || 0) / 60) * (r.watchPerMinute || 1));
  // Credit needs `reqHb` well-spaced heartbeats (first ~a tick in, then every hbInterval),
  // which for short videos takes longer than requiredWatchSeconds. Target that
  // heartbeat-limited time (+~2 ticks of slack) so the bar doesn't read "done" before the
  // claim can land. For long videos requiredWatchSeconds dominates, so it's unchanged.
  const effectiveTarget = (reqSec, reqHb, hbInterval) => Math.max(reqSec || 120, 10 + ((reqHb || 2) - 1) * (hbInterval || 20));

  function init(A) {
    let frame = null, state = null, commentHooked = false, likeHooked = false, lastHb = 0;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1 };

    // Locally remember what's already credited per (platform, post) so the ✓ state
    // survives a refresh (the server is idempotent; this is purely the display).
    const doneKey = (ref) => `rgcDone:${A.platform}:${ref}`;
    async function getDone(ref) { try { const k = doneKey(ref); return (await chrome.storage.local.get(k))[k] || {}; } catch { return {}; } }
    async function setDone(ref, patch) { try { const k = doneKey(ref); const cur = (await chrome.storage.local.get(k))[k] || {}; await chrome.storage.local.set({ [k]: { ...cur, ...patch } }); } catch { /* ignore */ } }

    function ensureFrame() {
      if (frame) return;
      frame = self.RGCFrame.mount({ key: A.platform, title: '🎟 Earn Tickets', width: 240, pos: { bottom: 16, right: 16 }, css: ROW_CSS });
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
    // The video's full-watch reward (based on its length), shown as the headline so a
    // long video reads "+33" not "+5" (the floor). The amount actually credited comes
    // from the claim and scales with how much was watched.
    function watchPotential() {
      const v = A.getVideoEl();
      const durMin = (v && isFinite(v.duration) && v.duration > 0) ? Math.floor(v.duration / 60) : 0;
      return Math.max(rewards.watchFloor || 5, durMin * (rewards.watchPerMinute || 1));
    }
    function watchRow() {
      if (state.watchDone) return rowEl('Watched', `+${state.awarded != null ? state.awarded : watchPotential()}`, 'done');
      // Watched enough, but the watch reward is gated behind like + comment on this post.
      if (state.watchBlocked) {
        const r = rowEl('✓ Watched — like & comment to collect', `+${watchPotential()}`, 'idle');
        r.classList.add('blocked');
        return r;
      }
      if (state.claiming) return rowEl(`Watch ${fmt(state.watched)} / ${fmt(state.target)}`, '', 'pending');
      const playing = state.watchPlaying;
      const suffix = playing ? '' : (state.watchMuted ? ' · unmute to earn' : ' · paused');
      const icon = playing ? '▶' : (state.watchMuted ? '🔇' : '⏸');
      const label = `${icon} Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}${suffix}`;
      const r = rowEl(label, `+${watchPotential()}`, 'idle');
      if (!playing) r.classList.add('paused');
      return r;
    }
    function hint(text) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = text; return h; }
    function drawWidget() {
      if (!state) return;
      ensureFrame();
      const body = frame.body; body.replaceChildren();
      if (A.actions.watch && (state.sessionId || state.watchDone)) {
        body.append(watchRow());
        if (state.watchBlocked && !state.watchDone) body.append(hint('You watched enough — like & comment on this post to collect its tickets'));
        else if (!state.watchDone) body.append(hint('Keep tab open & unmuted while watching'));
      }
      if (A.actions.like) body.append(rowEl('Like', socialAmt(rewards.likeReward, state.likeS), state.likeS));
      if (A.actions.comment) {
        body.append(rowEl('Comment', socialAmt(rewards.commentReward, state.commentS), state.commentS));
        if (state.commentS === 'idle') body.append(hint('Comment must be 5+ characters'));
      }
      const earned = (state.likeS === 'done' ? rewards.likeReward : 0) + (state.commentS === 'done' ? rewards.commentReward : 0) + (state.watchDone ? (state.awarded || 0) : 0);
      frame.setPill(earned ? `+${earned}` : '🎟');
    }
    function clearWidget() { if (frame) { frame.destroy(); frame = null; } state = null; }

    async function fireEngagement(action) {
      const ref = state && state.ref; if (!ref) return;
      const key = action === 'like' ? 'likeS' : 'commentS';
      if (state[key] !== 'idle') return; // already pending or done
      state[key] = 'pending'; drawWidget();
      const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: A.platform, action, ref }).catch(() => null);
      if (r && r.credited) { state[key] = 'done'; setDone(ref, action === 'like' ? { like: true } : { comment: true }); }
      // A genuine already-earned response (HTTP 200, credited:false) on a like → show done.
      // Must distinguish from an ERROR object (e.g. {error:'http_409'} when the post isn't an
      // active target yet, or an auth blip): error objects have no `credited` field, so fall
      // through to idle and retry. Marking the like done on an error would stick it "done"
      // forever in local storage and the like could never credit later.
      else if (r && action === 'like' && 'credited' in r) { state[key] = 'done'; setDone(ref, { like: true }); }
      else state[key] = 'idle';
      drawWidget();
    }

    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      function tryCredit() {
        if (!state || state.commentS !== 'idle') return null;
        const before = (A.commentText() || '').trim();
        if (before.length <= 5) return null;
        // Credit once the box clears after a real submit.
        setTimeout(() => {
          if (!state || state.commentS !== 'idle') return;
          if ((A.commentText() || '').trim() !== before) fireEngagement('comment');
        }, 1500);
        return before;
      }
      // Click path: submit button pressed.
      document.addEventListener('click', (e) => {
        if (!A.commentSubmitTarget(e.target)) return;
        tryCredit();
      }, true);
      // Keyboard path: Enter in the comment input box (TikTok & YouTube accept Enter).
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        if (!A.commentInputTarget || !A.commentInputTarget(e.target)) return;
        tryCredit();
      }, true);
    }

    // Catch a like the instant it's clicked. The 5s poll alone can miss a like that the
    // platform optimistically lights up then reverts within a couple seconds (e.g. a
    // logged-out/flaky TikTok session) — so on a click of the like control we sample
    // isLiked() a few times over ~2s and credit as soon as it reads liked.
    function hookLike() {
      if (likeHooked || !A.actions.like || !A.likeTarget) return; likeHooked = true;
      document.addEventListener('click', (e) => {
        if (!A.likeTarget(e.target)) return;
        if (!state || state.likeS !== 'idle') return;
        // Captured BEFORE the page toggles the like, so this reflects the pre-click state.
        // We only treat the click as a like (not an un-like) when we weren't already liked.
        const wasLiked = A.isLiked();
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (!state || state.likeS !== 'idle') { clearInterval(iv); return; }
          if (A.isLiked()) { clearInterval(iv); fireEngagement('like'); return; } // confirmed liked
          // Optimistic fallback: clicked the like control from an un-liked state but we still
          // can't positively read the red heart after ~5s (selector drift, or the platform
          // visually reverted a like it didn't persist). Credit the intent so people don't
          // have to click 5–6 times. Un-likes (wasLiked) are never credited here.
          if (tries >= 20) { clearInterval(iv); if (!wasLiked) fireEngagement('like'); }
        }, 250);
      }, true);
    }

    async function startWatch() {
      if (!A.actions.watch) return;
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
      drawWidget();
    }
    async function claimWatch() {
      if (!state || state.watchDone || state.claiming) return;
      state.claiming = true; drawWidget();
      const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', platform: A.platform, videoRef: state.ref }).catch(() => null);
      state.claiming = false;
      // Credit on a successful claim OR if it was already claimed earlier (don't blink forever).
      if (r && (r.ok || r.reason === 'already_claimed')) {
        state.watchDone = true;
        state.watchBlocked = false;
        state.awarded = r.ok ? (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)) : null;
        setDone(state.ref, { watch: true, awarded: state.awarded });
      } else if (r && r.reason === 'engagement_required') {
        // Watch time is satisfied; the reward is held until the user likes AND comments.
        state.watchBlocked = true;
      }
      drawWidget();
    }

    async function start(ref) {
      if (!ref) return clearWidget();
      if (state && state.ref === ref) return; // same video — don't reset progress on minor URL tweaks
      const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
      rewards = {
        likeReward: (data && data.likeReward) || 0,
        commentReward: (data && data.commentReward) || 0,
        watchVideoReward: (data && data.watchVideoReward) || 0,
        watchFloor: (data && data.watchVideoFloor) || 5,
        watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
      };
      const target = data && (data.targets || []).find((t) => t.platform === A.platform && t.ref === ref);
      if (!target) return clearWidget();
      // Merge server done flags (bearer-scoped, authoritative) with local cache.
      const local = await getDone(ref);
      const srv = target.done || {};
      // Like: trust the server's per-user flag as authoritative. ORing the local cache
      // would let a stale local "done" (written by the old transient-error bug) keep
      // suppressing the like even after the server says it was never earned.
      const likeDone = !!srv.like;
      const commentDone = !!(srv.comment || local.comment);
      const watchDone = !!(srv.watch || local.watch);
      if (!srv.like && local.like) setDone(ref, { like: false }); // heal a stale cached "done"
      if (srv.like && !local.like) setDone(ref, { like: true });
      if (srv.comment && !local.comment) setDone(ref, { comment: true });
      if (srv.watch && !local.watch) setDone(ref, { watch: true });
      state = { ref, watched: 0, target: 0, sessionId: null,
        watchDone, awarded: local.awarded != null ? local.awarded : null,
        watchPlaying: false, watchMuted: false, claiming: false, watchBlocked: false,
        likeS: likeDone ? 'done' : 'idle', commentS: commentDone ? 'done' : 'idle' };
      lastHb = 0; hookComment(); hookLike(); drawWidget();
      if (!state.watchDone) startWatch();
    }

    // Every 5s: detect a like, accrue focused-playing watch time, heartbeat, claim when ready.
    setInterval(() => {
      if (!state || state.ref !== A.getRef()) return;
      if (A.actions.like && state.likeS === 'idle' && A.isLiked()) fireEngagement('like');
      if (!A.actions.watch || !state.sessionId || state.watchDone) return;
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
      // Claim once watched enough. If the reward is blocked on engagement, don't
      // re-hammer the server every 5s — only retry the claim once like AND comment land.
      if ((state.watched || 0) >= (state.target || 120)) {
        if (!state.watchBlocked) claimWatch();
        else if (state.likeS === 'done' && state.commentS === 'done') claimWatch();
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
        (!A.actions.watch || state.sessionId || state.watchDone || state.watchBlocked);
      if (established || wdTries >= 6 || now < wdNextAt) return;
      wdTries++; wdNextAt = now + 2000 * wdTries; // 2s, 4s, 6s … backoff
      if (!state || state.ref !== ref) start(ref);          // setup never took — redo it
      else if (A.actions.watch && !state.sessionId) startWatch(); // session never started — retry it
    }, 1000);
    start(A.getRef());
  }

  return { init, effectiveTarget };
})();
