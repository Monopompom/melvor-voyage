// Outposts (src/outpost-model.mjs): where a tent may go, how many, the store's sums and the save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENT, OUTPOST_LEVELS, MAX_OUTPOSTS, OUTPOST_MILESTONES, maxOutposts, nextOutpostLevel, keyOf, parseKey, isPlace, pitchAction, campRecord,
  newOutpost, share, strike, cleanOutposts, BUILD_MS, isBuilding, buildLeft, standing, pickBuilder, buildStep,
} from '../src/outpost-model.mjs';
import { allowedAt, rateAt } from '../src/rules.mjs';

const land = { q: 5, r: 7, t: 'grasslands', f: [] };
const ok = { tents: 1, outposts: {}, level: 30, rec: land, folkHere: true };

test('one tent at Voyage 30, a second at 50, a third at 70, a fourth at 90', () => {
  assert.deepEqual(OUTPOST_LEVELS, [30, 50, 70, 90]);
  assert.equal(MAX_OUTPOSTS, 4);
  assert.deepEqual([1, 29, 30, 49, 50, 70, 89, 90, 99].map(maxOutposts), [0, 0, 1, 1, 2, 3, 3, 4, 4]);
  assert.equal(nextOutpostLevel(1), 30);
  assert.equal(nextOutpostLevel(55), 70);
  assert.equal(nextOutpostLevel(90), null);
  assert.equal(TENT.level, OUTPOST_LEVELS[0]);
});

test('keys round-trip and junk is no key', () => {
  assert.equal(keyOf(3, -4), '3,-4');
  assert.deepEqual(parseKey('3,-4'), { q: 3, r: -4 });
  assert.equal(parseKey('3;4'), undefined);
  assert.equal(parseKey('a,b'), undefined);
});

test('a tent goes on land where a Folk of yours stands, under the level\'s count', () => {
  assert.equal(pitchAction(ok), 'pitch');
  assert.equal(pitchAction({ ...ok, tents: 0 }), 'no-tent');
  assert.equal(pitchAction({ ...ok, rec: undefined }), 'unknown');
  assert.equal(pitchAction({ ...ok, rec: { ...land, cloud: true } }), 'unknown');
  assert.equal(pitchAction({ ...ok, rec: { ...land, t: 'water' } }), 'sea');
  assert.equal(pitchAction({ ...ok, rec: { ...land, t: 'shoal' } }), 'sea');
  assert.equal(pitchAction({ ...ok, folkHere: false }), 'no-folk');
  assert.equal(pitchAction({ ...ok, level: 29 }), 'full');
  assert.equal(pitchAction({ ...ok, outposts: { '1,1': newOutpost(0) } }), 'full');
  assert.equal(pitchAction({ ...ok, level: 50, outposts: { '1,1': newOutpost(0) } }), 'pitch');
});

test('never on a town, port, market or camp, nor twice on one hex', () => {
  for (const f of ['city', 'capital', 'port', 'market', 'camp']) {
    assert.equal(isPlace({ ...land, f: [f] }), true, f);
    assert.equal(pitchAction({ ...ok, rec: { ...land, f: [f] } }), 'place', f);
  }
  // A farm or a lone building is not a place of that kind: a tent may stand by it.
  assert.equal(pitchAction({ ...ok, rec: { ...land, f: ['farm'] } }), 'pitch');
  assert.equal(pitchAction({ ...ok, outposts: { [keyOf(5, 7)]: newOutpost(0) } }), 'pitched');
});

test('the hex counts as a camp: Smithing, Crafting and Fletching work, Thieving at 0.8', () => {
  const opts = { strictness: 'strict' };
  const wild = { q: 5, r: 7, t: 'grasslands' };
  const camp = campRecord(wild);
  assert.deepEqual(camp.f, ['camp']);
  assert.equal(camp.outpost, true);
  assert.equal(wild.f, undefined, 'the table\'s record is never changed');
  for (const skill of ['melvorD:Smithing', 'melvorD:Crafting', 'melvorD:Fletching']) {
    assert.equal(allowedAt(skill, wild, opts), false, skill);
    assert.equal(allowedAt(skill, camp, opts), true, skill);
  }
  assert.equal(rateAt('melvorD:Thieving', camp, opts), 0.8);
  // Features already there stay, and a camp is never added twice.
  assert.deepEqual(campRecord({ ...wild, f: ['farm'] }).f, ['farm', 'camp']);
  const twice = campRecord(camp);
  assert.equal(twice, camp);
});

