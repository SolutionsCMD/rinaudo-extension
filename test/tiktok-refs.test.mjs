import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const tt = loadAdapter('content/tiktok.js', 'RGC_TIKTOK_ADAPTER');

assert.equal(tt.platform, 'tiktok');
assert.equal(tt.refFromPath('/@realmizkif/video/7655132041440234766'), '7655132041440234766');
assert.equal(tt.refFromPath('/@realmizkif'), '');
assert.equal(tt.refFromPath('/foryou'), '');
assert.equal(tt.refFromPath(''), '');
console.log('tiktok ref extraction OK');
