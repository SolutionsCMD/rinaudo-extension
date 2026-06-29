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
  await chrome.runtime.sendMessage({ type: 's2Connect' });
  btn.disabled = false;
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
    u.textContent = `Update available — v${extUpdate.latest}. Reload the extension to get the latest version.`;
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
if (self.renderRates) renderRates($('rates'));
