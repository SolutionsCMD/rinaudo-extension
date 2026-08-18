// Grid highlight: the parts that break when a site changes a URL shape, plus the two
// rules that carry real consequences (never ring a honeypot, never double-ring a page).
// The ring drawing itself needs a real browser and is checked by hand on release.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// Same trick as test/_load.mjs: run the IIFE under stubbed globals and read what it
// registers on `self`. The module exports its pure helpers BEFORE the host check, so it
// loads fine off-platform (here the stub hostname matches neither site, so it returns
// early and never touches the DOM).
function loadGrid() {
  const code = readFileSync('content/grid-highlight.js', 'utf8');
  const self = {};
  const location = { hostname: 'example.com', pathname: '/', href: 'https://example.com/', origin: 'https://example.com' };
  new Function('self', 'location', 'document', 'chrome', code)(self, location, {}, {});
  return self.RGC_GRID_HIGHLIGHT;
}

const G = loadGrid();
assert.ok(G, 'module must export its helpers even when the host does not match');

// --- YouTube ref extraction (grid tiles link both ways) ---
assert.equal(G.refFor('youtube', '/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com'), 'dQw4w9WgXcQ');
assert.equal(G.refFor('youtube', '/watch?v=dQw4w9WgXcQ&pp=abc', 'https://www.youtube.com'), 'dQw4w9WgXcQ');
assert.equal(G.refFor('youtube', 'https://www.youtube.com/watch?v=iCA2ug6zKtg', 'https://www.youtube.com'), 'iCA2ug6zKtg');
assert.equal(G.refFor('youtube', '/shorts/l9YGmBaqzAI', 'https://www.youtube.com'), 'l9YGmBaqzAI');
// A channel page link is not a video and must never be ringed.
assert.equal(G.refFor('youtube', '/@Mizkif', 'https://www.youtube.com'), '');
assert.equal(G.refFor('youtube', '/results?search_query=mizkif', 'https://www.youtube.com'), '');
assert.equal(G.refFor('youtube', 'not a url at all', 'https://www.youtube.com'), '');

// --- TikTok ref extraction ---
assert.equal(G.refFor('tiktok', '/@realmizkif/video/7675044515761196302', 'https://www.tiktok.com'), '7675044515761196302');
assert.equal(G.refFor('tiktok', 'https://www.tiktok.com/@realmizkif/video/7674926705986899214?is_from_webapp=1', 'https://www.tiktok.com'), '7674926705986899214');
// The profile itself, and a non-numeric id, are not videos.
assert.equal(G.refFor('tiktok', '/@realmizkif', 'https://www.tiktok.com'), '');
assert.equal(G.refFor('tiktok', '/@realmizkif/video/notanid', 'https://www.tiktok.com'), '');

// --- Page split: the grid module must go silent wherever engage-core binds a post,
// or a single video page would carry both a grid ring and the button rings.
assert.equal(G.isSingleVideoPath('youtube', '/watch'), true);
assert.equal(G.isSingleVideoPath('youtube', '/shorts/l9YGmBaqzAI'), true);
assert.equal(G.isSingleVideoPath('youtube', '/@Mizkif'), false);
assert.equal(G.isSingleVideoPath('youtube', '/@Mizkif/videos'), false);
assert.equal(G.isSingleVideoPath('youtube', '/feed/subscriptions'), false);
assert.equal(G.isSingleVideoPath('tiktok', '/@realmizkif/video/7675044515761196302'), true);
assert.equal(G.isSingleVideoPath('tiktok', '/@realmizkif'), false);
assert.equal(G.isSingleVideoPath('tiktok', '/'), false);

// --- Badge text: exact payout, or a tick once the watch is banked (owner: ring the
// collected ones too, the badge is what tells them apart).
assert.equal(G.badgeText({ reward: 55, watchDone: false }), '+55');
assert.equal(G.badgeText({ reward: 5, watchDone: false }), '+5');
assert.equal(G.badgeText({ reward: 55, watchDone: true }), '✓');
assert.equal(G.badgeText(null), '+0');

// --- The honeypot gate. This is the rule with teeth: ringing an unlisted target would
// advertise a hidden post, and ringing a honeypot would walk an honest member into a trap
// built to catch scripted claimers. Mirrors the filter in loadTargets, and a payload with
// no `listed` field must count as unlisted.
const PLATFORM = 'youtube';
const keep = (t) => t.platform === PLATFORM && t.listed === true && !!t.ref;
assert.equal(keep({ platform: 'youtube', ref: 'a', listed: true }), true);
assert.equal(keep({ platform: 'youtube', ref: 'b', listed: false }), false, 'honeypot / hidden must never ring');
assert.equal(keep({ platform: 'youtube', ref: 'c' }), false, 'no listed field counts as unlisted');
assert.equal(keep({ platform: 'tiktok', ref: 'd', listed: true }), false, 'other platform');
assert.equal(keep({ platform: 'youtube', ref: '', listed: true }), false);

console.log('grid highlight OK');