test('sharing: carry what you want up to the limit, the rest stays in the tent', () => {
  const cap = { food: 1000, fuel: 40 };
  assert.deepEqual(share({ food: 800, fuel: 30 }, { food: 0, fuel: 0 }, { food: 300, fuel: 10.5 }, cap),
    { have: { food: 300, fuel: 10.5 }, store: { food: 500, fuel: 19.5 } });
  // Taking: no more than the limit, the rest stays.
  assert.deepEqual(share({ food: 300, fuel: 10 }, { food: 2000, fuel: 100 }, { food: 5000, fuel: 5000 }, cap),
    { have: { food: 1000, fuel: 40 }, store: { food: 1300, fuel: 70 } });
  // Never more than the two hold together, never below nothing.
  assert.deepEqual(share({ food: 100, fuel: 1 }, { food: 50, fuel: 1 }, { food: 900, fuel: -3 }, cap),
    { have: { food: 150, fuel: 0 }, store: { food: 0, fuel: 2 } });
  // Stores above the limit (from before it existed) are not cut by opening the tent.
  assert.deepEqual(share({ food: 1500, fuel: 40 }, { food: 10, fuel: 0 }, { food: 1500, fuel: 40 }, cap),
    { have: { food: 1500, fuel: 40 }, store: { food: 10, fuel: 0 } });
  // Fuel stays in thousandths.
  assert.deepEqual(share({ food: 0, fuel: 0.1 }, { food: 0, fuel: 0.2 }, { food: 0, fuel: 0.3 }, cap).have.fuel, 0.3);
});

test('striking camp: the store comes back up to the limit, the rest is lost', () => {
  const cap = { food: 1000, fuel: 40 };
  assert.deepEqual(strike({ food: 200, fuel: 10 }, { food: 300, fuel: 5 }, cap),
    { have: { food: 500, fuel: 15 }, lost: { food: 0, fuel: 0 } });
  assert.deepEqual(strike({ food: 900, fuel: 38 }, { food: 300, fuel: 5 }, cap),
    { have: { food: 1000, fuel: 40 }, lost: { food: 200, fuel: 3 } });
  // Already over the limit: nothing comes back, nothing of yours is cut.
  assert.deepEqual(strike({ food: 1200, fuel: 40 }, { food: 50, fuel: 0 }, cap),
    { have: { food: 1200, fuel: 40 }, lost: { food: 50, fuel: 0 } });
});

test('the save keeps up to four outposts and drops junk', () => {
  assert.deepEqual(cleanOutposts(null), {});
  assert.deepEqual(cleanOutposts([]), {});
  assert.deepEqual(cleanOutposts({ '3,4': { food: 12.7, fuel: 1.23456, at: 99 }, 'x': {}, '5,6': null, '7,8': 'tent' }),
    { '3,4': { food: 12, fuel: 1.235, at: 99 } });
  assert.deepEqual(cleanOutposts({ '1,1': { food: -5, fuel: 'a' } }), { '1,1': { food: 0, fuel: 0, at: 0 } });
  const many = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [keyOf(n, n), newOutpost(n)]));
  assert.equal(Object.keys(cleanOutposts(many)).length, 4);
});

test('the shop sells the Tent at Voyage 30 and it gives one Tent item', () => {
  const pkg = JSON.parse(readFileSync(new URL('../data/package.json', import.meta.url), 'utf8'));
  const p = pkg.data.shopPurchases.find((x) => x.id === TENT.id);
  assert.ok(p, 'purchase');
  assert.deepEqual(p.contains.items, [{ id: `voyage:${TENT.id}`, quantity: 1 }]);
  assert.deepEqual(p.purchaseRequirements, [{ type: 'SkillLevel', skillID: 'voyage:Voyage', level: TENT.level }]);
  assert.ok(pkg.data.items.some((x) => x.id === TENT.id), 'item');
  assert.ok(pkg.data.shopDisplayOrder[0].ids.includes(`voyage:${TENT.id}`), 'shown in the shop');
});

