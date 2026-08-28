// The amount-vote card's two pieces of real logic: the input parser (which must mirror
// the engine's chat parser) and the clamp that keeps an out-of-range amount from ever
// being sent — the engine REFUSES those rather than clamping, so a card that could
// produce one would silently lose the member's vote.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../content/kick.js', import.meta.url), 'utf8');

function extract(name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} not found in content/kick.js`);
  // Walk braces from the function's opening { to its matching close.
  const open = src.indexOf('{', i);
  let depth = 0, end = open;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  return src.slice(i, end + 1);
}

const parseAmountInput = new Function(extract('parseAmountInput') + '; return parseAmountInput')();

test('parses the shapes people type', () => {
  assert.equal(parseAmountInput('25k'), 2500000);
  assert.equal(parseAmountInput('$25k'), 2500000);
  assert.equal(parseAmountInput('25000'), 2500000);
  assert.equal(parseAmountInput('$25,000'), 2500000);
  assert.equal(parseAmountInput('12.5k'), 1250000);
  assert.equal(parseAmountInput('1m'), 100000000);
  assert.equal(parseAmountInput('$500'), 50000);
  assert.equal(parseAmountInput('0'), 0);
});

test('refuses what is not an amount', () => {
  for (const t of ['', '  ', 'sell', 'k', '25k please', '-5k', 'NVDA']) {
    assert.equal(parseAmountInput(t), null, `should refuse ${JSON.stringify(t)}`);
  }
});

test('the card clamps to the session range before sending', () => {
  // Mirrors amountVote()'s clamp line: nothing outside [min,max] can leave the card.
  const clamp = (av, cents) => Math.min(av.maxCents, Math.max(av.minCents, Math.round(cents)));
  const av = { minCents: 0, maxCents: 10000000 };
  assert.equal(clamp(av, 50000000), 10000000);
  assert.equal(clamp(av, -5), 0);
  assert.equal(clamp(av, 2500000), 2500000);
  assert.ok(src.includes('Math.min(av.maxCents, Math.max(av.minCents'), 'clamp must stay in amountVote()');
});
