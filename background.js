// Service worker: holds the auth token, runs the Connect-with-Kick flow, and on
// a 30s alarm checks for an open poll → fires ONE desktop notification when the
// member isn't on the Kick stream tab.
importScripts('config.js');
const C = self.RGC;

const getToken = async () => (await chrome.storage.local.get('token')).token || null;

async function connect() {
  const redirect = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const url = `${C.CONNECT_PAGE}?ext_redirect=${encodeURIComponent(redirect)}`;
  const done = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const code = new URL(done).searchParams.get('code');
  if (!code) throw new Error('no code in redirect');
  const r = await fetch(C.API + C.EXCHANGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { token } = await r.json();
  if (token) await chrome.storage.local.set({ token });
}

async function disconnect() {
  const token = await getToken();
  if (token) {
    await fetch(C.API + C.DISCONNECT, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  await chrome.storage.local.remove(['token', 'lastPollId']);
}

async function fetchActive() {
  const token = await getToken();
  if (!token) return null;
  const r = await fetch(C.API + C.ACTIVE, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

// Is the member actively looking at the Kick stream right now? (host permission
// for kick.com lets us read that tab's URL; other tabs read as undefined → false.)
async function focusedOnKick() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return !!(tab && /^https:\/\/kick\.com\/mizkif/.test(tab.url || ''));
  } catch { return false; }
}

// Pop the interactive vote module in its own small window. Reuses one window if
// it's already open (focus it) rather than stacking.
async function openVoteWindow() {
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (voteWin != null) {
    try { await chrome.windows.update(voteWin, { focused: true, drawAttention: true }); return; } catch { /* gone */ }
  }
  const w = await chrome.windows.create({ url: 'vote/vote.html', type: 'popup', width: 384, height: 500, focused: true });
  await chrome.storage.local.set({ voteWin: w.id });
}
chrome.windows.onRemoved.addListener(async (id) => {
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (id === voteWin) await chrome.storage.local.remove('voteWin');
});

async function checkPoll() {
  const data = await fetchActive();
  const poll = data && data.poll; // /api/custom-polls/active → { poll: {id, question, ...} | null, ... }
  if (!poll) return;
  const { lastPollId } = await chrome.storage.local.get('lastPollId');
  if (poll.id === lastPollId) return; // already popped for this poll
  await chrome.storage.local.set({ lastPollId: poll.id });
  // Watching the stream → the on-page card handles it. Otherwise pop the module.
  if (await focusedOnKick()) return;
  await openVoteWindow();
}

// Cast a vote on behalf of the content script (the content script's own fetch
// is blocked by the page's tracking-prevention/CSP; the SW request isn't).
async function castVote(command) {
  const token = await getToken();
  if (!token) return { ok: false };
  const r = await fetch(C.API + C.VOTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ command }),
  }).catch(() => null);
  return r && r.ok ? r.json() : { ok: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'connect') { await connect().catch(() => {}); reply({ ok: true }); }
    else if (msg.type === 'disconnect') { await disconnect(); reply({ ok: true }); }
    else if (msg.type === 'authState') { reply({ connected: !!(await getToken()) }); }
    // Network proxy for the content script (avoids page tracking-prevention).
    else if (msg.type === 'getActive') { reply(await fetchActive()); }
    else if (msg.type === 'castVote') { reply(await castVote(msg.command)); }
  })();
  return true; // async reply
});

chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: C.CHANNEL_URL }));
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') checkPoll(); });
