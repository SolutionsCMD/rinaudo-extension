// Service worker: Season-2 "Connect with Kick" (tickets), the live-poll vote
// module (on-stream card + off-tab pop-out window), and desktop notifications
// when Mizkif goes live or posts.
// Chrome (service worker) loads config via importScripts; Firefox (event page)
// loads config.js via manifest background.scripts, so importScripts is absent there.
if (typeof importScripts === 'function') importScripts('config.js');
const C = self.RGC;   // notifications: public status feed + channel url
const S2 = self.S2;   // engagement + polls

const getS2Token = async () => (await chrome.storage.local.get('s2Token')).s2Token || null;

// Firefox for Android implements neither the `notifications` nor the `windows` API. Touching
// them at the top level (addListener) would throw and abort the whole background script —
// which unregisters the onMessage listener and makes "Connect" fail with
// "Could not establish connection. Receiving end does not exist." Feature-detect once and
// guard every use, so connect + polling still work on mobile (just without toasts / pop-out).
const HAS_NOTIFICATIONS = !!(chrome.notifications && chrome.notifications.create);
const HAS_WINDOWS = !!(chrome.windows && chrome.windows.create);
function notify(id, opts) { try { if (HAS_NOTIFICATIONS) chrome.notifications.create(id, opts); } catch { /* unsupported */ } }

// Post/video notifications open the PLATFORM HOMEPAGE, not the direct video URL, so
// members search for it themselves — search demand + in-app discovery is a stronger
// signal to the platform's algorithm than an external deep-link. Unknown hosts (e.g.
// a Kick stream or a custom link) are left as-is so go-live still opens the stream.
function homepageFor(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'https://www.youtube.com';
  if (host.endsWith('tiktok.com')) return 'https://www.tiktok.com';
  if (host.endsWith('instagram.com') || host === 'instagr.am') return 'https://www.instagram.com';
  if (host.endsWith('x.com') || host.endsWith('twitter.com')) return 'https://x.com';
  return url;
}

// Per-platform toast-notification toggles (set in the popup). Opt-OUT: a platform is on
// unless its pref is explicitly false. Keys: kick, youtube, tiktok, instagram, x.
const prefOn = (prefs, p) => !prefs || prefs[p] !== false;
const SOCIAL_PLATFORM_KEY = { tiktok: 'tiktok', instagram: 'instagram', twitter: 'x' };

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

// Tab-based connect: open the connect page in a normal browser tab. The user logs in with
// Kick there; the page finishes the handshake and lands on ?code=<code>, which the injected
// content-script (content/connect.js) posts back as an 's2ConnectCode' message. This works
// everywhere — Chrome, Firefox, and mobile — with no chrome.identity / launchWebAuthFlow
// (which is unsupported on Firefox Android and flaky on Firefox desktop).
async function s2Connect() {
  await chrome.tabs.create({ url: S2.CONNECT_PAGE });
}

// The connect tab's content script (content/connect.js) does the code→token exchange itself
// and stores s2Token directly (shared storage), which auto-clears the "!" badge via the
// storage listener. All we do here is close that tab once it signals completion.
async function s2ConnectDone(tabId) {
  if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch { /* already closed */ } }
}

