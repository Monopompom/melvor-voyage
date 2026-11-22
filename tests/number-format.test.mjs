import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortNumber, decimal, wideCount } from '../src/number-format.mjs';

test('shortNumber keeps small numbers whole and shortens big ones, rounded down', () => {
  assert.equal(shortNumber(0), '0');
  assert.equal(shortNumber(9999), '9999');
  assert.equal(shortNumber(12345), '12.3K');
  assert.equal(shortNumber(125000), '125K');
  assert.equal(shortNumber(511842), '511K');
  assert.equal(shortNumber(999999), '999K');
  assert.equal(shortNumber(1005430), '1M');
  assert.equal(shortNumber(2500000), '2.5M');
  assert.equal(shortNumber(99_990_000), '99.9M');
  assert.equal(shortNumber(100_000_000), '100M');
  assert.equal(shortNumber(123_456_789_000), '123B');
  assert.equal(shortNumber(-2500000), '-2.5M');
  assert.equal(shortNumber(1234.9), '1234');
});

test('shortNumber passes a value that is not a number through', () => {
  assert.equal(shortNumber(Infinity), 'Infinity');
  assert.equal(shortNumber('x'), 'x');
});

test('decimal keeps the decimals a fraction needs, up to the limit, without trailing zeros', () => {
  assert.equal(decimal(0.5), '0.5');
  assert.equal(decimal(1.25), '1.25');
  assert.equal(decimal(1.234), '1.23');
  assert.equal(decimal(1.004), '1');
  assert.equal(decimal(2), '2');
  assert.equal(decimal(0.1 + 0.2), '0.3');
  assert.equal(decimal(1.26, 1), '1.3');
  assert.equal(decimal(-0.75), '-0.75');
  assert.equal(decimal(NaN), 'NaN');
});

test('the short form keeps the letter and the space the game uses in each language', () => {
  const saved = globalThis.formatNumber;
  try {
    globalThis.formatNumber = (n) => (n >= 1e8 ? `${n / 1e6} Mio.` : `${n / 1e3} Tsd.`);
    assert.equal(shortNumber(127000000), '127\u00a0Mio.');
    assert.equal(shortNumber(273000), '273\u00a0Tsd.');
    globalThis.formatNumber = (n) => (n >= 1e8 ? `${n / 1e6}百万` : n >= 1e5 ? `${n / 1e3}千` : `${n}`);
    assert.equal(shortNumber(273000), '273千');
  } finally {
    if (saved === undefined) delete globalThis.formatNumber; else globalThis.formatNumber = saved;
  }
});

test('a count with a word for its unit is wide, a letter is not', () => {
  for (const text of ['23,4\u00a0Mio.', '127\u00a0Tsd.', '23.4百万', '127百万']) assert.equal(wideCount(text), true, text);
  for (const text of ['23.4M', '9,999', '100K', '273千', '58']) assert.equal(wideCount(text), false, text);
});
