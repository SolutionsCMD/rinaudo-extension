// Shared config. Loaded as a content script (isolated world) and via
// importScripts() in the service worker — `self` exists in both, so this works
// in each. S1 (rinaudoglobal) is used only for the public notifications feed now.
self.RGC = {
  API: 'https://rinaudoglobal.com',
  CHANNEL_URL: 'https://kick.com/mizkif',
  STATUS: '/api/extension/status',
};

// Season-2 backend (separate app/DB). Engagement (X like/comment) → tickets.
// Points at the deployed S2 origin; for same-machine local dev, temporarily
// change API + CONNECT_PAGE to http://localhost:4020.
self.S2 = {
  API: 'https://s2.jsolutions.dev',
  CONNECT_PAGE: 'https://s2.jsolutions.dev/extension/connect',
  EXCHANGE: '/api/extension/connect',
  TARGETS: '/api/extension/targets',
  ENGAGEMENT: '/api/extension/engagement',
  POLL: '/api/extension/poll',
  POLL_VOTE: '/api/extension/poll-vote',
  POLL_FAST_MS: 5000,
  // YouTube watch-to-earn (backend system already on s2; needs to accept the
  // extension bearer — see the backend handoff).
  WATCH_SESSION: '/api/watch/session',
  WATCH_HEARTBEAT: '/api/watch/heartbeat',
  WATCH_CLAIM: '/api/watch/claim',
  KICK_CHECKIN: '/api/extension/kick/checkin',
};
