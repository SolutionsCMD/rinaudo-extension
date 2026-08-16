// The observer's body reader, driven through the REAL wrapped fetch/XHR.
//
// A multipart (FormData) submit used to read as an empty body, so no signature could
// match it: that is the Facebook reshare cohort (never credited on Facebook, fine on
// TikTok and Instagram, probe rows containing read queries only). These tests pin the
// encodings we accept and, just as importantly, that member content is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadObserver() {
  const sent = [];
  const win = {
    postMessage: (m) => sent.push(m),
    fetch: async () => ({ ok: true }),
    location: { origin: 'https://www.facebook.com', href: 'https://www.facebook.com/' },
    URLSearchParams, FormData,
  };
  win.XMLHttpRequest = function () {};
  win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };
  const code = readFileSync('content/observe.js', 'utf8');
  new Function('window', 'navigator', 'location', 'URLSearchParams', 'FormData', 'WeakMap', 'Object',
    code.replace(/\bwindow\b/g, 'window'))(
    win, { sendBeacon: () => true }, win.location, URLSearchParams, FormData, WeakMap, Object);
  return { win, sent };
}

test('a multipart reshare is seen, and only its request name is read', async () => {
  const { win, sent } = loadObserver();
  const fd = new FormData();
  fd.set('fb_api_req_friendly_name', 'ComposerStoryCreateMutation');
  fd.set('doc_id', '987654321');
  // Member content rides in `variables`. It must never reach the matcher.
  fd.set('variables', JSON.stringify({ message: { text: 'my private caption' } }));
  await win.fetch('https://www.facebook.com/api/graphql/', { method: 'POST', body: fd });
  const hit = sent.find((m) => m.platform === 'facebook' && m.kind === 'repost');
  assert.ok(hit, 'the multipart reshare should be observed');
  assert.equal(hit.ok, true);
  assert.equal(JSON.stringify(sent).includes('my private caption'), false,
    'member content must never leave the page');
});

test('a form-encoded reshare still matches, unchanged', async () => {
  const { win, sent } = loadObserver();
  await win.fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST',
    body: 'av=1&fb_api_req_friendly_name=ComposerStoryCreateMutation&doc_id=1',
  });
  assert.ok(sent.find((m) => m.platform === 'facebook' && m.kind === 'repost'));
});

test('an unrelated multipart POST matches nothing', async () => {
  const { win, sent } = loadObserver();
  const fd = new FormData();
  fd.set('fb_api_req_friendly_name', 'CometUnifiedShareSheetDialogQuery');
  await win.fetch('https://www.facebook.com/api/graphql/', { method: 'POST', body: fd });
  assert.equal(sent.some((m) => m.kind === 'repost'), false);
  // ...but the diagnostic sees it now, which is the whole point of the probe.
  assert.ok(sent.find((m) => m.kind === 'fbdiag'));
});
