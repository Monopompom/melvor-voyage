import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEA_TIER, GROUND_TIER, seaTier, landTier, ODDS, meets, BREATHER, tollOf, stakeOf, purseOf, settle, pressPurse,
  batteredAfterLoss, BATTERED_MAX, patchedLines, PATCH_FOOD, FOLK_TOLL_PCT, FOLK_WOUND, folkWound, folkTakeShare, hungryTail, RUN_LAND_DROP, tiltOf, gradeOf, pickBand, bandRoll, HIDEOUT_HEX, cleanEnc, cleanFight, cleanDeck, calKey,
  DEBT_PCT, AWAY_CAP, AWAY_MAX, awayAdd, foldAway, foldFolks, foldMine, debtKey, debtOf, creditors, meetOn, shareDebt, owe, payDebts,
} from '../src/encounter-rules-model.mjs';
import * as E from '../src/encounter-model.mjs';
const { STARTER, replay } = E;
const fightOf = (raw) => cleanFight(raw, E);
import { CLASS_INFO } from '../src/terrain.mjs';
import { seas } from '../src/charts-model.mjs';

test('every chart sea has a tier 1 to 4, and every land ground a tier 0 to 3', () => {
  const hexes = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8')).hexes;
  assert.deepEqual(Object.keys(seas(hexes, ['FakePort'])).sort(), Object.keys(SEA_TIER).sort());
  for (const t of Object.values(SEA_TIER)) assert.ok(t >= 1 && t <= 4);
  assert.ok(hexes.some((h) => h.poi === 'BanditHideout' && h.q === HIDEOUT_HEX.q && h.r === HIDEOUT_HEX.r), 'Bandit Hideout\'s hex');
  for (const cls of Object.keys(CLASS_INFO)) if (cls !== 'water' && cls !== 'shoal') assert.ok(cls in GROUND_TIER, cls);
  assert.equal(seaTier('BeginningPort'), 1);
  assert.equal(seaTier('BeginningPort', true), 4, 'the cloud\'s edge');
  assert.equal(seaTier(undefined), 0);
  assert.equal(landTier('grasslands'), 0);
  assert.equal(landTier('grasslands', 2), 1, 'near Bandit Hideout');
  assert.equal(landTier('cursedlands', 0), 4);
  assert.equal(landTier('water'), 0);
});

test('the odds a hex: never at tier 0, doubled by a debt', () => {
  assert.equal(meets(0, 0), false);
  assert.equal(meets(1, ODDS[1] * 0.99), true);
  assert.equal(meets(1, ODDS[1]), false);
  assert.equal(meets(1, ODDS[1] * 1.5, true), true);
  assert.equal(meets(4, NaN), false);
  assert.ok(ODDS[4] > ODDS[1]);
  assert.equal(BREATHER, 20);
  assert.equal(pickBand(['a', 'b', 'c'], 0.999), 'c');
  assert.equal(bandRoll(0), 0.8);
});

test('the toll: the tier\'s share of what you carry, never under three hexes of fare; at sea a quarter of the hold', () => {
  assert.deepEqual(tollOf({ where: 'land', tier: 1, gp: 1e6, hexGp: 100 }), { toll: 50000, rule: 'gp' });
  assert.deepEqual(tollOf({ where: 'land', tier: 4, gp: 1000, hexGp: 100 }), { toll: 300, rule: 'fare' });
  assert.deepEqual(tollOf({ where: 'sea', tier: 2, gp: 1e6, hexGp: 100, holdWorth: 1e6 }), { toll: 250000, rule: 'hold' });
  assert.deepEqual(tollOf({ where: 'sea', tier: 2, gp: 1e7, hexGp: 100, holdWorth: 1e6 }), { toll: 700000, rule: 'gp' });
  assert.equal(tollOf({ where: 'land', tier: 1, gp: 2e9, hexGp: 0 }).toll, 1e8, 'no cap');
  assert.equal(tollOf({ where: 'land', tier: 1, gp: 0, hexGp: 0 }).toll, 1);
  assert.equal(purseOf('land', 3), 12000);
  assert.equal(purseOf('sea', 4), 45000);
});

