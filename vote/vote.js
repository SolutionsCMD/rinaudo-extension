// The pop-up vote module. Opened by the service worker when a poll opens and the
// member isn't focused on the Kick stream. Talks to the SW (getActive/castVote)
// — the SW does the network, so no cross-site/tracking-prevention issues. Builds
// DOM with textContent only.
const root = document.getElementById('root');
let shownPollId = null, current = null;

function setMuted(text) { root.replaceChildren(); const p = document.createElement('p'); p.className = 'muted'; p.textContent = text; root.append(p); }

function render(poll, mine) {
  current = poll;
  root.replaceChildren();
  const q = document.createElement('p'); q.className = 'q'; q.textContent = poll.question || 'Vote'; root.append(q);
  (poll.options || []).forEach((o) => {
    const b = document.createElement('button'); b.className = 'opt'; b.textContent = o.label;
    if (mine) { b.disabled = true; if (o.command === mine) b.classList.add('chosen'); }
    else { b.addEventListener('click', () => submit(o.command)); }
    root.append(b);
  });
  if (mine) { const v = document.createElement('div'); v.className = 'voted'; v.textContent = '✓ Voted'; root.append(v); }
}

async function submit(command) {
  if (!current) return;
  chrome.runtime.sendMessage({ type: 'castVote', command }).catch(() => {});
  render(current, command); // optimistic
}

async function tick() {
  let data = null;
  try { data = await chrome.runtime.sendMessage({ type: 'getActive' }); } catch { return; }
  const poll = data && data.poll;
  if (!poll) {
    // Poll closed → say so briefly, then close the window.
    if (shownPollId) { setMuted('Poll closed.'); setTimeout(() => window.close(), 1200); shownPollId = null; }
    else { setMuted('No poll open right now.'); }
    return;
  }
  const mine = data.myCommand || null;
  if (poll.id !== shownPollId) { shownPollId = poll.id; render(poll, mine); }
  else if (mine && !root.querySelector('.voted')) { render(poll, mine); }
}

tick();
setInterval(tick, 3000);
