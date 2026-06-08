// Runs on youtube.com watch + shorts pages. If the video is one of Mizkif's
// eligible latest uploads, shows an earning widget and credits watch (focus-gated
// heartbeats) / like / comment via the service worker. SPA-aware. Verbose [RGC-yt]
// logging so the YouTube-DOM-dependent bits (like/comment) can be diagnosed live.
const C = self.RGC;
const LOG = (...a) => console.log('[RGC-yt]', ...a);
let host = null, shadow = null, state = null, acc = 0, tickN = 0, commentHooked = false;

function currentVideoId() {
  const u = new URL(location.href);
  if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
  return u.searchParams.get('v') || '';
}
function getVideoEl() { return document.querySelector('video'); }

// Like: find the button whose label mentions "like" (not "dislike") and read aria-pressed.
function likeButton() {
  return [...document.querySelectorAll('button[aria-pressed]')].find((b) => {
    const l = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
    return l.includes('like') && !l.includes('dislike');
  }) || null;
}
function isLiked() { const b = likeButton(); return !!(b && b.getAttribute('aria-pressed') === 'true'); }

function ensureWidget() {
  if (host) return;
  host = document.createElement('div'); host.id = 'rgc-earn-host';
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
function fmt(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function drawWidget() {
  ensureWidget();
  const card = document.createElement('div'); card.className = 'w';
  const h = document.createElement('div'); h.className = 'h'; h.textContent = 'Earn watchtime'; card.append(h);
  card.append(rowEl(state.watchDone ? 'Watched' : `Watch ${fmt(state.accrued)} / ${fmt(state.target)}`, '+30m', state.watchDone));
  card.append(rowEl('Like', '+15m', state.likeDone));
  card.append(rowEl('Comment', '+15m', state.commentDone));
  const old = shadow.querySelector('.w'); if (old) old.remove();
  shadow.append(card);
}
function clearWidget() { if (host) { host.remove(); host = null; shadow = null; } state = null; }

async function fireEarn(action) {
  const vid = state && state.videoId; if (!vid) return;
  const r = await chrome.runtime.sendMessage({ type: 'earn', videoId: vid, action }).catch(() => null);
  LOG('earn', action, '→', r);
  if (r && r.credited) { if (action === 'like') state.likeDone = true; if (action === 'comment') state.commentDone = true; drawWidget(); }
}

// Comment: catch the click on the comment "Comment"/submit button (more reliable
// than matching authorship). Attached once; checks state at click time.
function hookComment() {
  if (commentHooked) return; commentHooked = true;
  document.addEventListener('click', (e) => {
    if (!state || state.commentDone) return;
    const n = e.target.closest && e.target.closest('#submit-button, ytd-commentbox #submit-button, ytd-comment-simplebox-renderer #submit-button, [aria-label="Comment"]');
    if (n) { LOG('comment submit click detected'); setTimeout(() => fireEarn('comment'), 400); }
  }, true);
}

async function start(videoId) {
  if (!videoId) return clearWidget();
  const res = await chrome.runtime.sendMessage({ type: 'isEligible', videoId }).catch(() => ({ eligible: false }));
  LOG('start', videoId, 'eligible=', res && res.eligible);
  if (!res || !res.eligible) return clearWidget();
  state = { videoId, accrued: 0, target: 600, watchDone: false, likeDone: false, commentDone: false };
  acc = 0; hookComment(); drawWidget();
}

setInterval(async () => {
  if (!state) return;
  const vid = currentVideoId();
  if (state.videoId !== vid) return;
  const v = getVideoEl();
  const playing = v && !v.paused && !v.ended && v.currentTime > 0;
  const focused = document.visibilityState === 'visible' && document.hasFocus();
  if (playing && focused && !state.watchDone) acc += 1;

  tickN++;
  if (tickN % 5 === 0) LOG('tick playing=' + playing + ' focused=' + focused + ' acc=' + acc + ' liked=' + isLiked() + ' likeBtn=' + !!likeButton());

  if (!state.likeDone && isLiked()) fireEarn('like');

  if (acc >= 15 && !state.watchDone) {
    const durationSec = (v && v.duration && isFinite(v.duration)) ? Math.round(v.duration) : 600;
    const send = acc; acc = 0;
    const res = await chrome.runtime.sendMessage({ type: 'earnHeartbeat', videoId: vid, seconds: send, durationSec }).catch(() => null);
    LOG('heartbeat send=' + send + ' dur=' + durationSec + ' →', res);
    if (res) {
      if (typeof res.accruedSec === 'number') state.accrued = res.accruedSec;
      if (typeof res.target === 'number') state.target = res.target;
      if (res.watchCredited) state.watchDone = true;
      drawWidget();
    }
  }
}, 1000);

let lastUrl = location.href;
setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(currentVideoId()); } }, 1000);
start(currentVideoId());
