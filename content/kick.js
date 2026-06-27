// Runs on kick.com/mizkif*. Asks the SW for the active S2 poll (~5s) and casts
// votes — the SW does the network (page CSP blocks content-script fetches).
// Live tally, one changeable vote. The card chrome (drag/collapse/position) is
// provided by RGCFrame (content/widget-frame.js).
const C = self.S2;
// --- Watchtime widget state ---
let wtFrame = null;   // second RGCFrame, independent of the poll frame
let wtEarned = 0;     // running session total (cosmetic, resets on page reload)
let wtPlaying = false;
let wtMuted = false;

const WT_CSS = `
  .row{display:flex;justify-content:space-between;align-items:center;font-size:13px}
  .lbl{color:#F4EFE3}
  .amt{color:#86D6A4;font-variant-numeric:tabular-nums}
  .sub{font-size:11px;color:#8A8678;margin-top:4px}`;

let frame = null, shownPollId = null, optimisticIdx = null;

const POLL_CSS = `
  .q{font-size:14px;font-weight:600;margin:0 0 12px;line-height:1.35}
  .opt{position:relative;display:flex;align-items:center;gap:10px;width:100%;margin:6px 0;padding:10px 12px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;cursor:pointer;overflow:hidden;text-align:left;font:inherit}
  .opt:hover{border-color:rgba(201,167,102,.4)}
  .opt.mine{border-color:#C9A766}
  .fill{position:absolute;left:0;top:0;bottom:0;z-index:0;background:linear-gradient(90deg,rgba(201,167,102,.20),rgba(201,167,102,.05))}
  .opt.mine .fill{background:linear-gradient(90deg,rgba(134,214,164,.26),rgba(134,214,164,.07))}
  .check{position:relative;z-index:1;color:#86D6A4;font-weight:700;flex:none}
  .ltext{position:relative;z-index:1;flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cnt{position:relative;z-index:1;font-variant-numeric:tabular-nums;color:#A9A697;font-size:12px}
  .hint{font-size:10px;letter-spacing:.06em;color:#8A8678;margin-top:10px;text-transform:uppercase}`;

function ensureWtFrame() {
  if (wtFrame) return;
  wtFrame = self.RGCFrame.mount({
    key: 'kick-watch',
    title: 'Watching',
    width: 220,
    pos: { bottom: 280, right: 16 },
    css: WT_CSS,
  });
}

function drawWtWidget(status) {
  // status: 'playing' | 'paused' | 'muted' | 'offline' | 'required'
  if (status === 'offline') {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    return;
  }
  if (status === 'required') {
    ensureWtFrame();
    const body = wtFrame.body;
    body.replaceChildren();
    const row = document.createElement('div'); row.className = 'row';
    const lbl = document.createElement('span'); lbl.className = 'lbl';
    lbl.textContent = '🎟 Like & comment to earn';
    row.append(lbl);
    body.append(row);
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = 'Required for watchtime';
    body.append(sub);
    wtFrame.setPill('🎟');
    return;
  }
  ensureWtFrame();
  const body = wtFrame.body;
  body.replaceChildren();

  const row = document.createElement('div'); row.className = 'row';
  const lbl = document.createElement('span'); lbl.className = 'lbl';
  const amt = document.createElement('span'); amt.className = 'amt';

  if (status === 'playing') {
    lbl.textContent = '▶ Watching';
    amt.textContent = wtEarned > 0 ? `+${wtEarned} earned` : 'earning…';
  } else if (status === 'muted') {
    lbl.textContent = '🔇 Unmute to earn';
    amt.textContent = '';
  } else {
    lbl.textContent = '⏸ Paused';
    amt.textContent = '';
  }

  row.append(lbl, amt);
  body.append(row);

  if (status === 'playing' && wtEarned > 0) {
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = 'Keep tab open & unmuted';
    body.append(sub);
  }

  wtFrame.setPill(wtEarned > 0 ? `+${wtEarned}` : '🎟');
}

function ensureFrame() {
  if (frame) return;
  // Bottom-right, lifted clear of Kick's chat input box.
  frame = self.RGCFrame.mount({ key: 'kick', title: 'Live Vote', width: 300, pos: { bottom: 104, right: 16 }, css: POLL_CSS });
}

function render(poll, tally, mine, connected) {
  ensureFrame();
  const total = (tally || []).reduce((a, b) => a + b, 0);
  const body = frame.body; body.replaceChildren();
  const q = document.createElement('div'); q.className = 'q'; q.textContent = poll.question || 'Vote'; body.append(q);
  (poll.options || []).forEach((label, idx) => {
    const c = (tally && tally[idx]) || 0;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'opt' + (mine === idx ? ' mine' : '');
    const fill = document.createElement('span'); fill.className = 'fill'; fill.style.width = (total > 0 ? Math.round(c / total * 100) : 0) + '%'; b.append(fill);
    if (mine === idx) { const ck = document.createElement('span'); ck.className = 'check'; ck.textContent = '✓'; b.append(ck); }
    const lt = document.createElement('span'); lt.className = 'ltext'; lt.textContent = label; b.append(lt);
    const cn = document.createElement('span'); cn.className = 'cnt'; cn.textContent = String(c); b.append(cn);
    b.addEventListener('click', () => vote(idx, connected));
    body.append(b);
  });
  const hint = document.createElement('div'); hint.className = 'hint';
  hint.textContent = connected ? (mine != null ? 'Tap another to change your vote' : 'Tap to vote') : 'Connect with Kick (extension popup) to vote';
  body.append(hint);
  frame.setPill(mine != null ? 'Voted ✓' : 'Vote');
}

function vote(idx, connected) {
  if (!connected || shownPollId == null) return;
  optimisticIdx = idx;
  chrome.runtime.sendMessage({ type: 's2PollVote', pollId: shownPollId, optionIdx: idx }).catch(() => {});
  tick();
}

function clear() { if (frame) { frame.destroy(); frame = null; } shownPollId = null; optimisticIdx = null; }

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

// --- Kick watchtime: send checkin every 60s while stream is playing ---
async function wtTick() {
  const v = document.querySelector('video');
  const live = v && !v.paused && !v.ended && v.currentTime > 0;
  const audible = !!(v && !v.muted && v.volume > 0);
  const visible = document.visibilityState === 'visible';

  wtPlaying = !!(live && audible && visible);
  wtMuted = !!(live && visible && !audible);

  if (!wtPlaying) {
    drawWtWidget(wtMuted ? 'muted' : 'paused');
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 's2KickCheckin' }).catch(() => null);
  if (!result) return;

  // Hide the widget when there's nothing to earn: stream offline OR the admin has the
  // watchtime master switch off. Without the watchtime_disabled case the card would keep
  // saying "▶ Watching / earning…" while no tickets are actually being credited.
  if (result.reason === 'stream_offline' || result.reason === 'watchtime_disabled') {
    drawWtWidget('offline');
    return;
  }
  if (result.reason === 'engagement_required') {
    drawWtWidget('required');
    return;
  }
  // Accumulate the per-checkin delta locally. The server's totalEarned is now a
  // per-epoch-hour figure (shared cap with chat watchtime) and resets each hour,
  // so mirroring it would make this counter jump backwards. Summing `awarded`
  // keeps it a monotonic session total, matching what the server actually credited.
  if (result.ok && result.awarded > 0) {
    wtEarned += result.awarded;
  }
  drawWtWidget('playing');
}

setInterval(wtTick, 60_000);
wtTick(); // run once on load so widget appears immediately if stream is live
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wtTick();
});
