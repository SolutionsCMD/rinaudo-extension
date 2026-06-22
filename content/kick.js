// Runs on kick.com/mizkif*. Asks the SW for the active S2 poll (~5s) and casts
// votes — the SW does the network (page CSP blocks content-script fetches).
// Shadow-DOM vote card with live tally; one changeable vote.
const C = self.S2;
let host = null, shadow = null, shownPollId = null, optimisticIdx = null;

function ensureHost() {
  if (host) return;
  host = document.createElement('div'); host.id = 'rgc-vote-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  shadow = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent = `
    .card{width:300px;background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:12px;padding:16px;font-family:system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.6)}
    .label{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#C9A766;margin-bottom:10px}
    .q{font-size:14px;font-weight:600;margin:0 0 12px;line-height:1.35}
    .opt{position:relative;display:flex;align-items:center;gap:10px;width:100%;margin:6px 0;padding:10px 12px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;cursor:pointer;overflow:hidden;text-align:left;font:inherit}
    .opt:hover{border-color:rgba(201,167,102,.4)}
    .opt.mine{border-color:#C9A766}
    .fill{position:absolute;left:0;top:0;bottom:0;z-index:0;background:linear-gradient(90deg,rgba(201,167,102,.20),rgba(201,167,102,.05))}
    .opt.mine .fill{background:linear-gradient(90deg,rgba(134,214,164,.26),rgba(134,214,164,.07))}
    .check{position:relative;z-index:1;color:#86D6A4;font-weight:700;flex:none}
    .ltext{position:relative;z-index:1;flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cnt{position:relative;z-index:1;font-variant-numeric:tabular-nums;color:#A9A697;font-size:12px}
    .hint{font-size:10px;letter-spacing:.06em;color:#8A8678;margin-top:8px;text-transform:uppercase}`;
  shadow.append(st);
  document.body.appendChild(host);
}

function render(poll, tally, mine, connected) {
  ensureHost();
  const total = (tally || []).reduce((a, b) => a + b, 0);
  const card = document.createElement('div'); card.className = 'card';
  const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = 'Live Vote'; card.append(lab);
  const q = document.createElement('div'); q.className = 'q'; q.textContent = poll.question || 'Vote'; card.append(q);
  (poll.options || []).forEach((label, idx) => {
    const c = (tally && tally[idx]) || 0;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'opt' + (mine === idx ? ' mine' : '');
    const fill = document.createElement('span'); fill.className = 'fill'; fill.style.width = (total > 0 ? Math.round(c / total * 100) : 0) + '%'; b.append(fill);
    if (mine === idx) { const ck = document.createElement('span'); ck.className = 'check'; ck.textContent = '✓'; b.append(ck); }
    const lt = document.createElement('span'); lt.className = 'ltext'; lt.textContent = label; b.append(lt);
    const cn = document.createElement('span'); cn.className = 'cnt'; cn.textContent = String(c); b.append(cn);
    b.addEventListener('click', () => vote(idx, connected));
    card.append(b);
  });
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = connected ? (mine != null ? 'Tap another to change your vote' : 'Tap to vote') : 'Connect with Kick (extension popup) to vote';
  card.append(hint);
  const old = shadow.querySelector('.card'); if (old) old.remove();
  shadow.append(card);
}

function vote(idx, connected) {
  if (!connected || shownPollId == null) return;
  optimisticIdx = idx;
  chrome.runtime.sendMessage({ type: 's2PollVote', pollId: shownPollId, optionIdx: idx }).catch(() => {});
  tick();
}

function clear() { if (host) { host.remove(); host = null; shadow = null; } shownPollId = null; optimisticIdx = null; }

async function tick() {
  const data = await chrome.runtime.sendMessage({ type: 's2Poll' }).catch(() => null);
  const poll = data && data.poll;
  if (!poll) return clear();
  if (poll.id !== shownPollId) { shownPollId = poll.id; optimisticIdx = null; }
  const serverMine = data.myVote == null ? null : Number(data.myVote);
  if (optimisticIdx != null && serverMine === optimisticIdx) optimisticIdx = null;
  const mine = optimisticIdx != null ? optimisticIdx : serverMine;
  render(poll, data.tally || [], mine, !!data.connected);
}

setInterval(tick, (C && C.POLL_FAST_MS) || 5000);
tick();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
