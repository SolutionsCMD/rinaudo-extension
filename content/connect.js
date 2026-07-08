// Injected on the S2 /extension/connect page. The tab-based connect flow finishes here:
// once the page has minted a one-time code it redirects to ...?code=<code>. We read that
// code off the URL and hand it to the service worker, which exchanges it for a session
// token and closes this tab. Works on Chrome, Firefox, and mobile (no chrome.identity).
(function () {
  try {
    const code = new URLSearchParams(location.search).get('code');
    if (!code) return;
    chrome.runtime.sendMessage({ type: 's2ConnectCode', code }).catch(() => {});
  } catch { /* not in an extension context / no runtime */ }
})();