test('settling: a win banks the purse, a flight half of it, a draw and a loss are graded by their Nerve left', () => {
  const band = (nerve, max = 100) => ({ nerve, max });
  const m = { toll: 1000, purse: 2000, gp: 100000 };
  const win = settle({ over: 'win', spent: 20, grabbed: 300, bonusPct: 10, band: band(0) }, m);
  assert.equal(win.now, -320);
  assert.equal(win.purse, 2200 + 300, 'with what they grabbed');
  const away = settle({ over: 'fled', spent: 0, grabbed: 300, band: band(10), def: {} }, m);
  assert.equal(away.now, -300 + 1000 + 300);
  const keep = settle({ over: 'fled', spent: 0, grabbed: 300, band: band(10), def: { keepGrabs: true } }, m);
  assert.equal(keep.now, -300 + 1000);
  const draw = settle({ over: 'draw', spent: 0, grabbed: 0, band: band(40) }, m);
  assert.equal(draw.take, 400);
  assert.equal(draw.battered, false);
  const lose = settle({ over: 'lose', spent: 0, grabbed: 0, band: band(25) }, m);
  assert.equal(lose.stake, stakeOf(1000, 100000));
  assert.equal(lose.take, Math.round(11000 * 0.25));
  assert.equal(lose.battered, true);
  const broke = settle({ over: 'lose', spent: 0, grabbed: 0, band: band(100) }, { toll: 1000, purse: 2000, gp: 500 });
  assert.equal(broke.take, 500, 'never more than you carry');
  assert.equal(broke.short, 1000 + 50 - 500, 'the rest is short (it becomes a debt)');
  assert.equal(lose.short, 0);
  const thin = settle({ over: 'draw', spent: 0, grabbed: 0, band: band(50) }, { toll: 1000, purse: 2000, gp: 200 });
  assert.deepEqual([thin.take, thin.short], [200, 300]);
  assert.equal(pressPurse(2000, true), 4000);
  assert.equal(pressPurse(2000, false), 1000);
});

test('Battered stacks to three losses', () => {
  assert.equal(batteredAfterLoss(0), 1);
  assert.equal(batteredAfterLoss(BATTERED_MAX), BATTERED_MAX);
});

test('patching up on the result turns its Battered line into the cure and keeps the rest', () => {
  const toll = { key: 'MOD_VOY_ENC_RES_LOSE_TAKE', vars: { pct: 55 }, gp: -100 };
  const out = patchedLines([toll, { key: 'MOD_VOY_ENC_RES_BATTERED', vars: { n: 2 } }]);
  assert.deepEqual(out, [toll, { key: 'MOD_VOY_ENC_RES_PATCHED', vars: { food: PATCH_FOOD } }]);
  assert.deepEqual(patchedLines(undefined), []);
});

test('your levels: a skill well above or below your average tilts its cards; the grade from your five best', () => {
  assert.deepEqual(tiltOf({ Attack: 60, Defence: 40, Thieving: 50 }), { Attack: 1, Defence: -1 });
  assert.deepEqual(tiltOf({}), {});
  assert.equal(gradeOf([1, 1, 1]), 1);
  assert.equal(gradeOf([99, 99, 10, 10, 10, 10]), 2, 'mean of the five best: 45.6');
  assert.equal(gradeOf([99, 99, 99, 99, 99, 1]), 4);
  assert.equal(gradeOf([120, 120, 110, 105, 100]), 5);
});

test('the save record: a new one gets the starter deck; junk is dropped', () => {
  const e = cleanEnc(undefined, E);
  assert.deepEqual(e.deck, STARTER);
  assert.equal(e.battered, 0);
  assert.equal(e.fight, null);
  assert.deepEqual(cleanDeck(['slash'], E), STARTER, 'too few cards');
  assert.deepEqual(cleanDeck([...STARTER.slice(0, 14), 'broadside'], E), STARTER, 'a ship card is not carried');
  const deck = [...STARTER, 'bribe', 'keg'];
  assert.deepEqual(cleanEnc({ deck }, E).deck, deck);
  const j = cleanEnc({ battered: 9, calm: -1, rest: 1e12, tricks: ['nope', 'x'], trophies: { spyglass: true, nobody: true }, owned: { bribe: 2, dread: 1 }, cal: { key: 'k', values: { 'land:2': 0.9, 'air:1': 2 } } }, E);
  assert.equal(j.battered, 0);
  assert.equal(j.calm, 0);
  assert.ok(j.rest <= 8 * 3600 * 1000);
  assert.deepEqual(j.tricks, []);
  assert.deepEqual(j.trophies, { spyglass: true });
  assert.deepEqual(j.owned, { bribe: 2 });
  assert.deepEqual(j.cal, { key: 'k', values: { 'land:2': 0.9 } });
});

