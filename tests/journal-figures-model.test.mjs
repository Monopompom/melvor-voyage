import test from 'node:test';
import assert from 'node:assert/strict';
import { figNumber, figOdds, barWidth, pivotMark, pivotCell, figureTable, HELP_DRESS, WRITTEN_FIGS, SECTION_ICONS, LIST_CARDS } from '../src/journal-figures-model.mjs';

const row = (...xs) => ({ cells: xs.map((x) => ({ html: x, text: x, cls: '' })) });

test('figNumber reads the number a cell shows', () => {
  assert.equal(figNumber('40 food'), 40);
  assert.equal(figNumber('×0.7 the time'), 0.7);
  assert.equal(figNumber('100%'), 100);
  assert.equal(figNumber('+6'), 6);
  assert.equal(figNumber('3,000 food'), 3000);
  assert.equal(figNumber('3 000 food'), 3000);
  assert.equal(figNumber('2.5M GP'), 2.5e6);
  assert.equal(figNumber('75K GP'), 75e3);
  assert.equal(figNumber('0.25'), 0.25);
  assert.equal(figNumber('−15 and colder'), -15);
  assert.equal(figNumber('—'), undefined);
});

test('figOdds reads a chance in words', () => {
  assert.equal(figOdds('1 in 10'), 0.1);
  assert.equal(figOdds('about 1 in 4'), 0.25);
  assert.equal(figOdds('never'), undefined);
});

test('a bar is scaled to the longest and a small value stays visible', () => {
  assert.equal(barWidth(40, 80), 50);
  assert.equal(barWidth(80, 80), 100);
  assert.equal(barWidth(1, 1000), 3);
  assert.equal(barWidth(0, 10), 0);
});

test('a pivot mark falls on the right side of the middle', () => {
  assert.deepEqual(pivotMark(0.7, 1, 0.4), { side: 'less', pct: 38 });
  assert.deepEqual(pivotMark(1.4, 1, 0.4), { side: 'more', pct: 50 });
  assert.deepEqual(pivotMark(1, 1, 0.4), { side: 'even', pct: 0 });
  assert.match(pivotCell('×0.7', 0.7, 1, 0.4), /vj-fig-good/);
  assert.match(pivotCell('×0.7', 0.7, 1, 0.4), /left:50%;width:38%/, 'a good figure grows right of the middle line');
  assert.match(pivotCell('×1.4', 1.4, 1, 0.4), /left:0%;width:50%/, 'a bad figure grows left of the middle line');
  assert.match(pivotCell('140%', 140, 100, 40, true), /left:50%;width:50%/, 'a good price sits on the right too');
  assert.match(pivotCell('60%', 60, 100, 40, true), /left:0%;width:50%/, 'a poor price sits on the left');
  assert.match(pivotCell('×1.4', 1.4, 1, 0.4), /vj-fig-bad/);
  assert.match(pivotCell('140%', 140, 100, 40, true), /vj-fig-good/);
});

test('a figure keeps every written value and leaves a blank cell without a mark', () => {
  const html = figureTable({ kind: 'bars', cols: [1, 2] }, ['Terrain', 'Food', 'Fuel'], [row('Grass', '40 food', '1'), row('Sea', '40 food', '—')]);
  for (const s of ['Grass', '40 food', '>1<', '—']) assert.ok(html.includes(s), s);
  assert.equal((html.match(/vj-fig-track/g) ?? []).length, 3);
});

test('columns of multipliers share one scale', () => {
  const html = figureTable({ kind: 'pivot', cols: [1, 2], at: 1 }, ['Kept', 'Food', 'Fuel'], [row('Cold', '×0.5', '×0.5'), row('Hot', '×2', '×1')]);
  assert.equal((html.match(/left:50%;width:25%/g) ?? []).length, 2);
});

test('crates come in rows of six', () => {
  const html = figureTable({ kind: 'crates', col: 1 }, ['Ship', 'Slots'], [row('Brig', '18'), row('Level 35', '+6')]);
  assert.equal((html.match(/<i><\/i>/g) ?? []).length, 24);
  assert.match(html, /vj-crates-plus/);
});

test('tiles carry the column name, each label and value', () => {
  const html = figureTable({ kind: 'tiles' }, ['Hex', 'Wear'], [row('Sea', '1%'), row('Deep water', '2%')]);
  for (const s of ['Wear', 'Sea', '1%', 'Deep water', '2%']) assert.ok(html.includes(s), s);
});

test('the thermometer bolds the word for each band', () => {
  const html = figureTable({ kind: 'thermo' }, ['Degrees', 'On land'], [row('1 to 19', 'mild: as ever')]);
  assert.match(html, /vj-thermo/);
  assert.match(html, /<b>mild<\/b>: as ever/);
});

test('every figure names a kind it can draw and every icon is a Font Awesome name', () => {
  const kinds = ['bars', 'pivot', 'odds', 'pips', 'crates', 'tiles', 'thermo', 'words', 'stack'];
  const specs = [...Object.values(HELP_DRESS).flatMap((d) => d.figs ?? []), ...Object.values(WRITTEN_FIGS).flatMap((c) => Object.values(c).flat())];
  for (const s of specs) assert.ok(kinds.includes(s.kind), s.kind);
  const icons = [...Object.values(HELP_DRESS).map((d) => d.icon), ...Object.values(SECTION_ICONS).flatMap((c) => Object.values(c)), ...Object.values(LIST_CARDS).flat()];
  for (const i of icons) assert.match(i, /^fa-[a-z-]+$/);
});
