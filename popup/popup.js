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

refreshS2();
refreshVersion();
if (self.renderRates) renderRates($('rates'));
