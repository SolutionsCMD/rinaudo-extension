self.RGC = {
  API: 'https://rinaudoglobal.com',
  CHANNEL_URL: 'https://kick.com/mizkif',
  STATUS: '/api/extension/status',
};

self.S2 = {
  API: 'https://s2.jsolutions.dev',
  CONNECT_PAGE: 'https://s2.jsolutions.dev/extension/connect',
  EXCHANGE: '/api/extension/connect',
  TARGETS: '/api/extension/targets',
  STATUS: '/api/extension/status',
  ENGAGEMENT: '/api/extension/engagement',
  ENGAGEMENT_DELETE: '/api/extension/engagement/delete',
  UI_EVENTS: '/api/ui-events',
  POLL: '/api/extension/poll',
  POLL_VOTE: '/api/extension/poll-vote',
  AMOUNT_VOTE: '/api/extension/amount-vote',
  AI_BATTLE: '/api/extension/ai-battle',
  ROUND: '/api/extension/round',
  POLL_FAST_MS: 10000,
  WATCH_SESSION: '/api/watch/session',
  WATCH_HEARTBEAT: '/api/watch/heartbeat',
  WATCH_CLAIM: '/api/watch/claim',
  KICK_CHECKIN: '/api/extension/kick/checkin',
  PUSH: '/api/extension/push',
  DISCOVER: '/api/extension/discover',
  VERSION: '/api/extension/version',
  DEBUG: '/api/extension/debug',
  TELEMETRY: '/api/extension/telemetry',
  ME: '/api/extension/me',
  OPEN_TARGETS: '/api/extension/open-targets',
  BUG_REPORT: '/api/extension/bug-report',
};

self.MIZKIF_LINKS = [
  { id: 'kick', label: 'Kick', url: 'https://kick.com/mizkif' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@Mizkif' },
  { id: 'youtube-live', label: 'MizkifLive', url: 'https://www.youtube.com/channel/UCuI9WIhxx-bDwHj5tF2FqIA' },
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@realmizkif' },
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/realmizkif/' },
  { id: 'x', label: 'X', url: 'https://x.com/Realmizkif' },
  { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/realmizkif' },
  { id: 'discord', label: 'Discord', url: 'https://discord.gg/MIZKIF' },
  { id: 'site', label: 'Website', url: 'https://mizkif.com' },
];

self.BUILD_CAPS = {
  x:         { repost: true,  send: false },
  tiktok:    { repost: true,  send: false },
  instagram: { repost: true,  send: false },
  facebook:  { repost: true,  send: false },
  youtube:   { repost: false, send: false },
};
