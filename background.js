if (typeof importScripts === 'function') importScripts('config.js', 'toast.js');
const C = self.RGC;
const S2 = self.S2;

const getS2Token = async () => (await chrome.storage.local.get('s2Token')).s2Token || null;

const HAS_NOTIFICATIONS = !!(chrome.notifications && chrome.notifications.create);
function notify(id, opts) { try { if (HAS_NOTIFICATIONS) chrome.notifications.create(id, opts); } catch {   } }

async function toastOptions(kind, data, fallback) {
  try {
    if (self.MGToast) {
      const o = await self.MGToast.build(kind, data);
      return /firefox/i.test(navigator.userAgent || '') ? self.MGToast.firefox(o) : o;
    }
  } catch {   }
  return fallback;
}

const PLATFORM_HOME = {
  youtube: 'https://www.youtube.com/@Mizkif',
  tiktok: 'https://www.tiktok.com/@realmizkif',
  instagram: 'https://www.instagram.com/realmizkif/',
  facebook: 'https://www.facebook.com/realmizkif/reels',
  twitter: 'https://x.com/REALMizkif',
  x: 'https://x.com/REALMizkif',
};
const CHANNEL_ONLY = new Set(['youtube', 'tiktok']);
const YT_CHANNEL_HOME = {
  Mizkif: 'https://www.youtube.com/@Mizkif',
  MizkifLive: 'https://www.youtube.com/@MizkifLive',
};
const channelHome = (platform, channel) =>
  (platform === 'youtube' && channel && YT_CHANNEL_HOME[channel]) || PLATFORM_HOME[platform] || '';
const postLink = (url, platform, channel) =>
  (CHANNEL_ONLY.has(platform) ? channelHome(platform, channel) : url) || PLATFORM_HOME[platform] || '';

function homepageFor(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  if (host.endsWith('youtube.com') || host === 'youtu.be') return PLATFORM_HOME.youtube;
  if (host.endsWith('tiktok.com')) return PLATFORM_HOME.tiktok;
  if (host.endsWith('instagram.com') || host === 'instagr.am') return PLATFORM_HOME.instagram;
  if (host.endsWith('facebook.com')) return PLATFORM_HOME.facebook;
  if (host.endsWith('x.com') || host.endsWith('twitter.com')) return PLATFORM_HOME.x;
  return url;
}


const prefOn = (prefs, p) => !prefs || prefs[p] !== false;
const SOCIAL_PLATFORM_KEY = { tiktok: 'tiktok', instagram: 'instagram', twitter: 'x' };

async function updateBadge() {
  const token = await getS2Token();
  try {
    await chrome.action.setBadgeText({ text: token ? '' : '!' });
    if (!token) await chrome.action.setBadgeBackgroundColor({ color: '#C9A766' });
  } catch {   }
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.s2Token) updateBadge(); });
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(updateBadge);


function badgeTextFor(state, secondsLeft) {
  if (state === 'paused') return 'II';
  if (state !== 'counting') return '';
  const s = Math.ceil(Number(secondsLeft));
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) {
    const tens = Math.ceil(s / 10) * 10;
    return tens >= 60 ? '1m' : tens + 's';
  }
  const m = Math.ceil(s / 60);
  return m <= 99 ? m + 'm' : Math.ceil(s / 3600) + 'h';
}

function balanceNext(prev, reply, sentAt, src) {
  const BALANCE_RACE_MS = 10000;
  const credit = (s) => s === 'engagement' || s === 'watch' || s === 'kick';
  if (!reply || typeof reply !== 'object') return null;
  const raw = reply.tickets;
  const n = raw == null || raw === '' || typeof raw === 'boolean' ? NaN : Number(raw);
  const hasTickets = Number.isFinite(n);
  const hasCanEarn = typeof reply.canEarn === 'boolean';
  if (!hasTickets && !hasCanEarn) return null;
  const at = Number(sentAt) || 0;
  const p = prev && typeof prev === 'object' ? prev : null;
  const pAt = p ? Number(p.at) || 0 : 0;
  const pTickets = p && Number.isFinite(p.tickets) ? p.tickets : null;
  let tickets = hasTickets ? Math.round(n) : pTickets;
  let stamp = at, from = typeof src === 'string' ? src : '';
  if (p && pAt > at) {
    const raises = credit(src) && !credit(p.src) && hasTickets && pTickets != null && tickets > pTickets
      && pAt - at < BALANCE_RACE_MS;
    if (!raises) return null;
    stamp = pAt;
  } else if (p && hasTickets && pTickets != null && tickets < pTickets && credit(p.src) && !credit(src)
      && src !== 'stake' && at - pAt < BALANCE_RACE_MS) {
    tickets = pTickets;
    from = p.src;
  }
  const next = {
    tickets,
    canEarn: hasCanEarn ? reply.canEarn : (p && typeof p.canEarn === 'boolean' ? p.canEarn : null),
    at: stamp,
    src: from,
  };
  if (p && p.tickets === next.tickets && p.canEarn === next.canEarn && at - (Number(p.at) || 0) < 60 * 1000) return null;
  return next;
}

function welcomeOnUpdate(previousVersion, currentVersion, alreadyShown) {
  if (alreadyShown === true || !previousVersion || !currentVersion) return false;
  const v = '1.177';
  return isNewerVersion(v, previousVersion) && !isNewerVersion(v, currentVersion);
}

function reasonFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const why = typeof body.reason === 'string' ? body.reason : body.error;
  return typeof why === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(why) ? why : null;
}

