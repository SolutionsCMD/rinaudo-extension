// Loads engage-core under a stubbed global and checks it exposes the init API.
// (Behavior is DOM/SW/timer heavy and verified in-browser; this only guards the contract.)
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const code = readFileSync('content/engage-core.js', 'utf8');
const self = {};
new Function('self', code)(self); // top-level only assigns self.EngageCore; init() is not called

assert.equal(typeof self.EngageCore, 'object', 'EngageCore global missing');
assert.equal(typeof self.EngageCore.init, 'function', 'EngageCore.init missing');
console.log('engage-core: loads + exposes init OK');
