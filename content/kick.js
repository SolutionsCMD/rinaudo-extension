// Runs on kick.com/mizkif*. Asks the SW for the active S2 poll (~5s) and casts
// votes — the SW does the network (page CSP blocks content-script fetches).
// Live tally, one changeable vote. The card chrome (drag/collapse/position) is
// provided by RGCFrame (content/widget-frame.js).
const C = self.S2;

// Vote card visibility pref (default on). Updated instantly when toggled in popup.
let voteCardEnabled = true;
chrome.storage.local.get('widgetPrefs').then(({ widgetPrefs }) => {
  voteCardEnabled = (widgetPrefs || {}).voteCard !== false;
}).catch(() => {});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'rgcWidgetPrefs') return;
  chrome.storage.local.get('widgetPrefs').then(({ widgetPrefs }) => {
    voteCardEnabled = (widgetPrefs || {}).voteCard !== false;
    if (!voteCardEnabled) clear();
  }).catch(() => {});
});

// --- Watchtime widget state ---
let wtFrame = null;    // second RGCFrame, independent of the poll frame
let wtHourEarned = 0;  // server-credited tickets this epoch-hour (chat + extension combined)
let wtPerHour = 0;     // this user's hourly rate, from the server
let wtSessionEarned = 0; // tickets THIS page session (sum of per-checkin awards)
let wtOffline = false; // last checkin said stream_offline / watchtime_disabled
let wtConnect = false; // last checkin said not_connected (show connect prompt)
let wtPlaying = false;
let wtMuted = false;
// Anti-flicker: Kick's player momentarily reads paused/muted during buffering,
// ad stitching and video-element swaps. A new player status must hold for two
// consecutive 5s reads before the widget flips to it. Server states (offline/
// connect/required) stay immediate — they only change on the 60s checkin.
let wtShownStatus = null;
let wtCandStatus = null, wtCandCount = 0;
let wtRenderKey = '';  // skip DOM rebuilds when nothing visible changed
// Admin "hide the widget" switch (server flag via the SW's 30s status poll).
// Hiding NEVER stops earning — checkins still run, the card just isn't drawn.
let wtHidden = false;
chrome.storage.local.get('watchWidgetHidden').then(({ watchWidgetHidden }) => {
  wtHidden = watchWidgetHidden === true;
  if (wtHidden && wtFrame) { wtFrame.destroy(); wtFrame = null; wtRenderKey = ''; }
}).catch(() => {});
chrome.storage.onChanged.addListener((ch) => {
  if (!ch.watchWidgetHidden) return;
  wtHidden = ch.watchWidgetHidden.newValue === true;
  if (wtHidden && wtFrame) { wtFrame.destroy(); wtFrame = null; wtRenderKey = ''; }
});

const WT_CSS = `
  .row{display:flex;justify-content:space-between;align-items:center;font-size:13px}
  .lbl{color:#F4EFE3}
  .amt{color:#86D6A4;font-variant-numeric:tabular-nums}
  .sub{font-size:11px;color:#8A8678;margin-top:4px}`;

