// Service worker: runs the Season-2 "Connect with Kick" flow (engagement →
// tickets) and fires desktop notifications when Mizkif goes live or posts.
importScripts('config.js');
const C = self.RGC;   // notifications: public status feed + channel url
const S2 = self.S2;   // engagement → tickets

// --- Season 2 (engagement → tickets) ---
const getS2Token = async () => (await chrome.storage.local.get('s2Token')).s2Token || null;

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

async function s2Engagement(action, ref) {
  const token = await getS2Token();
  if (!token) return { credited: false };
  const r = await fetch(S2.API + S2.ENGAGEMENT, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform: 'x', action, ref }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ credited: false })) : { credited: false };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 's2Connect') { const e = await s2Connect().then(() => null).catch((x) => x); reply({ ok: !e }); }
    else if (msg.type === 's2AuthState') { reply({ connected: !!(await getS2Token()) }); }
    else if (msg.type === 's2Targets') { reply(await s2Targets()); }
    else if (msg.type === 's2Engagement') { reply(await s2Engagement(msg.action, msg.ref)); }
  })();
  return true; // async reply
});

// --- Notifications: Kick go-live + new YouTube upload + new TikTok/IG/X post ---
// Polled on a 30s alarm against the public status feed (no login needed). Seeds
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
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') checkSignals(); });
