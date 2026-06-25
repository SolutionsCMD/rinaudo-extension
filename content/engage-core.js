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
    .row.paused .lbl{color:#8A8678}`;

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const watchEstimate = (sec, r) => Math.max(r.watchFloor || 5, Math.floor((sec || 0) / 60) * (r.watchPerMinute || 1));
  // Credit needs `reqHb` well-spaced heartbeats (first ~a tick in, then every hbInterval),
  // which for short videos takes longer than requiredWatchSeconds. Target that
  // heartbeat-limited time (+~2 ticks of slack) so the bar doesn't read "done" before the
  // claim can land. For long videos requiredWatchSeconds dominates, so it's unchanged.
  const effectiveTarget = (reqSec, reqHb, hbInterval) => Math.max(reqSec || 120, 10 + ((reqHb || 2) - 1) * (hbInterval || 20));

  function init(A) {
    let frame = null, state = null, commentHooked = false, lastHb = 0;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1 };

    // Locally remember what's already credited per (platform, post) so the ✓ state
    // survives a refresh (the server is idempotent; this is purely the display).
    const doneKey = (ref) => `rgcDone:${A.platform}:${ref}`;
    async function getDone(ref) { try { const k = doneKey(ref); return (await chrome.storage.local.get(k))[k] || {}; } catch { return {}; } }
    async function setDone(ref, patch) { try { const k = doneKey(ref); const cur = (await chrome.storage.local.get(k))[k] || {}; await chrome.storage.local.set({ [k]: { ...cur, ...patch } }); } catch { /* ignore */ } }

    function ensureFrame() {
      if (frame) return;
      frame = self.RGCFrame.mount({ key: A.platform, title: 'Earn tickets', width: 240, pos: { bottom: 16, right: 16 }, css: ROW_CSS });
    }
    // status: 'idle' | 'pending' | 'done'
    function rowEl(label, amt, status) {
      const r = document.createElement('div'); r.className = 'row' + (status === 'pending' ? ' pending' : '');
      const l = document.createElement('span'); l.className = 'lbl';
      l.textContent = (status === 'done' ? '✓ ' : '') + label; if (status === 'done') l.classList.add('done');
      const a = document.createElement('span'); a.className = 'amt';
      a.textContent = status === 'pending' ? '⋯' : amt;
      r.append(l, a); return r;
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
      if (state.claiming) return rowEl(`Watch ${fmt(state.watched)} / ${fmt(state.target)}`, '', 'pending');
      const playing = state.watchPlaying;
      const suffix = playing ? '' : (state.watchMuted ? ' · unmute to earn' : ' · paused');
      const icon = playing ? '▶' : (state.watchMuted ? '🔇' : '⏸');
      const label = `${icon} Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}${suffix}`;
      const r = rowEl(label, `+${watchPotential()}`, 'idle');
      if (!playing) r.classList.add('paused');
      return r;
    }
    function drawWidget() {
      if (!state) return;
      ensureFrame();
      const body = frame.body; body.replaceChildren();
      if (A.actions.watch && (state.sessionId || state.watchDone)) body.append(watchRow());
      if (A.actions.like) body.append(rowEl('Like', `+${rewards.likeReward}`, state.likeS));
      if (A.actions.comment) body.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentS));
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
      // A real (non-null) response with credited:false on a like means it's already
      // earned (the card only shows on active targets) — show done, not a blink-to-idle.
      else if (r && action === 'like') { state[key] = 'done'; setDone(ref, { like: true }); }
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
        const sub = A.commentSubmitTarget(e.target);
        console.log('[RGC-comment]', A.platform, 'click', e.target.tagName, e.target.getAttribute && e.target.getAttribute('data-e2e'), 'sub:', !!sub, 'text:', (A.commentText()||'').trim().slice(0,30), 'state:', state && state.commentS);
        if (!sub) return;
        tryCredit();
      }, true);
      // Keyboard path: Enter in the comment input box (TikTok & YouTube accept Enter).
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const inp = A.commentInputTarget && A.commentInputTarget(e.target);
        console.log('[RGC-comment]', A.platform, 'enter', e.target.tagName, 'inp:', !!inp, 'text:', (A.commentText()||'').trim().slice(0,30));
        if (!inp) return;
        tryCredit();
      }, true);
    }

    async function startWatch() {
      if (!A.actions.watch) return;
      const v = A.getVideoEl();
      const dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
      const s = await chrome.runtime.sendMessage({ type: 's2WatchSession', platform: A.platform, videoRef: state.ref, playerDuration: dur }).catch(() => null);
      if (!s || s.error || !s.sessionId) return; // backend not ready / not the active target / not connected
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
        state.awarded = r.ok ? (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)) : null;
        setDone(state.ref, { watch: true, awarded: state.awarded });
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
      const likeDone = !!(srv.like || local.like);
      const commentDone = !!(srv.comment || local.comment);
      const watchDone = !!(srv.watch || local.watch);
      if (srv.like && !local.like) setDone(ref, { like: true });
      if (srv.comment && !local.comment) setDone(ref, { comment: true });
      if (srv.watch && !local.watch) setDone(ref, { watch: true });
      state = { ref, watched: 0, target: 0, sessionId: null,
        watchDone, awarded: local.awarded != null ? local.awarded : null,
        watchPlaying: false, watchMuted: false, claiming: false,
        likeS: likeDone ? 'done' : 'idle', commentS: commentDone ? 'done' : 'idle' };
      lastHb = 0; hookComment(); drawWidget();
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
      if ((state.watched || 0) >= (state.target || 120)) claimWatch();
    }, 5000);

    // SPA URL changes → re-evaluate eligibility for the new post.
    let lastUrl = location.href;
    setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(A.getRef()); } }, 1000);
    start(A.getRef());
  }

  return { init, effectiveTarget };
})();