function sharedRead(ttlMs, now) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  let cache = null;
  let inflight = null;
  let gen = 0;
  return {
    forget() { gen++; cache = null; inflight = null; },
    async get(token, load) {
      if (cache && cache.token === token && clock() - cache.at < ttlMs) return cache.data;
      if (inflight && inflight.token === token) return inflight.p;
      const g = gen;
      const p = Promise.resolve().then(() => load(token));
      inflight = { token, p };
      try {
        const data = await p;
        if (g === gen) cache = { at: clock(), token, data };
        return data;
      } finally {
        if (inflight && inflight.p === p) inflight = null;
      }
    },
  };
}

async function s2Connect() {
  await chrome.tabs.create({ url: S2.CONNECT_PAGE });
}

async function s2ConnectDone(tabId) {
  if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch {   } }
}

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

let _extVersion = '';
function extVersion() {
  if (!_extVersion) { try { _extVersion = chrome.runtime.getManifest().version || ''; } catch {   } }
  return _extVersion;
}

async function s2Headers(token, json) {
  const h = {
    Authorization: `Bearer ${token}`,
    'X-RGC-Device': await getDeviceId(),
    'X-RGC-Client': extVersion(),
  };
  const fp = await getFingerprint();
  if (fp) h['X-RGC-Fingerprint'] = fp;
  const caps = await getCaps();
  if (caps) h['X-RGC-Caps'] = caps;
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function httpFail(r, base) {
  const out = { ...(base || {}), error: 'http_' + r.status };
  const why = reasonFromBody(await r.json().catch(() => null));
  if (why) out.reason = why;
  return out;
}

let balanceChain = Promise.resolve();
let balanceFloor = 0;
function noteBalance(reply, sentAt, src) {
  if (!reply || typeof reply !== 'object') return;
  if (reply.tickets == null && typeof reply.canEarn !== 'boolean') return;
  if (sentAt < balanceFloor) return;
  balanceChain = balanceChain.then(async () => {
    const { s2Balance } = await chrome.storage.local.get('s2Balance');
    const next = balanceNext(s2Balance, reply, sentAt, src);
    if (next) await chrome.storage.local.set({ s2Balance: next });
  }).catch(() => {   });
}

const TARGETS_TTL_MS = 5000;
const targetsRead = sharedRead(TARGETS_TTL_MS);
async function fetchTargets(token) {
  const empty = (extra) => ({ targets: [], likeReward: 0, commentReward: 0, ...extra });
  const sentAt = Date.now();
  const r = await fetch(S2.API + S2.TARGETS, { headers: await s2Headers(token) }).catch(() => null);
  if (!r) return empty({ connected: true, error: 'network' });
  if (!r.ok) return httpFail(r, empty({ connected: r.status !== 401 }));
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object' || !Array.isArray(j.targets)) return empty({ connected: true, error: 'bad_json' });
  noteBalance(j, sentAt, 'targets');
  return { ...j, connected: true };
}
async function s2Targets() {
  const token = await getS2Token();
  if (!token) return { targets: [], likeReward: 0, commentReward: 0, connected: false, error: 'not_connected' };
  return targetsRead.get(token, fetchTargets);
}

const ME_TTL_MS = 3000;
const meRead = sharedRead(ME_TTL_MS);
async function fetchMe(token) {
  const sentAt = Date.now();
  const r = await fetch(S2.API + (S2.ME || '/api/extension/me'), { headers: await s2Headers(token) }).catch(() => null);
  if (!r) return { connected: true, error: 'network' };
  if (!r.ok) return httpFail(r, { connected: r.status !== 401 });
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') return { connected: true, error: 'bad_json' };
  noteBalance(j, sentAt, 'me');
  return { ...j, connected: true };
}
async function s2Me() {
  const token = await getS2Token();
  if (!token) return { connected: false, error: 'not_connected' };
  return meRead.get(token, fetchMe);
}

const openRead = sharedRead(60000);
async function s2OpenTargets() {
  return openRead.get('open', async () => {
    const r = await fetch(S2.API + (S2.OPEN_TARGETS || '/api/extension/open-targets')).catch(() => null);
    if (!r || !r.ok) return { targets: [], error: r ? 'http_' + r.status : 'network' };
    const j = await r.json().catch(() => null);
    const list = j && Array.isArray(j.targets) ? j.targets.filter((t) => t && typeof t.platform === 'string' && typeof t.ref === 'string') : [];
    return { targets: list.map((t) => ({ platform: t.platform, ref: t.ref })) };
  });
}

function forgetReads() { targetsRead.forget(); meRead.forget(); }

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.s2Token) return;
  forgetReads();
  balanceFloor = Date.now();
  balanceChain = balanceChain.then(() => chrome.storage.local.remove('s2Balance')).catch(() => {});
  if (changes.s2Token.newValue) void s2Me();
});

async function s2Discover(platform, refs) {
  const token = await getS2Token();
  if (!token || !Array.isArray(refs) || !refs.length) return { ok: false };
  const r = await fetch(S2.API + S2.DISCOVER, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, refs: refs.slice(0, 30) }),
  }).catch(() => null);
  return { ok: !!(r && r.ok) };
}

async function s2Debug(kind, data) {
  const token = await getS2Token();
  if (!token) return;
  fetch(S2.API + S2.DEBUG, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ kind, data }),
  }).catch(() => {});
}

let uiQueue = [];
const UI_QUEUE_MAX = 50;

async function s2FlushUi() {
  if (!uiQueue.length) return;
  const token = await getS2Token();
  if (!token) { uiQueue = []; return; }
  const batch = uiQueue.slice(0, UI_QUEUE_MAX);
  uiQueue = uiQueue.slice(batch.length);
  try {
    await fetch(S2.API + S2.UI_EVENTS, {
      method: 'POST', headers: await s2Headers(token, true),
      body: JSON.stringify({ events: batch }),
    });
  } catch {   }
}

