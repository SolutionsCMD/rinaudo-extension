// Grid highlight: the parts that break when a site changes a URL shape, plus the two
// rules that carry real consequences (never ring an unlisted target, never double-ring).
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

// --- The listed gate. This is the rule with teeth: the server decides what a member may
// be shown, and anything it has not listed must never be surfaced. Mirrors the filter in
// loadTargets, and a payload with no `listed` field must count as unlisted.
const PLATFORM = 'youtube';
const keep = (t) => t.platform === PLATFORM && t.listed === true && !!t.ref;
assert.equal(keep({ platform: 'youtube', ref: 'a', listed: true }), true);
assert.equal(keep({ platform: 'youtube', ref: 'b', listed: false }), false, 'an unlisted target must never ring');
assert.equal(keep({ platform: 'youtube', ref: 'c' }), false, 'no listed field counts as unlisted');
assert.equal(keep({ platform: 'tiktok', ref: 'd', listed: true }), false, 'other platform');
assert.equal(keep({ platform: 'youtube', ref: '', listed: true }), false);

// --- The three platforms added on 2026-08-18 ---
assert.equal(G.refFor('x', '/REALMizkif/status/2089505354837106881', 'https://x.com'), '2089505354837106881');
assert.equal(G.refFor('x', 'https://x.com/i/web/status/2089420102009819576', 'https://x.com'), '2089420102009819576');
assert.equal(G.refFor('x', '/REALMizkif', 'https://x.com'), '', 'a profile link is not a post');
assert.equal(G.refFor('x', '/i/lists/123', 'https://x.com'), '');

assert.equal(G.refFor('instagram', '/p/DcJh2sZjj8k/', 'https://www.instagram.com'), 'DcJh2sZjj8k');
assert.equal(G.refFor('instagram', '/reel/DcKh0IZD4lz/', 'https://www.instagram.com'), 'DcKh0IZD4lz');
assert.equal(G.refFor('instagram', '/tv/ABC123def/', 'https://www.instagram.com'), 'ABC123def');
assert.equal(G.refFor('instagram', '/realmizkif/', 'https://www.instagram.com'), '', 'profile is not a post');

assert.equal(G.refFor('facebook', '/reel/1735287921076691', 'https://www.facebook.com'), '1735287921076691');
assert.equal(G.refFor('facebook', '/realmizkif', 'https://www.facebook.com'), '');

// Page split for the new platforms: silent wherever engage-core binds the post itself.
assert.equal(G.isSingleVideoPath('x', '/REALMizkif/status/2089505354837106881'), true);
assert.equal(G.isSingleVideoPath('x', '/home'), false);
assert.equal(G.isSingleVideoPath('x', '/REALMizkif'), false);
assert.equal(G.isSingleVideoPath('instagram', '/p/DcJh2sZjj8k/'), true);
assert.equal(G.isSingleVideoPath('instagram', '/reel/DcKh0IZD4lz/'), true);
assert.equal(G.isSingleVideoPath('instagram', '/realmizkif/'), false);
assert.equal(G.isSingleVideoPath('facebook', '/reel/1735287921076691'), true);
assert.equal(G.isSingleVideoPath('facebook', '/realmizkif'), false);
// An unknown platform must never claim a page or a ref.
assert.equal(G.refFor('kick', '/anything', 'https://kick.com'), '');
assert.equal(G.isSingleVideoPath('kick', '/anything'), false);

// --- Badge maths: what the post STILL pays ---
// Live tariff at the time of writing: watch per-video, like 3, comment 1, repost 5, send 2.
const RATES = { likeReward: 3, commentReward: 1, xLikeReward: 3, xCommentReward: 1,
                repostReward: 5, shareSendReward: 2 };
const YT_ALL = { watch: true, like: true, comment: true, repost: false, shareSend: false };
const X_ALL = { watch: false, like: true, comment: true, repost: true, shareSend: false };
const TT_ALL = { watch: true, like: true, comment: false, repost: true, shareSend: true };

// A fresh long YouTube video: 55 watch + 3 like + 1 comment.
assert.equal(G.remainingFor(
  { platform: 'youtube', reward: 55, actions: YT_ALL, done: {} }, RATES), 59);
// Same video once the watch is banked: only like + comment left.
assert.equal(G.remainingFor(
  { platform: 'youtube', reward: 55, actions: YT_ALL, done: { watch: true } }, RATES), 4);
// X has NO watch, so its `reward` (which degrades to the watch floor server-side) must be
// ignored entirely — this is the bug the remaining-total model exists to prevent.
assert.equal(G.remainingFor(
  { platform: 'x', reward: 5, actions: X_ALL, done: {} }, RATES), 9, 'like 3 + comment 1 + repost 5');
// TikTok with comments switched off server-side: actions.comment already false.
assert.equal(G.remainingFor(
  { platform: 'tiktok', reward: 5, actions: TT_ALL, done: {} }, RATES), 15, 'watch 5 + like 3 + repost 5 + send 2');
// Everything collected -> nothing left.
assert.equal(G.remainingFor(
  { platform: 'x', reward: 5, actions: X_ALL,
    done: { like: true, comment: true, repost: true } }, RATES), 0);
// Defensive: missing/garbage input never produces a negative or NaN badge.
assert.equal(G.remainingFor(null, RATES), 0);
assert.equal(G.remainingFor({ platform: 'x', actions: X_ALL, done: {} }, {}), 0);
assert.equal(G.remainingFor({ platform: 'youtube', reward: -9, actions: YT_ALL, done: {} }, RATES), 4);

// Badge text reads off the computed total.
assert.equal(G.badgeText({ remaining: 59 }), '+59');
assert.equal(G.badgeText({ remaining: 0 }), '✓');
assert.equal(G.badgeText(null), '✓');

console.log('grid highlight OK');

// Facebook is deliberately narrow again: reel links ring, nothing else does, after a
// wider matcher ringed a comment (owner, 2026-08-19).
{
  const FB = 'https://www.facebook.com';
  assert.deepEqual(G.refCandidates('facebook', FB + '/reel/4562594350730390', FB), ['4562594350730390']);
  assert.deepEqual(G.refCandidates('facebook', FB + '/realmizkif/posts/pfbid02Xk?story_fbid=2502817863524426', FB), []);
  assert.deepEqual(G.refCandidates('x', 'https://x.com/i/status/1899', 'https://x.com'), ['1899']);
  console.log('ok facebook stays narrow');
}
