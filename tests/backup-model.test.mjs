import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backup-model.mjs';

const record = JSON.stringify({ v: 27, landHexes: 10, journal: { found: { 'melvorD:Normal': ['14,10'] } } });
const sample = () => B.make({
  record, xp: 750977.5, name: 'VoFoSD', mode: 'melvorD:Standard', mod: '1.4.0', build: '2026-11-05.537', save: 27, at: Date.UTC(2026, 10, 5, 12),
  items: { 'voyage:Pitch': 11779, 'voyage:Crate': 20, 'melvorD:Normal_Logs': 5, 'voyage:Tent': 0 },
  buys: { 'voyage:Dry_Casks': 1, 'worker_folks:Hire_Newbie': 1 },
  settings: { spoilage: true, weather: false }, storage: { save: { v: 1, compassGiven: true } },
});

test('a backup keeps Voyage\'s own items and purchases only, in whole counts', () => {
  const b = sample();
  assert.deepEqual(b.items, { 'voyage:Pitch': 11779, 'voyage:Crate': 20 });
  assert.deepEqual(b.buys, { 'voyage:Dry_Casks': 1 });
  assert.equal(b.f, B.FORMAT);
  assert.equal(b.xp, 750977.5);
});

test('it can\'t be made at sea or Adrift: those run on the real clock', () => {
  assert.equal(B.blockedBy({ voyage: null, adrift: null }), undefined);
  assert.equal(B.blockedBy({ voyage: { walk: [] }, adrift: null }), 'voyage');
  assert.equal(B.blockedBy({ voyage: null, adrift: { q: 1 } }), 'adrift');
  assert.equal(B.blockedBy(undefined), 'empty');
});

test('the code goes there and back, deflated, and is much shorter than the record', async () => {
  const b = sample();
  const code = await B.encode(b);
  assert.match(code, /^VOYAGE-BACKUP:z:[A-Za-z0-9+/=]+$/);
  const back = await B.decode(code, 27);
  assert.deepEqual(back.backup, b);
  // pasted with line breaks and spaces, as a mail or a chat wraps it
  const wrapped = code.replace(/(.{60})/g, '$1\n ');
  assert.deepEqual((await B.decode(wrapped, 27)).backup, b);
  // a big record shrinks: the Journal's hex lists repeat a lot
  const big = B.make({ ...b, record: JSON.stringify({ v: 27, journal: { found: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`melvorD:Item_${i}`, Array.from({ length: 20 }, (_, j) => `${i % 30},${j}`)])) } }) });
  const bigCode = await B.encode(big);
  assert.ok(bigCode.length < big.record.length / 2, `${bigCode.length} vs ${big.record.length}`);
});

test('a broken, cut or foreign code is refused with its reason', async () => {
  const code = await B.encode(sample());
  assert.deepEqual(await B.decode('', 27), { why: 'empty' });
  assert.deepEqual(await B.decode('hello', 27), { why: 'notCode' });
  assert.equal((await B.decode(code.slice(0, code.length - 40), 27)).why, 'broken');
  // a changed character inside the sealed text: the checksum catches it
  const sealed = B.seal(sample()).replace('11779', '99999');
  const plain = `VOYAGE-BACKUP:j:${Buffer.from(sealed).toString('base64')}`;
  assert.deepEqual(await B.decode(plain, 27), { why: 'checksum' });
});

test('a record newer than this build is refused; an older one passes (the save migrates it on restore)', () => {
  const newer = B.seal(B.make({ ...sample(), record: JSON.stringify({ v: 28 }) }));
  assert.deepEqual(B.open(newer, 27), { why: 'newer' });
  const older = B.seal(B.make({ ...sample(), record: JSON.stringify({ v: 20 }) }));
  assert.ok(B.open(older, 27).backup !== undefined);
  assert.deepEqual(B.open(B.seal(B.make({ ...sample(), record: 'nope' })), 27), { why: 'record' });
  assert.deepEqual(B.open(B.seal({ ...sample(), f: 9 }), 27), { why: 'format' });
});

test('a restore tops items up to the backup and never doubles them; purchases at least the backup\'s', () => {
  const b = sample();
  // a fresh Voyage: everything comes back
  assert.deepEqual(B.restorePlan(b, {}), { add: [['voyage:Pitch', 11779], ['voyage:Crate', 20]], buys: [['voyage:Dry_Casks', 1]] });
  // the same code again, or Pitch made since: only the gap, nothing taken away
  assert.deepEqual(B.restorePlan(b, { items: { 'voyage:Pitch': 12000, 'voyage:Crate': 5 }, buys: { 'voyage:Dry_Casks': 1 } }), { add: [['voyage:Crate', 15]], buys: [] });
});

test('the download is named after the character and the day', () => {
  assert.equal(B.fileName('VoFoSD', Date.UTC(2026, 10, 5, 12)), 'voyage-backup-VoFoSD-2026-11-05.txt');
  assert.equal(B.fileName('  Ölaf the Bold!! ', Date.UTC(2026, 0, 2, 12)), 'voyage-backup-Olaf-the-Bold-2026-01-02.txt');
  assert.equal(B.fileName('', 0).startsWith('voyage-backup-character-'), true);
});

