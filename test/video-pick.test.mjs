// Every adapter that can show a watch row must pick the video the member is ACTUALLY
// watching, not the first <video> in the document. TikTok and Instagram both took the
// first one until 1.162, which read a preloaded or off-screen element and froze the timer
// at "paused" (reports 2026-08-22 and 2026-08-23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A stand-in <video>: a rect plus a paused flag is all the scorer looks at.
const vid = (o) => ({
  paused: o.paused ?? true,
  getBoundingClientRect: () => ({
    left: o.left ?? 0, top: o.top ?? 0,
    right: (o.left ?? 0) + (o.w ?? 0), bottom: (o.top ?? 0) + (o.h ?? 0),
    width: o.w ?? 0, height: o.h ?? 0,
  }),
});

function pickerFor(file, globalName) {
  const code = readFileSync(file, 'utf8');
  let vids = [];
  const self = {};
  const document = {
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'video' ? vids : []),
    createElement: () => ({ style: {} }),
    documentElement: { appendChild() {} },
  };
  const window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 900 };
  const timer = () => 0;
  new Function('self', 'location', 'document', 'window', 'chrome', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', code)(
    self, { pathname: '/' }, document, window, { runtime: { sendMessage: async () => null } }, timer, timer, () => {}, () => {});
  const adapter = self[globalName];
  return (list) => { vids = list; return adapter.getVideoEl(); };
}

for (const [file, name, label] of [
  ['content/tiktok.js', 'RGC_TIKTOK_ADAPTER', 'tiktok'],
  ['content/instagram.js', 'RGC_IG_ADAPTER', 'instagram'],
]) {
  const pick = pickerFor(file, name);

  test(`${label}: a single video is returned unchanged`, () => {
    const only = vid({ w: 400, h: 700, paused: false });
    assert.equal(pick([only]), only);
  });

  test(`${label}: the PLAYING video wins over a bigger paused one`, () => {
    // The exact shape of the bug: a preloaded neighbour sits first in the document.
    const preloadedPaused = vid({ w: 500, h: 900, paused: true });
    const playing = vid({ w: 300, h: 500, paused: false });
    assert.equal(pick([preloadedPaused, playing]), playing);
  });

  test(`${label}: among paused videos the most visible one wins`, () => {
    const offscreen = vid({ top: -2000, w: 400, h: 700, paused: true });
    const onscreen = vid({ top: 0, w: 400, h: 700, paused: true });
    assert.equal(pick([offscreen, onscreen]), onscreen);
  });

  test(`${label}: the expanded player beats the small one behind it`, () => {
    // "bigger form" (2026-08-23): both play, the large one is what is being watched.
    const small = vid({ w: 200, h: 350, paused: false });
    const expanded = vid({ w: 900, h: 880, paused: false });
    assert.equal(pick([small, expanded]), expanded);
  });

  test(`${label}: no videos means no element, never a throw`, () => {
    assert.equal(pick([]), null);
  });
}

console.log('video-pick: tiktok + instagram pick the watched video');