test('an open fight survives the save: replayed from its options and actions, it is the same fight', () => {
  const opt = { band: 'highwaymen', tier: 2, where: 'land', seed: 12345, strength: 1.1, deck: STARTER.slice(), cannons: 0, hull: false, charms: [], tilt: { Attack: 1 }, gp: 50000, toll: 2500, battered: 1, know: [], learn: true };
  const actions = [['p', 0], ['p', 0], ['e'], ['t', 1], ['p', 0]];
  const f = fightOf(JSON.parse(JSON.stringify({ opt, actions, stage: 'fight', roll: 1.1, rule: 'gp', purse: 5000, ground: 'highlands' })));
  assert.deepEqual(f.opt, opt);
  assert.deepEqual(f.actions, actions);
  const a = replay(opt, actions);
  const b = replay(f.opt, f.actions);
  assert.deepEqual([a.band.nerve, a.you.resolve, a.round, a.hand.map((c) => c.id)], [b.band.nerve, b.you.resolve, b.round, b.hand.map((c) => c.id)]);
  assert.equal(fightOf({ opt: { ...opt, band: 'nobody' } }), null);
  assert.equal(fightOf({ opt: { ...opt, tier: 0 } }), null);
  assert.deepEqual(fightOf({ opt, actions: [['p', 0], ['x'], ['e']] }).actions, [['p', 0]], 'stops at the first bad action');
  const res = fightOf({ opt, stage: 'result', res: { head: { key: 'MOD_VOY_ENC_LOG_WIN', vars: {} }, tone: 'good', lines: [{ key: 'bad key' }, { key: 'MOD_VOY_ENC_LOG_GRAB', vars: { gp: 20 }, gp: -20 }], purse: 3000, loot: [{ id: 'melvorD:Bones', qty: 2, kind: 'haul' }, { trophy: 'spyglass', kind: 'rare' }, { id: 'x', qty: 1, kind: 'haul' }], press: true } }).res;
  assert.equal(res.lines.length, 1);
  assert.deepEqual(res.loot, [{ id: 'melvorD:Bones', qty: 2, kind: 'haul' }, { trophy: 'spyglass', qty: 1, kind: 'rare' }]);
  assert.equal(res.purse, 3000);
  const end = (e) => fightOf({ opt, stage: 'result', res: { head: { key: 'MOD_VOY_ENC_LOG_WIN', vars: {} }, end: e } }).res.end;
  assert.deepEqual(end({ you: [12, 28], band: [0, 65], captain: true }), { you: [12, 28], band: [0, 65], captain: true }, 'the bars as the fight ended');
  for (const bad of [{ you: [30, 28], band: [0, 65] }, { you: [1, 28] }, { you: [-1, 28], band: [0, 65] }, { you: [1.5, 28], band: [0, 65] }, 'x']) assert.equal(end(bad), undefined);
});

test('a fight keeps the supplies already taken from the bank, so Press on takes only its own', () => {
  const opt = { band: 'highwaymen', tier: 2, where: 'land', seed: 12345, strength: 1.1, deck: STARTER.slice(), cannons: 0, hull: false, charms: [], tilt: {}, gp: 0, toll: 1, battered: 0, know: [], learn: true };
  assert.deepEqual(fightOf({ opt, usedDone: { hotmeal: 2, bitter3: 1, slash: 4, grapeshot: 0.5, nope: 1 } }).usedDone, { hotmeal: 2, bitter3: 1 });
  assert.equal(fightOf({ opt, usedDone: { slash: 1 } }).usedDone, undefined);
  assert.equal(fightOf({ opt }).usedDone, undefined);
});

test('the calibration key follows the kit, not its order', () => {
  assert.equal(calKey({ deck: ['a', 'b'], charms: [], tilt: { X: 1 } }), calKey({ deck: ['b', 'a'], charms: [], tilt: { X: 1 } }));
  assert.notEqual(calKey({ deck: ['a'], tilt: {} }), calKey({ deck: ['a'], tilt: { X: -1 } }));
});

