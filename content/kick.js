const C = self.S2;


try {
  for (const el of document.querySelectorAll('#rgc-frame-kick, #rgc-frame-kick-watch, [id^="rgc-ring-"], #rgc-hud, #rgc-hud-dock, #rgc-kick-anchor')) el.remove();
} catch (e) {   }

let kickDead = false;
const kickTimers = [];
function kickMsg(msg) {
  if (kickDead) return Promise.resolve(null);
  let p;
  try {
    if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') throw new Error('Extension context invalidated.');
    p = chrome.runtime.sendMessage(msg);
  } catch (e) {
    kickTeardown();
    return Promise.resolve(null);
  }
  return Promise.resolve(p).catch((e) => {
    if (/context invalidated/i.test(String((e && e.message) || e))) kickTeardown();
    return null;
  });
}
function kickTeardown() {
  if (kickDead) return;
  kickDead = true;
  for (const t of kickTimers) { clearInterval(t); clearTimeout(t); }
  try { if (tickTimer) clearTimeout(tickTimer); } catch (e) {   }
  try { clear(); } catch (e) {   }
  try { if (wtFrame) wtFrame.destroy(); wtFrame = null; } catch (e) {   }
  try { kickTotal.teardown(); } catch (e) {   }
}

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

let wtFrame = null;
let wtHourEarned = 0;
let wtPerHour = 0;
let wtSessionEarned = 0;
let wtOffline = false;
let wtConnect = false;
let wtGate = false;
let wtPlaying = false;
let wtMuted = false;
let wtShownStatus = null;
let wtCandStatus = null, wtCandCount = 0;
let wtRenderKey = '';
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
let shownAmountId = null, optimisticAmount = null, amountDraft = '', lastAmountClosesAt = null;
let shownBattleId = null, battleDraft = '', lastBattleClosesAt = null, battleBusy = false;
let battleStatusMsg = '';
let amountStatusMsg = '';

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
  .avg{font-family:ui-monospace,monospace;font-size:30px;font-weight:800;text-align:center;color:#F4EFE3;line-height:1.05;margin:2px 0 1px;font-variant-numeric:tabular-nums}
  .avgsub{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#8A8678;margin-bottom:9px}
  .avgsub b{color:#C9A766;font-variant-numeric:tabular-nums;font-size:13px}
  .avgsub b.hot{color:#E8B339}
  .avbar{position:relative;height:4px;border-radius:3px;background:rgba(244,239,227,.10);overflow:hidden;margin:0 0 10px}
  .avbar i{position:absolute;left:0;top:0;bottom:0;width:100%;background:#C9A766;transform-origin:0 50%;transition:transform 1s linear}
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
  .sep{height:1px;background:rgba(201,167,102,.16);margin:13px 0 12px}
  .bsides{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 8px}
  .bside{padding:9px 8px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;cursor:pointer;font:inherit;text-align:center}
  .bside:hover{border-color:rgba(201,167,102,.4)}
  .bside.mine{border-color:#86D6A4;background:rgba(134,214,164,.10)}
  .bside .bnm{font-weight:700;font-size:13px}
  .bside .bpot{display:block;margin-top:3px;font-family:ui-monospace,monospace;font-size:11px;color:#A9A697}
  .brow{display:flex;gap:6px}
  .bin{flex:1;min-width:0;padding:8px 10px;border:1px solid rgba(244,239,227,.12);border-radius:8px;background:rgba(255,255,255,.02);color:#F4EFE3;font:inherit;font-family:ui-monospace,monospace;font-size:13px}
  .ball{flex:none;padding:8px 12px;border:1px solid rgba(244,239,227,.18);border-radius:8px;background:none;color:#F4EFE3;font:inherit;font-size:12px;cursor:pointer}
  .bmine{font-size:11px;color:#86D6A4;text-align:center;margin-top:8px}
  .bstatus{font-size:11px;color:#F0A15E;text-align:center;margin-top:8px}`;

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
  const key = `${status}|${wtHourEarned}|${wtPerHour}|${wtSessionEarned}`;
  if (key === wtRenderKey && wtFrame) return;
  wtRenderKey = key;

  if (status === 'required' || status === 'connect' || status === 'gate') {
    ensureWtFrame();
    const body = wtFrame.body;
    body.replaceChildren();
    const row = document.createElement('div'); row.className = 'row';
    const lbl = document.createElement('span'); lbl.className = 'lbl';
    lbl.textContent = status === 'connect' ? '🎟 Connect to earn'
      : status === 'gate' ? '🎟 Link Kick to earn' : '🎟 Like & comment to earn';
    row.append(lbl);
    body.append(row);
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = status === 'connect'
      ? 'Open the extension popup and connect with Kick'
      : status === 'gate' ? 'Open the extension menu to link it.' : 'Required for watchtime';
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
  frame = self.RGCFrame.mount({ key: 'kick', title: 'Live Vote', width: 300, pos: { bottom: 104, right: 16 }, css: POLL_CSS + (self.RGCStake ? self.RGCStake.CSS : '') });
}

function roundAction(action, ticker, amount) {
  kickMsg({ type: 's2RoundAction', action, ticker, amount }).then(() => kickTotal.afterAction());
  tick();
}

function drawRound(data) {
  if (!self.RGCStake || !data || !data.round) return false;
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
const tix = (n) => Number(n || 0).toLocaleString('en-US');

function battleStake(sideIdx, tickets) {
  if (battleBusy || shownBattleId == null) return;
  battleBusy = true;
  battleStatusMsg = '';
  kickMsg({ type: 's2AiBattleStake', battleId: shownBattleId, sideIdx, tickets })
    .then((r) => {
      if (r && r.ok) { battleStatusMsg = ''; return; }
      const reason = r && r.reason;
      battleStatusMsg = reason === 'insufficient' ? 'Not enough tickets for that'
        : reason === 'closed' || reason === 'not_staking' ? 'Staking has closed'
        : reason === 'not_connected' ? 'Connect the extension (its icon) to stake'
        : 'That did not go through, try again';
    })
    .catch(() => { battleStatusMsg = 'That did not go through, try again'; })
    .finally(() => { battleBusy = false; battleDraft = ''; tick(); kickTotal.afterAction(); });
}

function drawBattle(body, b, mine) {
  const left = b.closesAt
    ? Math.max(0, Math.round((new Date(b.closesAt).getTime() - Date.now()) / 1000)) : null;

  const q = document.createElement('div'); q.className = 'q';
  q.textContent = b.name || 'Which AI wins?';
  body.append(q);

  const sub = document.createElement('div'); sub.className = 'avgsub';
  const n = document.createElement('span');
  n.textContent = (b.sides[0].backers + b.sides[1].backers) + ' staked';
  const t = document.createElement('b');
  t.classList.add('btimer');
  if (left === 0) t.textContent = 'closed';
  else { t.textContent = left + 's'; if (left != null && left <= 10) t.classList.add('hot'); }
  sub.append(n, t); body.append(sub);

  const grid = document.createElement('div'); grid.className = 'bsides';
  b.sides.forEach((side, i) => {
    const btn = document.createElement('button'); btn.type = 'button';
    btn.className = 'bside' + (mine && mine.sideIdx === i ? ' mine' : '');
    const nm = document.createElement('span'); nm.className = 'bnm'; nm.textContent = side.label;
    const pot = document.createElement('span'); pot.className = 'bpot';
    pot.textContent = tix(side.pot) + ' 🎟';
    btn.append(nm, pot);
    btn.addEventListener('click', () => {
      if (battleDraft === 'all') { battleStake(i, 'all'); return; }
      const amount = parseInt(battleDraft, 10);
      if (!Number.isInteger(amount) || amount < 1) {
        battleStatusMsg = 'Type an amount (or All) first, then pick a side';
        battleDraft = ''; tick(); return;
      }
      battleStake(i, amount);
    });
    grid.append(btn);
  });
  body.append(grid);

  if (left !== 0) {
    const row = document.createElement('div'); row.className = 'brow';
    const input = document.createElement('input'); input.className = 'bin'; input.type = 'text';
    input.placeholder = 'tickets, then pick a side';
    input.value = battleDraft;
    input.addEventListener('input', () => {
      battleDraft = input.value.toLowerCase() === 'all' ? 'all' : input.value.replace(/[^0-9]/g, '');
    });
    const all = document.createElement('button'); all.type = 'button'; all.className = 'ball';
    all.textContent = 'All';
    all.addEventListener('click', () => {
      if (mine && mine.sideIdx != null) battleStake(mine.sideIdx, 'all');
      else { battleDraft = 'all'; tick(); }
    });
    row.append(input, all); body.append(row);
  }

  if (battleStatusMsg) {
    const st = document.createElement('div'); st.className = 'bstatus'; st.textContent = battleStatusMsg;
    body.append(st);
  }
  const line = document.createElement('div');
  if (mine) {
    line.className = 'bmine';
    line.textContent = 'You staked ' + tix(mine.tickets) + ' on ' + b.sides[mine.sideIdx].label;
  } else {
    line.className = 'hint';
    line.textContent = left === 0 ? 'Staking is closed' : 'Tickets are spent either way';
  }
  body.append(line);
}
const shortMoney = (cents) => cents >= 100000 ? '$' + Math.round(cents / 100 / 1000) + 'k' : money(cents);

function parseAmountInput(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[$,\s]/g, '');
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1000000 : 1) * 100);
}

function amountVote(av, cents, connected) {
  if (!connected || shownAmountId == null) return;
  const amount = Math.min(av.maxCents, Math.max(av.minCents, Math.round(cents)));
  optimisticAmount = amount;
  amountDraft = '';
  amountStatusMsg = '';
  kickMsg({ type: 's2AmountVote', sessionId: shownAmountId, amountCents: amount })
    .then((r) => {
      if (r && r.ok) return;
      optimisticAmount = null;
      amountStatusMsg = 'That did not count, tap it again';
    })
    .catch(() => { optimisticAmount = null; amountStatusMsg = 'That did not count, tap it again'; })
    .finally(() => { tick(); kickTotal.afterAction(); });
  tick();
}

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
  t.classList.add('atimer');
  if (!open) { t.textContent = 'final'; } else if (left === 0) { t.textContent = 'time up'; }
  else { t.textContent = left + 's'; if (left != null && left <= 10) t.classList.add('hot'); }
  sub.append(n, t); body.append(sub);

  if (open && left != null) {
    const bar = document.createElement('div'); bar.className = 'avbar';
    const i = document.createElement('i');
    i.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / 60)).toFixed(3) + ')';
    bar.append(i); body.append(bar);
  }

  if (open && left !== 0) {
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
  kickMsg({ type: 's2PollVote', pollId: shownPollId, optionIdx: idx }).then(() => kickTotal.afterAction());
  tick();
}

function clear() {
  if (frame) { frame.destroy(); frame = null; }
  shownPollId = null; optimisticIdx = null;
  shownAmountId = null; optimisticAmount = null; amountDraft = ''; lastAmountClosesAt = null;
  shownBattleId = null; battleDraft = ''; lastBattleClosesAt = null;
}

async function tick() {
  if (kickDead) return;
  if (!location.pathname.toLowerCase().startsWith('/mizkif') || !voteCardEnabled) {
    clear();
    return;
  }
  if (document.visibilityState === 'hidden') return;
  if (frame && frame.body) {
    const root = frame.body.getRootNode ? frame.body.getRootNode() : document;
    const ae = root.activeElement;
    if (ae && ae.tagName === 'INPUT' && frame.body.contains(ae)) return;
  }
  const rd = await kickMsg({ type: 's2Round' });
  if (kickDead) return;
  if (rd && drawRound(rd)) return;
  const data = await kickMsg({ type: 's2Poll' });
  if (kickDead) return;
  const poll = data && data.poll;
  const av = data && data.amountVote;
  const battle = data && data.aiBattle;
  if (!poll && !av && !battle) return clear();

  ensureFrame();
  const connected = !!(data && data.connected);
  const body = frame.body; body.replaceChildren();

  if (battle) {
    if (battle.id !== shownBattleId) { shownBattleId = battle.id; battleDraft = ''; }
    lastBattleClosesAt = battle.closesAt || null;
    drawBattle(body, battle, data.myBattleStake || null);
    if (av || poll) { const sep = document.createElement('div'); sep.className = 'sep'; body.append(sep); }
  } else {
    shownBattleId = null; battleDraft = ''; lastBattleClosesAt = null;
  }

  if (av) {
    if (av.id !== shownAmountId) { shownAmountId = av.id; optimisticAmount = null; amountDraft = ''; }
    const serverMineAmt = data.myAmountCents == null ? null : Number(data.myAmountCents);
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

  if (frame.setTitle) frame.setTitle(battle ? 'AI Battle' : av && !poll ? 'How Much' : 'Live Vote');
  if (battle) frame.setPill('⚔ Stake');
  else if (av && av.status === 'open') frame.setPill('$ Vote');
}

let tickTimer = null;
function scheduleTick() {
  if (tickTimer) clearTimeout(tickTimer);
  if (kickDead) { tickTimer = null; return; }
  const base = (C && C.POLL_FAST_MS) || 10000;
  const ms = (shownAmountId != null || shownBattleId != null) ? Math.max(4000, Math.round(base / 2)) : base;
  tickTimer = setTimeout(() => { tick().finally(scheduleTick); }, ms);
}
scheduleTick();

kickTimers.push(setInterval(() => {
  if (kickDead || document.visibilityState !== 'visible') return;
  if (shownBattleId != null && frame && lastBattleClosesAt) {
    const b = frame.body.querySelector('b.btimer');
    if (b) {
      const left = Math.max(0, Math.round((new Date(lastBattleClosesAt).getTime() - Date.now()) / 1000));
      b.textContent = left === 0 ? 'closed' : left + 's';
      b.className = 'btimer' + (left <= 10 ? ' hot' : '');
    }
  }
  if (shownAmountId == null || !frame) return;
  const b = frame.body.querySelector('b.atimer');
  const bar = frame.body.querySelector('.avbar i');
  if (!b || !lastAmountClosesAt) return;
  const left = Math.max(0, Math.round((new Date(lastAmountClosesAt).getTime() - Date.now()) / 1000));
  b.textContent = left === 0 ? 'time up' : left + 's';
  b.className = 'atimer' + (left <= 10 ? ' hot' : '');
  if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / 60)).toFixed(3) + ')';
}, 1000));

tick();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });


function mainVideo() {
  let best = null, bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) { best = v; bestArea = area; }
  }
  return best;
}

function wtStatus() {
  const v = mainVideo();
  const live = v && !v.paused && !v.ended && v.currentTime > 0;
  const audible = !!(v && !v.muted && v.volume > 0);
  const visible = document.visibilityState === 'visible';
  wtPlaying = !!(live && audible && visible);
  wtMuted = !!(live && visible && !audible);
  return wtPlaying ? 'playing' : wtMuted ? 'muted' : 'paused';
}

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

function wtUiTick() {
  if (kickDead) return;
  kickTotal.tick();
  if (!location.pathname.toLowerCase().startsWith('/mizkif')) {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtShownStatus = null; wtRenderKey = '';
    return;
  }
  if (wtOffline) { drawWtWidget('offline'); return; }
  if (wtConnect) { drawWtWidget('connect'); return; }
  if (wtGate) { drawWtWidget('gate'); return; }
  drawWtWidget(wtStableStatus(wtStatus()));
}

async function wtTick() {
  if (kickDead) return;
  if (!location.pathname.toLowerCase().startsWith('/mizkif')) {
    if (wtFrame) { wtFrame.destroy(); wtFrame = null; }
    wtShownStatus = null; wtRenderKey = '';
    return;
  }

  const status = wtStatus();
  if (!wtPlaying) {
    if (!wtOffline && !wtConnect && !wtGate) drawWtWidget(wtStableStatus(status));
    return;
  }

  const result = await kickMsg({ type: 's2KickCheckin' });
  if (!result || kickDead) return;
  kickTotal.afterCheckin(result);

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
  if (result.earnGate === true || result.canEarn === false || result.reason === 'earn_gate') {
    wtGate = true;
    drawWtWidget('gate');
    return;
  }
  wtGate = false;
  if (result.reason === 'engagement_required') {
    drawWtWidget('required');
    return;
  }
  if (result.ok) {
    wtHourEarned = Number(result.totalEarned) || 0;
    wtPerHour = Number(result.perHour) || 0;
    wtSessionEarned += Number(result.awarded) || 0;
  }
  drawWtWidget(wtStableStatus(status));
}

kickTimers.push(setInterval(wtTick, 60_000));
kickTimers.push(setInterval(wtUiTick, 5_000));
wtTick();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wtTick();
});

