import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const yt = loadAdapter('content/youtube.js', 'RGC_YT_ADAPTER');

assert.equal(yt.platform, 'youtube');
assert.equal(yt.refFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(yt.refFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'), 'dQw4w9WgXcQ');
assert.equal(yt.refFromUrl('https://www.youtube.com/shorts/abc12345678'), 'abc12345678');
assert.equal(yt.refFromUrl('https://www.youtube.com/'), '');
console.log('youtube ref extraction OK');
