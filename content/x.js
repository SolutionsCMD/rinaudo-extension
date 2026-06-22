// Runs on x.com / twitter.com tweet pages. If the tweet is an admin-published
// S2 engagement target, shows an earn widget and credits like/comment via the
// service worker. SPA-aware. Best-effort detection (DOM-based), gated server-side
// by the target allow-list + once-per-(user,target,action) idempotency.
const C = self.S2;
const LOG = (...a) => console.log('[RGC-x]', ...a);
let host = null, shadow = null, state = null, commentHooked = false, rewards = { likeReward: 0, commentReward: 0 };

function currentStatusId() {
  const m = location.pathname.match(/\/status\/(\d+)/);
  return m ? m[1] : '';
}
function isLiked() { return !!document.querySelector('[data-testid="unlike"]'); }

function ensureWidget() {
  if (host) return;
  host = document.createElement('div'); host.id = 'rgc-x-host';
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
  ensureWidget();
  const card = document.createElement('div'); card.className = 'w';
  const h = document.createElement('div'); h.className = 'h'; h.textContent = 'Earn tickets'; card.append(h);
  card.append(rowEl('Like', `+${rewards.likeReward}`, state.likeDone));
  card.append(rowEl('Comment', `+${rewards.commentReward}`, state.commentDone));
  const old = shadow.querySelector('.w'); if (old) old.remove();
  shadow.append(card);
}
function clearWidget() { if (host) { host.remove(); host = null; shadow = null; } state = null; }

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
    if (n) { LOG('reply submit click detected'); setTimeout(() => fireEngagement('comment'), 600); }
  }, true);
}

async function start(statusId) {
  if (!statusId) return clearWidget();
  const res = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
  rewards = { likeReward: (res && res.likeReward) || 0, commentReward: (res && res.commentReward) || 0 };
  const eligible = !!(res && (res.targets || []).some((t) => t.ref === statusId));
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
