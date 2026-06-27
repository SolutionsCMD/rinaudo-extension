// Service worker: Season-2 "Connect with Kick" (tickets), the live-poll vote
// module (on-stream card + off-tab pop-out window), and desktop notifications
// when Mizkif goes live or posts.
// Chrome (service worker) loads config via importScripts; Firefox (event page)
// loads config.js via manifest background.scripts, so importScripts is absent there.
if (typeof importScripts === 'function') importScripts('config.js');
const C = self.RGC;   // notifications: public status feed + channel url
const S2 = self.S2;   // engagement + polls

const getS2Token = async () => (await chrome.storage.local.get('s2Token')).s2Token || null;

// Toolbar "!" badge until the member connects, cleared once they do.
async function updateBadge() {
  const token = await getS2Token();
  try {
    await chrome.action.setBadgeText({ text: token ? '' : '!' });
    if (!token) await chrome.action.setBadgeBackgroundColor({ color: '#C9A766' });
  } catch { /* action API unavailable */ }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.s2Token) updateBadge(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(updateBadge);

async function s2Connect() {
  const redirect = chrome.identity.getRedirectURL(); // https://<id>.chromiumapp.org/
  const url = `${S2.CONNECT_PAGE}?ext_redirect=${encodeURIComponent(redirect)}`;
  const done = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const code = new URL(done).searchParams.get('code');
  if (!code) throw new Error('no code in redirect');
  const r = await fetch(S2.API + S2.EXCHANGE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!r.ok) throw new Error(`exchange failed: ${r.status}`);
  const { token } = await r.json();
  if (!token) throw new Error('no token in exchange response');
  await chrome.storage.local.set({ s2Token: token });
}

async function s2Targets() {
  const token = await getS2Token();
  if (!token) return { targets: [], likeReward: 0, commentReward: 0 };
  const r = await fetch(S2.API + S2.TARGETS, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ targets: [], likeReward: 0, commentReward: 0 })) : { targets: [], likeReward: 0, commentReward: 0 };
}

async function s2Engagement(platform, action, ref) {
  const token = await getS2Token();
  if (!token) return { credited: false };
  const r = await fetch(S2.API + S2.ENGAGEMENT, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform, action, ref }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ credited: false })) : { credited: false };
}

// --- YouTube watch-to-earn (drives the existing s2 /api/watch/* flow) ---
async function s2WatchSession(platform, videoRef, playerDuration) {
  const token = await getS2Token();
  if (!token) return { error: 'not_connected' };
  const r = await fetch(S2.API + S2.WATCH_SESSION, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform, videoRef, playerDuration }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ error: 'bad_json' })) : { error: r ? 'http_' + r.status : 'network' };
}
async function s2WatchHeartbeat(sessionId) {
  const token = await getS2Token();
  if (!token) return { counted: false };
  const r = await fetch(S2.API + S2.WATCH_HEARTBEAT, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ counted: false })) : { counted: false };
}
async function s2WatchClaim(platform, videoRef) {
  const token = await getS2Token();
  if (!token) return { ok: false };
  const r = await fetch(S2.API + S2.WATCH_CLAIM, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform, videoRef }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}
async function s2KickCheckin() {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const r = await fetch(S2.API + S2.KICK_CHECKIN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}

// --- Live poll vote module ---
async function s2Poll() {
  const token = await getS2Token();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(S2.API + S2.POLL, { headers }).catch(() => null);
  const base = r && r.ok ? await r.json().catch(() => ({ poll: null, tally: [], myVote: null })) : { poll: null, tally: [], myVote: null };
  return { ...base, connected: !!token };
}

async function s2PollVote(pollId, optionIdx) {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const r = await fetch(S2.API + S2.POLL_VOTE, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ pollId, optionIdx }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}

// Is the active tab Mizkif's Kick channel? (kick.com host permission makes
// tab.url readable for that tab; other tabs read undefined → false.)
async function focusedOnKick() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return !!(tab && /^https:\/\/kick\.com\/mizkif/.test(tab.url || ''));
  } catch { return false; }
}

// Pop the vote window, reusing one if already open.
async function openVoteWindow() {
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (voteWin != null) {
    try { await chrome.windows.update(voteWin, { focused: true, drawAttention: true }); return; } catch { /* gone */ }
  }
  const w = await chrome.windows.create({ url: 'vote/vote.html', type: 'popup', width: 360, height: 320, focused: true });
  await chrome.storage.local.set({ voteWin: w.id });
}
chrome.windows.onRemoved.addListener(async (id) => {
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (id === voteWin) await chrome.storage.local.remove('voteWin');
});

// On the alarm: if a NEW poll is open AND the viewer isn't on the Kick tab, pop
// the window (deduped per poll id). On the Kick tab, the on-page card handles it.
async function checkPoll() {
  const data = await s2Poll();
  const poll = data && data.poll;
  if (!poll) return;
  const key = 'poll:' + poll.id;
  const { lastPollKey } = await chrome.storage.local.get('lastPollKey');
  if (key === lastPollKey) return;
  await chrome.storage.local.set({ lastPollKey: key });
  if (await focusedOnKick()) return;
  await openVoteWindow();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 's2Connect') { const e = await s2Connect().then(() => null).catch((x) => x); reply({ ok: !e }); }
    else if (msg.type === 's2AuthState') { reply({ connected: !!(await getS2Token()) }); }
    else if (msg.type === 's2Targets') { reply(await s2Targets()); }
    else if (msg.type === 's2Engagement') { reply(await s2Engagement(msg.platform || 'x', msg.action, msg.ref)); }
    else if (msg.type === 's2WatchSession') { reply(await s2WatchSession(msg.platform, msg.videoRef, msg.playerDuration)); }
    else if (msg.type === 's2WatchHeartbeat') { reply(await s2WatchHeartbeat(msg.sessionId)); }
    else if (msg.type === 's2WatchClaim') { reply(await s2WatchClaim(msg.platform, msg.videoRef)); }
    else if (msg.type === 's2KickCheckin') { reply(await s2KickCheckin()); }
    else if (msg.type === 's2Poll') { reply(await s2Poll()); }
    else if (msg.type === 's2PollVote') { reply(await s2PollVote(msg.pollId, msg.optionIdx)); }
    else if (msg.type === 'resize' && typeof msg.height === 'number') {
      const { voteWin } = await chrome.storage.local.get('voteWin');
      if (voteWin != null) { try { await chrome.windows.update(voteWin, { height: Math.round(msg.height) }); } catch { /* gone */ } }
      reply({ ok: true });
    }
  })();
  return true; // async reply
});

