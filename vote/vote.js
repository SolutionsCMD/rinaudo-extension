// Pop-up vote window for the active S2 custom poll. Talks to the service worker
// (s2Poll → {poll,tally,myVote,connected}; s2PollVote). One changeable vote.
const root = document.getElementById('root');
let shownPollId = null, optimisticIdx = null, lastH = 0;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const votesWord = (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

function fitWindow() {
  const content = document.body.scrollHeight;
  const frame = window.outerHeight - window.innerHeight;
  const target = Math.min(820, Math.max(120, content + frame + 2));
  if (Math.abs(target - lastH) < 3) return;
  lastH = target;
  chrome.runtime.sendMessage({ type: 'resize', height: target }).catch(() => {});
}

function draw(poll, tally, mine, connected) {
  const total = (tally || []).reduce((a, b) => a + b, 0);
  const leader = Math.max(0, ...(tally || []));
  const card = el('div', 'card');
  const head = el('div', 'head');
  const label = el('span', 'label'); label.append(el('span', 'pulse'), document.createTextNode('Live Vote'));
  head.append(label, el('span', 'pollTotal', votesWord(total)));
  card.append(head, el('div', 'q', poll.question || 'Vote'));
  const opts = el('div', 'pollOpts');
  (poll.options || []).forEach((labelText, idx) => {
    const c = (tally && tally[idx]) || 0;
    const isMine = mine === idx;
    const win = c > 0 && c === leader;
    const b = el('button', 'pollOpt' + (isMine ? ' pollMine' : '') + (win ? ' pollWin' : '')); b.type = 'button';
    const fill = el('span', 'pollFill'); fill.style.width = (total > 0 ? c / total * 100 : 0) + '%'; b.append(fill);
    if (isMine) b.append(el('span', 'pollCheck', '✓'));
    b.append(el('span', 'pollLabel', labelText));
    b.append(el('span', 'pollPct', total > 0 ? `${Math.round(c / total * 100)}%` : ''));
    b.append(el('span', 'pollCount', String(c)));
    b.addEventListener('click', () => cast(idx, connected));
    opts.append(b);
  });
  card.append(opts);
  card.append(el('div', 'hint', connected ? (mine != null ? 'Tap another option to change your vote' : 'Tap to vote') : 'Connect with Kick in the extension to vote'));
  root.replaceChildren(card);
  fitWindow();
}

function cast(idx, connected) {
  if (!connected || shownPollId == null) return;
  optimisticIdx = idx;
  chrome.runtime.sendMessage({ type: 's2PollVote', pollId: shownPollId, optionIdx: idx }).catch(() => {});
  tick();
}

async function tick() {
  const data = await chrome.runtime.sendMessage({ type: 's2Poll' }).catch(() => null);
  const poll = data && data.poll;
  if (!poll) {
    if (shownPollId != null) { root.replaceChildren(el('p', 'muted', 'Vote closed.')); setTimeout(() => window.close(), 1200); shownPollId = null; }
    else root.replaceChildren(el('p', 'muted', 'No vote open right now.'));
    fitWindow(); return;
  }
  if (poll.id !== shownPollId) { shownPollId = poll.id; optimisticIdx = null; }
  const serverMine = data.myVote == null ? null : Number(data.myVote);
  if (optimisticIdx != null && serverMine === optimisticIdx) optimisticIdx = null;
  const mine = optimisticIdx != null ? optimisticIdx : serverMine;
  draw(poll, data.tally || [], mine, !!data.connected);
}

tick();
if (self.renderRates) renderRates(document.getElementById('rates')).then(() => fitWindow());
setInterval(tick, 3000);
window.addEventListener('load', () => setTimeout(fitWindow, 250));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWindow);