// Opaque per-install device token — a random id WE generate (NOT a fingerprint, hardware
// id, or anything derived from the machine). Stored locally, resettable. Sent as the
// X-RGC-Device header so the backend can cluster multi-accounts for cashout review.
let _deviceId = null;
async function getDeviceId() {
  if (_deviceId) return _deviceId;
  const { rgcDeviceId } = await chrome.storage.local.get('rgcDeviceId');
  if (rgcDeviceId) { _deviceId = rgcDeviceId; return _deviceId; }
  _deviceId = (self.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  await chrome.storage.local.set({ rgcDeviceId: _deviceId });
  return _deviceId;
}
// Fuzzy machine fingerprint: a stable hash of GPU / canvas / UA / cores / timezone.
// Unlike the device token it survives a reinstall or fresh profile on the SAME machine.
// It is NOT unique (same model + browser collide) — the backend treats it as a weak,
// review-only signal. Computed once via OffscreenCanvas in the service worker, then cached.
let _fp = null;
async function getFingerprint() {
  if (_fp != null) return _fp;
  const { rgcFp } = await chrome.storage.local.get('rgcFp');
  if (rgcFp) { _fp = rgcFp; return _fp; }
  const parts = [];
  try { parts.push(navigator.userAgent || ''); } catch {}
  try { parts.push((navigator.languages || [navigator.language]).join(',')); } catch {}
  try { parts.push(String(navigator.hardwareConcurrency || ''), String(navigator.deviceMemory || '')); } catch {}
  try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch {}
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) parts.push(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '', gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      parts.push(gl.getParameter(gl.VERSION) || '');
    }
  } catch {}
  try {
    const cv = new OffscreenCanvas(200, 50), ctx = cv.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = '14px Arial';
    ctx.fillStyle = '#069'; ctx.fillText('rgc fp⚡', 2, 2);
    ctx.fillStyle = 'rgba(102,200,0,.7)'; ctx.fillText('rgc fp⚡', 4, 6);
    const buf = await (await cv.convertToBlob()).arrayBuffer();
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    parts.push([...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(''));
  } catch {}
  try {
    const enc = new TextEncoder().encode(parts.join('|'));
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc));
    _fp = [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ rgcFp: _fp });
  } catch { _fp = ''; }
  return _fp;
}

// Client capability hints: coarse device traits (GPU renderer string, CPU/memory class) the
// backend uses to size features for the device. URI-encoded compact JSON. Computed once.
let _caps = null;
async function getCaps() {
  if (_caps != null) return _caps;
  let renderer = '';
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
    }
  } catch {}
  let cores = 0, mem = 0;
  try { cores = Number(navigator.hardwareConcurrency) || 0; } catch {}
  try { mem = Number(navigator.deviceMemory) || 0; } catch {}
  try { _caps = encodeURIComponent(JSON.stringify({ r: String(renderer).slice(0, 160), c: cores, m: mem })); }
  catch { _caps = ''; }
  return _caps;
}

async function s2Headers(token, json) {
  const h = { Authorization: `Bearer ${token}`, 'X-RGC-Device': await getDeviceId() };
  const fp = await getFingerprint();
  if (fp) h['X-RGC-Fingerprint'] = fp;
  const caps = await getCaps();
  if (caps) h['X-RGC-Caps'] = caps;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function s2Targets() {
  const token = await getS2Token();
  if (!token) return { targets: [], likeReward: 0, commentReward: 0 };
  const r = await fetch(S2.API + S2.TARGETS, { headers: await s2Headers(token) }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ targets: [], likeReward: 0, commentReward: 0 })) : { targets: [], likeReward: 0, commentReward: 0 };
}

async function s2Engagement(platform, action, ref) {
  const token = await getS2Token();
  if (!token) return { credited: false };
  const r = await fetch(S2.API + S2.ENGAGEMENT, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, action, ref }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ credited: false })) : { credited: false };
}

// --- YouTube watch-to-earn (drives the existing s2 /api/watch/* flow) ---
async function s2WatchSession(platform, videoRef, playerDuration) {
  const token = await getS2Token();
  if (!token) return { error: 'not_connected' };
  const r = await fetch(S2.API + S2.WATCH_SESSION, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, videoRef, playerDuration }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ error: 'bad_json' })) : { error: r ? 'http_' + r.status : 'network' };
}
async function s2WatchHeartbeat(sessionId) {
  const token = await getS2Token();
  if (!token) return { counted: false };
  const r = await fetch(S2.API + S2.WATCH_HEARTBEAT, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ sessionId }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ counted: false })) : { counted: false };
}
async function s2WatchClaim(platform, videoRef, mode) {
  const token = await getS2Token();
  if (!token) return { ok: false };
  const r = await fetch(S2.API + S2.WATCH_CLAIM, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, videoRef, mode }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}