test('a debt: its band claims ten points more, and its ground meets bands twice as often', () => {
  const plainToll = tollOf({ where: 'land', tier: 1, gp: 100000, hexGp: 10 }).toll;
  const owedToll = tollOf({ where: 'land', tier: 1, gp: 100000, hexGp: 10, debt: true }).toll;
  assert.equal(plainToll, 5000);
  assert.equal(owedToll, (5 + DEBT_PCT) * 1000);
  const p = ODDS[2];
  assert.deepEqual(meetOn(2, p * 0.5), { band: undefined }, 'any band of the ground');
  assert.equal(meetOn(2, p * 1.5), undefined, 'owing nobody, the odds stay');
  assert.deepEqual(meetOn(2, p * 1.5, ['cultists']), { band: 'cultists' }, 'the extra half meets the band you owe');
  assert.deepEqual(meetOn(2, p * 1.9, ['highwaymen', 'deserters']), { band: 'deserters' });
  assert.equal(meetOn(2, p * 2, ['cultists']), undefined);
  assert.equal(meetOn(0, 0, ['cultists']), undefined, 'tier 0 never meets');
  // Over many rolls a ground you owe on meets twice as often as one you don't.
  let base = 0; let owed = 0;
  for (let i = 0; i < 100000; i++) { const r = i / 100000; if (meetOn(4, r)) base += 1; if (meetOn(4, r, ['corsairs'])) owed += 1; }
  assert.equal(owed, 2 * base);
  const debts = { [debtKey('highwaymen', 'highlands')]: 900 };
  assert.equal(debtOf(debts, 'highwaymen', 'highlands'), 900);
  assert.equal(debtOf(debts, 'highwaymen', 'desert'), 0, 'owed on its own ground only');
  assert.deepEqual(creditors(debts, ['highwaymen', 'deserters'], 'highlands'), ['highwaymen']);
});

test('debts add up, share out by toll, and are paid off biggest first, whole or in part', () => {
  let d = owe({}, { 'a:x': 100 });
  d = owe(d, { 'a:x': 50, 'b:y': 400 });
  assert.deepEqual(d, { 'a:x': 150, 'b:y': 400 });
  const share = shareDebt([{ band: 'a', ground: 'x', toll: 300 }, { band: 'b', ground: 'y', toll: 100 }, { band: 'a', ground: 'x', toll: 100 }], 1001);
  assert.equal(Object.values(share).reduce((x, y) => x + y, 0), 1001, 'every GP owed to someone');
  assert.deepEqual(share, { 'a:x': 801, 'b:y': 200 });
  assert.deepEqual(shareDebt([], 50), {});
  assert.deepEqual(shareDebt([{ band: 'a', ground: 'x', toll: 1 }], 0), {});
  const part = payDebts({ 'a:x': 150, 'b:y': 400 }, 450);
  assert.deepEqual(part, { debts: { 'a:x': 100 }, paid: 450 });
  const all = payDebts({ 'a:x': 150, 'b:y': 400 }, 10000);
  assert.deepEqual(all, { debts: {}, paid: 550 });
  assert.deepEqual(payDebts({ 'a:x': 150 }, 0), { debts: { 'a:x': 150 }, paid: 0 });
});

test('offline: the bands met fold into one encounter, led by the strongest, capped at three encounters', () => {
  assert.equal(foldAway([]), undefined);
  const m = (band, tier, toll, purse) => ({ band, tier, where: 'land', ground: 'highlands', toll, purse });
  const list = [m('highwaymen', 1, 500, 2000), m('cultists', 3, 900, 12000), m('deserters', 3, 1200, 12000), m('smugglers', 2, 700, 5000), m('highwaymen', 1, 400, 2000)];
  const f = foldAway(list);
  assert.equal(f.lead.band, 'deserters', 'the highest tier, then the dearest toll');
  assert.equal(f.n, 5);
  assert.equal(f.toll, 1200 + 900 + 700, `the ${AWAY_CAP} biggest tolls`);
  assert.equal(f.purse, 12000 + 12000 + 5000);
  let kept = [];
  for (let i = 0; i < AWAY_MAX + 5; i++) kept = awayAdd(kept, m('highwaymen', 1 + (i % 4), 100 + i, 2000));
  assert.equal(kept.length, AWAY_MAX, 'the save keeps a few');
  const ones = kept.filter((x) => x.tier === 1);
  assert.equal(ones.length, 9 - 5, 'the five weakest dropped: tier 1, the cheapest tolls');
  assert.ok(ones.every((x) => x.toll >= 100 + 20), 'the dearest tier 1 bands stay');
});

