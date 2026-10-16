import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSave, loadSave, serializeSave, emptyJournal, cleanJournal, JOURNAL_GUIDES, JOURNAL_LIMITS, FREE_CHART_LEVELS, GOLBIN_GIFT } from '../src/voyage-model.mjs';
import { addFound, addMiss, addPlace, placesOf, learn, byDistance, search, parseHex, splitLinks, linkTargetExists, chart, chartChance, freeChartsLeft, markUnread, markRead, unreadCount, CHART_ITEMS } from '../src/journal-model.mjs';

test('v6 saves get an empty journal', () => {
  const v6 = { v: 6, landHexes: 3, waterHexes: 0, backfilled: true, ship: null, shipChecked: true, stores: { food: 10, fuel: 1 }, kitGiven: true, hold: [], unlockNotice: [] };
  const { save, report } = loadSave(JSON.stringify(v6));
  assert.deepEqual(report.applied, [6, 7, 8]);
  assert.deepEqual(save.journal, emptyJournal());
  assert.equal(save.landHexes, 3);
});

test('a journal round-trips and junk is dropped', () => {
  const save = defaultSave();
  addFound(save.journal, 'melvorD:Iron_Ore', 3, 5, { q: 0, r: 0 }, JOURNAL_LIMITS.found);
  addMiss(save.journal, 'melvorD:Iron_Ore', 4, 5, JOURNAL_LIMITS.missed);
  addPlace(save.journal, 'combat', 'melvorD:Farmlands', 1, 2);
  learn(save.journal, 'terrain', JOURNAL_GUIDES);
  assert.deepEqual(loadSave(serializeSave(save)).save, save);
  const dirty = cleanJournal({
    found: { a: ['1,2', '1,2', 'x', 5], b: [], '': ['1,1'] },
    missed: 'no',
    places: { 'combat|a': '1,2', 'boat|b': '1,2', 'trade|': '1,2', 'trade|c': 'far' },
    guides: ['grace', 'nope', 'terrain', 'grace'],
  });
  assert.deepEqual(dirty, { found: { a: ['1,2'] }, missed: {}, places: { 'combat|a': '1,2' }, guides: ['grace', 'terrain'], charted: [], freeUsed: 0, unread: {}, golbin: false });
  assert.deepEqual(cleanJournal(null), emptyJournal());
});

test('finds: first, more, repeats, and the nearest to the start kept', () => {
  const j = emptyJournal();
  const start = { q: 0, r: 0 };
  assert.equal(addFound(j, 'x', 5, 0, start, 3), 'new');
  assert.equal(addFound(j, 'x', 5, 0, start, 3), undefined);
  assert.equal(addFound(j, 'x', 1, 0, start, 3), 'more');
  addFound(j, 'x', 9, 0, start, 3);
  addFound(j, 'x', 2, 0, start, 3);
  assert.deepEqual(j.found.x, ['1,0', '2,0', '5,0']);
});

test('misses: never on a found hex, no repeats, oldest goes, and a find clears one', () => {
  const j = emptyJournal();
  addFound(j, 'x', 1, 1, undefined, 20);
  assert.equal(addMiss(j, 'x', 1, 1, 2), false);
  assert.equal(addMiss(j, 'x', 2, 1, 2), true);
  assert.equal(addMiss(j, 'x', 2, 1, 2), false);
  addMiss(j, 'x', 3, 1, 2);
  addMiss(j, 'x', 4, 1, 2);
  assert.deepEqual(j.missed.x, ['3,1', '4,1']);
  addFound(j, 'x', 3, 1, undefined, 20);
  addFound(j, 'x', 4, 1, undefined, 20);
  assert.equal(j.missed.x, undefined);
});

test('places and guide pages are noted once', () => {
  const j = emptyJournal();
  assert.equal(addPlace(j, 'trade', 'Market', 1, 2), true);
  assert.equal(addPlace(j, 'trade', 'Market', 3, 3), false);
  addPlace(j, 'combat', 'Farmlands', 4, 4);
  assert.deepEqual(placesOf(j, 'trade'), [{ id: 'Market', q: 1, r: 2 }]);
  assert.equal(learn(j, 'zone', JOURNAL_GUIDES), true);
  assert.equal(learn(j, 'zone', JOURNAL_GUIDES), false);
  assert.equal(learn(j, 'made-up', JOURNAL_GUIDES), false);
});

test('hexes by distance, nearest first', () => {
  assert.deepEqual(byDistance(['4,0', '1,0'], { q: 0, r: 0 }).map((h) => h.distance), [1, 4]);
  assert.equal(parseHex('a,b'), undefined);
});

test('search takes action and item names, by word starts', () => {
  const entries = [
    { id: 'rock', names: ['Iron', 'Iron Ore'] },
    { id: 'fish', names: ['Shark', 'Raw Shark'] },
    { id: 'tree', names: ['Oak Tree', 'Oak Logs'] },
  ];
  assert.deepEqual(search(entries, 'iron'), ['rock']);
  assert.deepEqual(search(entries, 'Raw Shark'), ['fish']);
  assert.deepEqual(search(entries, 'ore'), ['rock']);
  assert.deepEqual(search(entries, 'ak'), []);
  assert.deepEqual(search(entries, '  '), ['rock', 'fish', 'tree']);
});