const withFolks = () => B.make({
  ...sample(),
  folks: [
    { id: 'a1', name: 'Ada', place: { q: 3, r: 4 }, travel: 'idle', traits: ['voyage:Seafarer', 'worker_folks:Quick', 'voyage:Seafarer'] },
    { id: 'b2', name: 'Bo', place: { q: 5, r: 5 }, travel: 'walking', traits: [] },
    { id: 'c3', name: 'Cy', place: null, travel: 'with', traits: ['voyage:Navigator'] },
    { id: 'a1', name: 'twin' }, 'junk',
  ],
});

test('a backup with Worker Folks keeps each Folk\'s hex, travel and Voyage traits; without it, none', () => {
  const b = withFolks();
  assert.deepEqual(b.folks.map((f) => f.id), ['a1', 'b2', 'c3']);
  assert.deepEqual(b.folks[0].traits, ['voyage:Seafarer']);
  assert.equal(sample().folks, null);
});

test('a restore puts matched Folks back, walks only where the record holds the walk, and their Voyage traits as they were', () => {
  const b = withFolks();
  const now = [
    { id: 'a1', name: 'Ada', place: { q: 9, r: 9 }, travel: 'idle', traits: ['voyage:Homebody', 'worker_folks:Quick'] },
    { id: 'b2', name: 'Bo', place: { q: 6, r: 5 }, travel: 'idle', traits: [] },
    { id: 'd4', name: 'Di', place: { q: 1, r: 1 }, travel: 'walking', traits: [] },
  ];
  const p = B.folksPlan(b, now, { b2: { road: [] } });
  assert.deepEqual(p.moves, [
    { id: 'a1', name: 'Ada', place: { q: 3, r: 4 }, travel: 'idle' },
    { id: 'b2', name: 'Bo', place: { q: 5, r: 5 }, travel: 'walking' },
  ]);
  assert.deepEqual(p.earn, [['a1', 'voyage:Seafarer']]);
  assert.deepEqual(p.drop, [['a1', 'voyage:Homebody']]);
  // Di walks now, but the restored record has no walk for her: she stops where she is
  assert.deepEqual(p.halt, [{ id: 'd4', name: 'Di' }]);
  assert.deepEqual(p.gone, ['Cy']);
  assert.equal(p.back, 2);
  assert.equal(p.none, false);
  // Bo's walk not in the record: he stands on his hex instead of waiting for a walk that isn't there
  assert.deepEqual(B.folksPlan(b, now, {}).moves[1], { id: 'b2', name: 'Bo', place: { q: 5, r: 5 }, travel: 'idle' });
  // the same restore again: nothing left to do
  const after = [{ ...now[0], place: { q: 3, r: 4 }, traits: ['voyage:Seafarer'] }, { ...now[1], place: { q: 5, r: 5 }, travel: 'walking' }];
  assert.deepEqual(B.folksPlan(b, after, { b2: {} }), { moves: [], earn: [], drop: [], halt: [], gone: ['Cy'], back: 2, none: false });
});

test('a backup made without Worker Folks leaves the Folks alone, but no one waits on a walk the record lacks', () => {
  const p = B.folksPlan(sample(), [{ id: 'x', name: 'X', place: { q: 0, r: 0 }, travel: 'walking', traits: ['voyage:Seafarer'] }], {});
  assert.deepEqual(p, { moves: [], earn: [], drop: [], halt: [{ id: 'x', name: 'X' }], gone: [], back: 0, none: true });
});

test('the Folks part goes through the code and back', async () => {
  const b = withFolks();
  assert.deepEqual((await B.decode(await B.encode(b), 27)).backup.folks, b.folks);
  // a code from before the Folks part reads as made without Worker Folks
  const { folks, ...old } = b;
  assert.equal(B.open(B.seal(old), 27).backup.folks, null);
});

test('with a Worker Folks that backs itself up, its whole code rides along unchanged; junk is dropped', async () => {
  const whole = 'FOLKS-BACKUP:z:AbCd+/==';
  const b = B.make({ ...sample(), whole });
  assert.equal(b.whole, whole);
  assert.equal((await B.decode(await B.encode(b), 27)).backup.whole, whole);
  assert.equal(B.make({ ...sample(), whole: 'VOYAGE-BACKUP:z:AA==' }).whole, null);
  assert.equal(B.make({ ...sample(), whole: 42 }).whole, null);
  assert.equal(sample().whole, null);
  // a code from before the whole part reads as made without it
  const { whole: _w, ...old } = b;
  assert.equal(B.open(B.seal(old), 27).backup.whole, null);
});

test('Worker Folks\' own code pasted here is told apart: it is restored on the Hiring page', async () => {
  assert.deepEqual(await B.decode('FOLKS-BACKUP:z:AbCd', 27), { why: 'folks' });
  assert.deepEqual(await B.decode(' FOLKS-BACKUP:j:\nAbCd ', 27), { why: 'folks' });
});
