import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOT, TOKENS, LOOT_DRAWS, rungOf, stashOf, lootAt, rollLoot, halveHaul, rollCard, BANK_SLOT_TOKEN, SIGNET_HALVES } from '../src/encounter-loot-model.mjs';
import { BANDS, CHARMS, rng } from '../src/encounter-model.mjs';

const ID = /^melvor(D|F|TotH|AoD):[A-Za-z_]+$/;

test('every band has loot: five rungs a line, five chests, a token skill and its own trophy', () => {
  assert.deepEqual(Object.keys(LOOT).sort(), Object.keys(BANDS).sort());
  for (const [band, L] of Object.entries(LOOT)) {
    assert.match(TOKENS[L.skill], ID, band);
    assert.equal(CHARMS[L.trophy].trophy, band);
    assert.equal(L.stash.length, 5);
    for (const id of L.stash) assert.match(id, ID);
    for (const line of L.haul) {
      assert.equal(line.rungs.length, 5);
      for (const [id] of line.rungs) assert.match(id, ID);
    }
  }
  for (const id of [BANK_SLOT_TOKEN, ...SIGNET_HALVES]) assert.match(id, ID);
});

test('an item the game lacks falls back to the rung below', () => {
  const line = LOOT.highwaymen.haul[0];
  assert.deepEqual(rungOf(line, 5), ['melvorTotH:Corundum_Arrows', 1]);
  const noTotH = (id) => !id.startsWith('melvorTotH:');
  assert.deepEqual(rungOf(line, 5, noTotH), ['melvorD:Dragon_Arrows', 1]);
  assert.equal(stashOf('highwaymen', 3, (id) => !id.startsWith('melvorAoD:')), 'melvorD:Bandit_Chest');
  assert.equal(rungOf(line, 5, () => false), undefined);
  const at = lootAt('cultists', 4, 5, noTotH);
  assert.ok(!at.haul.some((id) => id.startsWith('melvorTotH:')));
  assert.equal(at.stash, 'melvorAoD:Treacherous_Chest');
});

test('a win rolls haul lines by tier; Press on doubles it with a chest for sure', () => {
  for (const tier of [1, 2, 3, 4]) {
    const r = rng(tier);
    const loot = rollLoot('deserters', tier, 3, r);
    assert.equal(loot.filter((x) => x.kind === 'haul').length, LOOT_DRAWS[tier], `tier ${tier}`);
  }
  const press = rollLoot('deserters', 2, 3, rng(7), { press: true });
  assert.ok(press.some((x) => x.kind === 'stash'));
  assert.deepEqual(halveHaul([{ id: 'a', qty: 5, kind: 'haul' }, { id: 'b', qty: 1, kind: 'haul' }, { id: 'c', qty: 1, kind: 'stash' }]),
    [{ id: 'a', qty: 2, kind: 'haul' }, { id: 'c', qty: 1, kind: 'stash' }]);
});

test('the rare find: trophies and Signet halves only at tiers 3 and 4, a second trophy a Bank Slot Token', () => {
  let trophies = 0;
  let low = 0;
  for (let k = 0; k < 20000; k++) {
    for (const x of rollLoot('corsairs', 4, 4, rng(k), { press: true })) if (x.trophy) trophies++;
    for (const x of rollLoot('corsairs', 2, 4, rng(k), { press: true })) if (x.trophy || SIGNET_HALVES.includes(x.id)) low++;
  }
  assert.ok(trophies > 0);
  assert.equal(low, 0);
  for (let k = 0; k < 20000; k++) {
    for (const x of rollLoot('corsairs', 4, 4, rng(k), { press: true }, ['spyglass'])) assert.equal(x.trophy, undefined);
  }
});

test('a rare find asked for comes for sure, of that kind, a trophy you have still a Bank Slot Token', () => {
  for (let k = 0; k < 50; k++) {
    assert.deepEqual(rollLoot('wreckers', 1, 2, rng(k), { rare: 'trophy' }).filter((x) => x.kind === 'rare'), [{ trophy: 'lantern', qty: 1, kind: 'rare' }]);
    assert.deepEqual(rollLoot('wreckers', 1, 2, rng(k), { rare: 'trophy' }, ['lantern']).filter((x) => x.kind === 'rare'), [{ id: BANK_SLOT_TOKEN, qty: 1, kind: 'rare' }]);
  }
});

test('a rare card drops about one win in ten', () => {
  let n = 0;
  const r = rng(3);
  for (let k = 0; k < 10000; k++) if (rollCard(r) !== undefined) n++;
  assert.ok(n > 850 && n < 1150, `${n}`);
});
