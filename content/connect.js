// Injected on the S2 /extension/connect page. Finishes the tab-based connect flow.
//
// Once the page mints a one-time code it redirects to ...?code=<code>. We do the whole
// handshake RIGHT HERE rather than round-tripping through the background worker (whose
// message channel is flaky on Firefox Android): a same-origin POST to /api/extension/connect
// (CORS-open, code-only, no cookies needed) returns the token, and we write it straight to
// the extension's shared storage — the popup + background both read the same store, and the
// background's storage listener clears the toolbar badge. Then we best-effort ask the
// background to close this tab.
(function () {
  // Firefox exposes promise-based `browser.*`; Chrome uses `chrome.*`. storage/runtime are
  // shared across all extension contexts, so writing the token here is seen everywhere.
  const api = (typeof browser !== 'undefined' && browser && browser.storage) ? browser : chrome;
  let code = '';
  try { code = new URLSearchParams(location.search).get('code') || ''; } catch { return; }
  if (!code) return;

  function setStatus(text, ok) {
    try {
      const h = document.querySelector('[data-connect-status]');
      if (h) { h.textContent = text; if (ok === false) h.style.color = '#C2452A'; }
    } catch { /* ignore */ }
  }

  (async () => {
    try {
      const r = await fetch('/api/extension/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) { setStatus('Connection failed — reopen the extension and tap Connect again.', false); return; }
      const data = await r.json().catch(() => null);
      if (!data || !data.token) { setStatus('Connection failed — please try again.', false); return; }
      await api.storage.local.set({ s2Token: data.token });
      setStatus('Connected ✓ — you can close this tab.', true);
      // Best-effort tab close via the background (content scripts can't close their own tab).
      try {
        const send = api.runtime.sendMessage({ type: 's2ConnectDone' });
        if (send && typeof send.catch === 'function') send.catch(() => {});
      } catch { /* fine — user closes the tab manually */ }
    } catch {
      setStatus('Connection failed — check your connection and try again.', false);
    }
  })();
})();
