import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backup-model.mjs';
import { SAVE_VERSION, defaultSave, loadSave, serializeSave } from '../src/voyage-model.mjs';
import { cleanCouriers, newCourier, startLeg } from '../src/courier-model.mjs';

const SEA = new Set(['1,0', '2,0', '3,0', '9,9']);
const seaOpts = { isSea: (h) => SEA.has(`${h.q},${h.r}`), coast: () => ({ q: 9, r: 9 }) };
const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }];

test('a copy at sea on the hex you stand on comes back as it is', () => {
  const rec = { voyage: { walk, at: 1 }, adrift: null, ship: null, boat: { q: 1, r: 0, hull: 'dinghy' } };
  assert.equal(B.settleAtSea(rec, { q: 1, r: 0 }, seaOpts), rec);
});

test('you sailed on after the copy: your vessel comes to your hex', () => {
  const rec = { voyage: { walk, at: 1 }, adrift: null, ship: null, boat: { q: 1, r: 0, hull: 'dinghy' } };
  const out = B.settleAtSea(rec, { q: 3, r: 0 }, seaOpts);
  assert.deepEqual([out.boat.q, out.boat.r], [3, 0]);
  assert.deepEqual(rec.boat, { q: 1, r: 0, hull: 'dinghy' }, 'the copy is not changed');
});

test('the big ship brings the boat on its deck', () => {
  const rec = { voyage: { walk, at: 1 }, adrift: null, ship: { q: 1, r: 0 }, boat: { q: 1, r: 0, aboard: true } };
  const out = B.settleAtSea(rec, { q: 2, r: 0 }, seaOpts);
  assert.deepEqual([out.ship.q, out.boat.q, out.boat.aboard], [2, 2, true]);
});

test('stepped ashore on the way: the vessel waits on the last sea hex', () => {
  const rec = { voyage: { walk, at: 1 }, adrift: null, ship: null, boat: { q: 1, r: 0 } };
  const out = B.settleAtSea(rec, { q: 4, r: 0 }, seaOpts);
  assert.deepEqual([out.boat.q, out.boat.r], [3, 0]);
});

test('on land off the way: the vessel comes to a coast', () => {
  const rec = { voyage: { walk, at: 1 }, adrift: null, ship: null, boat: { q: 1, r: 0 } };
  const out = B.settleAtSea(rec, { q: 7, r: 7 }, seaOpts);
  assert.deepEqual([out.boat.q, out.boat.r], [9, 9]);
});

test('an Adrift spell left behind ends and its vessel follows', () => {
  const rec = { voyage: null, adrift: { q: 1, r: 0 }, ship: null, boat: { q: 1, r: 0 } };
  const out = B.settleAtSea(rec, { q: 2, r: 0 }, seaOpts);
  assert.equal(out.adrift, null);
  assert.equal(out.boat.q, 2);
});

test('ashore in the copy nothing is moved', () => {
  const rec = { voyage: null, adrift: null, ship: null, boat: { q: 1, r: 0 } };
  assert.equal(B.settleAtSea(rec, { q: 2, r: 0 }, seaOpts), rec);
});

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

test('a safety copy taken mid-route brings back couriers, the walks and the route choice', async () => {
  const step = (q, r) => ({ q, r, cls: 'grasslands', ms: 100 });
  const stops = [{ kind: 'bank', q: 0, r: 0 }, { kind: 'folk', id: 'lark' }];
  const courier = {
    ...startLeg(newCourier(stops, { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0), step(2, 0)]),
    reached: 1, into: 40, pending: [{ kind: 'bank', q: 3, r: 0 }, { kind: 'folk', id: 'ingrid' }],
    pack: { food: 12, fuel: 3 },
    round: { carried: { 'f:lark': 2000 }, ms: 5000, fares: 10, trips: 1 },
    last: { carried: { 'f:lark': 9000 }, ms: 20000, fares: 40, trips: 2 },
  };
  const walk = { to: { q: 5, r: 5 } };
  const record = {
    ...defaultSave(), routeBy: 'fast', couriers: { rolf: courier }, walks: { jory: walk },
    voyage: { walk: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], at: 1 }, boat: { q: 1, r: 0, hull: 'dinghy' },
  };
  const b = B.make({
    record: serializeSave(record), xp: 500, name: 'A', mode: 'melvorD:Standard', save: SAVE_VERSION, at: 1,
    folks: [{ id: 'rolf', name: 'Rolf', place: { q: 1, r: 0 }, travel: 'walking', traits: [] }, { id: 'jory', name: 'Jory', place: { q: 2, r: 2 }, travel: 'walking', traits: [] }],
  });
  const { backup } = await B.decode(await B.encode(b), SAVE_VERSION);
  const raw = loadSave(backup.record).save;
  const save = B.settleAtSea(raw, { q: 2, r: 0 }, seaOpts);
  assert.equal(save.routeBy, 'fast');
  assert.deepEqual(cleanCouriers(save.couriers), { rolf: courier });
  assert.deepEqual(save.walks, { jory: walk });
  assert.deepEqual([save.boat.q, save.boat.r], [2, 0], 'the vessel comes to where the game has you');
  const now = [
    { id: 'rolf', name: 'Rolf', place: { q: 9, r: 9 }, travel: 'idle', traits: [] },
    { id: 'jory', name: 'Jory', place: { q: 9, r: 8 }, travel: 'idle', traits: [] },
    { id: 'new', name: 'New', place: { q: 7, r: 7 }, travel: 'walking', traits: [] },
  ];
  const plan = B.folksPlan(backup, now, { ...save.walks, ...save.couriers });
  assert.deepEqual(plan.moves.map((m) => [m.id, m.travel]), [['rolf', 'walking'], ['jory', 'walking']], 'a courier and a walker stay on the road');
  assert.deepEqual(plan.halt.map((h) => h.id), ['new']);
});

test('a loaded file must start like a code, and an oversized or bomb code is refused', async () => {
  assert.equal(B.looksLikeCode('  VOYAGE-BACKUP:z:abc'), true);
  assert.equal(B.looksLikeCode('hello'), false);
  assert.equal(B.looksLikeCode(''), false);
  assert.deepEqual(await B.decode('x'.repeat(B.MAX_CODE + 1), SAVE_VERSION), { why: 'broken' });
  const zero = new Uint8Array(B.MAX_UNPACKED + 1024);
  const w = new CompressionStream('deflate-raw');
  const packed = new Uint8Array(await new Response(new Blob([zero]).stream().pipeThrough(w)).arrayBuffer());
  const code = `VOYAGE-BACKUP:z:${Buffer.from(packed).toString('base64')}`;
  assert.ok(code.length < B.MAX_CODE);
  assert.deepEqual(await B.decode(code, SAVE_VERSION), { why: 'broken' });
});
