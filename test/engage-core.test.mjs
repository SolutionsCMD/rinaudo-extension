// Loads engage-core under a stubbed global and checks it exposes the init API.
// (Behavior is DOM/SW/timer heavy and verified in-browser; this only guards the contract.)
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const code = readFileSync('content/engage-core.js', 'utf8');
const self = {};
new Function('self', code)(self); // top-level only assigns self.EngageCore; init() is not called

assert.equal(typeof self.EngageCore, 'object', 'EngageCore global missing');
assert.equal(typeof self.EngageCore.init, 'function', 'EngageCore.init missing');

// effectiveTarget: short videos must target the heartbeat-limited time (~30s for a
// 15s clip needing 2 beats), not requiredWatchSeconds (15s), or the bar reads "done"
// before the claim can qualify. Long videos are dominated by requiredWatchSeconds.
const eff = self.EngageCore.effectiveTarget;
assert.equal(eff(15, 2, 20), 30, 'short video targets the heartbeat time, not 15s');
assert.equal(eff(648, 19, 20), 648, 'long video unchanged');
assert.equal(eff(undefined, undefined, undefined), 120, 'defaults are sane');
console.log('engage-core: loads + exposes init + effectiveTarget OK');
