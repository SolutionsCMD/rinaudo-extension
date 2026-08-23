// TikTok comments are two-signal (2026-08-23): credit waits for TikTok's own
// /api/comment/publish/ request, matched to the video on screen, carrying the typed
// text. These pin the signature, the text extraction, the id, the non-matches, and the
// adapter flag that turns the DOM paths off. Driven through the REAL wrapped fetch, the
// same way observe-body.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAdapter } from './_load.mjs';

function loadObserver(hostname = 'www.tiktok.com') {
  const sent = [];
  const win = {
    postMessage: (m) => sent.push(m),
    fetch: async () => ({ ok: true }),
    location: { origin: `https://${hostname}`, href: `https://${hostname}/`, hostname },
    URLSearchParams, FormData,
  };
  win.XMLHttpRequest = function () {};
  win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  const code = readFileSync('content/observe.js', 'utf8');
  new Function('window', 'navigator', 'location', 'URLSearchParams', 'FormData', 'WeakMap', 'Object', code)(
    win, { sendBeacon: () => true }, win.location, URLSearchParams, FormData, WeakMap, Object);
  return { win, sent };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a real comment publish reports kind=comment with the video id and the typed text', async () => {
  const { win, sent } = loadObserver();
  await win.fetch('https://www.tiktok.com/api/comment/publish/?aid=1988&aweme_id=7676966500120546574'
    + '&text=this%20is%20a%20six%20word%20comment&text_extra=%5B%5D', { method: 'POST' });
  await tick();
  const m = sent.find((x) => x.kind === 'comment');
  assert.ok(m, 'comment signal posted');
  assert.equal(m.platform, 'tiktok');
  assert.equal(m.ref, '7676966500120546574');
  assert.equal(m.txt, 'this is a six word comment');
  assert.equal(m.ok, true);
});

test('plus-encoded spaces decode too', async () => {
  const { win, sent } = loadObserver();
  await win.fetch('https://www.tiktok.com/api/comment/publish/?aweme_id=1&text=one+two+three+four+five+six', { method: 'POST' });
  await tick();
  assert.equal(sent.find((x) => x.kind === 'comment').txt, 'one two three four five six');
});

test('the comment LIST read that fires on every video never matches and is not probed', async () => {
  const { win, sent } = loadObserver();
  await win.fetch('https://www.tiktok.com/api/comment/list/?aweme_id=1&count=20', { method: 'GET' });
  await tick();
  assert.equal(sent.filter((x) => x.kind === 'comment').length, 0, 'no credit signal');
  assert.equal(sent.filter((x) => x.kind === 'ttdiag').length, 0, 'list reads are not probe-worthy');
});

test('comment digg and delete share the prefix and must not match', async () => {
  const { win, sent } = loadObserver();
  await win.fetch('https://www.tiktok.com/api/comment/digg/?aweme_id=1&cid=2', { method: 'POST' });
  await win.fetch('https://www.tiktok.com/api/comment/delete/?aweme_id=1&cid=2', { method: 'POST' });
  await tick();
  assert.equal(sent.filter((x) => x.kind === 'comment').length, 0);
});

test('an unmatched comment-ish POST on TikTok is probed by PATH only, capped', async () => {
  const { win, sent } = loadObserver();
  for (let i = 0; i < 10; i++) {
    await win.fetch('https://www.tiktok.com/api/comment/somethingnew/?aweme_id=1&text=secret%20words', { method: 'POST' });
  }
  await tick();
  const probes = sent.filter((x) => x.kind === 'ttdiag');
  assert.equal(probes.length, 4, 'capped at 4 per page');
  assert.equal(probes[0].meta.path, '/api/comment/somethingnew/');
  assert.ok(!JSON.stringify(probes).includes('secret'), 'query string never leaves the page');
});

test('the probe is TikTok-only: the same path on another host is ignored', async () => {
  const { win, sent } = loadObserver('www.instagram.com');
  await win.fetch('https://www.instagram.com/api/comment/whatever/', { method: 'POST' });
  await tick();
  assert.equal(sent.filter((x) => x.kind === 'ttdiag').length, 0);
});

test('the TikTok adapter declares network-confirmed comments', () => {
  const tt = loadAdapter('content/tiktok.js', 'RGC_TIKTOK_ADAPTER');
  assert.equal(tt.commentConfirmNetwork, true);
  assert.equal(tt.likeConfirmNetwork, true);
});

test('engage-core only credits a network comment whose ref matches the bound post', () => {
  // Pinned at the source level: the branch must compare d.ref to state.ref. A behavioural
  // harness for engage-core does not exist (DOM/SW heavy), so this guards the contract.
  const src = readFileSync('content/engage-core.js', 'utf8');
  const branch = src.slice(src.indexOf("if (d.kind === 'comment')"), src.indexOf("if (d.kind === 'ttdiag')"));
  assert.match(branch, /String\(d\.ref\) === state\.ref/);
  assert.match(src, /if \(A\.commentConfirmNetwork\) return;/, 'DOM comment hooks are skipped on network-confirmed adapters');
});

console.log('tiktok-comment: two-signal comment signature OK');
