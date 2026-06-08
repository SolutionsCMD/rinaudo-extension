// Pop-up vote module — matches the Live Desk poll card (DeskPoll). Talks to the
// service worker (getActive/castVote); SW does the network. You can change your
// vote any time by clicking another option (backend upserts), exactly like the
// desk. Builds DOM with textContent only.
const root = document.getElementById('root');
let shownPollId = null;
let optimisticMine = null;   // option just clicked, before the server confirms
let lastPoll = null, lastTally = {};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render(poll, tally, mine) {
  const counts = Object.values(tally || {});
  const total = counts.reduce((a, b) => a + b, 0);
  const leader = Math.max(0, ...counts);

  const card = el('div', 'card');
  const head = el('div', 'head');
  const label = el('span', 'label');
  label.append(el('span', 'pulse'), document.createTextNode('Live Poll'));
  head.append(label, el('span', 'pollTotal', `${total} ${total === 1 ? 'vote' : 'votes'}`));
  card.append(head, el('div', 'q', poll.question || 'Vote'));

  const opts = el('div', 'pollOpts');
  (poll.options || []).forEach((o) => {
    const c = tally[o.command] || 0;
    const pct = total > 0 ? (c / total) * 100 : 0;
    const isMine = mine === o.command;
    const win = c > 0 && c === leader;
    const b = el('button', 'pollOpt' + (isMine ? ' pollMine' : '') + (win ? ' pollWin' : ''));
    b.type = 'button';
    const fill = el('span', 'pollFill');
    fill.style.width = pct + '%';
    b.append(fill);
    if (isMine) b.append(el('span', 'pollCheck', '✓'));
    b.append(el('span', 'pollLabel', o.label));
    b.append(el('span', 'pollPct', total > 0 ? `${Math.round(pct)}%` : ''));
    b.append(el('span', 'pollCount', String(c)));
    b.addEventListener('click', () => vote(o.command));
    opts.append(b);
  });
  card.append(opts);
  card.append(el('div', 'hint', mine ? 'Tap another option to change your vote' : 'Tap to vote'));

  root.replaceChildren(card);
}

function vote(command) {
  optimisticMine = command;                       // instant highlight
  if (lastPoll) render(lastPoll, lastTally, command);
  chrome.runtime.sendMessage({ type: 'castVote', command }).catch(() => {});
  tick();                                          // pull fresh tally right away
}

async function tick() {
  let data = null;
  try { data = await chrome.runtime.sendMessage({ type: 'getActive' }); } catch { return; }
  const poll = data && data.poll;
  if (!poll) {
    if (shownPollId) { root.replaceChildren(el('p', 'muted', 'Poll closed.')); setTimeout(() => window.close(), 1200); shownPollId = null; }
    else { root.replaceChildren(el('p', 'muted', 'No poll open right now.')); }
    return;
  }
  shownPollId = poll.id;
  lastPoll = poll;
  lastTally = data.tally || {};
  // Once the server reflects our optimistic choice, drop the override.
  if (optimisticMine && data.myCommand === optimisticMine) optimisticMine = null;
  const mine = optimisticMine || data.myCommand || null;
  render(poll, lastTally, mine);
}

tick();
setInterval(tick, 3000);
