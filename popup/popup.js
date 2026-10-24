const $ = (id) => document.getElementById(id);

async function refreshS2() {
  const r = await chrome.runtime.sendMessage({ type: 's2AuthState' }).catch(() => ({ connected: false }));
  popupConnected = !!(r && r.connected);
  document.body.classList.toggle('connected', popupConnected);
  $('s2connect').classList.toggle('pulse', !popupConnected);
  const s2status = $('s2status');
  s2status.replaceChildren();
  if (r && r.connected) {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = 'Connected ✓';
    s2status.append(ok, document.createTextNode(' Open any of his posts to earn.'));
  } else {
    s2status.textContent = 'Not connected yet.';
  }
}

const LINK_KICK_URL = 'https://mizkif.com/desk/positions';

function fmtTickets(n) {
  try { return Number(n).toLocaleString('en-US'); } catch { return String(n); }
}

function drawBalance(bal, connected) {
  const box = $('total');
  const gate = $('gate');
  const has = connected && bal && Number.isFinite(bal.tickets);
  box.hidden = !has;
  if (has) $('totalN').textContent = fmtTickets(bal.tickets);
  gate.hidden = !(connected && bal && bal.canEarn === false);
}

let popupConnected = false;
async function refreshBalance() {
  const { s2Balance } = await chrome.storage.local.get('s2Balance').catch(() => ({}));
  drawBalance(s2Balance, popupConnected);
  if (!popupConnected) return;
  const r = await chrome.runtime.sendMessage({ type: 's2Me' }).catch(() => null);
  if (r && r.connected === false) {
    popupConnected = false;
    drawBalance(null, false);
    if (r.error === 'not_connected') { refreshS2(); return; }
    const st = $('s2status');
    st.replaceChildren();
    st.textContent = 'Your connection expired. Connect with Kick again.';
    return;
  }
  if (r && !r.error && Number.isFinite(Number(r.tickets))) {
    drawBalance({ tickets: Number(r.tickets), canEarn: r.canEarn }, true);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.s2Balance) drawBalance(changes.s2Balance.newValue, popupConnected);
  if (changes.s2Token) { refreshS2().then(refreshBalance); }
});

$('gateBtn').addEventListener('click', () => { chrome.tabs.create({ url: LINK_KICK_URL }).catch(() => {}); });

$('s2connect').addEventListener('click', async () => {
  const btn = $('s2connect');
  btn.disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 's2Connect' }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  btn.disabled = false;
  if (r && !r.ok && r.error) {
    const s = $('s2status');
    if (s) { s.textContent = 'Connect failed: ' + r.error; s.style.color = '#C2452A'; }
  }
  refreshS2();
});

async function refreshVersion() {
  let current = '';
  try { current = chrome.runtime.getManifest().version || ''; } catch {   }
  $('ver').textContent = current ? 'v' + current : '';
  const { extUpdate } = await chrome.storage.local.get('extUpdate').catch(() => ({}));
  if (!extUpdate || !extUpdate.available) return;

  const u = $('update');
  $('updateText').textContent = `Update available: v${extUpdate.latest}`;
  u.style.display = 'block';

  const btn = $('updateBtn');
  const msg = $('updateMsg');
  const link = $('updateLink');
  const canSelfUpdate = !!(chrome.runtime && chrome.runtime.requestUpdateCheck);
  const STORE = canSelfUpdate
    ? 'https://chromewebstore.google.com/detail/rinaudo-capital/opnjljhcacpimaeohbbibagnicceeikb'
    : 'https://addons.mozilla.org/en-US/firefox/addon/rinaudo-capital/';
  link.href = STORE;

  if (!canSelfUpdate) {
    btn.style.display = 'none';
    link.style.display = 'inline';
    msg.textContent = 'Your browser installs updates from the add-ons site.';
    return;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    msg.textContent = 'Checking…';
    const r = await chrome.runtime.sendMessage({ type: 'applyUpdate' }).catch(() => null);
    const status = r && r.status;
    if (r && r.ok) {
      msg.textContent = 'Updating now…';
      return;
    }
    if (status === 'no_update') {
      msg.textContent = 'No update ready yet. The store has not rolled it out to you.';
    } else if (status === 'throttled') {
      msg.textContent = 'Checked too recently. Try again in a few minutes.';
    } else {
      msg.textContent = 'Could not update automatically.';
      link.style.display = 'inline';
    }
    btn.disabled = false;
  });
}

async function initNotifToggles() {
  const { notifPrefs } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
  const prefs = notifPrefs || {};
  for (const box of document.querySelectorAll('#notifs input[data-p]')) {
    const p = box.getAttribute('data-p');
    box.checked = prefs[p] !== false;
    box.addEventListener('change', async () => {
      const { notifPrefs: cur } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
      const next = { ...(cur || {}), [p]: box.checked };
      await chrome.storage.local.set({ notifPrefs: next });
    });
  }
}