function s2LogUi(e) {
  try {
    const ver = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    uiQueue.push({ ...e, client: `extension ${ver}`.trim() });
    if (uiQueue.length >= UI_QUEUE_MAX) void s2FlushUi();
  } catch {   }
}

async function s2Engagement(platform, action, ref, commentId, text) {
  const token = await getS2Token();
  if (!token) return { error: 'not_connected' };
  const body = { platform, action, ref };
  if (typeof commentId === 'string' && commentId) body.commentId = commentId;
  if (action === 'comment' && typeof text === 'string' && text.trim()) body.text = text.slice(0, 2000);
  const sentAt = Date.now();
  const r = await fetch(S2.API + S2.ENGAGEMENT, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return { error: 'network' };
  if (!r.ok) return httpFail(r);
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') return { error: 'bad_json' };
  if (!('credited' in j)) return { error: 'bad_response' };
  forgetReads();
  noteBalance(j, sentAt, 'engagement');
  return j;
}

async function s2CommentDeleted(platform, ref, commentId) {
  const token = await getS2Token();
  if (!token) return { error: 'not_connected' };
  const r = await fetch(S2.API + S2.ENGAGEMENT_DELETE, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, ref, commentId: commentId || null }),
  }).catch(() => null);
  if (!r) return { error: 'network' };
  if (!r.ok) return { error: 'http_' + r.status };
  forgetReads();
  return (await r.json().catch(() => null)) || { error: 'bad_json' };
}