test('a milestone at each tent level, named as in en.json', () => {
  const skill = JSON.parse(readFileSync(new URL('../data/skill.json', import.meta.url), 'utf8'));
  const en = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
  const ms = skill.data.skillData[0].data.customMilestones.filter((m) => Object.values(OUTPOST_MILESTONES).includes(m.name));
  assert.deepEqual(ms.map((m) => m.level), OUTPOST_LEVELS);
  assert.equal(ms[0].name, OUTPOST_MILESTONES.first);
  assert.ok(ms.slice(1).every((m) => m.name === OUTPOST_MILESTONES.more));
  assert.equal(en.MOD_VOY_MILESTONE_OUTPOST_FIRST, OUTPOST_MILESTONES.first);
  assert.equal(en.MOD_VOY_MILESTONE_OUTPOST, OUTPOST_MILESTONES.more);
  const pkg = JSON.parse(readFileSync(new URL('../data/package.json', import.meta.url), 'utf8'));
  const item = pkg.data.items.find((x) => x.id === TENT.id);
  assert.equal(en.MOD_VOY_ITEM_TENT_NAME, item.name);
  assert.equal(en.MOD_VOY_ITEM_TENT_DESC, item.customDescription);
});

test('a tent goes up over an hour of one Folk\'s work, online or offline, and counts toward the limit meanwhile', () => {
  assert.equal(BUILD_MS, 60 * 60 * 1000);
  const o = newOutpost(1000, 'f1', 'melvorD:Woodcutting');
  assert.deepEqual(o.build, { folk: 'f1', until: 1000 + BUILD_MS, skill: 'melvorD:Woodcutting' });
  assert.equal(isBuilding(o), true);
  assert.equal(buildLeft(o, 1000 + BUILD_MS - 60000), 60000);
  assert.equal(buildLeft(o, 1000 + BUILD_MS * 5), 0);
  assert.equal(isBuilding(newOutpost(0)), false);
  assert.equal(pitchAction({ ...ok, outposts: { '1,1': o } }), 'full');
  assert.deepEqual(Object.keys(standing({ '1,1': o, '2,2': newOutpost(0) })), ['2,2']);
});

test('the builder is a Folk with no skill first, else the first by slot', () => {
  assert.equal(pickBuilder([{ id: 'a', slot: 0, skillId: 'x' }, { id: 'b', slot: 2, skillId: null }]).id, 'b');
  assert.equal(pickBuilder([{ id: 'a', slot: 3, skillId: 'x' }, { id: 'b', slot: 1, skillId: 'y' }]).id, 'b');
  assert.equal(pickBuilder([]), undefined);
});

test('the work stops when the builder is fired, moved, walking or given a skill; it is up when the time is done', () => {
  const o = newOutpost(0, 'f1');
  const folk = { id: 'f1', travel: 'idle', skillId: null, place: { q: 5, r: 7 } };
  assert.equal(buildStep(o, '5,7', folk, 10), 'going');
  assert.equal(buildStep(o, '5,7', folk, BUILD_MS), 'up');
  assert.equal(buildStep(o, '5,7', undefined, 10), 'stop');
  assert.equal(buildStep(o, '5,7', { ...folk, place: { q: 5, r: 8 } }, 10), 'stop');
  assert.equal(buildStep(o, '5,7', { ...folk, travel: 'walking' }, 10), 'stop');
  assert.equal(buildStep(o, '5,7', { ...folk, skillId: 'melvorD:Mining' }, 10), 'stop');
  assert.equal(buildStep(newOutpost(0), '5,7', undefined, 10), 'up');
});

test('the save keeps a tent going up, and drops a broken build', () => {
  const o = newOutpost(5, 'f1');
  assert.deepEqual(cleanOutposts({ '1,1': o }), { '1,1': o });
  assert.deepEqual(cleanOutposts({ '1,1': { food: 0, fuel: 0, at: 5, build: { folk: '', until: 9 } } }), { '1,1': { food: 0, fuel: 0, at: 5 } });
  assert.deepEqual(cleanOutposts({ '1,1': { at: 5, build: { folk: 'f', until: 'x', skill: 3 } } }), { '1,1': { food: 0, fuel: 0, at: 5, build: { folk: 'f', until: 0, skill: null } } });
});
