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

// Season-2 backend (separate app/DB from S1). Engagement (X like/comment) →
// tickets lands here. For local dev S2 runs on :4020; swap API for the deployed
// S2 origin when it ships.
self.S2 = {
  API: 'http://localhost:4020',
  CONNECT_PAGE: 'http://localhost:4020/extension/connect',
  EXCHANGE: '/api/extension/connect',
  TARGETS: '/api/extension/targets',
  ENGAGEMENT: '/api/extension/engagement',
};
