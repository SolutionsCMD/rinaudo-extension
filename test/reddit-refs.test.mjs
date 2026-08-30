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

// The upvote reads, against the markup Reddit actually ships (captured from the live post
// 2026-08-30): the buttons sit inside <shreddit-post>'s SHADOW ROOT, carry an EMPTY
// aria-label, and are told apart by an `upvote` / `downvote` attribute with aria-pressed
// holding the state. The first cut keyed on aria-label from the light DOM and credited
// nothing.
import { test as t2 } from 'node:test';

function loadFns(names) {
  // Pull the helpers out of the IIFE by name, with the tiny DOM shims they touch.
  const out = {};
  for (const name of names) {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} not found`);
    const open = src.indexOf('{', i);
    let depth = 0, end = open;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    out[name] = src.slice(i, end + 1);
  }
  return out;
}

const fns = loadFns(['deepFind']);
const deepFind = new Function(fns.deepFind + '; return deepFind')();

// Minimal element stand-ins: only what deepFind touches.
const el = (tag, attrs = {}, kids = [], shadowKids = null) => {
  const node = {
    tagName: tag,
    _attrs: attrs,
    hasAttribute: (a) => Object.prototype.hasOwnProperty.call(attrs, a),
    getAttribute: (a) => (a in attrs ? attrs[a] : null),
    children: kids,
    querySelectorAll: () => kids,
    shadowRoot: shadowKids ? { querySelectorAll: () => shadowKids } : null,
  };
  return node;
};

const isUpvoteBtn = (e) => e.tagName === 'BUTTON' && e.hasAttribute && e.hasAttribute('upvote');

t2('finds the upvote button inside a shadow root', () => {
  const up = el('BUTTON', { upvote: '', 'aria-pressed': 'true' });
  const down = el('BUTTON', { downvote: '', 'aria-pressed': 'false' });
  const post = el('SHREDDIT-POST', { id: 't3_abc' }, [], [down, up]);
  const hit = deepFind(post.shadowRoot, isUpvoteBtn, 0);
  assert.equal(hit, up, 'must pick the upvote button, not the downvote one');
  assert.equal(hit.getAttribute('aria-pressed'), 'true');
});

t2('returns null rather than guessing when there is no vote button', () => {
  const post = el('SHREDDIT-POST', { id: 't3_abc' }, [], [el('SPAN', {})]);
  assert.equal(deepFind(post.shadowRoot, isUpvoteBtn, 0), null);
});

t2('does not mistake a downvote for an upvote', () => {
  const down = el('BUTTON', { downvote: '', 'aria-pressed': 'true' });
  const post = el('SHREDDIT-POST', {}, [], [down]);
  assert.equal(deepFind(post.shadowRoot, isUpvoteBtn, 0), null);
});

t2('stops descending rather than recursing forever', () => {
  let deepest = el('BUTTON', { upvote: '' });
  for (let i = 0; i < 9; i++) deepest = el('DIV', {}, [], [deepest]);
  assert.equal(deepFind(deepest.shadowRoot, isUpvoteBtn, 0), null, 'depth cap must hold');
});
