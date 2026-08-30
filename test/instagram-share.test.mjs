// The Instagram share matcher. Deliberately loose (owner: IG desktop has ~10 share
// affordances) but it must never read a like, a comment or a menu as a share: one click
// pays one action, and the repost beside it is a different control worth different money.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../content/instagram.js', import.meta.url), 'utf8');
const i = src.indexOf('sendTarget(t) {');
assert.ok(i >= 0, 'sendTarget not found');
const open = src.indexOf('{', i);
let depth = 0, end = open;
for (let j = open; j < src.length; j++) {
  if (src[j] === '{') depth++;
  else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
}
const body = src.slice(i, end + 1).replace(/^sendTarget/, 'function sendTarget');
const sendTarget = new Function(body + '; return sendTarget')();

/** Minimal element stand-in: closest() by a comma list, querySelector by the same. */
function el({ tag = 'DIV', label = null, href = null, text = '', kids = [], parent = null }) {
  const node = {
    tagName: tag, _label: label, _href: href, textContent: text, _kids: kids, _parent: parent,
    matchesSel(sel) {
      return sel.split(',').map((s) => s.trim()).some((s) => {
        const m = s.match(/^svg\[aria-label="([^"]+)"\]$/);
        if (m) return tag === 'SVG' && label === m[1];
        const h = s.match(/^a\[href\*="([^"]+)"\]$/);
        if (h) return tag === 'A' && !!href && href.includes(h[1]);
        if (s === '[role="button"]' || s === 'button') return tag === 'BUTTON';
        if (s === 'a') return tag === 'A';
        return false;
      });
    },
    closest(sel) { let n = node; while (n) { if (n.matchesSel(sel)) return n; n = n._parent; } return null; },
    querySelector(sel) { return node._kids.find((k) => k.matchesSel(sel)) || null; },
  };
  node._kids.forEach((k) => { k._parent = node; });
  return node;
}

test('the paper plane counts', () => {
  const svg = el({ tag: 'SVG', label: 'Share Post' });
  assert.ok(sendTarget(svg));
  assert.ok(sendTarget(el({ tag: 'SVG', label: 'Share' })));
});

test('copy link counts', () => {
  assert.ok(sendTarget(el({ tag: 'SVG', label: 'Copy link' })));
});

test('a wrapper button counts only when it holds a share icon', () => {
  const good = el({ tag: 'BUTTON', kids: [el({ tag: 'SVG', label: 'Share Post' })] });
  assert.ok(sendTarget(good));
  const bad = el({ tag: 'BUTTON', kids: [el({ tag: 'SVG', label: 'Like' })] });
  assert.equal(sendTarget(bad), null, 'a like button must never arm a share');
});

test('the handoff links count, and they are language independent', () => {
  assert.ok(sendTarget(el({ tag: 'A', href: 'https://twitter.com/share?text=See%20this' })));
  assert.ok(sendTarget(el({ tag: 'A', href: 'https://www.facebook.com/sharer/sharer.php?u=x' })));
});

test('the sheet rows count by exact label, not by containing the word', () => {
  assert.ok(sendTarget(el({ tag: 'BUTTON', text: 'Send' })));
  assert.ok(sendTarget(el({ tag: 'BUTTON', text: 'Copy link' })));
  // A caption or comment button that merely contains the word must not arm it.
  assert.equal(sendTarget(el({ tag: 'BUTTON', text: 'Send a message to Mizkif' })), null);
});

test('unrelated controls do not count', () => {
  assert.equal(sendTarget(el({ tag: 'SVG', label: 'Like' })), null);
  assert.equal(sendTarget(el({ tag: 'SVG', label: 'Repost' })), null, 'repost is its own action');
  assert.equal(sendTarget(el({ tag: 'DIV', text: 'whatever' })), null);
  assert.equal(sendTarget(null), null);
});