test('the save keeps the bands met away and the debts; junk is dropped', () => {
  const e = cleanEnc({ away: [{ band: 'corsairs', tier: 4, where: 'sea', ground: 'MistyPort', toll: 9000, purse: 45000 }, { band: 'nobody', tier: 1, where: 'land', ground: 'x', toll: 1, purse: 1 }, { band: 'highwaymen', tier: 7, where: 'land', ground: 'x' }],
    debts: { 'highwaymen:highlands': 1200.4, 'nobody:x': 5, 'cultists:': 9, 'cultists:a:b': 9, 'smugglers:desert': -3 } }, E);
  assert.deepEqual(e.away, [{ band: 'corsairs', tier: 4, where: 'sea', ground: 'MistyPort', toll: 9000, purse: 45000 }]);
  assert.deepEqual(e.debts, { 'highwaymen:highlands': 1200 });
  assert.deepEqual(cleanEnc(undefined, E).away, []);
  assert.deepEqual(cleanEnc(undefined, E).debts, {});
  const opt = { band: 'highwaymen', tier: 2, where: 'land', seed: 7, strength: 1, deck: STARTER.slice(), gp: 1000, toll: 100 };
  const f = fightOf({ opt, debt: 300, away: { n: 4, parts: [{ band: 'highwaymen', tier: 2, where: 'land', ground: 'highlands', toll: 100, purse: 5000 }] }, res: { owed: 250.6 } });
  assert.equal(f.debt, 300);
  assert.equal(f.away.n, 4);
  assert.equal(f.away.parts.length, 1);
  assert.equal(f.res.owed, 251);
  assert.equal(fightOf({ opt, away: { n: 2, parts: [] } }).away, undefined, 'no parts, no fold');
});

test('a walking Folk: Pay takes the tier\'s share of its pack, a loss or a draw that times their Nerve left, Run the run\'s drop', () => {
  assert.equal(folkTakeShare('pay', 1), FOLK_TOLL_PCT[1] / 100);
  assert.equal(folkTakeShare('pay', 4), 0.7);
  assert.equal(folkTakeShare('lose', 2, 0.5), FOLK_TOLL_PCT[2] / 200);
  assert.equal(folkTakeShare('draw', 3, 2), FOLK_TOLL_PCT[3] / 100, 'their Nerve left counts at most whole');
  assert.equal(folkTakeShare('lose', 3, -1), 0);
  assert.equal(folkTakeShare('run', 4), RUN_LAND_DROP);
  for (const how of ['win', 'fled', 'presswin']) assert.equal(folkTakeShare(how, 4, 1), 0, how);
  for (let tier = 1; tier < FOLK_TOLL_PCT.length; tier++) assert.ok(FOLK_TOLL_PCT[tier] > FOLK_TOLL_PCT[tier - 1], `tier ${tier} asks more`);
});

test('a walking Folk: a lost fight wounds it for a share of its max HP, never nothing', () => {
  assert.equal(folkWound(100), Math.ceil(100 * FOLK_WOUND));
  assert.equal(folkWound(99), 30);
  assert.equal(folkWound(0), 1);
  assert.equal(folkWound(undefined), 1);
});

test('a walking Folk: the food a band takes leaves the road\'s last hexes hungry, as many as it no longer feeds', () => {
  assert.equal(hungryTail([10, 10, 10, 10], 0), 0);
  assert.equal(hungryTail([10, 10, 10, 10], 10), 1);
  assert.equal(hungryTail([10, 10, 10, 10], 11), 2, 'a hex fed in part goes hungry');
  assert.equal(hungryTail([10, 10, 10, 10], 40), 4);
  assert.equal(hungryTail([10, 10, 10, 10], 400), 4, 'never more than the road ahead');
  assert.equal(hungryTail([5, 20], 15), 1, 'counted from the road\'s end');
  assert.equal(hungryTail([], 15), 0);
});