async function s2WatchSession(platform, videoRef, playerDuration) {
  const token = await getS2Token();
  if (!token) return { error: 'not_connected' };
  const r = await fetch(S2.API + S2.WATCH_SESSION, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, videoRef, playerDuration }),
  }).catch(() => null);
  if (!r) return { error: 'network' };
  if (!r.ok) return httpFail(r);
  return r.json().catch(() => ({ error: 'bad_json' }));
}
async function s2WatchHeartbeat(sessionId) {
  const token = await getS2Token();
  if (!token) return { counted: false, error: 'not_connected' };
  const r = await fetch(S2.API + S2.WATCH_HEARTBEAT, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ sessionId }),
  }).catch(() => null);
  if (!r) return { counted: false, error: 'network' };
  if (!r.ok) return httpFail(r, { counted: false });
  return r.json().catch(() => ({ counted: false, error: 'bad_json' }));
}
async function s2WatchClaim(platform, videoRef, mode) {
  const token = await getS2Token();
  if (!token) return { ok: false, error: 'not_connected' };
  const sentAt = Date.now();
  const r = await fetch(S2.API + S2.WATCH_CLAIM, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ platform, videoRef, mode }),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network' };
  if (!r.ok) return httpFail(r, { ok: false });
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') return { ok: false, error: 'bad_json' };
  forgetReads();
  noteBalance(j, sentAt, 'watch');
  return j;
}
async function s2KickCheckin() {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected', error: 'not_connected' };
  const sentAt = Date.now();
  const r = await fetch(S2.API + S2.KICK_CHECKIN, {
    method: 'POST',
    headers: await s2Headers(token),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network' };
  if (!r.ok) return httpFail(r, { ok: false });
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') return { ok: false, error: 'bad_json' };
  meRead.forget();
  noteBalance(j, sentAt, 'kick');
  return j;
}

const ACT_MAX = 40;
let actLog = null;
async function actLoad() {
  if (actLog) return actLog;
  actLog = [];
  try {
    if (chrome.storage.session) {
      const { bugAct } = await chrome.storage.session.get('bugAct');
      if (Array.isArray(bugAct)) actLog = bugAct.slice(-ACT_MAX);
    }
  } catch {   }
  return actLog;
}
function actEntry(msg, out, at) {
  const TYPES = { s2Engagement: 'engagement', s2WatchSession: 'watchSession', s2WatchClaim: 'watchClaim',
    s2KickCheckin: 'kickCheckin', s2CommentDeleted: 'commentDeleted' };
  const type = msg && TYPES[msg.type];
  if (!type) return null;
  const o = out && typeof out === 'object' ? out : {};
  const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v == null ? undefined : String(v).slice(0, n));
  const e = { at, type };
  const platform = cut(msg.platform, 16); if (platform) e.platform = platform;
  const action = cut(msg.action || msg.mode, 20); if (action) e.action = action;
  const ref = cut(msg.ref || msg.videoRef, 80); if (ref) e.ref = ref;
  if (o.error) e.error = cut(o.error, 30);
  if (o.reason) e.reason = cut(o.reason, 40);
  if (typeof o.credited === 'boolean') e.credited = o.credited;
  if (typeof o.ok === 'boolean') e.ok = o.ok;
  if (typeof o.awarded === 'number' || typeof o.awarded === 'boolean') e.awarded = o.awarded;
  if (o.earnGate === true) e.earnGate = true;
  return e;
}
function actNote(msg, out) {
  const e = actEntry(msg, out, Date.now());
  if (!e) return;
  void actLoad().then((log) => {
    log.push(e);
    if (log.length > ACT_MAX) log.splice(0, log.length - ACT_MAX);
    try { if (chrome.storage.session) chrome.storage.session.set({ bugAct: log }).catch(() => {}); } catch {   }
  });
}

function uaInfo(ua) {
  const s = String(ua || '');
  const pick = (re) => { const m = re.exec(s); return m ? m[1] : ''; };
  let name = '', ver = '';
  if (/Edg(?:A|iOS)?\//.test(s)) { name = 'Edge'; ver = pick(/Edg(?:A|iOS)?\/(\d+)/); }
  else if (/OPR\//.test(s)) { name = 'Opera'; ver = pick(/OPR\/(\d+)/); }
  else if (/Firefox\//.test(s)) { name = 'Firefox'; ver = pick(/Firefox\/(\d+)/); }
  else if (/Chrome\//.test(s)) { name = 'Chrome'; ver = pick(/Chrome\/(\d+)/); }
  else if (/Safari\//.test(s)) { name = 'Safari'; ver = pick(/Version\/(\d+)/); }
  let os = '';
  if (/Android/.test(s)) os = 'Android ' + pick(/Android (\d+)/);
  else if (/iPhone|iPad/.test(s)) os = 'iOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'Mac';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  return { name, ver, os: os.trim(), mobile: /Mobile|Android|iPhone/.test(s) };
}

async function bugWorkerDiag() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const u = uaInfo(ua);
  const token = await getS2Token().catch(() => null);
  let st = {};
  try { st = await chrome.storage.local.get(['s2Balance', 'notifPrefs', 'guideSound', 'guideOn', 'extUpdate', 'shareHidden']); } catch { st = {}; }
  const bal = st.s2Balance || {};
  return {
    v: 1,
    ext: { version: extVersion(), browser: { name: u.name, ver: u.ver }, os: u.os, mobile: u.mobile },
    conn: { connected: !!token, tickets: typeof bal.tickets === 'number' ? bal.tickets : null, canEarn: typeof bal.canEarn === 'boolean' ? bal.canEarn : null },
    prefs: { sound: st.guideSound !== false, guide: st.guideOn !== false, notif: st.notifPrefs || {}, shareHidden: st.shareHidden === true },
    update: st.extUpdate ? { available: !!st.extUpdate.available, latest: st.extUpdate.latest || '' } : null,
    activity: (await actLoad()).slice(),
  };
}

async function bugShot(windowId) {
  try {
    if (!chrome.tabs || typeof chrome.tabs.captureVisibleTab !== 'function') return null;
    const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
    if (typeof raw !== 'string' || !raw.startsWith('data:image/')) return null;
    if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return raw.length < 1_300_000 ? raw : null;
    const blob = await (await fetch(raw)).blob();
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 1600 / bmp.width);
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    const url = await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(out); });
    return typeof url === 'string' && url.length < 1_300_000 ? url : null;
  } catch { return null; }
}

const bugDrafts = new Map();
const BUG_DRAFT_MS = 3600000;
async function bugSaveDraft(id, d) {
  bugDrafts.set(id, d);
  try { if (chrome.storage.session) await chrome.storage.session.set({ ['bugDraft:' + id]: d }); } catch {   }
}
async function bugLoadDraft(id) {
  let d = bugDrafts.get(id) || null;
  if (!d) { try { if (chrome.storage.session) d = (await chrome.storage.session.get('bugDraft:' + id))['bugDraft:' + id] || null; } catch { d = null; } }
  return d && Date.now() - (d.at || 0) < BUG_DRAFT_MS ? d : null;
}
async function bugDropDraft(id) {
  bugDrafts.delete(id);
  try { if (chrome.storage.session) await chrome.storage.session.remove('bugDraft:' + id); } catch {   }
}

async function bugStart(msg, sender) {
  const tab = sender && sender.tab;
  const windowId = tab ? tab.windowId : (typeof msg.windowId === 'number' ? msg.windowId : undefined);
  const shot = await bugShot(windowId);
  const page = msg.page && typeof msg.page === 'object' ? msg.page : null;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await bugSaveDraft(id, {
    at: Date.now(),
    from: ['panel', 'reject', 'popup'].includes(msg.from) ? msg.from : 'popup',
    reason: typeof msg.reason === 'string' ? msg.reason.slice(0, 40) : null,
    page, shot,
  });
  const url = chrome.runtime.getURL('report.html') + '?d=' + id;
  try { await chrome.tabs.create({ url, index: tab && typeof tab.index === 'number' ? tab.index + 1 : undefined }); }
  catch { try { await chrome.tabs.create({ url }); } catch { return { ok: false }; } }
  return { ok: true };
}

async function bugDraft(id) {
  const d = await bugLoadDraft(String(id || ''));
  const diag = await bugWorkerDiag();
  if (d) { diag.page = d.page; diag.from = d.from; if (d.reason) diag.rejectReason = d.reason; }
  else diag.from = 'direct';
  return { diag, shot: d ? d.shot : null };
}

async function bugPrefill() {
  const token = await getS2Token().catch(() => null);
  if (!token) return { connected: false, kick: null };
  const r = await fetch(S2.API + (S2.BUG_REPORT || '/api/extension/bug-report'), { headers: await s2Headers(token) }).catch(() => null);
  if (!r || !r.ok) return { connected: true, kick: null };
  const j = await r.json().catch(() => null);
  return { connected: true, kick: j && typeof j.kick === 'string' ? j.kick : null };
}

async function bugSubmit(msg) {
  const token = await getS2Token().catch(() => null);
  const headers = token ? await s2Headers(token, true) : { 'Content-Type': 'application/json', 'X-RGC-Client': extVersion() };
  const body = { message: String(msg.message || ''), kickName: msg.kickName ? String(msg.kickName) : null, diag: msg.diag || null };
  if (typeof msg.screenshot === 'string' && msg.screenshot) body.screenshot = msg.screenshot;
  const r = await fetch(S2.API + (S2.BUG_REPORT || '/api/extension/bug-report'), {
    method: 'POST', headers, body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return { ok: false, error: 'network' };
  const j = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, error: (j && j.error) || 'http_' + r.status };
  if (msg.draftId) void bugDropDraft(String(msg.draftId));
  return { ok: true, id: j && j.id };
}

async function s2Poll() {
  const token = await getS2Token();
  const headers = token
    ? { Authorization: `Bearer ${token}`, 'X-RGC-Client': extVersion() }
    : { 'X-RGC-Client': extVersion() };
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
  if (r && r.ok) meRead.forget();
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}

async function s2AmountVote(sessionId, amountCents) {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const r = await fetch(S2.API + S2.AMOUNT_VOTE, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ sessionId, amountCents }),
  }).catch(() => null);
  return r && r.ok ? r.json().catch(() => ({ ok: false })) : { ok: false };
}