test('search takes the skill name too, alone or with a name', () => {
  const entries = [
    { id: 'iron', names: ['Iron', 'Iron Ore'], skill: 'Mining' },
    { id: 'copper', names: ['Copper', 'Copper Ore'], skill: 'Mining' },
    { id: 'shark', names: ['Shark', 'Raw Shark'], skill: 'Fishing' },
  ];
  assert.deepEqual(search(entries, 'mining'), ['iron', 'copper']);
  assert.deepEqual(search(entries, 'min cop'), ['copper']);
  assert.deepEqual(search(entries, 'fish'), ['shark']);
  assert.deepEqual(search(entries, 'mining shark'), []);
});

test('crosslinks: split into text and links, targets checked', () => {
  assert.deepEqual(splitLinks('See [[ch:stores|the table]] and [[tab:places|Places]].'), [
    { text: 'See ' }, { kind: 'ch', id: 'stores', text: 'the table' }, { text: ' and ' }, { kind: 'tab', id: 'places', text: 'Places' }, { text: '.' },
  ]);
  assert.deepEqual(splitLinks('no links'), [{ text: 'no links' }]);
  assert.deepEqual(splitLinks('[[guide:zone|Zones]]'), [{ kind: 'guide', id: 'zone', text: 'Zones' }]);
  assert.deepEqual(splitLinks('[[broken|x]]'), [{ text: '[[broken|x]]' }]);
  assert.equal(linkTargetExists('ch', 'lands', []), true);
  assert.equal(linkTargetExists('ch', 'nope', []), false);
  assert.equal(linkTargetExists('guide', 'zone', ['zone']), true);
  assert.equal(linkTargetExists('tab', 'resources', []), true);
  assert.equal(linkTargetExists('url', 'x', []), false);
});

test('v7 saves get charting and unread marks, the rest kept', () => {
  const v7 = { v: 7, landHexes: 1, waterHexes: 0, backfilled: true, ship: null, shipChecked: true, stores: { food: 0, fuel: 0 }, kitGiven: true, hold: [], unlockNotice: [], journal: { found: { a: ['1,1'] }, missed: {}, places: {}, guides: ['zone'] } };
  const { save, report } = loadSave(JSON.stringify(v7));
  assert.deepEqual(report.applied, [7, 8]);
  assert.deepEqual(save.journal, { found: { a: ['1,1'] }, missed: {}, places: {}, guides: ['zone'], charted: [], freeUsed: 0, unread: {}, golbin: false });
});

test('the golbin\'s purse is given once: the flag survives a save, junk reads as not given', () => {
  const save = defaultSave();
  assert.equal(save.journal.golbin, false);
  save.journal.golbin = true;
  assert.equal(loadSave(serializeSave(save)).save.journal.golbin, true);
  assert.equal(cleanJournal({ golbin: 'yes' }).golbin, false);
  assert.ok(GOLBIN_GIFT.gp > 0 && GOLBIN_GIFT.items.every((x) => x.id.includes(':') && x.quantity > 0));
});

test('charting: once per action, junk cleaned, free charts counted', () => {
  const j = emptyJournal();
  assert.equal(chart(j, 'melvorD:Iron'), true);
  assert.equal(chart(j, 'melvorD:Iron'), false);
  assert.deepEqual(cleanJournal({ charted: ['a', 'a', 5, ''], freeUsed: 9 }).charted, ['a']);
  assert.equal(cleanJournal({ freeUsed: 9 }).freeUsed, FREE_CHART_LEVELS.length);
  assert.equal(freeChartsLeft(29, 0, FREE_CHART_LEVELS), 0);
  assert.equal(freeChartsLeft(50, 0, FREE_CHART_LEVELS), 2);
  assert.equal(freeChartsLeft(99, 3, FREE_CHART_LEVELS), 1);
  assert.equal(freeChartsLeft(30, 2, FREE_CHART_LEVELS), 0);
  assert.equal(chartChance(1).toFixed(6), (1 / 2000 * (1 + 1 / 99)).toFixed(6));
  assert.equal(chartChance(99), 1 / 1000);
  assert.equal(chartChance(120), 1 / 1000);
  assert.equal(Object.keys(CHART_ITEMS).length, 6);
});

test('unread marks: new stays new, updated, read, oldest dropped, junk cleaned', () => {
  const j = emptyJournal();
  markUnread(j, 'a:x', 'new', 3);
  markUnread(j, 'a:x', 'more', 3);
  assert.equal(j.unread['a:x'], 'new');
  markUnread(j, 'a:y', 'more', 3);
  markUnread(j, 'p:combat|z', 'new', 3);
  markUnread(j, 'g:zone', 'new', 3);
  assert.deepEqual(Object.keys(j.unread), ['a:y', 'p:combat|z', 'g:zone']);
  assert.equal(unreadCount(j, 'a:'), 1);
  assert.equal(unreadCount(j), 3);
  assert.equal(markRead(j, 'a:y'), true);
  assert.equal(markRead(j, 'a:y'), false);
  assert.deepEqual(cleanJournal({ unread: { 'a:x': 'more', 'q:x': 'new', 'g:': 'new', 'g:zone': 'old' } }).unread, { 'a:x': 'more' });
});
