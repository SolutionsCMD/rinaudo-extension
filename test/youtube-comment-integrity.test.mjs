// The YouTube comment integrity change (owner, 2026-09-08).
//
// Two separate promises are pinned here:
//   1. comments credit ONLY on YouTube's own create_comment request, never off the page.
//      The DOM paths engage-core would otherwise run credited on CANCEL (that click
//      empties the composer, which the fallback reads as "posted").
//   2. the delete detector needs all three of its signals, and reads structure rather
//      than button text, because labels are localized.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAdapter } from './_load.mjs';

const yt = loadAdapter('content/youtube.js', 'RGC_YT_ADAPTER');

test('youtube comments are network-confirmed only', () => {
  assert.equal(yt.commentConfirmNetwork, true,
    'without this engage-core keeps its DOM comment paths, and Cancel credits');
});

test('engage-core registers no comment DOM listener when the adapter is network-confirmed', () => {
  const src = readFileSync('content/engage-core.js', 'utf8');
  const hook = src.slice(src.indexOf('function hookComment()'));
  const guard = hook.indexOf('if (A.commentConfirmNetwork) return;');
  const firstListener = hook.indexOf("document.addEventListener('click'");
  assert.ok(guard > -1, 'the network-only guard must exist');
  assert.ok(firstListener > -1 && guard < firstListener,
    'the guard must come BEFORE any listener, or the DOM paths still arm');
});

test('the delete detector requires all three signals', () => {
  const src = readFileSync('content/engage-core.js', 'utf8');
  const fn = src.slice(src.indexOf('function maybeReportDelete()'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  for (const signal of ['delConfirmAt', 'delRemovedAt', 'delNetAt']) {
    assert.ok(body.includes(`fresh(${signal})`), `${signal} must be required`);
  }
  assert.ok(body.includes("state.commentS !== 'done'"),
    'a delete of a comment we never credited is nothing to undo');
  assert.ok(body.includes('deleteReported'), 'the report must fire at most once');
});

test('the delete detector reads structure, never button wording', () => {
  const src = readFileSync('content/youtube.js', 'utf8');
  const from = src.indexOf('commentConfirmTarget');
  const block = src.slice(from, from + 800);
  for (const word of ['Delete', 'Remove', 'Löschen', 'Supprimer']) {
    assert.equal(block.includes(`'${word}'`), false,
      `matching on the word ${word} would break on every other language`);
  }
  assert.ok(block.includes('confirm-button'), 'it should match the dialog structurally');
});

test('a comment id is read from the permalink, and its absence is survivable', () => {
  assert.equal(typeof yt.commentIdFromDom, 'function');
  assert.equal(typeof yt.commentIdFromNode, 'function');
  // No DOM under Node: the adapter must answer null rather than throw, because
  // commentIdFor calls it on a timer and a throw there would stop the credit.
  assert.equal(yt.commentIdFromDom('anything'), null);
  assert.equal(yt.commentIdFromNode(null), null);
  const src = readFileSync('content/youtube.js', 'utf8');
  assert.ok(/lc=\(\[\\w\.-\]\+\)/.test(src) || src.includes('lc='),
    'the id comes from the ?lc= permalink YouTube hangs off every comment');
});

test('the credit never waits on the comment id', () => {
  const src = readFileSync('content/engage-core.js', 'utf8');
  assert.ok(src.includes('commentIdFor(txt).then((id) => fireEngagement(\'comment\', { commentId: id }))'),
    'the id is resolved then the credit fires; it must not be awaited inline');
  const fn = src.slice(src.indexOf('function commentIdFor('));
  assert.ok(fn.includes('resolve(null)'), 'it must resolve null rather than hang');
});

test('comment text never leaves the page', () => {
  const src = readFileSync('content/engage-core.js', 'utf8');
  const send = src.slice(src.indexOf("type: 's2CommentDeleted'"), src.indexOf("type: 's2CommentDeleted'") + 300);
  assert.equal(/text|txt|body/.test(send), false, 'only ids and the target ref may be sent');
});