const kickTotal = (function () {
  const POLL_MS = 45 * 1000;
  const STALE_MS = 3 * 60 * 1000;
  const CHAT_ORIGIN_MS = 90 * 1000;
  const CHAT_REFRESH_MS = 4000;
  const CHAT_REFRESH_GAP_MS = 30 * 1000;
  const ACTION_REFRESH_MS = 1500;
  const ANCHOR_ID = 'rgc-kick-anchor';
  const HIDE_WHEN = '#injected-channel-player .z-controls.top-0';

  let hud = null;
  let dockedTo = null;
  let shown = null;
  let canEarn = null;
  let connected = null;
  let gateKey = '';
  let tipped = '';
  let pollT = 0, soonT = 0, chatT = 0, layoutT = 0;
  let lastChatAt = 0, lastChatRefreshAt = 0;
  let dead = false;

  function kickTotalStep(shown, rec, staleMs) {
    if (!rec || typeof rec !== 'object') return null;
    const raw = rec.tickets;
    if (raw == null || raw === '' || typeof raw === 'boolean') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const total = Math.round(n);
    const recAt = Number(rec.at) || 0;
    if (!shown || typeof shown.tickets !== 'number' || !Number.isFinite(shown.tickets)) {
      return { total, at: recAt, gain: 0, change: 'init' };
    }
    const shownAt = Number(shown.at) || 0;
    const at = Math.max(shownAt, recAt);
    if (total === shown.tickets) return { total, at, gain: 0, change: 'same' };
    if (total < shown.tickets) return { total, at, gain: 0, change: 'down' };
    if (recAt - shownAt > staleMs) return { total, at, gain: 0, change: 'catchup' };
    return { total, at, gain: total - shown.tickets, change: 'up' };
  }

  const onChannel = () => /^\/mizkif(\/|$)/i.test(location.pathname);
  const visible = () => document.visibilityState === 'visible';
  const copy = (k, fallback) => {
    const G = self.RGCGuide;
    return (G && G.COPY && typeof G.COPY[k] === 'string' && G.COPY[k]) || fallback;
  };

  function call(name, ...args) {
    if (!hud || typeof hud[name] !== 'function') return false;
    try { hud[name](...args); return true; } catch (e) { return false; }
  }

  function ensureHud() {
    if (hud) return hud;
    if (dead || kickDead) return null;
    const G = self.RGCGuide;
    if (!G || typeof G.create !== 'function') return null;
    try { hud = G.create({ platform: 'kick', kick: true }) || null; } catch (e) { hud = null; }
    if (!hud) return null;
    dockedTo = null; gateKey = '';
    if (shown) call('setTotal', shown.tickets, { animate: false });
    place(true);
    renderGate();
    return hud;
  }

  function fallbackSpot() {
    let top = 0, left = 0;
    for (const n of document.querySelectorAll('nav')) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top <= 1) top = Math.max(top, r.bottom);
    }
    const sb = document.getElementById('sidebar-wrapper');
    if (sb) {
      const r = sb.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left <= 1) left = Math.max(left, r.right);
    }
    return { top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)) };
  }
  function offlineAnchor() {
    let a = document.getElementById(ANCHOR_ID);
    if (!a) { a = document.createElement('div'); a.id = ANCHOR_ID; }
    const root = document.body || document.documentElement;
    if (a.parentNode !== root) root.appendChild(a);
    const s = fallbackSpot();
    const cssText = 'all:initial!important;position:fixed!important;left:' + s.left + 'px!important;top:' + s.top
      + 'px!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;'
      + 'display:block!important;pointer-events:none!important;z-index:201!important;transform:none!important';
    if (a.getAttribute('data-spot') !== s.left + ',' + s.top) {
      a.style.cssText = cssText;
      a.setAttribute('data-spot', s.left + ',' + s.top);
    }
    return a;
  }
  function dropOfflineAnchor() {
    const a = document.getElementById(ANCHOR_ID);
    if (a) { try { a.remove(); } catch (e) {   } }
  }
  function touchScreen() {
    try { return !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches); } catch (e) { return false; }
  }
  function place() {
    if (!hud || dead) return;
    const v = document.getElementById('video-player');
    const player = v && v.parentElement;
    const el = player || offlineAnchor();
    if (player) dropOfflineAnchor();
    if (el !== dockedTo) {
      dockedTo = el;
      call('dock', el, player && touchScreen() ? { hideWhen: HIDE_WHEN } : undefined);
    } else {
      call('dock', el);
    }
  }

  function chatBox() {
    const el = document.getElementById('chat-input-wrapper');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  function applyRecord(rec) {
    if (dead) return;
    if (!rec || typeof rec !== 'object') { shown = null; return; }
    if (typeof rec.canEarn === 'boolean') setCanEarn(rec.canEarn);
    const s = kickTotalStep(shown, rec, STALE_MS);
    if (!s) return;
    shown = { tickets: s.total, at: s.at };
    if (!hud || s.change === 'same') return;
    if (s.gain > 0 && visible()) {
      const from = (Date.now() - lastChatAt < CHAT_ORIGIN_MS && chatBox()) || 'hud';
      if (call('cashIn', { fromEl: from, amount: s.gain, newTotal: s.total })) return;
    }
    call('setTotal', s.total, { animate: false });
  }

  function renderGate() {
    if (!hud) return;
    const key = connected === false ? 'connect' : canEarn === false ? 'link' : 'ok';
    if (key !== gateKey) {
      gateKey = key;
      if (key === 'connect') call('setCanEarn', false, { chip: copy('connectChip', 'Connect') });
      else if (key === 'link') call('setCanEarn', false);
      else call('setCanEarn', true);
    }
    if (key === 'ok' || tipped === key || !visible()) return;
    tipped = key;
    call('tip', {
      el: 'hud',
      text: key === 'connect'
        ? copy('connect', 'Connect the extension to start earning.')
        : copy('link', 'Link your Kick account to earn tickets. Open the extension menu to link it.'),
      icon: 'link',
    });
  }
  function setCanEarn(v) {
    if (typeof v !== 'boolean' || v === canEarn) return;
    canEarn = v;
    if (v) wtGate = false;
    renderGate();
  }
  function setConnected(v) {
    if (v === connected) return;
    connected = v;
    renderGate();
    if (v === false) { clearTimeout(pollT); pollT = 0; } else schedulePoll();
  }

  async function refresh() {
    if (dead || kickDead || !onChannel()) return;
    const r = await kickMsg({ type: 's2Me' });
    if (dead || !r || typeof r !== 'object') return;
    if (r.connected === false) setConnected(false);
    else if (r.connected === true && !r.error) setConnected(true);
    if (typeof r.canEarn === 'boolean') setCanEarn(r.canEarn);
    if (!shown && typeof r.tickets === 'number') applyRecord({ tickets: r.tickets, at: 0 });
  }
  function schedulePoll() {
    clearTimeout(pollT); pollT = 0;
    if (dead || kickDead || !hud || connected === false || !visible() || !onChannel()) return;
    pollT = setTimeout(() => { pollT = 0; refresh().finally(schedulePoll); }, POLL_MS);
  }
  function afterAction() {
    if (dead || connected === false || soonT) return;
    soonT = setTimeout(() => { soonT = 0; refresh(); }, ACTION_REFRESH_MS);
  }
  function afterCheckin(r) {
    if (dead || !r || typeof r !== 'object') return;
    if (r.reason === 'not_connected' || r.error === 'not_connected' || r.error === 'http_401') setConnected(false);
    else if (r.ok === true) setConnected(true);
    if (r.earnGate === true || r.reason === 'earn_gate') setCanEarn(false);
    else if (typeof r.canEarn === 'boolean') setCanEarn(r.canEarn);
    if (r.ok === true && typeof r.tickets !== 'number' && Number(r.awarded) > 0) afterAction();
  }

  function chatSent() {
    if (dead) return;
    lastChatAt = Date.now();
    if (connected === false || chatT || lastChatAt - lastChatRefreshAt < CHAT_REFRESH_GAP_MS) return;
    lastChatRefreshAt = lastChatAt;
    chatT = setTimeout(() => { chatT = 0; refresh(); }, CHAT_REFRESH_MS);
  }
  function onKey(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = e.target;
    if (t && t.closest && t.closest('#chat-input-wrapper')) chatSent();
  }
  function onClick(e) {
    const t = e.target;
    const b = t && t.closest ? t.closest('button') : null;
    if (!b) return;
    if (b.id === 'send-message-button') { chatSent(); return; }
    const box = document.getElementById('chat-input-wrapper');
    const area = box && box.parentElement && box.parentElement.parentElement;
    if (!area || !area.contains(b) || box.contains(b)) return;
    const all = area.querySelectorAll('button');
    if (all.length && all[all.length - 1] === b) chatSent();
  }

  function onVisibility() {
    if (dead) return;
    if (!visible()) { clearTimeout(pollT); pollT = 0; return; }
    if (!onChannel() || !ensureHud()) return;
    place();
    renderGate();
    refresh();
    schedulePoll();
  }
  function onLayout(e) {
    clearTimeout(layoutT);
    const ms = e && e.type && e.type.indexOf('fullscreenchange') >= 0 ? 0 : 200;
    layoutT = setTimeout(() => { layoutT = 0; if (visible()) place(); }, ms);
  }

  function tick() {
    if (dead) return;
    if (!onChannel()) { stop(); return; }
    if (!visible()) return;
    if (!hud) {
      if (ensureHud()) { refresh(); schedulePoll(); }
      return;
    }
    place();
    call('tick');
    if (!pollT) schedulePoll();
  }
  function stop() {
    clearTimeout(pollT); pollT = 0;
    clearTimeout(soonT); soonT = 0;
    clearTimeout(chatT); chatT = 0;
    clearTimeout(layoutT); layoutT = 0;
    if (hud) { call('destroy'); hud = null; }
    dockedTo = null;
    dropOfflineAnchor();
  }
  function teardown() { dead = true; stop(); }

  function init() {
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (dead || (area && area !== 'local')) return;
        if (ch.s2Token) {
          canEarn = null; tipped = '';
          setConnected(!!ch.s2Token.newValue);
        }
        if (ch.s2Balance) applyRecord(ch.s2Balance.newValue);
      });
      chrome.storage.local.get('s2Balance').then((got) => {
        if (dead || shown || !got || !got.s2Balance) return;
        applyRecord(got.s2Balance);
      }).catch(() => {});
    } catch (e) { return; }
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onLayout);
    document.addEventListener('webkitfullscreenchange', onLayout);
    window.addEventListener('resize', onLayout, { passive: true });
    document.addEventListener('keydown', onKey, { capture: true, passive: true });
    document.addEventListener('click', onClick, { capture: true, passive: true });
    if (!onChannel()) return;
    ensureHud();
    refresh();
    schedulePoll();
  }

  return { init, tick, afterCheckin, afterAction, teardown, step: kickTotalStep };
})();
kickTotal.init();
