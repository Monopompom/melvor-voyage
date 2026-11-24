// The rival captain (round 5): when he is out, the odds he is the band met at sea, his deck growing with every Pay and
// Run, his strength and bounty, his record in the save; and in the fight engine, his own band never picked at random,
// his captain cards in his moves, the Tricorn's Nerve cut at sea, his loot without a rare trophy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/encounter-model.mjs';
import * as V from '../src/rival-model.mjs';
import * as L from '../src/encounter-loot-model.mjs';
import { cleanFight } from '../src/encounter-rules-model.mjs';

const fresh = () => V.cleanRival({}, E);

test('he comes out after ten bands met at sea, at most once a day, more on the seas you sail most, never once beaten', () => {
  const r = fresh();
  assert.equal(V.isOut(r), false);
  assert.equal(V.chanceOf(r, { hexes: 100, top: 100, now: 1 }), 0);
  const out = { ...r, seaMet: V.FIRST_AFTER };
  assert.equal(V.isOut(out), true);
  assert.equal(V.chanceOf(out, { hexes: 100, top: 100, now: 1 }), V.CHANCE, 'your most-sailed sea');
  assert.equal(V.chanceOf(out, { hexes: 50, top: 100, now: 1 }), V.CHANCE / 2, 'a sea sailed half as much');
  assert.equal(V.chanceOf(out, { hexes: 0, top: 100, now: 1 }), 0, 'a sea never sailed');
  const met = V.meeting(out, 'MistyPort', 1000);
  assert.deepEqual([met.met, met.last, met.lastSea], [1, 1000, 'MistyPort']);
  assert.equal(V.chanceOf(met, { hexes: 100, top: 100, now: 1000 + V.GAP_MS - 1 }), 0, 'not twice in a day');
  assert.equal(V.chanceOf(met, { hexes: 100, top: 100, now: 1000 + V.GAP_MS }), V.CHANCE);
  const beaten = V.ended(met, 'won', 5000, E);
  assert.equal(beaten.beaten, 5000);
  assert.equal(V.isOut(beaten), false, 'the thread ends');
  assert.equal(V.chanceOf(beaten, { hexes: 100, top: 100, now: 1e12 }), 0);
  assert.equal(V.CHANCE, 1 / 6);
  assert.equal(V.FIRST_AFTER, 10);
});

test('each Pay or Run gives him his next card, stronger and with a bigger bounty; a loss or a draw gives none', () => {
  let r = { ...fresh(), seaMet: 10 };
  assert.deepEqual(V.deckOf(r, E), E.RIVAL_START);
  assert.equal(V.bountyOf(r), 20000);
  assert.equal(V.strengthMul(r), 1);
  r = V.ended(r, 'pay', 1, E);
  r = V.ended(r, 'run', 2, E);
  assert.deepEqual(r.cards, E.RIVAL_GAINS.slice(0, 2));
  assert.deepEqual([r.paid, r.ran], [1, 1]);
  assert.equal(V.bountyOf(r), 30000);
  assert.ok(Math.abs(V.strengthMul(r) - 1.08) < 1e-9);
  r = V.ended(V.ended(r, 'lost', 3, E), 'drew', 4, E);
  assert.deepEqual([r.lost, r.drew, r.cards.length], [1, 1, 2]);
  for (let i = 0; i < 20; i++) r = V.ended(r, 'pay', 5, E);
  assert.equal(r.cards.length, E.RIVAL_GAINS.length, 'nine at most');
  assert.equal(V.deckOf(r, E).length, 12);
  assert.equal(V.bountyOf(r), 20000 + 5000 * 9);
  for (const id of [...E.RIVAL_START, ...E.RIVAL_GAINS]) assert.ok(E.CAPTAIN_CARDS[id], id);
});

