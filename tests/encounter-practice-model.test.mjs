import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/encounter-model.mjs';
import * as R from '../src/encounter-rules-model.mjs';
import { cleanPick, fightOpt, reckon, headKey, toneOf, resultLines, coachOf } from '../src/encounter-practice-model.mjs';

const kit = { deck: E.STARTER.slice(), cannons: 0, hull: false, charms: [], tilt: {} };
const opt = (over = {}) => fightOpt({ kit, pick: { where: 'land', tier: 1, band: 'highwaymen' }, strength: 1, roll: 1, seed: 7, gp: 1000000, toll: 50000, know: [], ...over });

test('a pick is made safe', () => {
  assert.deepEqual(cleanPick(undefined, E), { where: 'land', tier: 1, band: E.bandsOf('land')[0] });
  assert.equal(cleanPick({ where: 'sea', tier: 9 }, E).tier, 1);
  // a band that is not met on that ground falls back to the ground's first
  const seaOnly = Object.keys(E.BANDS).find((b) => E.BANDS[b].where === 'sea');
  if (seaOnly !== undefined) assert.equal(cleanPick({ where: 'land', band: seaOnly }, E).band, E.bandsOf('land')[0]);
  assert.equal(cleanPick({ where: 'land', tier: 3, band: 'highwaymen' }, E).tier, 3);
});

test('a practice fight is never Battered and writes no trick', () => {
  const o = opt({ know: ['x'] });
  assert.equal(o.battered, 0);
  assert.equal(o.learn, false);
  assert.deepEqual(o.know, ['x']);
  assert.equal(E.newFight(o).learn, false);
});

test('the reckoning is what the real settling would do', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const o = opt({ seed });
    const s = E.autoFight(o);
    const args = { toll: o.toll, purse: 2000, gp: o.gp };
    const st = R.settle(s, args);
    assert.equal(reckon(s, args, R).net, st.now + st.purse - st.short, `seed ${seed}, ${s.over}`);
  }
});

test('Press on doubles or halves the win it follows', () => {
  const atWin = { now: -100, purse: 2000 };
  const args = { toll: 500, purse: 2000, gp: 10000 };
  assert.equal(reckon({ over: 'presswin' }, args, R, atWin).net, 3900);
  const lost = reckon({ over: 'presslose' }, args, R, atWin);
  assert.equal(lost.net, 900);
  assert.equal(lost.battered, true);
});

test('what a loss would have owed counts in its cost', () => {
  const s = { over: 'lose', spent: 0, grabbed: 0, band: { nerve: 10, max: 10 }, def: {} };
  // nothing carried: the whole stake would be owed
  const r = reckon(s, { toll: 500, purse: 2000, gp: 0 }, R);
  assert.equal(r.net, -500);
  assert.equal(r.battered, true);
});

test('heads, tones and result lines', () => {
  assert.equal(headKey({ over: 'win' }), 'MOD_VOY_ENC_RES_WIN');
  assert.equal(headKey({ over: 'win', chaseFrom: 3 }), 'MOD_VOY_ENC_RES_WIN_CHASE');
  assert.equal(headKey({ over: 'fled', def: { keepGrabs: true } }), 'MOD_VOY_ENC_RES_FLED_GRABS');
  assert.equal(headKey({ over: 'lose' }), 'MOD_VOY_ENC_RES_LOSE');
  assert.equal(toneOf('presswin'), 'good');
  assert.equal(toneOf('lose'), 'bad');
  assert.equal(toneOf('draw'), 'mid');
  const lines = resultLines({ net: -300.4, toll: 500, battered: true });
  assert.equal(lines[0].gp, -300);
  assert.equal(lines[1].gp, -500);
  assert.ok(lines.some((l) => l.key === 'MOD_VOY_ENC_PRACTICE_BATTERED'));
  assert.ok(!resultLines({ net: 10, toll: 5, battered: false }).some((l) => l.key === 'MOD_VOY_ENC_PRACTICE_BATTERED'));
});

test('the tips follow the round', () => {
  const s = E.newFight(opt());
  assert.match(coachOf(s, E), /^MOD_VOY_ENC_PRACTICE_COACH_/);
  // every play used, nothing Quick left to play: end the round
  const done = { ...s, plays: 0, cardsThisRound: 3, hand: s.hand.filter((c) => !E.CARDS[c.id].quick) };
  assert.equal(coachOf(done, E), 'MOD_VOY_ENC_PRACTICE_COACH_END');
  assert.equal(coachOf({ ...s, phase: 'chase' }, E), 'MOD_VOY_ENC_PRACTICE_COACH_CHASE');
  assert.equal(coachOf({ ...s, phase: 'press' }, E), 'MOD_VOY_ENC_PRACTICE_COACH_PRESS');
  assert.equal(coachOf({ ...s, over: 'win' }, E), undefined);
});

test('a hidden move gets its own tip, and a suit in play points at the combo', () => {
  const hiddenBand = Object.keys(E.BANDS).find((b) => E.BANDS[b].hidden);
  const h = E.newFight(opt({ pick: { where: E.BANDS[hiddenBand].where === 'sea' ? 'sea' : 'land', tier: 1, band: hiddenBand } }));
  assert.equal(coachOf(h, E), 'MOD_VOY_ENC_PRACTICE_COACH_HIDDEN');
  const s = E.newFight(opt());
  const combo = { ...s, cardsThisRound: 1, plays: 2, suits: { steel: 1 }, hand: [{ uid: 900, id: 'slash' }] };
  assert.equal(coachOf(combo, E), 'MOD_VOY_ENC_PRACTICE_COACH_COMBO');
});
