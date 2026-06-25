// Runs on youtube.com/watch* and /shorts/*. If the current video is the active
// S2 YouTube engagement target, shows an "Earn tickets" widget and credits:
//   • Watch  — start a watch session, send focus+play-gated heartbeats, claim
//              (the server does the anti-cheat: well-spaced heartbeats + wall time)
//   • Like   — via the like button's aria-pressed state
//   • Comment— via the comment submit-click hook (best-effort)
// All network goes through the service worker (page CSP). SPA-aware. The card
// chrome (drag/collapse/position) is provided by RGCFrame (content/widget-frame.js).
const C = self.S2;
let frame = null, state = null, commentHooked = false, lastHb = 0;
let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1 };

const ROW_CSS = `
  .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
  .row:first-child{margin-top:0}
  .row .amt{color:#A9A697;font-variant-numeric:tabular-nums}
  .done{color:#86D6A4}`;

function currentVideoId() {
  const u = new URL(location.href);
  if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
  return u.searchParams.get('v') || '';
}
function getVideoEl() { return document.querySelector('video'); }
function likeButton() {
  return [...document.querySelectorAll('button[aria-pressed]')].find((b) => {
    const l = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
    return l.includes('like') && !l.includes('dislike');
  }) || null;
}
function isLiked() { const b = likeButton(); return !!(b && b.getAttribute('aria-pressed') === 'true'); }
function fmt(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
// Live estimate mirroring the server formula: max(floor, minutes × perMinute).
// floor + perMinute come from the season economy (admin-tunable); the real award
// is whatever the claim returns.
function watchEstimate(sec) {
  return Math.max(rewards.watchFloor || 5, Math.floor((sec || 0) / 60) * (rewards.watchPerMinute || 1));
}

function ensureFrame() {
  if (frame) return;
  frame = self.RGCFrame.mount({ key: 'yt', title: 'Earn tickets', width: 240, pos: { top: 72, right: 16 }, css: ROW_CSS });
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
  if (state.sessionId) {
    const amt = state.watchDone ? (state.awarded != null ? state.awarded : watchEstimate(state.watched)) : watchEstimate(state.watched);
    body.append(rowEl(state.watchDone ? 'Watched' : `Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}`, `+${amt}`, state.watchDone));
  }
  body.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
  body.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
  const earned = (state.likeDone ? rewards.likeReward : 0) + (state.commentDone ? rewards.commentReward : 0) + (state.watchDone ? (state.awarded || 0) : 0);
  frame.setPill(earned ? `+${earned}` : '🎟');
}
function clearWidget() { if (frame) { frame.destroy(); frame = null; } state = null; }

async function fireEngagement(action) {
  const ref = state && state.videoId; if (!ref) return;
  const r = await chrome.runtime.sendMessage({ type: 's2Engagement', platform: 'youtube', action, ref }).catch(() => null);
  if (r && r.credited) { if (action === 'like') state.likeDone = true; if (action === 'comment') state.commentDone = true; drawWidget(); }
}

// Comment = clicking a comment-submit button. Best-effort (same heuristic as S1).
function hookComment() {
  if (commentHooked) return; commentHooked = true;
  document.addEventListener('click', (e) => {
    if (!state || state.commentDone) return;
    const n = e.target.closest && e.target.closest('#submit-button, ytd-commentbox #submit-button, ytd-comment-simplebox-renderer #submit-button');
    if (n) setTimeout(() => fireEngagement('comment'), 600);
  }, true);
}

async function startWatch() {
  const v = getVideoEl();
  const dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
  const s = await chrome.runtime.sendMessage({ type: 's2WatchSession', videoRef: state.videoId, playerDuration: dur }).catch(() => null);
  if (!s || s.error || !s.sessionId) return; // not the active watch target / not connected
  state.sessionId = s.sessionId;
  state.target = s.requiredWatchSeconds || 120;
  state.hbInterval = s.heartbeatIntervalSec || 20;
  drawWidget();
}

async function claimWatch() {
  if (!state || state.watchDone || state.claiming) return;
  state.claiming = true;
  const r = await chrome.runtime.sendMessage({ type: 's2WatchClaim', videoRef: state.videoId }).catch(() => null);
  state.claiming = false;
  if (r && r.ok) { state.watchDone = true; state.awarded = (r.awarded != null ? r.awarded : (r.tickets != null ? r.tickets : null)); drawWidget(); }
}

async function start(videoId) {
  if (!videoId) return clearWidget();
  const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
  rewards = {
    likeReward: (data && data.likeReward) || 0,
    commentReward: (data && data.commentReward) || 0,
    watchVideoReward: (data && data.watchVideoReward) || 0,
    watchFloor: (data && data.watchVideoFloor) || 5,
    watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
  };
  const eligible = !!(data && (data.targets || []).some((t) => t.platform === 'youtube' && t.ref === videoId));
  if (!eligible) return clearWidget();
  state = { videoId, watched: 0, target: 0, sessionId: null, watchDone: false, likeDone: false, commentDone: false };
  lastHb = 0; hookComment(); drawWidget();
  startWatch();
}

// Every 5s: accrue focused-playing time, send watch heartbeats, claim when ready, detect a like.
setInterval(() => {
  if (!state || state.videoId !== currentVideoId()) return;
  if (!state.likeDone && isLiked()) fireEngagement('like');
  if (!state.sessionId || state.watchDone) return;
  const v = getVideoEl();
  const playing = v && !v.paused && !v.ended && v.currentTime > 0;
  const focused = document.visibilityState === 'visible' && document.hasFocus();
  if (playing && focused) {
    state.watched = (state.watched || 0) + 5;
    const now = Date.now();
    if (now - lastHb >= (state.hbInterval || 20) * 1000) {
      lastHb = now;
      chrome.runtime.sendMessage({ type: 's2WatchHeartbeat', sessionId: state.sessionId }).catch(() => {});
    }
    drawWidget();
  }
  if ((state.watched || 0) >= (state.target || 120)) claimWatch();
}, 5000);

let lastUrl = location.href;
setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(currentVideoId()); } }, 1000);
start(currentVideoId());