async function s2AiBattleStake(battleId, sideIdx, tickets) {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const r = await fetch(S2.API + S2.AI_BATTLE, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ battleId, sideIdx, tickets }),
  }).catch(() => null);
  if (r) meRead.forget();
  return r ? r.json().catch(() => ({ ok: false })) : { ok: false };
}

async function s2Round() {
  const token = await getS2Token();
  const headers = token
    ? { Authorization: `Bearer ${token}`, 'X-RGC-Client': extVersion() }
    : { 'X-RGC-Client': extVersion() };
  const r = await fetch(S2.API + S2.ROUND, { headers }).catch(() => null);
  const base = r && r.ok ? await r.json().catch(() => ({ round: null, me: null })) : { round: null, me: null };
  return { ...base, connected: !!token };
}

async function s2RoundAction(action, ticker, amount) {
  const token = await getS2Token();
  if (!token) return { ok: false, reason: 'not_connected' };
  const sentAt = Date.now();
  const r = await fetch(S2.API + S2.ROUND, {
    method: 'POST', headers: await s2Headers(token, true),
    body: JSON.stringify({ action, ticker, amount }),
  }).catch(() => null);
  if (r) meRead.forget();
  const j = r ? await r.json().catch(() => ({ ok: false })) : { ok: false };
  if (j && j.ok === true && j.tickets != null) noteBalance({ tickets: j.tickets }, sentAt, 'stake');
  return j;
}


const BADGE_RED = '#d6002f';
const BADGE_GOLD = '#C9A766';
let badgeTabsP = null;
function loadBadgeTabs() {
  if (!badgeTabsP) {
    badgeTabsP = (async () => {
      const m = new Map();
      try {
        if (chrome.storage.session) {
          const { badgeTabs } = await chrome.storage.session.get('badgeTabs');
          for (const id of Array.isArray(badgeTabs) ? badgeTabs : []) m.set(id, '?');
        }
      } catch {   }
      return m;
    })();
  }
  return badgeTabsP;
}
function saveBadgeTabs(m) {
  try {
    if (chrome.storage.session) chrome.storage.session.set({ badgeTabs: [...m.keys()].slice(-50) }).catch(() => {});
  } catch {   }
}
function badgeTextFromMessage(msg) {
  const m = msg || {};
  if (m.state === 'counting' && m.secondsLeft == null && typeof m.text === 'string') {
    return /^(\d{1,2}[smh])$/.test(m.text) ? m.text : '';
  }
  return badgeTextFor(m.state, m.secondsLeft);
}
let badgeChain = Promise.resolve();
function setTabBadge(tabId, text) {
  const run = badgeChain.then(() => applyTabBadge(tabId, text));
  badgeChain = run.catch(() => {});
  return run;
}
async function applyTabBadge(tabId, text) {
  const a = chrome.action;
  if (!a || typeof a.setBadgeText !== 'function') return;
  const tabs = await loadBadgeTabs();
  if (text) {
    if (tabs.get(tabId) === text) return;
    try {
      await a.setBadgeText({ tabId, text });
      await a.setBadgeBackgroundColor({ tabId, color: BADGE_RED });
    } catch { return; }
    if (typeof a.setBadgeTextColor === 'function') {
      try { await a.setBadgeTextColor({ tabId, color: '#FFFFFF' }); } catch {   }
    }
    tabs.set(tabId, text);
    saveBadgeTabs(tabs);
    return;
  }
  if (!tabs.has(tabId)) return;
  tabs.delete(tabId);
  saveBadgeTabs(tabs);
  try { await a.setBadgeText({ tabId, text: null }); }
  catch {
    const token = await getS2Token().catch(() => null);
    try { await a.setBadgeText({ tabId, text: token ? '' : '!' }); } catch {   }
  }
  try { await a.setBadgeBackgroundColor({ tabId, color: BADGE_GOLD }); } catch {   }
  if (typeof a.setBadgeTextColor === 'function') {
    try { await a.setBadgeTextColor({ tabId, color: null }); } catch {   }
  }
}
async function s2Badge(sender, msg) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (typeof tabId !== 'number' || tabId < 0) return { ok: false };
  if (sender.frameId) return { ok: false };
  const text = badgeTextFromMessage(msg);
  await setTabBadge(tabId, text);
  return { ok: true, text };
}
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!info || info.status !== 'loading') return;
    void setTabBadge(tabId, '').catch(() => {});
  });
}

const DASH_ORIGIN = 'https://dashboard.kick.com/*';
const DASH_SCRIPT_ID = 'rgc-kick-badges-dashboard';
async function syncDashboardBadges() {
  try {
    if (!chrome.permissions || !chrome.scripting || !chrome.scripting.registerContentScripts) return;
    const granted = await chrome.permissions.contains({ origins: [DASH_ORIGIN] });
    const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [DASH_SCRIPT_ID] })).length > 0;
    if (granted && !have) {
      await chrome.scripting.registerContentScripts([{
        id: DASH_SCRIPT_ID, matches: ['https://dashboard.kick.com/moderator/mizkif*'],
        js: ['content/kick-badges.js'], runAt: 'document_idle', persistAcrossSessions: true,
      }]);
    } else if (!granted && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [DASH_SCRIPT_ID] });
    }
  } catch (e) {
    console.warn('[rgc] dashboard badges:', (e && e.message) || e);
  }
}
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(syncDashboardBadges);
  chrome.permissions.onRemoved.addListener(syncDashboardBadges);
}
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(syncDashboardBadges);
chrome.runtime.onInstalled.addListener(syncDashboardBadges);

