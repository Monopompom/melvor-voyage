import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS, TRICKS, BANDS, CHARMS, STARTER, FOLK_DECK, SUITS, ATTACKS, TIER_F, TARGET, DECK_MIN, DECK_MAX,
  newFight, play, toss, endRound, pressOn, replay, autoFight, aiRound, odds, oddsRun, oddsOfTally, calibrate, calibration, bandsOf,
  canPlay, cardN, cardCost, trickOf, kindKey, moveText,
} from '../src/encounter-model.mjs';

const base = (o = {}) => ({ band: 'highwaymen', tier: 1, seed: 11, deck: STARTER, where: 'land', gp: 50000, toll: 2500, know: [], ...o });
const sig = (s) => [s.over, s.round, s.band.nerve, s.you.resolve, s.gp, s.edge, s.found.join(), s.log.length].join('|');

test('the content holds together: suits, sources, sequences, decks', () => {
  for (const [id, c] of Object.entries(CARDS)) {
    assert.equal(c.id, id);
    assert.ok(c.suit === null || SUITS.includes(c.suit), id);
    assert.ok(['starter', 'milestone', 'shop', 'drop', 'crafted', 'ship', 'folk', 'curse'].includes(c.src), id);
    if (c.src === 'milestone') assert.ok([30, 60, 90].includes(c.lvl), `${id} needs a milestone level`);
    if (!c.dead) assert.equal(typeof c.fx, 'function', id);
  }
  for (const t of Object.values(TRICKS)) for (const id of t.seq) assert.ok(CARDS[id], `${t.id}: ${id}`);
  assert.equal(STARTER.length, DECK_MIN);
  assert.ok(DECK_MAX > DECK_MIN);
  for (const id of [...STARTER, ...FOLK_DECK]) assert.ok(CARDS[id], id);
  assert.ok(!STARTER.some((id) => CARDS[id].finisher), 'Edge waits for a finisher: none in the starter');
  for (const b of Object.values(BANDS)) assert.ok(['land', 'sea', 'any'].includes(b.where), b.id);
  assert.deepEqual(bandsOf('sea').sort(), ['corsairs', 'smugglers', 'wreckers']);
  assert.deepEqual(bandsOf('land').sort(), ['cultists', 'deserters', 'highwaymen', 'smugglers', 'wreckers']);
  for (const c of Object.values(CHARMS)) if (c.trophy) assert.ok(BANDS[c.trophy], c.id);
  assert.equal(TIER_F.length, 5);
  assert.equal(TARGET.length, 5);
});

test('a fight is seeded: the same seed plays the same fight, and replay() rebuilds it from its actions', () => {
  for (const band of Object.keys(BANDS)) {
    const where = BANDS[band].where === 'sea' ? 'sea' : 'land';
    const a = autoFight(base({ band, where, seed: 5 }));
    const b = autoFight(base({ band, where, seed: 5 }));
    assert.equal(sig(a), sig(b), band);
    // the same fight, recorded action by action, then replayed
    const opt = base({ band, where, seed: 9 });
    const live = newFight(opt);
    const acts = [];
    while (!live.over) { aiRound(live, (x, i) => acts.push([x, i])); acts.push(['e']); endRound(live); }
    assert.equal(sig(replay(opt, acts)), sig(live), band);
  }
});

