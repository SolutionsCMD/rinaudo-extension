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

// Any Mizkif Kick tab open? If so, the content-script card handles it — skip the
// notification so we don't double-nudge.
async function onKickTab() {
  const tabs = await chrome.tabs.query({ url: C.CHANNEL_TAB_MATCH });
  return tabs.length > 0;
}

async function checkPoll() {
  const data = await fetchActive();
  const poll = data && data.poll; // /api/custom-polls/active → { poll: {id, question, ...} | null, ... }
  if (!poll) return;
  const { lastPollId } = await chrome.storage.local.get('lastPollId');
  if (poll.id === lastPollId) return; // already alerted on this poll
  await chrome.storage.local.set({ lastPollId: poll.id });
  if (await onKickTab()) return;
  chrome.notifications.create(`poll-${poll.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Poll open on stream',
    message: poll.question || 'A vote just opened — back to the stream to vote.',
    priority: 2,
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'connect') { await connect().catch(() => {}); reply({ ok: true }); }
    else if (msg.type === 'disconnect') { await disconnect(); reply({ ok: true }); }
    else if (msg.type === 'authState') { reply({ connected: !!(await getToken()) }); }
  })();
  return true; // async reply
});

chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: C.CHANNEL_URL }));
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') checkPoll(); });
