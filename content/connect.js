(function () {
  const api = (typeof browser !== 'undefined' && browser && browser.storage) ? browser : chrome;
  let code = '';
  try { code = new URLSearchParams(location.search).get('code') || ''; } catch { return; }
  if (!code) return;

  function setStatus(text, ok) {
    try {
      const h = document.querySelector('[data-connect-status]');
      if (h) { h.textContent = text; if (ok === false) h.style.color = '#C2452A'; }
    } catch {   }
  }

  (async () => {
    try {
      const r = await fetch('/api/extension/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) { setStatus('Connection failed. Reopen the extension and tap Connect again.', false); return; }
      const data = await r.json().catch(() => null);
      if (!data || !data.token) { setStatus('Connection failed. Please try again.', false); return; }
      await api.storage.local.set({ s2Token: data.token });
      setStatus('Connected ✓. You can close this tab.', true);
      try {
        const send = api.runtime.sendMessage({ type: 's2ConnectDone' });
        if (send && typeof send.catch === 'function') send.catch(() => {});
      } catch {   }
    } catch {
      setStatus('Connection failed. Check your connection and try again.', false);
    }
  })();
})();