test('a walking Folk\'s fight keeps its flag and the Folk through a save, and only with the flag', () => {
  const base = { opt: { band: 'highwaymen', tier: 2, where: 'land', seed: 7, strength: 1, deck: E.FOLK_DECK.slice(), folk: true }, stage: 'meet', folk: { id: 'worker_folks:F1', name: 'Ada', pack: 412.4 } };
  const f = fightOf(base);
  assert.equal(f.opt.folk, true);
  assert.deepEqual(f.folk, { id: 'worker_folks:F1', name: 'Ada', pack: 412 });
  const s = E.newFight(f.opt);
  assert.equal(s.you.max, E.FOLK_RESOLVE, 'a reload replays it at the Folk\'s Resolve');
  const mine = fightOf({ ...base, opt: { ...base.opt, folk: undefined } });
  assert.equal(mine.opt.folk, undefined);
  assert.equal(mine.folk, undefined, 'a Folk without the flag is dropped');
  assert.equal(fightOf({ ...base, folk: { id: '', name: 'x' } }).folk, undefined);
  assert.equal(fightOf({ ...base, folk: { id: 'a', name: 'n'.repeat(99), pack: -5 } }).folk.name.length, 60);
  assert.equal(fightOf({ ...base, folk: { id: 'a', name: 'n', pack: -5 } }).folk.pack, 0);
});

test('the card last lent a Folk is kept, one of your own kinds only', () => {
  assert.equal(cleanEnc({ lent: 'drive' }, E).lent, 'drive');
  assert.equal(cleanEnc({}, E).lent, undefined);
  for (const id of ['slip', 'broadside', 'dread', 'nonsense', 7]) assert.equal(cleanEnc({ lent: id }, E).lent, undefined, String(id));
  const crafted = Object.keys(E.CARDS).find((id) => E.CARDS[id].src === 'crafted');
  if (crafted !== undefined) assert.equal(cleanEnc({ lent: crafted }, E).lent, undefined, 'a crafted card is used up: never lent');
});

test('offline: a band that met a walking Folk claims no GP; the fold names each Folk once, at the highest tier', () => {
  const cora = { id: 'worker_folks:C', name: 'Cora' };
  const bram = { id: 'worker_folks:B', name: 'Bram' };
  const raw = [
    { band: 'highwaymen', tier: 2, where: 'land', ground: 'desert', toll: 500, purse: 2000, folk: cora },
    { band: 'deserters', tier: 3, where: 'land', ground: 'badlands', toll: 9, purse: 3000, folk: cora },
    { band: 'cultists', tier: 1, where: 'land', ground: 'swamplands', toll: 0, purse: 1000, folk: bram },
  ];
  const away = cleanEnc({ away: raw }, E).away;
  assert.ok(away.every((x) => x.toll === 0), 'a Folk\'s part claims nothing of your GP');
  assert.deepEqual(away.find((x) => x.band === 'cultists').folk, bram);
  assert.deepEqual(foldFolks(away), [{ ...cora, tier: 3 }, { ...bram, tier: 1 }]);
  assert.equal(foldMine(away), false);
  const fold = foldAway(away);
  assert.equal(fold.toll, 1, 'the least a toll can be');
  assert.equal(fold.purse, 6000, 'their purses are yours to win');
  const withYou = [...away, { band: 'highwaymen', tier: 1, where: 'land', ground: 'highlands', toll: 400, purse: 1000 }];
  assert.equal(foldMine(withYou), true);
  assert.equal(foldAway(withYou).toll, 400);
  assert.equal(foldFolks([{ band: 'x', tier: 1 }]).length, 0);
  assert.equal(cleanEnc({ away: [{ ...raw[0], folk: { id: '' } }] }, E).away[0].folk, undefined, 'junk Folk: an ordinary part');
  assert.equal(cleanEnc({ away: [{ ...raw[0], folk: { id: '' } }] }, E).away[0].toll, 500);
  const f = fightOf({ opt: { band: 'deserters', tier: 3, where: 'land', seed: 3, strength: 1 }, stage: 'meet', away: { n: 3, parts: raw } });
  assert.deepEqual(foldFolks(f.away.parts).map((x) => x.name), ['Cora', 'Bram'], 'kept through a reload');
});