async function s2KickCheckin() {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const r = await fetch(S2.API + S2.KICK_CHECKIN, {
    method: 'POST',
    headers: await s2Headers(token),
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
    method: 'POST', headers: await s2Headers(token, true),
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
  if (!HAS_WINDOWS) return; // no separate pop-out window on Firefox Android
  const { voteWin } = await chrome.storage.local.get('voteWin');
  if (voteWin != null) {
    try { await chrome.windows.update(voteWin, { focused: true, drawAttention: true }); return; } catch { /* gone */ }
  }
  const w = await chrome.windows.create({ url: 'vote/vote.html', type: 'popup', width: 360, height: 320, focused: true });
  await chrome.storage.local.set({ voteWin: w.id });
}
if (HAS_WINDOWS) chrome.windows.onRemoved.addListener(async (id) => {
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
    if (msg.type === 's2Connect') { const e = await s2Connect().then(() => null).catch((x) => x); if (e) console.error('[rgc] s2Connect failed:', e); reply({ ok: !e, error: e ? (e.message || String(e)) : null }); }
    else if (msg.type === 's2ConnectDone') { await s2ConnectDone(_sender && _sender.tab && _sender.tab.id); reply({ ok: true }); }
    else if (msg.type === 's2AuthState') { reply({ connected: !!(await getS2Token()) }); }
    else if (msg.type === 's2Targets') { reply(await s2Targets()); }
    else if (msg.type === 's2Engagement') { reply(await s2Engagement(msg.platform || 'x', msg.action, msg.ref)); }
    else if (msg.type === 's2WatchSession') { reply(await s2WatchSession(msg.platform, msg.videoRef, msg.playerDuration)); }
    else if (msg.type === 's2WatchHeartbeat') { reply(await s2WatchHeartbeat(msg.sessionId)); }
    else if (msg.type === 's2WatchClaim') { reply(await s2WatchClaim(msg.platform, msg.videoRef, msg.mode)); }
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

// Quiet window for the Kick go-live toast: never notify on weekends, or overnight
// (8pm–8am America/New_York) any day. Go-live toast only — other notifications
// (uploads, posts, earn targets) are unaffected.
function inKickQuietWindow(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(now);
  const wd = p.find((x) => x.type === 'weekday').value;
  let hr = parseInt(p.find((x) => x.type === 'hour').value, 10);
  if (hr === 24) hr = 0; // some engines emit '24' for midnight
  const weekend = wd === 'Sat' || wd === 'Sun';
  const night = hr >= 20 || hr < 8; // 8pm–8am ET
  return weekend || night;
}

// Is this YouTube upload a Short? The public feed only gives /watch URLs, so probe
// youtube.com/shorts/<id> (host permission granted): a real Short serves 200, a regular
// video 3xx-redirects to /watch (status 0 / opaqueredirect under manual). Errors → treat
// as a normal video. Body is cancelled so nothing large downloads.
async function isYouTubeShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, { redirect: 'manual' });
    try { if (res.body) res.body.cancel(); } catch { /* ignore */ }
    return res.status === 200;
  } catch { return false; }
}

// Build a crop-safe toast image from a YouTube thumbnail. Chrome cover-crops notification
// images to ~2:1, lopping the top/bottom off a 16:9 thumb — so we letterbox it onto the
// brand background at 2:1 first (via OffscreenCanvas in the worker). Tries maxres→mq→hq.
// Returns a JPEG data URL, or null on any failure so the caller can fall back to a banner.
async function youtubeThumbCard(videoId) {
  try {
    let bmp = null;
    for (const q of ['maxresdefault', 'mqdefault', 'hqdefault']) {
      try {
        const blob = await fetch(`https://i.ytimg.com/vi/${videoId}/${q}.jpg`).then((r) => (r.ok ? r.blob() : null));
        if (blob && blob.size > 1024) { bmp = await createImageBitmap(blob); break; }
      } catch { /* try next quality */ }
    }
    if (!bmp) return null;
    const W = 960, H = 480, RULE = 6;
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d');
    x.fillStyle = '#141414'; x.fillRect(0, 0, W, H);
    const s = Math.min(W / bmp.width, (H - RULE) / bmp.height);
    const w = bmp.width * s, h = bmp.height * s;
    x.drawImage(bmp, (W - w) / 2, (H - RULE - h) / 2, w, h);
    x.fillStyle = '#C9A766'; x.fillRect(0, H - RULE, W, RULE); // brand rule along the bottom
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(out); });
  } catch { return null; }
}