const EARN_PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', facebook: 'Facebook', reddit: 'Reddit' };
const EARN_MAX_ROWS = 6;
const EARN_LABEL_CHARS = 40;

function truncate(s, n) {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function earnAmounts(t, data) {
  const d = data || {};
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  return {
    like: t.platform === 'x' && d.xLikeReward != null ? n(d.xLikeReward) : n(d.likeReward),
    repost: n(d.repostReward),
    watch: n(t.reward) || n(d.watchVideoReward) || n(d.watchVideoFloor) || 5,
  };
}

function buildCanRepost(platform) {
  const caps = self.BUILD_CAPS && self.BUILD_CAPS[platform];
  return !!(caps && caps.repost);
}

function earnTicks(t, data) {
  const acts = t.actions || {};
  const done = t.done || {};
  const amt = earnAmounts(t, data);
  const rows = [
    ['Like', acts.like === true && amt.like > 0, done.like === true],
    ['Repost', acts.repost === true && amt.repost > 0 && buildCanRepost(t.platform), done.repost === true],
    ['Watch', acts.watch === true && amt.watch > 0, done.watch === true],
  ].filter(([, worthDrawing]) => worthDrawing);
  if (!rows.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'earn-ticks';
  for (const [name, , isDone] of rows) {
    const chip = document.createElement('span');
    chip.className = isDone ? 'earn-tick done' : 'earn-tick';
    chip.textContent = isDone ? name + ' ✓' : name;
    wrap.append(chip);
  }
  return wrap;
}

const BRAND = self.RGCBrand || { LINK_STYLE: {}, svgIcon: () => null };
function earnRow(t, data) {
  const li = document.createElement('li');
  li.className = 'earn-item';
  const st = BRAND.LINK_STYLE[t.platform];
  if (st) li.style.setProperty('--platform', st[1]);
  const ic = document.createElement('span');
  ic.className = 'earn-ic';
  const svg = BRAND.svgIcon(t.platform);
  if (svg) ic.append(svg); else ic.textContent = '•';
  const body = document.createElement('div');
  body.className = 'earn-body';
  li.append(ic, body);
  const head = document.createElement('div');
  head.className = 'earn-head';
  const plat = document.createElement('span');
  plat.className = 'earn-plat';
  plat.textContent = EARN_PLATFORM[t.platform] || 'Post';
  const open = document.createElement('button');
  open.className = 'earn-open';
  open.type = 'button';
  open.textContent = 'Open';
  const EARN_CHANNEL = {
    youtube: 'https://www.youtube.com/',
    tiktok: 'https://www.tiktok.com/',
  };
  const dest = EARN_CHANNEL[t.platform] || t.url;
  open.addEventListener('click', () => { chrome.tabs.create({ url: dest }); });
  head.append(plat, open);
  body.append(head);
  const label = truncate(t.label, EARN_LABEL_CHARS);
  if (label) {
    const p = document.createElement('div');
    p.className = 'earn-label';
    p.textContent = label;
    body.append(p);
  }
  const ticks = earnTicks(t, data);
  if (ticks) body.append(ticks);
  return li;
}

async function initEarnNow() {
  const auth = await chrome.runtime.sendMessage({ type: 's2AuthState' }).catch(() => null);
  if (!auth || !auth.connected) return;
  const data = await chrome.runtime.sendMessage({ type: 's2Targets' }).catch(() => null);
  const all = data && Array.isArray(data.targets) ? data.targets : [];
  const listed = all.filter((t) => t && t.listed === true && typeof t.url === 'string' && t.url);
  if (!listed.length) return;
  const list = $('earnlist');
  list.replaceChildren();
  for (const t of listed.slice(0, EARN_MAX_ROWS)) list.append(earnRow(t, data));
  const extra = listed.length - EARN_MAX_ROWS;
  if (extra > 0) {
    const more = $('earnmore');
    more.textContent = `Plus ${extra} more on the Earn tab of the site.`;
    more.hidden = false;
  }
  $('earnnow').hidden = false;
}

async function initWidgetToggles() {
  const { widgetPrefs } = await chrome.storage.local.get('widgetPrefs').catch(() => ({}));
  const prefs = widgetPrefs || {};
  const box = $('toggleVote');
  box.checked = prefs.voteCard !== false;
  box.addEventListener('change', async () => {
    const { widgetPrefs: cur } = await chrome.storage.local.get('widgetPrefs').catch(() => ({}));
    await chrome.storage.local.set({ widgetPrefs: { ...(cur || {}), voteCard: box.checked } });
    const tabs = await chrome.tabs.query({ url: 'https://kick.com/mizkif*' }).catch(() => []);
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'rgcWidgetPrefs' }).catch(() => {});
  });
}