test('the save keeps his record; cards out of order or unknown are cut there', () => {
  const r = V.cleanRival({ seaMet: 12, met: 3, paid: 1, ran: 1, lost: 0, drew: 1, cards: ['broadside2', 'taunt', 'nope', 'ironbrace'], last: 99.5, lastSea: 'MistyPort', beaten: -4 }, E);
  assert.deepEqual(r, { seaMet: 12, met: 3, paid: 1, ran: 1, lost: 0, drew: 1, cards: ['broadside2', 'taunt'], last: 99, lastSea: 'MistyPort', beaten: 0 });
  assert.deepEqual(V.cleanRival({ cards: ['taunt'] }, E).cards, [], 'not from the first gain: none');
  assert.deepEqual(V.cleanRival('junk', E), fresh());
  assert.equal(V.cleanRival({ lastSea: 'a b' }, E).lastSea, '');
});

test('his band is never picked at random; his captain cards are in his moves; a saved fight keeps his deck', () => {
  assert.equal(E.bandsOf('sea').includes('rival'), false);
  assert.equal(E.BANDS.rival.where, 'sea');
  const opt = { band: 'rival', tier: 3, seed: 21, strength: 1, deck: E.STARTER, where: 'sea', gp: 50000, toll: 2500, know: [], rival: [...E.RIVAL_START, ...E.RIVAL_GAINS] };
  const s = E.newFight(opt);
  const kinds = new Set(E.BANDS.rival.moves({ ...s, round: 3, intents: [{}] }).filter(([w]) => w > 0).map(([, m]) => m.kind));
  for (const k of ['volley', 'board', 'strike', 'call', 'brace', 'charge', 'grab']) assert.ok(kinds.has(k), k);
  assert.ok(E.autoFight(opt).over, 'a fight against him plays to its end');
  const f = cleanFight({ opt: { ...opt, rival: ['broadside', 'nope', 'chainshot'] } }, E);
  assert.deepEqual(f.opt.rival, ['broadside', 'chainshot']);
  assert.deepEqual(cleanFight({ opt: { ...opt, rival: undefined } }, E).opt.rival, E.RIVAL_START);
  assert.equal(cleanFight({ opt: { ...opt, band: 'corsairs' } }, E).opt.rival, undefined);
});

test('he starts a little harder than a corsair; his gained cards and their strength make him much harder', () => {
  const rate = (band, rival, more = 1) => {
    let w = 0;
    for (let k = 0; k < 400; k++) {
      const s = E.autoFight({ band, tier: 1, seed: k * 31 + 8, deck: E.STARTER, where: 'sea', gp: 50000, toll: 500, know: [], cannons: 2, hull: true, rival, strength: E.TIER_F[1] * more });
      if (s.over === 'win' || s.over === 'fled') w++;
    }
    return w / 400;
  };
  const corsair = rate('corsairs');
  const start = rate('rival', E.RIVAL_START);
  const six = rate('rival', [...E.RIVAL_START, ...E.RIVAL_GAINS.slice(0, 6)], 1.24);
  assert.ok(start < corsair && start > 0.5, `start ${start} against a corsair's ${corsair}`);
  assert.ok(six < 0.35, `six cards gained: ${six}`);
});

test('the Tricorn: a band at sea starts with a tenth less Nerve; on land it does nothing', () => {
  const sea = { band: 'corsairs', tier: 2, seed: 3, strength: 1, deck: E.STARTER, where: 'sea', gp: 0, toll: 100, know: [] };
  const plain = E.newFight(sea).band.max;
  const worn = E.newFight({ ...sea, charms: ['tricorn'] }).band.max;
  assert.equal(worn, Math.round(E.BANDS.corsairs.nerve * E.TUNE.nerve * E.TRICORN_NERVE));
  assert.ok(worn < plain);
  const land = { ...sea, band: 'highwaymen', where: 'land' };
  assert.equal(E.newFight({ ...land, charms: ['tricorn'] }).band.max, E.newFight(land).band.max);
  assert.equal(E.CHARMS.tricorn.trophy, 'rival');
});

test('his loot is a corsair\'s, and a rare trophy roll from him is a Bank Slot Token: the Tricorn comes with the win', () => {
  const loot = L.rollLoot('rival', 4, 3, () => 0, { rare: 'trophy' }, [], () => true);
  assert.equal(loot.some((x) => x.trophy !== undefined), false);
  assert.ok(loot.some((x) => x.id === L.BANK_SLOT_TOKEN));
});