const KICK_RANKS_MIN_MS = 4.5 * 60 * 1000;
let kickRanksInFlight = null;
function kickRanksRefresh() {
  if (kickRanksInFlight) return kickRanksInFlight;
  kickRanksInFlight = (async () => {
    try {
      const { kickRanks: cur, kickBadges } = await chrome.storage.local.get(['kickRanks', 'kickBadges']);
      if (kickBadges === false) return { ok: true, skipped: 'off' };
      if (cur && cur.fetchedAt && Date.now() - cur.fetchedAt < KICK_RANKS_MIN_MS) return { ok: true, cached: true };
      const headers = cur && cur.etag ? { 'If-None-Match': cur.etag } : {};
      const r = await fetch(`${self.S2.API}/api/extension/ranks`, { headers, cache: 'no-store' });
      if (r.status === 304 && cur) {
        await chrome.storage.local.set({ kickRanks: { ...cur, fetchedAt: Date.now() } });
        return { ok: true, unchanged: true };
      }
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json();
      if (!j || typeof j.ranks !== 'object') return { ok: false, error: 'bad_body' };
      await chrome.storage.local.set({ kickRanks: {
        ranks: j.ranks, tiers: j.tiers, total: j.total, season: j.season,
        etag: r.headers.get('etag'), fetchedAt: Date.now(),
      } });
      return { ok: true, total: j.total };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      kickRanksInFlight = null;
    }
  })();
  return kickRanksInFlight;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 's2Connect') { const e = await s2Connect().then(() => null).catch((x) => x); if (e) console.error('[rgc] s2Connect failed:', e); reply({ ok: !e, error: e ? (e.message || String(e)) : null }); }
    else if (msg.type === 's2ConnectDone') { await s2ConnectDone(_sender && _sender.tab && _sender.tab.id); reply({ ok: true }); }
    else if (msg.type === 's2AuthState') { reply({ connected: !!(await getS2Token()) }); }
    else if (msg.type === 's2Targets') { reply(await s2Targets()); }
    else if (msg.type === 's2Me') { reply(await s2Me()); }
    else if (msg.type === 's2OpenTargets') { reply(await s2OpenTargets()); }
    else if (msg.type === 's2Badge') { reply(await s2Badge(_sender, msg)); }
    else if (msg.type === 's2Engagement') { const o = await s2Engagement(msg.platform || 'x', msg.action, msg.ref, msg.commentId, msg.text); actNote(msg, o); reply(o); }
    else if (msg.type === 's2CommentDeleted') { const o = await s2CommentDeleted(msg.platform || 'youtube', msg.ref, msg.commentId); actNote(msg, o); reply(o); }
    else if (msg.type === 'kickRanks') { reply(await kickRanksRefresh()); }
    else if (msg.type === 'dashboardBadgesSync') { await syncDashboardBadges(); reply({ ok: true }); }
    else if (msg.type === 's2Debug') { s2Debug(msg.kind || 'x', msg.data); reply({ ok: true }); }
    else if (msg.type === 's2Discover') { reply(await s2Discover(msg.platform, msg.refs)); }
    else if (msg.type === 's2LogUi') { s2LogUi(msg.event || {}); reply({ ok: true }); }
    else if (msg.type === 's2FlushUi') { await s2FlushUi(); reply({ ok: true }); }
    else if (msg.type === 's2WatchSession') { const o = await s2WatchSession(msg.platform, msg.videoRef, msg.playerDuration); actNote(msg, o); reply(o); }
    else if (msg.type === 's2WatchHeartbeat') { reply(await s2WatchHeartbeat(msg.sessionId)); }
    else if (msg.type === 's2WatchClaim') { const o = await s2WatchClaim(msg.platform, msg.videoRef, msg.mode); actNote(msg, o); reply(o); }
    else if (msg.type === 's2KickCheckin') { const o = await s2KickCheckin(); actNote(msg, o); reply(o); }
    else if (msg.type === 'bugStart') { reply(await bugStart(msg, _sender)); }
    else if (msg.type === 'bugDraft') { reply(await bugDraft(msg.id)); }
    else if (msg.type === 'bugPrefill') { reply(await bugPrefill()); }
    else if (msg.type === 'bugSubmit') { reply(await bugSubmit(msg)); }
    else if (msg.type === 'applyUpdate') { reply(await applyUpdate()); }
    else if (msg.type === 's2Poll') { reply(await s2Poll()); }
    else if (msg.type === 's2PollVote') { reply(await s2PollVote(msg.pollId, msg.optionIdx)); }
    else if (msg.type === 's2AmountVote') { reply(await s2AmountVote(msg.sessionId, msg.amountCents)); }
    else if (msg.type === 's2AiBattleStake') { reply(await s2AiBattleStake(msg.battleId, msg.sideIdx, msg.tickets)); }
    else if (msg.type === 's2Round') { reply(await s2Round()); }
    else if (msg.type === 's2RoundAction') { reply(await s2RoundAction(msg.action, msg.ticker, msg.amount)); }
    else if (msg.type === 'resize') { reply({ ok: true }); }
  })();
  return true;
});


function inKickQuietWindow(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(now);
  const wd = p.find((x) => x.type === 'weekday').value;
  let hr = parseInt(p.find((x) => x.type === 'hour').value, 10);
  if (hr === 24) hr = 0;
  const weekend = wd === 'Sat' || wd === 'Sun';
  const night = hr >= 20 || hr < 8;
  return weekend || night;
}

