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
  if (!poll) return clear();
  if (poll.id !== shownPollId) { shownPollId = poll.id; optimisticIdx = null; }
  const serverMine = data.myVote == null ? null : Number(data.myVote);
  if (optimisticIdx != null && serverMine === optimisticIdx) optimisticIdx = null;
  const mine = optimisticIdx != null ? optimisticIdx : serverMine;
  if (frame.setTitle) frame.setTitle('Live Vote');
  render(poll, data.tally || [], mine, !!data.connected);
}

setInterval(tick, (C && C.POLL_FAST_MS) || 5000);
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