// Toast image for an earn target: YouTube → composited thumbnail; everything else → the
// static gold banner (TikTok/IG/X have no clean thumbnail-by-id). Never throws.
async function earnToastImage(platform, ref) {
  if (platform === 'youtube') return (await youtubeThumbCard(ref)) || 'icons/notif-earn.png';
  return 'icons/notif-earn.png';
}

async function checkSignals() {
  const r = await fetch(C.API + C.STATUS).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return;
  const store = await chrome.storage.local.get(['sigSeen', 'notifUrls', 'notifPrefs']);
  const seen = store.sigSeen || null;
  const notifUrls = store.notifUrls || {};
  const prefs = store.notifPrefs;
  const nowVideos = {};
  (r.latestVideos || []).forEach((v) => { if (v.videoId) nowVideos[v.channelId] = v.videoId; });

  if (seen) {
    if (r.streamLive && !seen.live && prefOn(prefs, 'kick') && !inKickQuietWindow()) {
      const id = `live-${Date.now()}`;
      notifUrls[id] = r.channelUrl;
      notify(id, { type: 'image', iconUrl: 'icons/kick.png', imageUrl: 'icons/notif-live.png', title: '🔴 Mizkif is LIVE on Kick', message: 'The stream just went live — vote & earn while you watch.', buttons: [{ title: 'Watch now' }], priority: 2 });
    }
    for (const v of (r.latestVideos || [])) {
      if (v.videoId && seen.videos[v.channelId] && v.videoId !== seen.videos[v.channelId] && prefOn(prefs, 'youtube')) {
        const id = `vid-${v.videoId}`;
        notifUrls[id] = homepageFor(v.url);
        const kind = (await isYouTubeShort(v.videoId)) ? 'Short' : 'video';
        const img = await youtubeThumbCard(v.videoId);
        const base = { iconUrl: 'icons/youtube.png', title: `New YouTube ${kind} — ${v.channelName}`, message: v.title ? `${v.title} — search for it on YouTube to watch.` : `New ${kind} — search for it on YouTube.`, priority: 2 };
        notify(id, img ? { ...base, type: 'image', imageUrl: img } : { ...base, type: 'basic' });
      }
    }
    const SOCIAL_TITLES = { tiktok: 'New TikTok — Mizkif', instagram: 'New Instagram — Mizkif', twitter: 'New X post — Mizkif' };
    const SOCIAL_ICONS = { tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', twitter: 'icons/x.png' };
    (r.latestSocial || []).forEach((s) => {
      const prev = (seen.social || {})[s.platform];
      if (s.url && prev && s.url !== prev && prefOn(prefs, SOCIAL_PLATFORM_KEY[s.platform] || s.platform)) {
        const id = `soc-${s.platform}-${Date.now()}`;
        notifUrls[id] = homepageFor(s.url);
        notify(id, { type: 'basic', iconUrl: SOCIAL_ICONS[s.platform] || 'icons/icon128.png', title: SOCIAL_TITLES[s.platform] || 'New post', message: s.title ? `${s.title} — open the app and search for it.` : 'New post — open the app and search for it.', priority: 2 });
      }
    });
  }
  const nowSocial = {};
  (r.latestSocial || []).forEach((s) => { if (s.url) nowSocial[s.platform] = s.url; });
  await chrome.storage.local.set({ sigSeen: { live: !!r.streamLive, videos: nowVideos, social: nowSocial }, notifUrls });
}

if (HAS_NOTIFICATIONS) {
  chrome.notifications.onClicked.addListener(async (id) => {
    const { notifUrls } = await chrome.storage.local.get('notifUrls');
    chrome.tabs.create({ url: (notifUrls && notifUrls[id]) || C.CHANNEL_URL });
    chrome.notifications.clear(id);
  });
  // Action buttons ("Watch now" / "Search & watch") open the same destination as the body.
  chrome.notifications.onButtonClicked.addListener(async (id) => {
    const { notifUrls } = await chrome.storage.local.get('notifUrls');
    chrome.tabs.create({ url: (notifUrls && notifUrls[id]) || C.CHANNEL_URL });
    chrome.notifications.clear(id);
  });
}
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
  updateBadge();
  if (details.reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});