const MAX_NOTIFY_AGE_MS = 2 * 60 * 60 * 1000;
function isFresh(publishedAt) {
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  return Number.isFinite(t) && Date.now() - t <= MAX_NOTIFY_AGE_MS;
}

async function checkSignals() {
  const r = await fetch(C.API + C.STATUS).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return false;
  const store = await chrome.storage.local.get(['sigSeen', 'notifUrls', 'notifPrefs']);
  const seen = store.sigSeen || null;
  const notifUrls = store.notifUrls || {};
  const prefs = store.notifPrefs;
  const nowVideos = {};
  (r.latestVideos || []).forEach((v) => { if (v.videoId) nowVideos[v.channelId] = v.videoId; });

  const vidSeen = new Set(seen?.vidSeen || []);
  const socSeen = new Set(seen?.socSeen || []);
  const seeding = !seen || !seen.vidSeen;
  const fire = [];

  if (seen) {
    if (r.streamLive && !seen.live && prefOn(prefs, 'kick') && !inKickQuietWindow()) {
      const id = `live-${Date.now()}`;
      notifUrls[id] = r.channelUrl;
      fire.push({ id, kind: 'live', data: { channelUrl: r.channelUrl }, fallback: { type: 'basic', iconUrl: 'icons/kick.png', title: 'Mizkif is live on Kick', message: 'The stream just started. Vote and earn while you watch.', priority: 2 } });
    }
    for (const v of (r.latestVideos || [])) {
      if (!v.videoId || vidSeen.has(v.videoId)) continue;
      vidSeen.add(v.videoId);
    }
    const SOCIAL_TITLES = { tiktok: 'New TikTok: Mizkif', instagram: 'New Instagram: Mizkif', twitter: 'New X post: Mizkif' };
    const SOCIAL_ICONS = { tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', twitter: 'icons/x.png' };
    for (const s of (r.latestSocial || [])) {
      if (!s.url || socSeen.has(s.url)) continue;
      socSeen.add(s.url);
      if (seeding || !prefOn(prefs, SOCIAL_PLATFORM_KEY[s.platform] || s.platform)) continue;
      const id = `soc-${s.platform}-${Date.now()}`;
      notifUrls[id] = postLink(s.url, s.platform);
      fire.push({ id, kind: 'social', data: { platform: s.platform, url: s.url, title: s.title }, fallback: { type: 'basic', iconUrl: SOCIAL_ICONS[s.platform] || 'icons/icon128.png', title: SOCIAL_TITLES[s.platform] || 'New post', message: 'New post. Click to open it.', priority: 2 } });
    }
  } else {
    (r.latestVideos || []).forEach((v) => { if (v.videoId) vidSeen.add(v.videoId); });
    (r.latestSocial || []).forEach((s) => { if (s.url) socSeen.add(s.url); });
  }
  const nowSocial = {};
  (r.latestSocial || []).forEach((s) => { if (s.url) nowSocial[s.platform] = s.url; });
  await chrome.storage.local.set({
    sigSeen: {
      live: !!r.streamLive, videos: nowVideos, social: nowSocial,
      vidSeen: [...vidSeen].slice(-60),
      socSeen: [...socSeen].slice(-30),
    },
    notifUrls,
  });
  for (const f of fire) notify(f.id, await toastOptions(f.kind, f.data, f.fallback));
  return !!r.streamLive;
}

async function checkS2Status() {
  const r = await fetch(S2.API + S2.STATUS).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return;
  await chrome.storage.local.set({
    watchWidgetHidden: r.watchWidgetHidden === true,
    shareHidden: r.shareHidden === true,
  });
}

if (HAS_NOTIFICATIONS) {
  chrome.notifications.onClicked.addListener(async (id) => {
    const { notifUrls } = await chrome.storage.local.get('notifUrls');
    chrome.tabs.create({ url: (notifUrls && notifUrls[id]) || C.CHANNEL_URL });
    chrome.notifications.clear(id);
  });
  chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
    const { notifUrls } = await chrome.storage.local.get('notifUrls');
    const u = notifUrls || {};
    chrome.tabs.create({ url: u[`${id}#b${buttonIndex}`] || u[id] || C.CHANNEL_URL });
    chrome.notifications.clear(id);
  });
}
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('poll', { periodInMinutes: 0.5 });
  updateBadge();
  if (details.reason === 'install') {
    chrome.storage.local.set({ welcomeShown177: true }).catch(() => {});
    chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update') {
    void maybeWelcomeOnUpdate(details.previousVersion);
  }
});

