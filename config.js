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
  STATUS: '/api/extension/status',
  ENGAGEMENT: '/api/extension/engagement',
  UI_EVENTS: '/api/ui-events',
  POLL: '/api/extension/poll',
  POLL_VOTE: '/api/extension/poll-vote',
  // Stake-on-a-ticker rounds: GET → {round, me, connected}, POST →
  // {action:'nominate'|'stake'|'join', ticker?, amount?}.
  ROUND: '/api/extension/round',
  // Widget refresh cadence. Each tick costs TWO engine requests (round + poll), so
  // this number multiplies by every viewer watching the stream. At 5s with ~400
  // concurrent viewers it was ~160 req/s on its own and the box was stalling
  // (2026-08-10). 10s is still well inside the vote windows.
  POLL_FAST_MS: 10000,
  // YouTube watch-to-earn (backend system already on s2; needs to accept the
  // extension bearer — see the backend handoff).
  WATCH_SESSION: '/api/watch/session',
  WATCH_HEARTBEAT: '/api/watch/heartbeat',
  WATCH_CLAIM: '/api/watch/claim',
  KICK_CHECKIN: '/api/extension/kick/checkin',
  PUSH: '/api/extension/push',
  VERSION: '/api/extension/version',
  DEBUG: '/api/extension/debug',
  // Selector-health reports (which adapter selectors failed to resolve on real pages).
  TELEMETRY: '/api/extension/telemetry',
};

// What THIS BUILD can actually do and prove, per platform. The server's actions matrix
// says what the platform offers; this says what our adapters implement. TikTok and
// Instagram flip to true only when their live discovery lands the control signatures and
// selectors. The popup reads this because it runs off-page and cannot probe the adapter
// the way the in-page widget's repostCapable() does.
self.BUILD_CAPS = {
  x:         { repost: true,  send: false },
  tiktok:    { repost: true,  send: false },
  instagram: { repost: true,  send: false },
  facebook:  { repost: true,  send: false },
  youtube:   { repost: false, send: false },
};