const DASH = { origins: ['https://dashboard.kick.com/*'] };
async function initDashboardBadges() {
  const btn = $('dashBtn'), state = $('dashState');
  if (!btn || !chrome.permissions) { const row = $('dashRow'); if (row) row.style.display = 'none'; return; }
  const draw = async () => {
    const on = await chrome.permissions.contains(DASH).catch(() => false);
    btn.textContent = on ? 'Turn Off' : 'Turn On';
    btn.classList.toggle('on', on);
    state.textContent = on ? 'On. Reload the dashboard tab to see them.' : 'For mods. Asks for access to dashboard.kick.com only.';
  };
  btn.addEventListener('click', async () => {
    const on = await chrome.permissions.contains(DASH).catch(() => false);
    if (on) await chrome.permissions.remove(DASH).catch(() => false);
    else await chrome.permissions.request(DASH).catch(() => false);
    chrome.runtime.sendMessage({ type: 'dashboardBadgesSync' }).catch(() => {});
    draw();
  });
  draw();
}

async function initGuideToggles() {
  const boxes = [...document.querySelectorAll('#widgets input[data-pref]')];
  const keys = boxes.map((b) => b.getAttribute('data-pref'));
  const got = await chrome.storage.local.get(keys).catch(() => ({}));
  for (const box of boxes) {
    const key = box.getAttribute('data-pref');
    box.checked = got[key] !== false;
    box.addEventListener('change', () => { chrome.storage.local.set({ [key]: box.checked }).catch(() => {}); });
  }
}

function renderLinks() {
  const wrap = $('links');
  const links = Array.isArray(self.MIZKIF_LINKS) ? self.MIZKIF_LINKS : [];
  wrap.replaceChildren();
  for (const l of links) {
    const a = document.createElement('a');
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener';
    const st = BRAND.LINK_STYLE[l.id] || [null, '#48d89f', 'Open'];
    a.style.setProperty('--platform', st[1]);
    const ic = document.createElement('span');
    ic.className = 'lic';
    const svg = st[0] ? BRAND.svgIcon(st[0]) : null;
    if (svg) ic.append(svg);
    else { const img = document.createElement('img'); img.src = '../icons/brand-m.png'; img.alt = ''; ic.append(img); }
    a.append(ic, document.createTextNode(l.label));
    a.addEventListener('click', (e) => {
      if (!chrome.tabs || !chrome.tabs.create) return;
      e.preventDefault();
      chrome.tabs.create({ url: l.url }).catch(() => { window.open(l.url, '_blank', 'noopener'); });
    });
    wrap.append(a);
  }
  $('hislinks').hidden = !links.length;
}

for (const el of document.querySelectorAll('[data-icon]')) {
  const svg = BRAND.svgIcon(el.getAttribute('data-icon'));
  if (svg) el.append(svg);
}
try {
  const A = self.RGCGuideAssets || {};
  for (const img of document.querySelectorAll('img[data-asset]')) {
    const src = A[img.getAttribute('data-asset')];
    if (typeof src === 'string') img.src = src;
  }
} catch {   }

refreshS2().then(refreshBalance);
refreshVersion();
initNotifToggles();
initGuideToggles();
initDashboardBadges();
initWidgetToggles();
renderLinks();
initEarnNow();
if (self.renderRates) renderRates($('rates'));

(async () => {
  try {
    const wanted = (chrome.runtime.getManifest().host_permissions || []).filter((o) => /^https:/.test(o));
    if (!wanted.length || !chrome.permissions || !chrome.permissions.contains) return;
    const have = await chrome.permissions.contains({ origins: wanted }).catch(() => true);
    if (have) return;
    const box = document.getElementById('hostgrant');
    const text = document.getElementById('hostgrantText');
    const btn = document.getElementById('hostgrantBtn');
    if (!box || !btn) return;
    const missing = [];
    for (const o of wanted) {
      const ok = await chrome.permissions.contains({ origins: [o] }).catch(() => true);
      if (!ok) missing.push(o.replace('https://', '').replace('/*', ''));
    }
    text.textContent = 'Your browser has not switched on earning for: '
      + [...new Set(missing.map((h) => h.replace(/^(www|m|web|old)\./, '')))].join(', ')
      + '. One click fixes it.';
    box.hidden = false;
    btn.addEventListener('click', async () => {
      const granted = await chrome.permissions.request({ origins: wanted }).catch(() => false);
      if (granted) { box.hidden = true; }
      else { text.textContent = 'The browser said no. You can also allow the sites from the extension\u2019s settings page.'; }
    });
  } catch {   }
})();

$('reportBtn').addEventListener('click', async () => {
  const btn = $('reportBtn');
  btn.disabled = true;
  let tab = null;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch { tab = null; }
  let page = null;
  if (tab && typeof tab.id === 'number') {
    page = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'rgcDiag' }).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 800)),
    ]);
  }
  await chrome.runtime.sendMessage({
    type: 'bugStart', from: 'popup', page: page && typeof page === 'object' ? page : null,
    windowId: tab ? tab.windowId : undefined,
  }).catch(() => null);
  try { window.close(); } catch {   }
});