test('a played dodge makes the attack miss (dodges add up)', () => {
  const deck = ['overwall', 'overwall', 'smokepot', 'smokepot', 'slip', 'slip', 'starread', 'starread', 'slash', 'slash', 'holdfast', 'feint', 'feint', 'pistol', 'purse'];
  let rounds = 0;
  let checked = 0;
  for (const band of Object.keys(BANDS)) for (let k = 0; k < 300; k++) {
    const where = BANDS[band].where === 'sea' ? 'sea' : 'land';
    const s = newFight(base({ band, where, tier: 1 + (k % 4), seed: k * 7 + 3, deck }));
    while (!s.over) {
      aiRound(s);
      const kinds = s.evade ? s.evadeKinds.slice() : [];
      const move = s.intents[0].kind;
      const from = s.log.length;
      endRound(s);
      rounds++;
      if (!kinds.includes(move)) continue;
      checked++;
      const landed = s.log.slice(from).find((l) => l.key === 'MOD_VOY_ENC_LOG_HURT' || l.key === 'MOD_VOY_ENC_LOG_HURT_GUARD' || l.key === 'MOD_VOY_ENC_LOG_GRAB');
      assert.equal(landed, undefined, `${band} seed ${k * 7 + 3}: ${move} landed after a dodge for ${kinds.join()}`);
    }
  }
  assert.ok(rounds > 5000 && checked > 200, `${rounds} rounds, ${checked} dodged`);
});

test('the starter deck at fixed strength wins about 65% at tier 1 against every band', () => {
  for (const band of Object.keys(BANDS)) {
    const where = BANDS[band].where === 'sea' ? 'sea' : 'land';
    let w = 0;
    const N = 600;
    for (let k = 0; k < N; k++) {
      const s = autoFight(base({ band, where, tier: 1, seed: k * 31 + 8, cannons: where === 'sea' ? 2 : 0, hull: where === 'sea', toll: 500 }));
      if (s.over === 'win' || s.over === 'fled') w++;
    }
    const pct = 100 * w / N;
    assert.ok(pct >= 58 && pct <= 74, `${band}: ${pct.toFixed(1)}%`);
  }
});

test('bands that run: a chase, then caught or away', () => {
  const o = odds(base({ band: 'smugglers', tier: 2 }), 400);
  assert.ok(o.chased > 0.2, `chased ${o.chased}`);
  assert.ok(o.fled > 0 && o.fled < 0.3, `got away ${o.fled}`);
  const never = odds(base({ band: 'deserters', tier: 2 }), 200);
  assert.equal(never.chased, 0, 'Deserters never run');
});

test('cards: plays, sea and land cards, Dread, skill tilt, the Defence cape, Coin costs', () => {
  const s = newFight(base({ deck: ['slash', 'hook', 'overwall', 'purse', 'read', 'slash', 'slash', 'slash', 'slash', 'slash', 'slash', 'slash', 'slash', 'slash', 'slash'], seed: 3 }));
  s.hand = [{ uid: 900, id: 'hook' }, { uid: 901, id: 'overwall' }, { uid: 902, id: 'dread' }, { uid: 903, id: 'purse' }, { uid: 904, id: 'read' }];
  assert.equal(canPlay(s, 0).why, 'MOD_VOY_ENC_WHY_SEA');
  assert.equal(canPlay(s, 1).ok, true);
  assert.equal(canPlay(s, 2).why, 'MOD_VOY_ENC_WHY_DREAD');
  assert.equal(toss(s, 2).ok, false, 'Dread can\'t be tossed');
  assert.equal(cardCost(s, 'purse'), 50, '2% of a 2,500 toll');
  s.plays = 0;
  assert.equal(canPlay(s, 3).why, 'MOD_VOY_ENC_WHY_PLAYS');
  assert.equal(canPlay(s, 4).ok, true, 'a quick card needs no play');
  const t = newFight(base({ tilt: { Attack: 1, Defence: -1 }, charms: ['cape'] }));
  assert.equal(cardN(t, { id: 'slash' }), 5);
  assert.equal(cardN(t, { id: 'holdfast' }), 6, 'tilted −1, the cape +1');
  const l = newFight(base({ charms: ['ledger'] }));
  assert.equal(cardCost(l, 'purse'), 0);
});

