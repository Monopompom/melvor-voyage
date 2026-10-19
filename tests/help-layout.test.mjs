import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mark, marked, msgHtml } from '../src/help-layout.mjs';

const tf = (key, vars) => key.replace(/\$\{(\w+)\}/g, (_, k) => vars[k]);

test('message marks: marked vars go in as HTML, the rest is escaped', () => {
  const s = marked(tf, 'Tow to ${name} <now>: ${hexes}, about ${time}', { hexes: '4 hexes & more' }, { name: mark.name('A & B'), time: mark.time('16 min') });
  assert.equal(s, 'Tow to <b>A &amp; B</b> &lt;now&gt;: 4 hexes &amp; more, about <b class="text-info">16 min</b>');
});

test('message marks: a var used twice is marked twice; no marks is plain escaping', () => {
  assert.equal(marked(tf, '${a} and ${a}', {}, { a: '<b>x</b>' }), '<b>x</b> and <b>x</b>');
  assert.equal(marked(tf, '${a} <i>', { a: '1' }), '1 &lt;i&gt;');
});

test('message marks: a price is amber, red when you cannot pay, after the GP icon', () => {
  assert.match(mark.gp('gp.png', '35,474'), /^<img class="voyage-skill-name-icon" src="gp\.png" alt=""><b class="text-warning">35,474<\/b>$/);
  assert.match(mark.gp('gp.png', '9', true), /text-danger/);
});

test('message body: always centred, however many lines', () => {
  assert.match(msgHtml(['a', 'b']), /text-center/);
  assert.match(msgHtml(['a', 'b', 'c', 'd']), /text-center/);
  assert.doesNotMatch(msgHtml(['a', 'b', 'c', 'd']), /text-left/);
});
