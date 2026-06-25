// Runs on youtube.com/watch* and /shorts/*. If the current video is the active
// S2 YouTube engagement target, shows an "Earn tickets" widget and credits:
//   • Watch  — start a watch session, send focus+play-gated heartbeats, claim
//              (the server does the anti-cheat: well-spaced heartbeats + wall time)
//   • Like   — via the like button's aria-pressed state
//   • Comment— via the comment submit-click hook (best-effort)
// All network goes through the service worker (page CSP). SPA-aware.
const C = self.S2;
let host = null, shadow = null, state = null, commentHooked = false, lastHb = 0;
let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0 };

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

function ensureWidget() {
  if (host) return;
  host = document.createElement('div'); host.id = 'rgc-yt-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  shadow = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent = `
    .w{width:236px;background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:12px;padding:14px;font-family:system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.6)}
    .h{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#C9A766;margin-bottom:10px}
    .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:7px 0}
    .row .amt{color:#A9A697;font-variant-numeric:tabular-nums}
    .done{color:#86D6A4}`;
  shadow.append(st);
  document.body.appendChild(host);
}
function rowEl(label, amt, done) {
  const r = document.createElement('div'); r.className = 'row';
  const l = document.createElement('span'); l.textContent = (done ? '✓ ' : '') + label; if (done) l.className = 'done';
  const a = document.createElement('span'); a.className = 'amt'; a.textContent = amt;
  r.append(l, a); return r;
}
function drawWidget() {
  if (!state) return;
  ensureWidget();
  const card = document.createElement('div'); card.className = 'w';
  const h = document.createElement('div'); h.className = 'h'; h.textContent = 'Earn tickets'; card.append(h);
  if (state.sessionId) {
    card.append(rowEl(state.watchDone ? 'Watched' : `Watch ${fmt(state.watched || 0)} / ${fmt(state.target || 0)}`,
      `+${rewards.watchVideoReward}`, state.watchDone));
  }
  card.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
  card.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
  const old = shadow.querySelector('.w'); if (old) old.remove();
  shadow.append(card);
}
function clearWidget() { if (host) { host.remove(); host = null; shadow = null; } state = null; }

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
  if (r && r.ok) { state.watchDone = true; drawWidget(); }
}

async function start(videoId) {
  if (!videoId) return clearWidget();
  const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
  rewards = {
    likeReward: (data && data.likeReward) || 0,
    commentReward: (data && data.commentReward) || 0,
    watchVideoReward: (data && data.watchVideoReward) || 0,
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