test('tricks fire on their run, across a round break for the across ones, and are found once', () => {
  assert.equal(trickOf([{ id: 'feint', round: 1 }, { id: 'slash', round: 1 }])?.id, 'feintcut');
  assert.equal(trickOf([{ id: 'feint', round: 1 }, { id: 'slash', round: 2 }]), null);
  assert.equal(trickOf([{ id: 'holdfast', round: 1 }, { id: 'slash', round: 2 }])?.id, 'patient');
  assert.equal(trickOf([{ id: 'feint', round: 2 }, { id: 'purse', round: 2 }, { id: 'pistol', round: 2 }])?.id, 'oldswitch');
  const s = newFight(base({ seed: 4 }));
  s.hand = [{ uid: 1, id: 'feint' }, { uid: 2, id: 'slash' }];
  s.drawPile = [];
  s.discard = [];
  play(s, 0);
  play(s, 0);
  assert.deepEqual(s.found, ['feintcut']);
  assert.equal(s.edge, 0, 'no Edge without a finisher in the deck');
});

test('Edge builds with combos when the deck holds a finisher', () => {
  const s = newFight(base({ deck: [...STARTER.slice(0, 14), 'drive'], seed: 2 }));
  assert.equal(s.hasFinisher, true);
  s.hand = [{ uid: 1, id: 'slash' }, { uid: 2, id: 'slash' }];
  play(s, 0);
  play(s, 0);
  assert.equal(s.edge, 1, 'Pair of Blades');
});

test('Press on: one round against their captain', () => {
  const s = autoFight(base({ seed: 1, tier: 1, strength: 0.3 }));
  assert.equal(s.over, 'win');
  pressOn(s);
  assert.equal(s.phase, 'press');
  assert.equal(s.band.key, 'MOD_VOY_BAND_HIGHWAYMEN_CAPTAIN');
  while (!s.over) { aiRound(s); endRound(s); }
  assert.ok(s.over === 'presswin' || s.over === 'presslose');
});

test('moves read as keys, with the numbers as vars', () => {
  const s = newFight(base());
  const m = moveText(s, { kind: 'grab', pct: 25, stop: 6 });
  assert.equal(m.head.key, 'MOD_VOY_ENC_MOVE_GRAB');
  assert.equal(m.head.vars.gp, 625);
  assert.equal(kindKey('strike'), 'MOD_VOY_ENC_KIND_STRIKE');
  for (const k of ATTACKS) assert.match(kindKey(k), /^MOD_VOY_ENC_KIND_/);
});

test('calibration: the generator steps band by band and ends where calibrate() does; the target holds', () => {
  const opt = base({ tier: 2 });
  const it = calibration(opt, 60, bandsOf('land'), 5);
  let steps = 0;
  let x;
  while (!(x = it.next()).done) steps++;
  assert.equal(steps, 5 * bandsOf('land').length);
  assert.equal(x.value, calibrate(opt, 60, bandsOf('land'), 5));
  const S = calibrate(base({ tier: 1 }), 200, bandsOf('land'));
  let w = 0;
  for (const band of bandsOf('land')) { const o = odds(base({ band, tier: 1, strength: S }), 200); w += o.win + o.fled; }
  const share = w / bandsOf('land').length;
  assert.ok(Math.abs(share - TARGET[1]) < 0.06, `tier 1 scaled win share ${share}`);
});

test('oddsRun plays one fight a step and ends with what odds() says', () => {
  const opt = base({ band: 'smugglers', tier: 2, seed: 5 });
  const it = oddsRun(opt, 40);
  let steps = 0;
  let x;
  while (!(x = it.next()).done) { steps++; assert.equal(x.value.n, steps); }
  assert.equal(steps, 40);
  assert.deepEqual(x.value, odds(opt, 40));
});

test('stopped early, oddsRun\'s tally gives the odds of the fights played so far', () => {
  const opt = base({ band: 'smugglers', tier: 2, seed: 5 });
  const it = oddsRun(opt, 40);
  let t;
  for (let k = 0; k < 15; k++) t = it.next().value;
  const o = oddsOfTally(t);
  assert.deepEqual(o, odds(opt, 15));
  assert.ok(Math.abs(o.win + o.fled + o.draw + o.lose - 1) < 1e-9);
});
