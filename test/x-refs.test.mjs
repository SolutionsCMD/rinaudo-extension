import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const x = loadAdapter('content/x.js', 'RGC_X_ADAPTER');

assert.equal(x.platform, 'x');
assert.equal(x.refFromPath('/REALMizkif/status/2069883444755370415'), '2069883444755370415');
assert.equal(x.refFromPath('/home'), '');
assert.equal(x.refFromPath(''), '');
console.log('x ref extraction OK');

// The reply-modal bug (2026-08-18): clicking Reply on a /status/ page opens X's modal
// composer AND moves the URL off /status/. getRef() must keep naming the tweet underneath
// while that modal is open, or engage-core clears the card mid-reply and the comment
// credits nothing. Narrow on purpose: no modal open means no sticky ref, so a composer on
// the home feed can never resurrect a stale one.
import { readFileSync } from 'node:fs';

/** Load x.js against a MUTABLE location + a modal flag, so a test can walk the real
 *  sequence: on the tweet -> Reply clicked -> X swaps the URL -> reply posted. */
function loadX() {
  const code = readFileSync('content/x.js', 'utf8');
  const self = {}, noop = () => {}, timer = () => 0;
  const location = { pathname: '/', href: 'https://x.com/' };
  const state = { modalOpen: false };
  const document = {
    addEventListener: noop, removeEventListener: noop,
    querySelector: (sel) => (state.modalOpen && String(sel).includes('aria-modal') ? {} : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    body: null, documentElement: null,
  };
  const window = { addEventListener: noop, removeEventListener: noop };
  const chrome = { runtime: { sendMessage: async () => null } };
  new Function('self', 'location', 'document', 'window', 'chrome',
    'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', code)(
    self, location, document, window, chrome, timer, timer, noop, noop);
  const go = (p) => { location.pathname = p; location.href = 'https://x.com' + p; };
  return { x: self.RGC_X_ADAPTER, go, state };
}

{
  const { x, go, state } = loadX();
  // 1. Member is on the tweet. Ref comes straight from the URL.
  go('/Mizkif/status/2089505354837106881');
  assert.equal(x.getRef(), '2089505354837106881');

  // 2. They click Reply: X opens its modal composer and moves the URL off /status/.
  //    Before the fix getRef() returned '' here, engage-core cleared the card, and the
  //    reply credited nothing.
  state.modalOpen = true;
  go('/compose/post');
  assert.equal(x.getRef(), '2089505354837106881', 'ref must survive the reply modal');

  // 3. Modal dismissed on the compose route: no modal, no sticky ref.
  state.modalOpen = false;
  assert.equal(x.getRef(), '');
}

{
  // A composer open on the home feed must never resurrect a tweet we were never on.
  const { x, go, state } = loadX();
  go('/home');
  state.modalOpen = true;
  assert.equal(x.getRef(), '', 'no status page seen -> nothing sticky');
}

console.log('x reply-modal ref stickiness OK');
