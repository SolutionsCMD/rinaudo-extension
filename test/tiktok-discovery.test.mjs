// Channel discovery: the extension reports the post ids a member can see on the channel,
// because IFTTT misses TikToks and every server-side route is gated. These pin the scope,
// which is the part that matters: ids only, and only this channel's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadOnChannel(pathname, links) {
  const sent = [];
  const code = readFileSync('content/tiktok.js', 'utf8');
  const self = {};
  const anchors = links.map((href) => ({ getAttribute: () => href }));
  const document = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'a[href*="/video/"]' ? anchors : []),
    createElement: () => ({ style: {} }),
    documentElement: { appendChild() {} },
  };
  const window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 900 };
  const chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return null; } } };
  let scan = null;
  // Capture the scheduled scan instead of running it on a timer.
  const setTimeoutStub = (fn) => { if (!scan) scan = fn; return 0; };
  const setIntervalStub = () => 0;
  new Function('self', 'location', 'document', 'window', 'chrome', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', code)(
    self, { pathname }, document, window, chrome, setIntervalStub, setTimeoutStub, () => {}, () => {});
  return { run: () => scan && scan(), sent };
}

test('on the channel profile it reports that channel\'s video ids', () => {
  const { run, sent } = loadOnChannel('/@realmizkif', [
    '/@realmizkif/video/7677377243076627726',
    '/@realmizkif/video/7677319376030190862',
  ]);
  run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 's2Discover');
  assert.equal(sent[0].platform, 'tiktok');
  assert.deepEqual(sent[0].refs, ['7677377243076627726', '7677319376030190862']);
});

test('another creator\'s videos on the same page are never reported', () => {
  const { run, sent } = loadOnChannel('/@realmizkif', [
    '/@someoneelse/video/7677377243076627726',
    '/@realmizkif/video/7677319376030190862',
  ]);
  run();
  assert.deepEqual(sent[0].refs, ['7677319376030190862']);
});

test('off the channel nothing is reported at all', () => {
  // The For You feed, someone else's profile: none of a member's other browsing is sent.
  const { run, sent } = loadOnChannel('/foryou', ['/@whoever/video/7677319376030190862']);
  run();
  assert.equal(sent.length, 0);
});

test('a channel video page reports its own id', () => {
  const { run, sent } = loadOnChannel('/@realmizkif/video/7677377243076627726', []);
  run();
  assert.deepEqual(sent[0].refs, ['7677377243076627726']);
});

console.log('tiktok-discovery: reports this channel only, ids only');
