import assert from 'node:assert';
import { loadAdapter } from './_load.mjs';

const ig = loadAdapter('content/instagram.js', 'RGC_IG_ADAPTER');

assert.equal(ig.platform, 'instagram');
assert.equal(ig.refFromPath('/p/DZqNB9_zBcF/'), 'DZqNB9_zBcF');
assert.equal(ig.refFromPath('/reel/DABcd12-_Xy/'), 'DABcd12-_Xy');
assert.equal(ig.refFromPath('/tv/AbCdEf/'), 'AbCdEf');
assert.equal(ig.refFromPath('/realmizkif/'), '');
assert.equal(ig.refFromPath(''), '');
console.log('instagram ref extraction OK');