let frame = null, shownPollId = null, optimisticIdx = null;
// Amount vote ("how much do we buy"): the member's own answer is held optimistically the
// same way a poll option is, so tapping a preset lights up without waiting for the tick.
let shownAmountId = null, optimisticAmount = null, amountDraft = '', lastAmountClosesAt = null;

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
  .hint{font-size:10px;letter-spacing:.06em;color:#8A8678;margin-top:10px;text-transform:uppercase}
  /* ── the amount vote. Same palette and chrome as the poll above it: the average is
     the answer, so it is the biggest thing on the card, with the presets reading as
     poll options because that is exactly what they are. ── */
  .avg{font-family:ui-monospace,monospace;font-size:30px;font-weight:800;text-align:center;color:#F4EFE3;line-height:1.05;margin:2px 0 1px;font-variant-numeric:tabular-nums}
  .avgsub{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#8A8678;margin-bottom:9px}
  .avgsub b{color:#C9A766;font-variant-numeric:tabular-nums;font-size:13px}
  .avgsub b.hot{color:#E8B339}
  .bar{position:relative;height:4px;border-radius:3px;background:rgba(244,239,227,.10);overflow:hidden;margin:0 0 10px}
  .bar i{position:absolute;left:0;top:0;bottom:0;background:#C9A766;border-radius:3px;transition:width 1s linear}
  .presets{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .amt{position:relative;padding:9px 8px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;cursor:pointer;font:inherit;font-family:ui-monospace,monospace;font-size:13px;text-align:center}
  .amt:hover{border-color:rgba(201,167,102,.4)}
  .amt.mine{border-color:#86D6A4;background:rgba(134,214,164,.10);font-weight:700}
  .amtrow{display:flex;gap:6px;margin-top:6px}
  .amtin{flex:1;min-width:0;padding:9px 10px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;font:inherit;font-family:ui-monospace,monospace;font-size:13px}
  .amtin:focus{outline:none;border-color:rgba(201,167,102,.5)}
  .amtgo{flex:none;padding:9px 14px;border:1px solid #C9A766;border-radius:8px;background:rgba(201,167,102,.14);color:#F4EFE3;font:inherit;font-weight:700;font-size:12px;cursor:pointer}
  .amtgo:hover{background:rgba(201,167,102,.24)}
  .mineline{font-size:11px;color:#86D6A4;text-align:center;margin-top:8px}
  .sep{height:1px;background:rgba(201,167,102,.16);margin:13px 0 12px}`;

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
  if (wtHidden) {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtRenderKey = '';
    return;
  }
  if (status === 'offline') {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtRenderKey = '';
    return;
  }
  // Nothing new to show → leave the DOM alone (kills the 5s visible rebuild).
  const key = `${status}|${wtHourEarned}|${wtPerHour}|${wtSessionEarned}`;
  if (key === wtRenderKey && wtFrame) return;
  wtRenderKey = key;

  if (status === 'required' || status === 'connect') {
    ensureWtFrame();
    const body = wtFrame.body;
    body.replaceChildren();
    const row = document.createElement('div'); row.className = 'row';
    const lbl = document.createElement('span'); lbl.className = 'lbl';
    lbl.textContent = status === 'connect' ? '🎟 Connect to earn' : '🎟 Like & comment to earn';
    row.append(lbl);
    body.append(row);
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = status === 'connect'
      ? 'Open the extension popup and connect with Kick'
      : 'Required for watchtime';
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

  const capped = wtPerHour > 0 && wtHourEarned >= wtPerHour;
  if (status === 'playing') {
    lbl.textContent = capped ? '✓ Watching' : '▶ Watching';
    amt.textContent = wtHourEarned > 0 ? `+${wtHourEarned} this hour` : 'earning…';
  } else if (status === 'muted') {
    lbl.textContent = '🔇 Unmute to earn';
    amt.textContent = wtHourEarned > 0 ? `+${wtHourEarned} this hour` : '';
  } else {
    lbl.textContent = '⏸ Paused';
    amt.textContent = wtHourEarned > 0 ? `+${wtHourEarned} this hour` : '';
  }

  row.append(lbl, amt);
  body.append(row);

  // Session total — everything this page session has banked, across hours.
  if (wtSessionEarned > 0) {
    const srow = document.createElement('div'); srow.className = 'row';
    const slbl = document.createElement('span'); slbl.className = 'lbl';
    slbl.textContent = '🎟 This session';
    const samt = document.createElement('span'); samt.className = 'amt';
    samt.textContent = `+${wtSessionEarned}`;
    srow.append(slbl, samt);
    body.append(srow);
  }

  if (status === 'playing') {
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = capped
      ? `Hourly max earned (${wtPerHour}/hr), resets next hour`
      : 'Keep tab open & unmuted';
    body.append(sub);
  }

  wtFrame.setPill(capped ? '✓' : wtHourEarned > 0 ? `+${wtHourEarned}` : '🎟');
}

function ensureFrame() {
  if (frame) return;
  // Bottom-right, lifted clear of Kick's chat input box. Stake panel shares the
  // frame, so its stylesheet rides along with the poll sheet.
  frame = self.RGCFrame.mount({ key: 'kick', title: 'Live Vote', width: 300, pos: { bottom: 104, right: 16 }, css: POLL_CSS + (self.RGCStake ? self.RGCStake.CSS : '') });
}

// Round actions go through the SW (bearer lives there), then refresh.
function roundAction(action, ticker, amount) {
  chrome.runtime.sendMessage({ type: 's2RoundAction', action, ticker, amount }).catch(() => {});
  tick();
}

// Stake round panel (the desk's stake UI 1:1 via shared vote/stake-panel.js).
// Returns true when a round is open and the frame shows it.
function drawRound(data) {
  if (!self.RGCStake || !data || !data.round) return false;
  // A round sits in 'nominating' for hours between stakes, so showing the suggestion
  // box there put a card on the stream essentially all the time (and a "SUGGESTIONS /
  // Stake" bar once minimised). The on-stream card is now reserved for when there's an
  // actual wager to place; suggesting still works from the extension's toolbar popup.
  // Bail BEFORE ensureFrame so the frame never mounts (mounting then clearing on the
  // next tick would flash the card on and off every few seconds).
  if (data.round.status === 'nominating') return false;
  ensureFrame();
  const status = data.round.status;
  if (frame.setTitle) frame.setTitle(status === 'nominating' ? 'Suggestions' : status === 'joining' ? 'Final Window' : 'Live Stake');
  const shown = self.RGCStake.render(frame.body, data, {
    nominate: (t) => roundAction('nominate', t),
    stake: (t, n) => roundAction('stake', t, n),
    join: (n) => roundAction('join', undefined, n),
  });
  if (shown) frame.setPill('🎟 Stake');
  return shown;
}

const money = (cents) => '$' + Math.round(cents / 100).toLocaleString('en-US');
/** $25k above a grand, plain dollars below it. */
const shortMoney = (cents) => cents >= 100000 ? '$' + Math.round(cents / 100 / 1000) + 'k' : money(cents);

/** The chat parser's shapes, for the card's own box: 25k, $25k, 12.5k, 1m, 25000, $500.
 *  A plain number here is dollars as typed — this box is unambiguous, unlike chat. */
function parseAmountInput(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[$,\s]/g, '');
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1000000 : 1) * 100);
}

/** Cast an amount. Clamped before it is sent: the engine REFUSES an out-of-range amount
 *  rather than clamping it (a silent clamp would move the average with a number nobody
 *  said), so the card must never be able to produce one. */
function amountVote(av, cents, connected) {
  if (!connected || shownAmountId == null) return;
  const amount = Math.min(av.maxCents, Math.max(av.minCents, Math.round(cents)));
  optimisticAmount = amount;
  amountDraft = '';
  chrome.runtime.sendMessage({ type: 's2AmountVote', sessionId: shownAmountId, amountCents: amount }).catch(() => {});
  tick();
}

/** The "how much do we buy" block, drawn into the card body. */
function drawAmountVote(body, av, mineCents, connected) {
  const open = av.status === 'open';
  const left = av.closesAt ? Math.max(0, Math.round((new Date(av.closesAt).getTime() - Date.now()) / 1000)) : null;

  const q = document.createElement('div'); q.className = 'q'; q.textContent = av.question || 'How much do we buy'; body.append(q);

  const avg = document.createElement('div'); avg.className = 'avg';
  avg.textContent = av.avgCents == null ? '···' : money(av.avgCents);
  body.append(avg);

  const sub = document.createElement('div'); sub.className = 'avgsub';
  const n = document.createElement('span'); n.textContent = av.votes + (av.votes === 1 ? ' vote' : ' votes');
  const t = document.createElement('b');
  if (!open) { t.textContent = 'final'; } else if (left === 0) { t.textContent = 'time up'; }
  else { t.textContent = left + 's'; if (left != null && left <= 10) t.className = 'hot'; }
  sub.append(n, t); body.append(sub);

  if (open && left != null) {
    const bar = document.createElement('div'); bar.className = 'bar';
    const i = document.createElement('i');
    // Drains over whatever the timer was set to, worked out from what is left and the
    // full minute, so an extended session refills rather than sitting empty.
    i.style.width = Math.max(0, Math.min(100, Math.round(left / 60 * 100))) + '%';
    bar.append(i); body.append(bar);
  }

  if (open && left !== 0) {
    // A $0 floor makes a poor button, so the presets start where people actually aim.
    const presets = [1000000, 2500000, 5000000, av.maxCents]
      .filter((c, idx, a) => c >= av.minCents && c <= av.maxCents && a.indexOf(c) === idx);
    const grid = document.createElement('div'); grid.className = 'presets';
    presets.forEach((c) => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'amt' + (mineCents === c ? ' mine' : '');
      b.textContent = shortMoney(c);
      b.addEventListener('click', () => amountVote(av, c, connected));
      grid.append(b);
    });
    body.append(grid);

    const row = document.createElement('div'); row.className = 'amtrow';
    const input = document.createElement('input'); input.className = 'amtin'; input.type = 'text';
    input.placeholder = 'or type an amount';
    input.value = amountDraft;
    input.addEventListener('input', () => { amountDraft = input.value; });
    const send = () => {
      const cents = parseAmountInput(input.value);
      if (cents === null) return;
      amountVote(av, cents, connected);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    const go = document.createElement('button'); go.type = 'button'; go.className = 'amtgo'; go.textContent = 'Vote';
    go.addEventListener('click', send);
    row.append(input, go); body.append(row);
  }

  const line = document.createElement('div');
  if (mineCents != null) {
    line.className = 'mineline';
    line.textContent = 'You said ' + money(mineCents) + (open ? ' (tap to change)' : '');
  } else {
    line.className = 'hint';
    line.textContent = connected
      ? (open ? 'Tap an amount, or type one in chat' : 'Voting closed')
      : 'Connect with Kick (extension popup) to vote';
  }
  body.append(line);
}

function render(poll, tally, mine, connected, keep) {
  ensureFrame();
  const total = (tally || []).reduce((a, b) => a + b, 0);
  const body = frame.body;
  if (!keep) body.replaceChildren();
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

function clear() {
  if (frame) { frame.destroy(); frame = null; }
  shownPollId = null; optimisticIdx = null;
  shownAmountId = null; optimisticAmount = null; amountDraft = ''; lastAmountClosesAt = null;
}

async function tick() {
  // SPA guard + vote-card toggle: clear when navigated away or user has disabled the widget.
  if (!location.pathname.toLowerCase().startsWith('/mizkif') || !voteCardEnabled) {
    clear();
    return;
  }
  // Nobody is looking at a hidden tab, so don't spend requests on it. The
  // visibilitychange handler below ticks immediately when the tab comes back,
  // so the card is current by the time it is on screen.
  if (document.visibilityState === 'hidden') return;
  // A live stake round takes the card over (it reverts to polls when it ends).
  const rd = await chrome.runtime.sendMessage({ type: 's2Round' }).catch(() => null);
  if (rd && drawRound(rd)) return;
  const data = await chrome.runtime.sendMessage({ type: 's2Poll' }).catch(() => null);
  const poll = data && data.poll;
  const av = data && data.amountVote;
  if (!poll && !av) return clear();

  // Both can be live at once. They share one card, amount vote on top, in the same
  // order the stream overlay stacks them — a member seeing both places should not have
  // to work out which is which.
  ensureFrame();
  const connected = !!(data && data.connected);
  const body = frame.body; body.replaceChildren();

  if (av) {
    if (av.id !== shownAmountId) { shownAmountId = av.id; optimisticAmount = null; amountDraft = ''; }
    const serverMineAmt = data.myAmountCents == null ? null : Number(data.myAmountCents);
    // Drop the optimistic value once the server agrees, so a later change is not fought.
    if (optimisticAmount != null && serverMineAmt === optimisticAmount) optimisticAmount = null;
    const mineAmt = optimisticAmount != null ? optimisticAmount : serverMineAmt;
    lastAmountClosesAt = av.status === 'open' ? av.closesAt : null;
    drawAmountVote(body, av, mineAmt, connected);
    if (poll) { const sep = document.createElement('div'); sep.className = 'sep'; body.append(sep); }
  } else {
    shownAmountId = null; optimisticAmount = null; lastAmountClosesAt = null;
  }

  if (poll) {
    if (poll.id !== shownPollId) { shownPollId = poll.id; optimisticIdx = null; }
    const serverMine = data.myVote == null ? null : Number(data.myVote);
    if (optimisticIdx != null && serverMine === optimisticIdx) optimisticIdx = null;
    const mine = optimisticIdx != null ? optimisticIdx : serverMine;
    render(poll, data.tally || [], mine, connected, true);
  } else {
    shownPollId = null; optimisticIdx = null;
  }

  if (frame.setTitle) frame.setTitle(av && !poll ? 'How Much' : 'Live Vote');
  if (av && av.status === 'open') frame.setPill('$ Vote');
}

// The base cadence is deliberately slow — each tick costs the engine a request per
// viewer. But an amount vote runs for about a minute and its average is the whole
// point, so while one is open the card refreshes twice as often, and drops straight
// back afterwards. The countdown itself ticks locally every second (below), so the
// timer is smooth regardless.
let tickTimer = null;
function scheduleTick() {
  if (tickTimer) clearTimeout(tickTimer);
  const base = (C && C.POLL_FAST_MS) || 10000;
  const ms = shownAmountId != null ? Math.max(4000, Math.round(base / 2)) : base;
  tickTimer = setTimeout(() => { tick().finally(scheduleTick); }, ms);
}
scheduleTick();

// Local countdown: redraw the timer and the bar every second from what the last tick
// brought back. No network, and only while a session is actually open.
setInterval(() => {
  if (shownAmountId == null || !frame) return;
  const b = frame.body.querySelector('.avgsub b');
  const bar = frame.body.querySelector('.bar i');
  if (!b || !lastAmountClosesAt) return;
  const left = Math.max(0, Math.round((new Date(lastAmountClosesAt).getTime() - Date.now()) / 1000));
  b.textContent = left === 0 ? 'time up' : left + 's';
  b.className = left <= 10 ? 'hot' : '';
  if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(left / 60 * 100))) + '%';
}, 1000);

tick();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

// --- Kick watchtime: send checkin every 60s while stream is playing ---

// Kick pages can hold several <video> elements (sidebar hover-previews, clip
// players) that are muted autoplay. querySelector('video') used to grab whichever
// came first in the DOM, so the widget read mute/pause state off the wrong player
// and told unmuted viewers to unmute. The live player is by far the largest —
// pick the biggest rendered video instead.
function mainVideo() {
  let best = null, bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { best = v; bestArea = area; }
  }
  return best;
}

// Local player status. Cheap (no network) — safe to poll frequently so the
// widget reacts to mute/pause changes in seconds, not at the next 60s checkin.
function wtStatus() {
  const v = mainVideo();
  const live = v && !v.paused && !v.ended && v.currentTime > 0;
  const audible = !!(v && !v.muted && v.volume > 0);
  const visible = document.visibilityState === 'visible';
  wtPlaying = !!(live && audible && visible);
  wtMuted = !!(live && visible && !audible);
  return wtPlaying ? 'playing' : wtMuted ? 'muted' : 'paused';
}

// Player-status changes must hold for 2 consecutive 5s reads before the widget
// flips — a single buffering blip or element swap no longer flickers the card.
// First paint adopts immediately so the widget never sits blank on load.
function wtStableStatus(raw) {
  if (wtShownStatus === null) {
    wtShownStatus = raw; wtCandStatus = null; wtCandCount = 0;
    return wtShownStatus;
  }
  if (raw === wtShownStatus) { wtCandStatus = null; wtCandCount = 0; return wtShownStatus; }
  if (raw === wtCandStatus) {
    wtCandCount += 1;
    if (wtCandCount >= 2) { wtShownStatus = raw; wtCandStatus = null; wtCandCount = 0; }
  } else {
    wtCandStatus = raw; wtCandCount = 1;
  }
  return wtShownStatus;
}

// Fast UI-only refresh: redraw from local player state, no network.
function wtUiTick() {
  if (!location.pathname.toLowerCase().startsWith('/mizkif')) {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtShownStatus = null; wtRenderKey = '';
    return;
  }
  if (wtOffline) { drawWtWidget('offline'); return; }
  if (wtConnect) { drawWtWidget('connect'); return; }
  drawWtWidget(wtStableStatus(wtStatus()));
}

async function wtTick() {
  // Kick is a SPA: the content script survives client-side navigation to other channels.
  // Guard so we only earn (and show the widget) while actually on Mizkif's channel.
  if (!location.pathname.toLowerCase().startsWith('/mizkif')) {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtShownStatus = null; wtRenderKey = '';
    return;
  }

  const status = wtStatus();
  if (!wtPlaying) {
    if (!wtOffline && !wtConnect) drawWtWidget(wtStableStatus(status));
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 's2KickCheckin' }).catch(() => null);
  if (!result) return;

  // Hide the widget when there's nothing to earn: stream offline OR the admin has the
  // watchtime master switch off. Without the watchtime_disabled case the card would keep
  // saying "▶ Watching / earning…" while no tickets are actually being credited.
  if (result.reason === 'stream_offline' || result.reason === 'watchtime_disabled') {
    wtOffline = true;
    drawWtWidget('offline');
    return;
  }
  wtOffline = false;
  if (result.reason === 'not_connected') {
    wtConnect = true;
    drawWtWidget('connect');
    return;
  }
  wtConnect = false;
  if (result.reason === 'engagement_required') {
    drawWtWidget('required');
    return;
  }
  // Mirror the server's per-hour truth. totalEarned counts everything credited this
  // epoch-hour (chat watchtime + extension combined) — chatting earns the full hourly
  // rate up front, so extension checkins often award 0 while the viewer HAS earned.
  // Showing the hour total (and a "max earned" state) instead of a session sum stops
  // the widget from sitting on "earning…" forever for active chatters.
  if (result.ok) {
    wtHourEarned = Number(result.totalEarned) || 0;
    wtPerHour = Number(result.perHour) || 0;
    // Session total: bank whatever THIS checkin actually awarded. Using `awarded`
    // (not the hour-total delta) means chat-earned tickets never double-count and
    // the hour rollover needs no special case.
    wtSessionEarned += Number(result.awarded) || 0;
  }
  drawWtWidget(wtStableStatus(status));
}

setInterval(wtTick, 60_000);
setInterval(wtUiTick, 5_000);
wtTick(); // run once on load so widget appears immediately if stream is live
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wtTick();
});
