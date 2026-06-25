import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const x = loadAdapter('content/x.js', 'RGC_X_ADAPTER');

assert.equal(x.platform, 'x');
assert.equal(x.refFromPath('/REALMizkif/status/2069883444755370415'), '2069883444755370415');
assert.equal(x.refFromPath('/home'), '');
assert.equal(x.refFromPath(''), '');
console.log('x ref extraction OK');
