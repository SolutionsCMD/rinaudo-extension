// Runs only on Mizkif's Kick channel. Pure UI: it asks the service worker for
// the active poll (~7s) and to cast votes — the SW does the network, because a
// cross-site fetch from this page context gets blocked by Edge tracking
// prevention / page CSP (ERR_BLOCKED_BY_CLIENT). Injects a shadow-DOM vote card.
//
// SW message contract:
//   {type:'getActive'} → { poll:{id,question,options:[{label,command}]}|null, myCommand } | null
//   {type:'castVote', command} → { ok, ... }
const C = self.RGC;

let host = null, shadow = null, shownPollId = null;
let current = null; // last poll object rendered, for re-render after voting

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  host.id = 'rgc-vote-host';
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .card{width:300px;background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:12px;
      padding:16px;font-family:system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.6)}
    .q{font-size:14px;font-weight:600;margin:0 0 12px;line-height:1.35}
    button{display:block;width:100%;margin:6px 0;padding:10px;border:0;border-radius:8px;
      background:#1d2c44;color:#F4EFE3;cursor:pointer;font-size:13px;text-align:left}
    button:hover:not(:disabled){background:#2a3d5c}
    button:disabled{opacity:.55;cursor:default}
    button.chosen{background:#244a33;color:#86D6A4}
    .voted{color:#7FB791;font-size:12px;margin-top:8px}`;
  shadow.append(style);
}

// `mine` = the command the member already voted for (or null).
function render(poll, mine) {
  ensureHost();
  current = poll;
  const card = document.createElement('div');
  card.className = 'card';
  const q = document.createElement('p');
  q.className = 'q';
  q.textContent = poll.question || 'Vote';
  card.append(q);
  (poll.options || []).forEach((o) => {
    const b = document.createElement('button');
    b.textContent = o.label;
    if (mine) {
      b.disabled = true;
      if (o.command === mine) b.classList.add('chosen');
    } else {
      b.addEventListener('click', () => submit(o.command));
    }
    card.append(b);
  });
  if (mine) {
    const v = document.createElement('div');
    v.className = 'voted';
    v.textContent = '✓ Voted';
    card.append(v);
  }
  const old = shadow.querySelector('.card');
  if (old) old.remove();
  shadow.append(card);
}

async function submit(command) {
  if (!current) return;
  chrome.runtime.sendMessage({ type: 'castVote', command }).catch(() => {});
  render(current, command); // optimistic; next tick confirms via myCommand
}

function clear() {
  if (host) { host.remove(); host = null; shadow = null; }
  shownPollId = null;
  current = null;
}

async function tick() {
  let data = null;
  try { data = await chrome.runtime.sendMessage({ type: 'getActive' }); } catch { return; }
  const poll = data && data.poll;
  if (!poll) return clear();
  const mine = data.myCommand || null;
  if (poll.id !== shownPollId) {
    shownPollId = poll.id;
    render(poll, mine);
  } else if (mine && shadow && !shadow.querySelector('.voted')) {
    render(poll, mine);
  }
}

setInterval(tick, C.POLL_FAST_MS);
tick();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
