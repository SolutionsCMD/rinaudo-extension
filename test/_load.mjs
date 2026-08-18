// Loads an adapter IIFE under stubbed globals and returns the adapter object it
// registers.
//
// Most adapters (instagram/tiktok/youtube) do nothing at load time but assign their
// global, so `self` is all that matters for them. content/x.js is different by design:
// it is both the X adapter AND the "timeline mode" content script, so registering its
// delegated document/window listeners at load IS its entry point (see the header comment
// there — the feed has no per-post widget for engage-core to drive). The stubs below
// therefore have to be inert-but-callable rather than empty, and the timers have to be
// neutered: x.js starts a 5-minute reward-refresh interval that would otherwise hold
// Node's event loop open long after the assertions finish.
//
// DOM-touching adapter METHODS are still never called from these tests.
import { readFileSync } from 'node:fs';

const noop = () => {};

export function loadAdapter(file, globalName) {
  const code = readFileSync(file, 'utf8');
  const self = {};
  const document = {
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {} }),
    documentElement: { appendChild: noop },
  };
  const window = { addEventListener: noop, removeEventListener: noop };
  // Extension APIs are absent under Node; x.js guards every call, but give it a stub that
  // resolves to nothing rather than letting a ReferenceError decide the control flow.
  const chrome = { runtime: { sendMessage: async () => null } };
  // Return a token so any clearTimeout/clearInterval on it is harmless, but never schedule.
  const timer = () => 0;
  new Function(
    'self', 'location', 'document', 'window', 'chrome',
    'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
    code,
  )(self, { pathname: '/' }, document, window, chrome, timer, timer, noop, noop);
  return self[globalName];
}
