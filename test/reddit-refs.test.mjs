// The Reddit adapter's ref reading. This is the one piece of the content script that is
// pure logic, and getting it wrong is expensive in both directions: a dropped kind prefix
// collides a comment target with a post target, and a wrong match sends junk ids to the
// discovery queue.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../content/reddit.js', import.meta.url), 'utf8');
const i = src.indexOf('function refFromPath(');
assert.ok(i >= 0, 'refFromPath not found');
const open = src.indexOf('{', i);
let depth = 0, end = open;
for (let j = open; j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
}
const refFromPath = new Function(src.slice(i, end + 1) + '; return refFromPath')();

test('a post permalink reads as t3', () => {
  assert.equal(refFromPath('/r/LivestreamFail/comments/abc123/some_slug/'), 't3_abc123');
  assert.equal(refFromPath('/user/mizkif/comments/xyz789/title/'), 't3_xyz789');
  assert.equal(refFromPath('/r/sub/comments/abc123'), 't3_abc123');
});

test('a comment permalink reads as t1', () => {
  assert.equal(refFromPath('/r/LivestreamFail/comments/abc123/some_slug/def456/'), 't1_def456');
  assert.equal(refFromPath('/r/sub/comments/abc123/slug/def456'), 't1_def456');
});

test('the kind prefix survives, so a post and a comment never collide', () => {
  assert.notEqual(refFromPath('/r/s/comments/same01/slug/'), refFromPath('/r/s/comments/x/slug/same01/'));
});

test('non-post paths read as empty', () => {
  for (const p of ['/user/mizkif/', '/r/LivestreamFail/', '/', '/settings', '']) {
    assert.equal(refFromPath(p), '', `should be empty for ${JSON.stringify(p)}`);
  }
});

test('ids come back lowercase, matching the server ref', () => {
  assert.equal(refFromPath('/r/S/comments/ABC123/slug/'), 't3_abc123');
});
