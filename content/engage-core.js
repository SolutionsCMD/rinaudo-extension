// Shared engagement engine for per-platform content scripts (TikTok, Instagram;
// X/YouTube may migrate here later). An adapter supplies the platform name, which
// actions apply, and the DOM selectors; this engine does the widget, the watch
// session loop, like/comment detection (+ the >5-char comment gate), the SW wiring,
// and SPA re-checks. Loaded after config.js + widget-frame.js, before the adapter.
//
// Adapter shape:
//   { platform, actions:{watch,like,comment}, getRef()->string, isLiked()->bool,
//     commentSubmitTarget(eventTarget)->Element|null, commentText()->string,
//     getVideoEl()->HTMLVideoElement|null }
self.EngageCore = (function () {
  const ROW_CSS = `
    .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
    .row:first-child{margin-top:0}
    .row .amt{color:#A9A697;font-variant-numeric:tabular-nums}
    .done{color:#86D6A4}`;

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const watchEstimate = (sec, r) => Math.max(r.watchFloor || 5, Math.floor((sec || 0) / 60) * (r.watchPerMinute || 1));

  function init(A) {
    let frame = null, state = null, commentHooked = false, lastHb = 0;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1 };

    function ensureFrame() {
      if (frame) return;
      frame = self.RGCFrame.mount({ key: A.platform, title: 'Earn tickets', width: 240, pos: { top: 72, right: 16 }, css: ROW_CSS });
    }
    function rowEl(label, amt, done) {
      const r = document.createElement('div'); r.className = 'row';
      const l = document.createElement('span'); l.textContent = (done ? '✓ ' : '') + label; if (done) l.className = 'done';
      const a = document.createElement('span'); a.className = 'amt'; a.textContent = amt;
      r.append(l, a); return r;
    }
    function drawWidget() {
      if (!state) return;
      ensureFrame();
      const body = frame.body; body.replaceChildren();
      if (A.actions.watch && state.sessionId) {
        const amt = state.watchDone ? (state.awarded != null ? state.awarded : watchEstimate(state.watched, rewards)) : watchEstimate(state.watched, rewards);
        body.append(rowEl(state.watchDone ? 'Watched' : `Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}`, `+${amt}`, state.watchDone));
      }
      if (A.actions.like) body.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
      if (A.actions.comment) body.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
      const earned = (state.likeDone ? rewards.likeReward : 0) + (state.commentDone ? rewards.commentReward : 0) + (state.watchDone ? (state.awarded || 0) : 0);
      frame.setPill(earned ? `+${earned}` : '🎟');
    }
    function clearWidget() { if (frame) { frame.destroy(); frame = null; } state = null; }

    async function fireEngagement(action) {
      const ref = state && state.ref; if (!ref) return;
      const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: A.platform, action, ref }).catch(() => null);
      if (r && r.credited) { if (action === 'like') state.likeDone = true; if (action === 'comment') state.commentDone = true; drawWidget(); }
    }

    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      document.addEventListener('click', (e) => {
        if (!state || state.commentDone) return;
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
      state.sessionId = s.sessionId; state.target = s.requiredWatchSeconds || 120; state.hbInterval = s.heartbeatIntervalSec || 20;
      drawWidget();
    }
    async function claimWatch() {
      if (!state || state.watchDone || state.claiming) return;
      state.claiming = true;
      const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', platform: A.platform, videoRef: state.ref }).catch(() => null);
      state.claiming = false;
      if (r && r.ok) { state.watchDone = true; state.awarded = (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)); drawWidget(); }
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
      state = { ref, watched: 0, target: 0, sessionId: null, watchDone: false, likeDone: false, commentDone: false };
      lastHb = 0; hookComment(); drawWidget();
      startWatch();
    }

    // Every 5s: detect a like, accrue focused-playing watch time, heartbeat, claim when ready.
    setInterval(() => {
      if (!state || state.ref !== A.getRef()) return;
      if (A.actions.like && !state.likeDone && A.isLiked()) fireEngagement('like');
      if (!A.actions.watch || !state.sessionId || state.watchDone) return;
      const v = A.getVideoEl();
      const playing = v && !v.paused && !v.ended && v.currentTime > 0;
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      if (playing && focused) {
        state.watched = (state.watched || 0) + 5;
        const now = Date.now();
        if (now - lastHb >= (state.hbInterval || 20) * 1000) { lastHb = now; chrome.runtime.sendMessage({ type: 's2WatchHeartbeat', platform: A.platform, sessionId: state.sessionId }).catch(() => {}); }
        drawWidget();
      }
      if ((state.watched || 0) >= (state.target || 120)) claimWatch();
    }, 5000);

    // SPA URL changes → re-evaluate eligibility for the new post.
    let lastUrl = location.href;
    setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(A.getRef()); } }, 1000);
    start(A.getRef());
  }

  return { init };
})();