// --- New earn target notifications ---
// Fires once per new target ref when the admin adds a YouTube/TikTok/IG/X post.
const TARGET_ICONS = { youtube: 'icons/youtube.png', tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', x: 'icons/x.png' };
const TARGET_TITLES = { youtube: 'New YouTube target — earn tickets', tiktok: 'New TikTok target — earn tickets', instagram: 'New Instagram target — earn tickets', x: 'New X target — earn tickets' };
const PLATFORM_NAME = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X' };
async function checkNewTargets() {
  const data = await s2Targets();
  const refs = (data.targets || []).map((t) => `${t.platform}:${t.ref}`);
  if (!refs.length) return;
  const store = await chrome.storage.local.get(['seenTargets', 'notifUrls', 'notifPrefs']);
  const seen = new Set(store.seenTargets || []);
  const notifUrls = store.notifUrls || {};
  const prefs = store.notifPrefs;
  const firstRun = seen.size === 0;
  // On the very first load, silently seed everything as seen (no install spam).
  if (firstRun) { refs.forEach((k) => seen.add(k)); await chrome.storage.local.set({ seenTargets: [...seen], notifUrls }); return; }
  for (const key of refs) {
    if (seen.has(key)) continue;
    const t = (data.targets || []).find((x) => `${x.platform}:${x.ref}` === key);
    if (!t) continue;
    // Staggered TikTok rollout: the server gates `notify` per-user so toasts spread out.
    // A not-yet-eligible target is NOT marked seen, so it can still fire at this user's
    // slot on a later poll. (Earning is unaffected — the target is live regardless.)
    if (t.notify === false) continue;
    seen.add(key); // only mark seen once we've decided to notify
    if (!prefOn(prefs, t.platform)) continue; // user muted this platform — seen, but no toast
    const id = `target-${key}`;
    notifUrls[id] = homepageFor(t.url || '');
    // Exact ticket value comes from the server per target (watch payout). Fall back to a
    // generic line if it's missing (older server).
    const n = Number(t.reward) || 0;
    const earn = n > 0 ? `Get ${n} ticket${n === 1 ? '' : 's'}` : 'Earn tickets';
    notify(id, {
      type: 'image',
      iconUrl: TARGET_ICONS[t.platform] || 'icons/icon128.png',
      imageUrl: await earnToastImage(t.platform, t.ref),
      title: `🎟 ${earn} — ${PLATFORM_NAME[t.platform] || 'new post'}`,
      message: t.label ? `${t.label} — search & watch to earn.` : `${earn}: search & watch the new post.`,
      buttons: [{ title: 'Search & watch' }],
      priority: 2,
    });
  }
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
  urls[id] = homepageFor(push.url);

  notify(id, {
    type: 'basic',
    iconUrl: 'icons/youtube.png',
    title: push.title,
    message: push.message || 'Open the app and search for it.',
    priority: 2,
  });

  await chrome.storage.local.set({ seenPushIds: [...seen], notifUrls: urls });
}

// --- Update check: compare the server's latest published version to ours ---
// Returns true if `latest` is a higher semver than `current` (numeric per-segment,
// so 1.0.13 > 1.0.9 — a plain string compare would get that backwards).
function isNewerVersion(latest, current) {
  const a = String(latest || '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(current || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
async function checkLatestVersion() {
  const r = await fetch(S2.API + S2.VERSION).catch(() => null);
  if (!r || !r.ok) return;
  const data = await r.json().catch(() => null);
  const latest = data && data.version;
  if (!latest) return;
  let current = '';
  try { current = chrome.runtime.getManifest().version || ''; } catch { /* ignore */ }
  // Stored for the overlay header badge and the popup to read.
  await chrome.storage.local.set({ extUpdate: { latest, available: isNewerVersion(latest, current) } });
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
  await checkLatestVersion();
});
// Also check right away on SW startup, so the badge appears without waiting for the alarm.
checkLatestVersion();
