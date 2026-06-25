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
    function watchRow() {
      if (state.watchDone) return rowEl('Watched', `+${state.awarded != null ? state.awarded : watchEstimate(state.watched, rewards)}`, 'done');
      if (state.claiming) return rowEl(`Watch ${fmt(state.watched)} / ${fmt(state.target)}`, '', 'pending');
      const playing = state.watchPlaying;
      const suffix = playing ? '' : (state.watchMuted ? ' · unmute to earn' : ' · paused');
      const icon = playing ? '▶' : (state.watchMuted ? '🔇' : '⏸');
      const label = `${icon} Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}${suffix}`;
      const r = rowEl(label, `+${watchEstimate(state.watched, rewards)}`, 'idle');
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
      else state[key] = 'idle';
      drawWidget();
    }

    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      document.addEventListener('click', (e) => {
        if (!state || state.commentS !== 'idle') return;
        const n = A.commentSubmitTarget(e.target);
        if (n) {
          if ((A.commentText() || '').trim().length <= 5) return; // >5-char gate
          setTimeout(() => fireEngagement('comment'), 600);
        }
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
      if (r && r.ok) { state.watchDone = true; state.awarded = (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)); setDone(state.ref, { watch: true, awarded: state.awarded }); }
      drawWidget();
    }

    async function start(ref) {
      if (!ref) return clearWidget();
      const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
      rewards = {
        likeReward: (data && data.likeReward) || 0,
        commentReward: (data && data.commentReward) || 0,
        watchVideoReward: (data && data.watchVideoReward) || 0,
        watchFloor: (data && data.watchVideoFloor) || 5,
        watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
      };
      const eligible = !!(data && (data.targets || []).some((t) => t.platform === A.platform && t.ref === ref));
      if (!eligible) return clearWidget();
      const done = await getDone(ref);
      state = { ref, watched: 0, target: 0, sessionId: null,
        watchDone: !!done.watch, awarded: done.watch ? (done.awarded != null ? done.awarded : null) : null,
        watchPlaying: false, watchMuted: false, claiming: false,
        likeS: done.like ? 'done' : 'idle', commentS: done.comment ? 'done' : 'idle' };
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
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      const wasPlaying = state.watchPlaying;
      state.watchPlaying = !!(live && audible && focused);
      state.watchMuted = !!(live && focused && !audible);
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
