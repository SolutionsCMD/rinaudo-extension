// Pop-up vote module — renders the Live Desk poll/vote card for whichever vote
// is open: a trade BUY vote (Skip / Small / Medium / Large with $ tiers), a SELL
// vote (Sell / Hold), or a custom poll. All changeable (the backend upserts).
// Talks to the service worker (getActive → unified shape; castVote / castTradeVote).
const root = document.getElementById('root');
let shownKey = null;       // current open-vote identity (detect new vote / closed)
let optimisticKey = null;  // option just clicked, before the server confirms

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const votesWord = (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

// Resize the popup window to fit the module's actual content (short votes get a
// short window; many options grow it, up to a cap, then options scroll inside).
let lastH = 0;
function fitWindow() {
  const content = document.body.scrollHeight;
  const frame = window.outerHeight - window.innerHeight; // titlebar etc.
  const target = Math.min(820, Math.max(120, content + frame + 2));
  if (Math.abs(target - lastH) < 3) return;
  lastH = target;
  chrome.runtime.sendMessage({ type: 'resize', height: target }).catch(() => {});
}

// Normalize the SW payload into one render model regardless of vote type.
function buildModel(data) {
  const tr = data && data.trade;
  if (tr && tr.type === 'buy_vote') {
    const t = tr.tally, total = t.total, leader = Math.max(t.small, t.medium, t.large, t.skip, 0);
    const tiers = [['small', 'Small', tr.tierAmounts.small, t.small], ['medium', 'Medium', tr.tierAmounts.medium, t.medium], ['large', 'Large', tr.tierAmounts.large, t.large]];
    const rows = tiers.map(([size, name, amt, c]) => ({
      key: 'buy:' + size, label: `${name} · ${money(amt)}`, count: c, pct: total > 0 ? c / total * 100 : 0,
      win: c > 0 && c === leader, payload: { tradeId: tr.trade.id, choice: 'buy', phase: 'buy_vote', size },
    }));
    rows.push({ key: 'skip', label: 'Skip', count: t.skip, pct: total > 0 ? t.skip / total * 100 : 0,
      win: t.skip > 0 && t.skip === leader, payload: { tradeId: tr.trade.id, choice: 'skip', phase: 'buy_vote' } });
    const serverMineKey = tr.myChoice === 'buy' ? 'buy:' + tr.mySize : (tr.myChoice === 'skip' ? 'skip' : null);
    return { voteKey: 'bv:' + tr.trade.id, title: `Buy ${tr.trade.ticker}?`, total, rows, serverMineKey, endpoint: 'trade' };
  }
  if (tr && tr.type === 'sell_vote') {
    const t = tr.tally, total = t.total;
    const rows = [
      { key: 'sell', label: 'Sell', count: t.sell, pct: total > 0 ? t.sell / total * 100 : 0, win: t.sell > 0 && t.sell >= t.hold, payload: { tradeId: tr.trade.id, choice: 'sell', phase: 'sell_vote', sellSessionId: tr.sellSession.id } },
      { key: 'hold', label: 'Hold', count: t.hold, pct: total > 0 ? t.hold / total * 100 : 0, win: t.hold > 0 && t.hold > t.sell, payload: { tradeId: tr.trade.id, choice: 'hold', phase: 'sell_vote', sellSessionId: tr.sellSession.id } },
    ];
    return { voteKey: 'sv:' + tr.trade.id, title: `Sell ${tr.trade.ticker}?`, total, rows, serverMineKey: tr.myChoice || null, endpoint: 'trade' };
  }
  if (data && data.poll) {
    const poll = data.poll, tally = data.tally || {}, vals = Object.values(tally);
    const total = vals.reduce((a, b) => a + b, 0), leader = Math.max(0, ...vals);
    const rows = (poll.options || []).map((o) => { const c = tally[o.command] || 0; return { key: o.command, label: o.label, count: c, pct: total > 0 ? c / total * 100 : 0, win: c > 0 && c === leader, payload: { command: o.command } }; });
    return { voteKey: 'cp:' + poll.id, title: poll.question || 'Vote', total, rows, serverMineKey: data.myCommand || null, endpoint: 'poll' };
  }
  return null;
}

function draw(model) {
  const effMine = optimisticKey || model.serverMineKey;
  const card = el('div', 'card');
  const head = el('div', 'head');
  const label = el('span', 'label'); label.append(el('span', 'pulse'), document.createTextNode('Live Vote'));
  head.append(label, el('span', 'pollTotal', votesWord(model.total)));
  card.append(head, el('div', 'q', model.title));
  const opts = el('div', 'pollOpts');
  model.rows.forEach((rw) => {
    const mine = rw.key === effMine;
    const b = el('button', 'pollOpt' + (mine ? ' pollMine' : '') + (rw.win ? ' pollWin' : ''));
    b.type = 'button';
    const fill = el('span', 'pollFill'); fill.style.width = (rw.pct || 0) + '%'; b.append(fill);
    if (mine) b.append(el('span', 'pollCheck', '✓'));
    b.append(el('span', 'pollLabel', rw.label));
    b.append(el('span', 'pollPct', model.total > 0 ? `${Math.round(rw.pct || 0)}%` : ''));
    b.append(el('span', 'pollCount', String(rw.count)));
    b.addEventListener('click', () => cast(model, rw));
    opts.append(b);
  });
  card.append(opts);
  card.append(el('div', 'hint', effMine ? 'Tap another option to change your vote' : 'Tap to vote'));
  root.replaceChildren(card);
  fitWindow();
}

function cast(model, rw) {
  optimisticKey = rw.key;
  draw(model); // instant highlight; counts catch up next tick
  if (model.endpoint === 'poll') chrome.runtime.sendMessage({ type: 'castVote', command: rw.payload.command }).catch(() => {});
  else chrome.runtime.sendMessage({ type: 'castTradeVote', payload: rw.payload }).catch(() => {});
  tick();
}

async function tick() {
  let data = null;
  try { data = await chrome.runtime.sendMessage({ type: 'getActive' }); } catch { return; }
  const model = buildModel(data);
  if (!model) {
    if (shownKey) { root.replaceChildren(el('p', 'muted', 'Vote closed.')); setTimeout(() => window.close(), 1200); shownKey = null; }
    else root.replaceChildren(el('p', 'muted', 'No vote open right now.'));
    fitWindow();
    return;
  }
  if (model.voteKey !== shownKey) { shownKey = model.voteKey; optimisticKey = null; } // new vote
  if (optimisticKey && model.serverMineKey === optimisticKey) optimisticKey = null;     // server caught up
  draw(model);
}

tick();
setInterval(tick, 3000);
// Re-fit once fonts have swapped in (Fraunces can change the measured height).
window.addEventListener('load', () => setTimeout(fitWindow, 250));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWindow);
