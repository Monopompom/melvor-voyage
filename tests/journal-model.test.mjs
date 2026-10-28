import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSave, loadSave, serializeSave, emptyJournal, cleanJournal, JOURNAL_GUIDES, JOURNAL_LIMITS, FREE_CHART_LEVELS, GOLBIN_GIFT } from '../src/voyage-model.mjs';
import { addFound, addMiss, addPlace, placesOf, learn, byDistance, search, parseHex, splitLinks, linkTargetExists, folksLines, chart, chartChance, freeChartsLeft, markUnread, markRead, unreadCount, CHART_ITEMS, JOURNAL_GUIDE_SECTIONS, JOURNAL_CHAPTERS, JOURNAL_WRITTEN } from '../src/journal-model.mjs';

test('v6 saves get an empty journal', () => {
  const v6 = { v: 6, landHexes: 3, waterHexes: 0, backfilled: true, ship: null, shipChecked: true, stores: { food: 10, fuel: 1 }, kitGiven: true, hold: [], unlockNotice: [] };
  const { save, report } = loadSave(JSON.stringify(v6));
  assert.deepEqual(report.applied, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(save.journal, { ...emptyJournal(), opened: true });
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
  assert.deepEqual(dirty, { found: { a: ['1,2'] }, missed: {}, places: { 'combat|a': '1,2' }, guides: ['grace', 'terrain'], charted: [], freeUsed: 0, unread: {}, golbin: false, ports: {}, opened: false });
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
  assert.deepEqual(report.applied, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepEqual(save.journal, { found: { a: ['1,1'] }, missed: {}, places: {}, guides: ['zone'], charted: [], freeUsed: 0, unread: {}, golbin: false, ports: {}, opened: true });
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
  assert.equal(freeChartsLeft(60, 0, FREE_CHART_LEVELS), 4, 'all four by Voyage 60 (the balance pass)');
  assert.equal(freeChartsLeft(99, 3, FREE_CHART_LEVELS), 1);
  assert.equal(freeChartsLeft(30, 2, FREE_CHART_LEVELS), 0);
  // One per 3 weeks of the work, whatever the action's length (build .210; was 1 in 20,000 by Voyage level).
  assert.equal(Math.round(1 / chartChance(3000)), 604800);
  assert.equal(Math.round(1 / chartChance(60000)), 30240);
  assert.equal(chartChance(-1), 0);
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

test('the chart and the Manifest come first, so chapter spreads start at 1', async () => {
  const { chapterSpread, howSpreads, FIRST_SPREADS } = await import('../src/journal-model.mjs');
  assert.equal(FIRST_SPREADS, 1);
  assert.deepEqual([0, 1, 2, 3, 15].map(chapterSpread), [1, 1, 2, 2, 8]);
  assert.equal(howSpreads(16), 9);
  assert.equal(howSpreads(15), 9);
  assert.equal(howSpreads(0), 1);
});

test('islands reached and ports used (phase 4 wrap-up): place kinds, port deeds counted and cleaned', async () => {
  const jm = await import('../src/journal-model.mjs');
  const save = defaultSave();
  assert.equal(jm.addPlace(save.journal, 'island', 'mainland', 15, 9), true);
  assert.equal(jm.notePort(save.journal, 'BeginningPort', 'load', 17, 13), true);
  assert.equal(jm.notePort(save.journal, 'BeginningPort', 'load', 17, 13), false, 'one place, two loads');
  jm.notePort(save.journal, 'BeginningPort', 'chart', 17, 13);
  assert.deepEqual(save.journal.ports, { BeginningPort: { load: 2, chart: 1 } });
  assert.deepEqual(jm.placesOf(save.journal, 'port'), [{ id: 'BeginningPort', q: 17, r: 13 }]);
  assert.deepEqual(loadSave(serializeSave(save)).save, save);
  assert.deepEqual(cleanJournal({ ports: { A: { load: 2, nope: 3, deliver: -1 }, B: { take: 'x' }, '': { load: 1 } } }).ports, { A: { load: 2 } });
  assert.deepEqual(cleanJournal({ places: { 'island|frost': '20,26', 'port|A': '1,1' } }).places, { 'island|frost': '20,26', 'port|A': '1,1' });
});

test('roman folios go past xvi', async () => {
  const { roman, JOURNAL_CHAPTERS } = await import('../src/journal-model.mjs');
  assert.deepEqual([1, 4, 9, 14, 16, 17, 19, 20, 24, 40].map(roman), ['i', 'iv', 'ix', 'xiv', 'xvi', 'xvii', 'xix', 'xx', 'xxiv', 'xl']);
  for (let i = 1; i <= JOURNAL_CHAPTERS.length + 4; i++) assert.match(roman(i), /^[ivxl]+$/);
  assert.equal(roman(0), '0');
});

test('cargo, markets, notices and planning live in the Guide, written at their first moment', () => {
  for (const id of ['cargo', 'markets', 'notices', 'planning']) {
    assert.ok(!JOURNAL_CHAPTERS.includes(id), id);
    assert.equal(JOURNAL_WRITTEN[id], undefined, id);
  }
  assert.deepEqual(Object.keys(JOURNAL_GUIDE_SECTIONS).sort(), ['board', 'cargo', 'market', 'planning', 'rumour']);
  for (const id of Object.keys(JOURNAL_GUIDE_SECTIONS)) assert.ok(JOURNAL_GUIDES.includes(id), id);
  // Every section of the old notices chapter lands on exactly one page.
  const notices = Object.values(JOURNAL_GUIDE_SECTIONS).filter((g) => g.from === 'NOTICES').flatMap((g) => g.sections).sort();
  assert.deepEqual(notices, ['CHARTS', 'ONE', 'RUMOURS', 'TASKS']);
});

test('prose marks: points, ledgers and notes among paragraphs', async () => {
  const { proseBlocks } = await import('../src/journal-model.mjs');
  assert.deepEqual(proseBlocks(['Lead.', '- one', '- two', '| Kind | Pays |', '| Fish | 140 |', '| Ore | 60 |', '> A note.', '', 'After.']), [
    { kind: 'p', text: 'Lead.' },
    { kind: 'points', items: ['one', 'two'] },
    { kind: 'table', head: ['Kind', 'Pays'], rows: [['Fish', '140'], ['Ore', '60']] },
    { kind: 'note', text: 'A note.' },
    { kind: 'p', text: 'After.' },
  ]);
  assert.deepEqual(proseBlocks(['A - B is not a point', 'x | y']), [{ kind: 'p', text: 'A - B is not a point' }, { kind: 'p', text: 'x | y' }]);
  assert.deepEqual(proseBlocks(undefined), []);
});

test('prose marks: a crosslink in a ledger cell keeps its bar', async () => {
  const { proseBlocks } = await import('../src/journal-model.mjs');
  const [t] = proseBlocks(['| Setting | What it does |', "| Timed travel off | Instant again ([[ch:clock|The ship's clock]]) |"]);
  assert.deepEqual(t.rows, [['Timed travel off', "Instant again ([[ch:clock|The ship's clock]])"]]);
});

test('folksLines: a {folks} line shows only with Folks on, its mark gone', () => {
  const lines = ['- Trade says so.', '- {folks} Folks here names them.', 'Plain.'];
  assert.deepEqual(folksLines(lines, false), ['- Trade says so.', 'Plain.']);
  assert.deepEqual(folksLines(lines, true), ['- Trade says so.', '- Folks here names them.', 'Plain.']);
  assert.deepEqual(folksLines(['{folks} Alone.'], true), ['Alone.']);
  // {wf:<name>}: a Worker Folks feature its API reports (build .423).
  const wf = ['A.', '- {wf:orders} Orders.', '{wf:sev} Severance.'];
  assert.deepEqual(folksLines(wf, true, { orders: true }), ['A.', '- Orders.']);
  assert.deepEqual(folksLines(wf, true), ['A.'], 'an older Worker Folks reports none');
  assert.deepEqual(folksLines(wf, false, { orders: true, sev: true }), ['A.'], 'nothing of Folks with Folks off');
});