// --- Notifications: Kick go-live + new YouTube upload + new TikTok/IG/X post ---
// Polled on the 30s alarm against the public status feed (no login needed). Seeds
// last-seen silently on first run so installing never spams old items.
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
      chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/kick.png', title: 'Mizkif is live on Kick', message: 'The stream just went live — tap to watch.', priority: 2 });
    }
    (r.latestVideos || []).forEach((v) => {
      if (v.videoId && seen.videos[v.channelId] && v.videoId !== seen.videos[v.channelId]) {
        const id = `vid-${v.videoId}`;
        notifUrls[id] = v.url;
        chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/youtube.png', title: `New YouTube video — ${v.channelName}`, message: v.title || 'New upload — tap to watch.', priority: 2 });
      }
    });
    const SOCIAL_TITLES = { tiktok: 'New TikTok — Mizkif', instagram: 'New Instagram — Mizkif', twitter: 'New X post — Mizkif' };
    const SOCIAL_ICONS = { tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', twitter: 'icons/x.png' };
    (r.latestSocial || []).forEach((s) => {
      const prev = (seen.social || {})[s.platform];
      if (s.url && prev && s.url !== prev) {
        const id = `soc-${s.platform}-${Date.now()}`;
        notifUrls[id] = s.url;
        chrome.notifications.create(id, { type: 'basic', iconUrl: SOCIAL_ICONS[s.platform] || 'icons/icon128.png', title: SOCIAL_TITLES[s.platform] || 'New post', message: s.title || 'Tap to open.', priority: 2 });
      }
    });
  }
  const nowSocial = {};
  (r.latestSocial || []).forEach((s) => { if (s.url) nowSocial[s.platform] = s.url; });
  await chrome.storage.local.set({ sigSeen: { live: !!r.streamLive, videos: nowVideos, social: nowSocial }, notifUrls });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const { notifUrls } = await chrome.storage.local.get('notifUrls');
  chrome.tabs.create({ url: (notifUrls && notifUrls[id]) || C.CHANNEL_URL });
  chrome.notifications.clear(id);
});
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
  updateBadge();
  if (details.reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});
// --- New earn target notifications ---
// Fires once per new target ref when the admin adds a YouTube/TikTok/IG/X post.
const TARGET_ICONS = { youtube: 'icons/youtube.png', tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', x: 'icons/x.png' };
const TARGET_TITLES = { youtube: 'New YouTube target — earn tickets', tiktok: 'New TikTok target — earn tickets', instagram: 'New Instagram target — earn tickets', x: 'New X target — earn tickets' };
async function checkNewTargets() {
  const data = await s2Targets();
  const refs = (data.targets || []).map((t) => `${t.platform}:${t.ref}`);
  if (!refs.length) return;
  const store = await chrome.storage.local.get(['seenTargets', 'notifUrls']);
  const seen = new Set(store.seenTargets || []);
  const notifUrls = store.notifUrls || {};
  const fresh = refs.filter((k) => !seen.has(k));
  if (seen.size > 0) { // don't notify on very first load
    for (const key of fresh) {
      const t = (data.targets || []).find((x) => `${x.platform}:${x.ref}` === key);
      if (!t) continue;
      const id = `target-${key}`;
      notifUrls[id] = t.url || '';
      chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: TARGET_ICONS[t.platform] || 'icons/icon128.png',
        title: TARGET_TITLES[t.platform] || 'New earn target',
        message: t.label || t.url || 'Tap to open and earn tickets.',
        priority: 2,
      });
    }
  }
  refs.forEach((k) => seen.add(k));
  await chrome.storage.local.set({ seenTargets: [...seen], notifUrls });
}

async function checkManualPush() {
  const r = await fetch(S2.API + S2.PUSH).catch(() => null);
  if (!r || !r.ok) return;
  const data = await r.json().catch(() => null);
  if (!data || !data.push) return;
  const push = data.push;

  const { seenPushIds, notifUrls } = await chrome.storage.local.get(['seenPushIds', 'notifUrls']);
  const seen = new Set(seenPushIds || []);
  if (seen.has(push.id)) return;

  seen.add(push.id);
  const id = `manual-push-${push.id}`;
  const urls = notifUrls || {};
  urls[id] = push.url;

  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/youtube.png',
    title: push.title,
    message: push.message || 'Tap to open.',
    priority: 2,
  });

  await chrome.storage.local.set({ seenPushIds: [...seen], notifUrls: urls });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'poll') return;
  // Run sequentially, NOT concurrently: checkSignals and checkNewTargets both
  // read-modify-write the shared notifUrls map in storage. Run in parallel, one writes
  // back a stale copy and clobbers the other's click-URL — so a target notification loses
  // its URL and the click falls back to the Kick channel URL. Awaiting keeps each one's
  // read+write atomic with respect to the others.
  await checkSignals();
  await checkPoll();
  await checkNewTargets();
  await checkManualPush();
});
