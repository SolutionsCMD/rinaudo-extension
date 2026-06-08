// Shared config. Loaded both as a content script (page isolated world) and via
// importScripts() in the service worker — `self` exists in both, so this works
// in each. To point at staging or a different channel, change it here only.
self.RGC = {
  API: 'https://rinaudoglobal.com',
  CHANNEL_URL: 'https://kick.com/mizkif',
  CHANNEL_TAB_MATCH: 'https://kick.com/mizkif*',
  ACTIVE: '/api/custom-polls/active',
  VOTE: '/api/custom-polls/vote',
  TRADES_ACTIVE: '/api/trades/active',
  VOTES: '/api/votes',
  STATUS: '/api/extension/status',
  EARN: '/api/extension/earn',
  EARN_HEARTBEAT: '/api/extension/earn-heartbeat',
  CONNECT_PAGE: 'https://rinaudoglobal.com/extension/connect',
  EXCHANGE: '/api/extension/connect',
  DISCONNECT: '/api/extension/disconnect',
  POLL_FAST_MS: 7000,
};
