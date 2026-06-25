// Runs on x.com / twitter.com tweet pages. If the tweet is an admin-published
// S2 engagement target, shows an earn widget and credits like/comment via the
// service worker. SPA-aware. Best-effort detection (DOM-based), gated server-side
// by the target allow-list + once-per-(user,target,action) idempotency. The card
// chrome (drag/collapse/position) is provided by RGCFrame (content/widget-frame.js).
const LOG = (...a) => console.log('[RGC-x]', ...a);
let frame = null, state = null, commentHooked = false, rewards = { likeReward: 0, commentReward: 0 };

const ROW_CSS = `
  .row{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin:8px 0}
  .row:first-child{margin-top:0}
  .row .amt{color:#A9A697;font-variant-numeric:tabular-nums}
  .done{color:#86D6A4}`;

function currentStatusId() {
  const m = location.pathname.match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}
function isLiked() { return !!document.querySelector('[data-testid="unlike"]'); }
// Current reply draft text — for the >5-char comment gate (Mizkif's anti-spam ask).
function replyText() {
  for (const el of document.querySelectorAll('[data-testid^="tweetTextarea_"]')) {
    const t = (el.textContent || '').trim();
    if (t) return t;
  }
  return '';
}

function ensureFrame() {
  if (frame) return;
  // Bottom-right, lifted clear of X's floating DM dock.
  frame = self.RGCFrame.mount({ key: 'x', title: 'Earn tickets', width: 240, pos: { bottom: 84, right: 16 }, css: ROW_CSS });
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
  body.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
  body.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
  const earned = (state.likeDone ? rewards.likeReward : 0) + (state.commentDone ? rewards.commentReward : 0);
  frame.setPill(earned ? `+${earned}` : '🎟');
}
function clearWidget() { if (frame) { frame.destroy(); frame = null; } state = null; }

async function fireEngagement(action) {
  const ref = state && state.ref; if (!ref) return;
  const r = await chrome.runtime.sendMessage({ type: 's2Engagement', action, ref }).catch(() => null);
  LOG('engagement', action, '→', r);
  if (r && r.credited) { if (action === 'like') state.likeDone = true; if (action === 'comment') state.commentDone = true; drawWidget(); }
}

// Comment = clicking the reply-tweet submit button while on the target tweet.
// Best-effort (same heuristic as the YouTube comment hook).
function hookComment() {
  if (commentHooked) return; commentHooked = true;
  document.addEventListener('click', (e) => {
    if (!state || state.commentDone) return;
    const n = e.target.closest && e.target.closest('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
    if (n) {
      if (replyText().length <= 5) { LOG('reply too short (<6 chars), not crediting'); return; }
      LOG('reply submit click detected'); setTimeout(() => fireEngagement('comment'), 600);
    }
  }, true);
}

async function start(statusId) {
  if (!statusId) return clearWidget();
  const res = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
  rewards = { likeReward: (res && res.likeReward) || 0, commentReward: (res && res.commentReward) || 0 };
  const eligible = !!(res && (res.targets || []).some((t) => (t.platform === 'x' || t.platform == null) && t.ref === statusId));
  LOG('start', statusId, 'eligible=', eligible);
  if (!eligible) return clearWidget();
  state = { ref: statusId, likeDone: false, commentDone: false };
  hookComment(); drawWidget();
}

setInterval(() => {
  if (!state) return;
  if (state.ref !== currentStatusId()) return;
  if (!state.likeDone && isLiked()) fireEngagement('like');
}, 1000);

let lastUrl = location.href;
setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; start(currentStatusId()); } }, 1000);
start(currentStatusId());