async function maybeWelcomeOnUpdate(previousVersion) {
  try {
    const { welcomeShown177 } = await chrome.storage.local.get('welcomeShown177');
    if (!welcomeOnUpdate(previousVersion, extVersion(), welcomeShown177)) return;
    await chrome.storage.local.set({ welcomeShown177: true });
    await chrome.tabs.create({ url: 'welcome.html?updated=1', active: false });
  } catch {   }
}
const TARGET_ICONS = { youtube: 'icons/youtube.png', tiktok: 'icons/tiktok.png', instagram: 'icons/instagram.png', x: 'icons/x.png' };
async function checkNewTargets() {
  const data = await s2Targets();
  const refs = (data.targets || []).map((t) => `${t.platform}:${t.ref}`);
  if (!refs.length) return;
  const store = await chrome.storage.local.get(['seenTargets', 'notifUrls', 'notifPrefs']);
  const seen = new Set(store.seenTargets || []);
  const notifUrls = store.notifUrls || {};
  const prefs = store.notifPrefs;
  const fire = [];
  const firstRun = seen.size === 0;
  if (firstRun) { refs.forEach((k) => seen.add(k)); await chrome.storage.local.set({ seenTargets: [...seen], notifUrls }); return; }
  for (const key of refs) {
    if (seen.has(key)) continue;
    const t = (data.targets || []).find((x) => `${x.platform}:${x.ref}` === key);
    if (!t) continue;
    if (t.listed !== true) continue;
    if (t.notify === false) continue;
    seen.add(key);
    if (!prefOn(prefs, t.platform)) continue;
    const id = `target-${key}`;
    notifUrls[id] = postLink(t.url, t.platform, t.channel);
    fire.push({ id, t });
  }
  let toast = null;
  if (fire.length === 1) {
    toast = { id: fire[0].id, kind: 'target', data: fire[0].t };
  } else if (fire.length > 1) {
    const id = `targets-${Date.now()}`;
    notifUrls[id] = notifUrls[fire[0].id];
    fire.slice(0, 2).forEach((f, i) => { notifUrls[`${id}#b${i}`] = notifUrls[f.id]; });
    fire.forEach((f) => { delete notifUrls[f.id]; });
    toast = { id, kind: 'targets', data: fire.map((f) => f.t) };
  }
  await chrome.storage.local.set({ seenTargets: [...seen], notifUrls });
  if (!toast) return;
  const n = Number(fire[0].t.reward) || 0;
  notify(toast.id, await toastOptions(toast.kind, toast.data, {
    type: 'basic',
    iconUrl: TARGET_ICONS[fire[0].t.platform] || 'icons/icon128.png',
    title: n > 0 ? `New Mizkif post: ${n} ticket${n === 1 ? '' : 's'}` : 'New Mizkif post',
    message: 'Open it to earn tickets.',
    priority: 2,
  }));
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
  await chrome.storage.local.set({ seenPushIds: [...seen], notifUrls: urls });

  let pushIcon = 'icons/icon128.png';
  try {
    const h = new URL(push.url).hostname.replace(/^www\./, '');
    if (h.endsWith('x.com') || h.endsWith('twitter.com')) pushIcon = 'icons/x.png';
    else if (h.endsWith('youtube.com') || h === 'youtu.be') pushIcon = 'icons/youtube.png';
    else if (h.endsWith('tiktok.com')) pushIcon = 'icons/tiktok.png';
    else if (h.endsWith('instagram.com') || h === 'instagr.am') pushIcon = 'icons/instagram.png';
  } catch {   }
  notify(id, await toastOptions('push', { title: push.title, message: push.message, url: push.url }, {
    type: 'basic',
    iconUrl: pushIcon,
    title: push.title,
    message: push.message || 'Open the app and search for it.',
    priority: 2,
  }));
}

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
  try { current = chrome.runtime.getManifest().version || ''; } catch {   }
  await chrome.storage.local.set({ extUpdate: { latest, available: isNewerVersion(latest, current) } });
}

async function applyUpdate() {
  if (!chrome.runtime.requestUpdateCheck) return { ok: false, status: 'unsupported' };
  try {
    const res = await new Promise((resolve) => {
      try {
        const r = chrome.runtime.requestUpdateCheck((status, details) => resolve({ status, details }));
        if (r && typeof r.then === 'function') r.then((d) => resolve(d && d.status ? d : { status: d })).catch(() => resolve({ status: 'error' }));
      } catch { resolve({ status: 'error' }); }
    });
    const status = (res && (res.status || res)) || 'error';
    if (status === 'update_available') {
      setTimeout(() => { try { chrome.runtime.reload(); } catch {   } }, 300);
      return { ok: true, status: 'update_available' };
    }
    return { ok: false, status: String(status) };
  } catch {
    return { ok: false, status: 'error' };
  }
}

const SEL_HEALTH_SEND_MS = 10 * 60 * 1000;
async function sendSelectorHealth() {
  try {
    const store = await chrome.storage.local.get(['selHealth', 'selHealthSentAt']);
    const reports = store.selHealth;
    if (!Array.isArray(reports) || reports.length === 0) return;
    if (Date.now() - (Number(store.selHealthSentAt) || 0) < SEL_HEALTH_SEND_MS) return;
    const token = await getS2Token();
    if (!token) return;
    await chrome.storage.local.set({ selHealthSentAt: Date.now() });
    let version = '';
    try { version = chrome.runtime.getManifest().version || ''; } catch {   }
    const r = await fetch(S2.API + S2.TELEMETRY, {
      method: 'POST', headers: await s2Headers(token, true),
      body: JSON.stringify({ version, reports }),
    }).catch(() => null);
    if (r && r.ok) await chrome.storage.local.remove('selHealth');
  } catch {   }
}

const OFFLINE_SKIP = 6;

let polling = false;
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'poll') return;
  if (polling) return;
  polling = true;
  try {

  const live = await checkSignals();

  if (!live) {
    const { offTick = 0 } = await chrome.storage.local.get('offTick');
    const next = (offTick + 1) % OFFLINE_SKIP;
    await chrome.storage.local.set({ offTick: next });
    if (next !== 0) return;
  } else if (typeof chrome.storage.local.set === 'function') {
    await chrome.storage.local.set({ offTick: 0 });
  }

  await checkNewTargets();
  await checkManualPush();
  await checkLatestVersion();
  await checkS2Status();
  await sendSelectorHealth();
  } finally { polling = false; }
});
(async () => {
  try {
    const { bootChecksAt } = await chrome.storage.local.get('bootChecksAt');
    const now = Date.now();
    if (now - (Number(bootChecksAt) || 0) < 2 * 60 * 1000 && now >= (Number(bootChecksAt) || 0)) return;
    await chrome.storage.local.set({ bootChecksAt: now });
  } catch {   }
  checkLatestVersion();
  checkS2Status();
})();
