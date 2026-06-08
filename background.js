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
  await chrome.storage.local.remove(['token', 'lastVoteKey', 'sigSeen', 'notifUrls']);
}

// Fetch BOTH vote systems (custom polls + trade buy/sell votes) and return a
// unified shape the vote window renders. trade takes priority when active.
async function fetchActiveVote() {
  const token = await getToken();
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };
  const [cp, tr] = await Promise.all([
    fetch(C.API + C.ACTIVE, { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(C.API + C.TRADES_ACTIVE, { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const trade = tr && (tr.type === 'buy_vote' || tr.type === 'sell_vote') ? tr : null;
  const poll = cp && cp.poll ? cp : null;
  return {
    poll: poll ? poll.poll : null,
    tally: poll ? poll.tally : null,
    myCommand: poll ? poll.myCommand : null,
    trade,
  };
}

// POST a trade vote (buy/skip/sell/hold) to /api/votes.
async function castTradeVote(payload) {
  const token = await getToken();
  if (!token) return { ok: false };
  const r = await fetch(C.API + C.VOTES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  }).catch(() => null);
  return r && r.ok ? r.json() : { ok: false };
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
  const w = await chrome.windows.create({ url: 'vote/vote.html', type: 'popup', width: 384, height: 300, focused: true });
  await chrome.storage.local.set({ voteWin: w.id });
}
chrome.windows.onRemoved.addListener(async (id) => {
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (id === voteWin) await chrome.storage.local.remove('voteWin');
});

async function checkPoll() {
  const av = await fetchActiveVote();
  if (!av) return;
  // Unique key per open vote (trade buy/sell or custom poll) for dedupe.
  let key = null;
  if (av.trade) key = av.trade.type + ':' + av.trade.trade.id;
  else if (av.poll) key = 'cp:' + av.poll.id;
  if (!key) return;
  const { lastVoteKey } = await chrome.storage.local.get('lastVoteKey');
  if (key === lastVoteKey) return; // already popped for this vote
  await chrome.storage.local.set({ lastVoteKey: key });
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
    // Network proxy for the vote window / content script.
    else if (msg.type === 'getActive') { reply(await fetchActiveVote()); }
    else if (msg.type === 'castVote') { reply(await castVote(msg.command)); }
    else if (msg.type === 'castTradeVote') { reply(await castTradeVote(msg.payload)); }
    // Vote window asks to resize itself to its content height.
    else if (msg.type === 'resize' && typeof msg.height === 'number') {
      const { voteWin } = await chrome.storage.local.get('voteWin');
      if (voteWin != null) { try { await chrome.windows.update(voteWin, { height: Math.round(msg.height) }); } catch { /* gone */ } }
      reply({ ok: true });
    }
  })();
  return true; // async reply
});

// Kick-live + new-YouTube-video notifications, polled on the same alarm. Seeds
// last-seen silently on first run so installing never spams old videos.
async function checkSignals() {
  const r = await fetch(C.API + C.STATUS).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return;
  const store = await chrome.storage.local.get(['sigSeen', 'notifUrls']);
  const seen = store.sigSeen || null;
  const notifUrls = store.notifUrls || {};
  const nowVideos = {};
  (r.latestVideos || []).forEach((v) => { if (v.videoId) nowVideos[v.channelId] = v.videoId; });

  if (seen) {
    if (r.streamLive && !seen.live) {
      const id = `live-${Date.now()}`;
      notifUrls[id] = r.channelUrl;
      chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Mizkif is live', message: 'The stream just went live — tap to watch.', priority: 2 });
    }
    (r.latestVideos || []).forEach((v) => {
      if (v.videoId && seen.videos[v.channelId] && v.videoId !== seen.videos[v.channelId]) {
        const id = `vid-${v.videoId}`;
        notifUrls[id] = v.url;
        chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: `New video — ${v.channelName}`, message: v.title || 'New upload — tap to watch.', priority: 2 });
      }
    });
  }
  await chrome.storage.local.set({ sigSeen: { live: !!r.streamLive, videos: nowVideos }, notifUrls });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { notifUrls } = await chrome.storage.local.get('notifUrls');
  chrome.tabs.create({ url: (notifUrls && notifUrls[id]) || C.CHANNEL_URL });
  chrome.notifications.clear(id);
});
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') { checkPoll(); checkSignals(); } });
