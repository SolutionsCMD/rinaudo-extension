// Onboarding page opened on first install. Connect-with-Kick button talks to the
// service worker; builds DOM with textContent (never innerHTML with dynamic data).
const btn = document.getElementById('connect');
const status = document.getElementById('status');

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: 's2AuthState' }).catch(() => ({ connected: false }));
  status.replaceChildren();
  if (r && r.connected) {
    const ok = document.createElement('span'); ok.className = 'ok';
    ok.textContent = "Connected ✓ — you're all set. You can close this tab.";
    status.append(ok);
    btn.textContent = 'Connected'; btn.disabled = true;
  } else {
    status.textContent = 'Not connected yet.';
    btn.textContent = 'Connect with Kick'; btn.disabled = false;
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 's2Connect' });
  refresh();
});

refresh();
