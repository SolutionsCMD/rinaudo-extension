// Facebook's reshare confirmation. Some members' Facebook sends a body the observer cannot
// read (name "(unnamed:string)", not JSON, no friendly-name token), so the network signal
// is unmatchable there and the success toast stands in for it. The rules that matter: the
// toast only counts inside an armed intent window, and the Reels share sheet must arm.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const fb = readFileSync(new URL('../content/facebook.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../content/engage-core.js', import.meta.url), 'utf8');

const RE = /repostToastRe:\s*(\/.*?\/[a-z]*)/.exec(fb);
assert.ok(RE, 'facebook must declare repostToastRe');
const toastRe = eval(RE[1]);

test('matches the toasts Facebook actually shows', () => {
  for (const t of [
    'Shared to your profile',
    'shared to your story',
    'Shared to News Feed',
    'Posted to your profile',
    'Lots of other text… Shared to your profile … more text',
  ]) assert.ok(toastRe.test(t), `should match: ${t}`);
});

test('does not match unrelated page text', () => {
  for (const t of [
    'Share', 'Send this to friends', 'Shared with 3 friends is not a toast we accept',
    'You shared a memory', '',
  ]) assert.equal(toastRe.test(t), false, `should NOT match: ${t}`);
});

test('the toast is a SECOND signal, never a first', () => {
  // It may only fire inside the armed window and only while the repost is still idle.
  assert.ok(core.includes("state.repostS !== 'idle' || Date.now() >= pendingRepostUntil"),
    'the toast watcher must require an armed, still-idle repost');
  assert.ok(core.includes('watchRepostToast()'), 'the watcher must be armed by the click intent');
  assert.ok(core.includes('stopRepostToast'), 'the watcher must be torn down');
});

test('the Reels share sheet arms the intent', () => {
  // Her probe recorded armed:false because the sheet is not a [role="dialog"].
  assert.ok(fb.includes("'[role=\"menu\"], [role=\"listbox\"]"),
    'repostTarget must accept the reels share sheet, not only a dialog');
});
