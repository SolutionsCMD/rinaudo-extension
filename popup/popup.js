// Popup: shows the Season-2 connect state and connects via the service worker.
// Builds DOM with textContent — never innerHTML with dynamic content.
const $ = (id) => document.getElementById(id);

async function refreshS2() {
  const r = await chrome.runtime.sendMessage({ type: 's2AuthState' }).catch(() => ({ connected: false }));
  const s2status = $('s2status');
  s2status.replaceChildren();
  if (r && r.connected) {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = 'Connected ✓';
    s2status.append(ok);
  } else {
    s2status.textContent = 'Not connected yet.';
  }
}

$('s2connect').addEventListener('click', async () => {
  const btn = $('s2connect');
  btn.disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 's2Connect' }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  btn.disabled = false;
  // Surface the real failure instead of silently doing nothing (esp. the Firefox connect flow).
  if (r && !r.ok && r.error) {
    const s = $('s2status');
    if (s) { s.textContent = 'Connect failed: ' + r.error; s.style.color = '#C2452A'; }
  }
  refreshS2();
});

// Show the current version, and an update banner if the SW flagged a newer one.
async function refreshVersion() {
  let current = '';
  try { current = chrome.runtime.getManifest().version || ''; } catch { /* ignore */ }
  $('ver').textContent = current ? 'v' + current : '';
  const { extUpdate } = await chrome.storage.local.get('extUpdate').catch(() => ({}));
  if (extUpdate && extUpdate.available) {
    const u = $('update');
    u.textContent = `Update available: v${extUpdate.latest}. Reload the extension to get the latest version.`;
    u.style.display = 'block';
  }
}

// Per-platform desktop-notification toggles. Stored in notifPrefs (opt-out: a platform
// is on unless explicitly false), read by the service worker before firing each toast.
async function initNotifToggles() {
  const { notifPrefs } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
  const prefs = notifPrefs || {};
  for (const box of document.querySelectorAll('#notifs input[data-p]')) {
    const p = box.getAttribute('data-p');
    box.checked = prefs[p] !== false; // default on
    box.addEventListener('change', async () => {
      const { notifPrefs: cur } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
      const next = { ...(cur || {}), [p]: box.checked };
      await chrome.storage.local.set({ notifPrefs: next });
    });
  }
}

// "Earn now": the live earn targets, fetched through the service worker (it holds the token).
// ONLY targets the server marks `listed` are drawn. Unlisted means hidden or honeypot, and a
// honeypot is bait for scripted claimers: showing one to an honest member with an Open button
// would walk them into a trap. A payload with no `listed` field is treated as unlisted, so an
// older or partial response hides rows instead of exposing them.
const EARN_PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X' };
const EARN_MAX_ROWS = 6;
const EARN_LABEL_CHARS = 40;

function truncate(s, n) {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// What one action pays on one target, read from the same targets payload the in-page card
// reads, so both surfaces quote one tariff. X has its own like amount and falls back to the
// global one; repost is a single global amount; a watch is priced per target by video
// length, so the target's own `reward` wins, with the global amount and then the floor
// (5, the same default the card uses) behind it. A watch therefore always pays something,
// which is why the card never hides that row either.
function earnAmounts(t, data) {
  const d = data || {};
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  return {
    like: t.platform === 'x' && d.xLikeReward != null ? n(d.xLikeReward) : n(d.likeReward),
    repost: n(d.repostReward),
    watch: n(t.reward) || n(d.watchVideoReward) || n(d.watchVideoFloor) || 5,
  };
}

// Can THIS build perform a repost on that platform? The in-page card asks the adapter in
// front of it (repostCapable()); the popup runs off the platform pages with no adapter in
// reach, so it reads the static map in config.js instead. A platform the map does not list
// gets no chip: an unknown build capability is never a promise.
function buildCanRepost(platform) {
  const caps = self.BUILD_CAPS && self.BUILD_CAPS[platform];
  return !!(caps && caps.repost);
}

// One chip per action the platform offers AND pays for, ticked when this member has already
// collected it. Gates the card applies too, all required: a capability the server does not
// report is never a promise, and an action the tariff prices at 0 is not earning yet, so it
// must not be advertised here either (repost is exactly that today). Repost carries a third
// gate, buildCanRepost, because the server's matrix offers it on platforms whose adapters
// cannot yet do it. The one case a 0 is still worth showing is a like on a target that pays
// for a watch: there the like is the gate that unlocks the watch payout, which is what the
// card labels 'Required', so the chip stays and says so.
function earnTicks(t, data) {
  const acts = t.actions || {};
  const done = t.done || {};
  const amt = earnAmounts(t, data);
  const likeGatesWatch = acts.watch === true && amt.watch > 0;
  const rows = [
    ['Like', acts.like === true && (amt.like > 0 || likeGatesWatch), done.like === true, amt.like === 0],
    ['Repost', acts.repost === true && amt.repost > 0 && buildCanRepost(t.platform), done.repost === true, false],
    ['Watch', acts.watch === true && amt.watch > 0, done.watch === true, false],
  ].filter(([, worthDrawing]) => worthDrawing);
  if (!rows.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'earn-ticks';
  for (const [name, , isDone, required] of rows) {
    const chip = document.createElement('span');
    chip.className = isDone ? 'earn-tick done' : 'earn-tick';
    chip.textContent = isDone ? name + ' ✓' : (required ? name + ' (required)' : name);
    wrap.append(chip);
  }
  return wrap;
}

function earnRow(t, data) {
  const li = document.createElement('li');
  li.className = 'earn-item';
  const head = document.createElement('div');
  head.className = 'earn-head';
  const plat = document.createElement('span');
  plat.className = 'earn-plat';
  plat.textContent = EARN_PLATFORM[t.platform] || 'Post';
  const open = document.createElement('button');
  open.className = 'earn-open';
  open.type = 'button';
  open.textContent = 'Open';
  open.addEventListener('click', () => { chrome.tabs.create({ url: t.url }); });
  head.append(plat, open);
  li.append(head);
  const label = truncate(t.label, EARN_LABEL_CHARS);
  if (label) {
    const p = document.createElement('div');
    p.className = 'earn-label';
    p.textContent = label;
    li.append(p);
  }
  const ticks = earnTicks(t, data);
  if (ticks) li.append(ticks);
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
  box.checked = prefs.voteCard !== false; // default on
  box.addEventListener('change', async () => {
    const { widgetPrefs: cur } = await chrome.storage.local.get('widgetPrefs').catch(() => ({}));
    await chrome.storage.local.set({ widgetPrefs: { ...(cur || {}), voteCard: box.checked } });
    // Tell any open Kick tab to apply the change immediately.
    chrome.tabs.query({ url: 'https://kick.com/mizkif*' }, (tabs) => {
      for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'rgcWidgetPrefs' }).catch(() => {});
    });
  });
}

refreshS2();
refreshVersion();
initNotifToggles();
initWidgetToggles();
initEarnNow();
if (self.renderRates) renderRates($('rates'));
