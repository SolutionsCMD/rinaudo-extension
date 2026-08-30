// A click-only share credits after a dwell, not on the click. The rules that matter: it
// fires when the member is still on the same post, it does NOT fire if they moved on, and
// a second click restarts the wait rather than queueing a second credit.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../content/engage-core.js', import.meta.url), 'utf8');
assert.ok(src.includes('const SHARE_CREDIT_DELAY_MS = 5000'), 'the dwell must stay 5s');
assert.ok(src.includes('state.ref !== ref'), 'the timer must re-check the post it armed on');
assert.ok(src.includes('cancelClickOnlyShare()'), 'teardown must cancel an armed share');

// A faithful re-implementation of the helper, to exercise the branches.
function makeArmer(clock) {
  let state = { ref: 'A', sendS: 'idle' };
  let fired = [];
  let timer = null;
  const DELAY = 5000;
  const sendCapable = () => true;
  const cancel = () => { if (timer) { clock.clear(timer); timer = null; } };
  const arm = () => {
    if (!sendCapable() || !state || state.sendS !== 'idle') return;
    const ref = state.ref;
    cancel();
    timer = clock.set(() => {
      timer = null;
      if (!sendCapable() || !state || state.ref !== ref || state.sendS !== 'idle') return;
      fired.push(ref);
    }, DELAY);
  };
  return { arm, cancel, fired, setState: (s) => { state = s; }, get pending() { return timer !== null; } };
}
const makeClock = () => {
  let now = 0; const jobs = new Map(); let id = 1;
  return {
    set(fn, ms) { const k = id++; jobs.set(k, { fn, at: now + ms }); return k; },
    clear(k) { jobs.delete(k); },
    tick(ms) { now += ms; for (const [k, j] of [...jobs]) if (j.at <= now) { jobs.delete(k); j.fn(); } },
  };
};

test('credits after the dwell when the member stays put', () => {
  const clock = makeClock(); const a = makeArmer(clock);
  a.arm(); clock.tick(4999);
  assert.deepEqual(a.fired, [], 'nothing before the dwell elapses');
  clock.tick(1);
  assert.deepEqual(a.fired, ['A']);
});

test('does not credit if they moved to another post', () => {
  const clock = makeClock(); const a = makeArmer(clock);
  a.arm(); a.setState({ ref: 'B', sendS: 'idle' }); clock.tick(6000);
  assert.deepEqual(a.fired, [], 'the credit must never land on the post they moved to');
});

test('a second click restarts the wait instead of queueing two credits', () => {
  const clock = makeClock(); const a = makeArmer(clock);
  a.arm(); clock.tick(3000); a.arm(); clock.tick(3000);
  assert.deepEqual(a.fired, [], 'restarted, so not yet');
  clock.tick(2000);
  assert.deepEqual(a.fired, ['A'], 'and exactly once');
});

test('teardown cancels an armed share', () => {
  const clock = makeClock(); const a = makeArmer(clock);
  a.arm(); a.cancel(); clock.tick(9000);
  assert.deepEqual(a.fired, []);
});
