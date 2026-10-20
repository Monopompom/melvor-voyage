import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BERTHS, berthsOf, mouths, hungerDamage, hungryHexes, berthRefusal, FOOD_SHARE, foodShare, crewLoad, jobsAfterAssign, jobsWithout, keptJob } from '../src/crew-model.mjs';
import { HULLS } from '../src/ship-model.mjs';

test('crew: every hull has berths, bigger hulls more; no vessel none', () => {
  for (const id of Object.keys(HULLS)) assert.ok(berthsOf(id) > 0, id);
  assert.deepEqual(BERTHS, { dinghy: 1, longboat: 2, brig: 6, galleon: 12 });
  assert.equal(berthsOf(undefined), 0);
  assert.equal(berthsOf('raft'), 0);
});

test('crew: you plus every Folk eat; hunger is a tenth of max HP, at least 1', () => {
  assert.equal(mouths(0), 1);
  assert.equal(mouths(3), 4);
  assert.equal(mouths(undefined), 1);
  assert.equal(mouths(-2), 1);
  assert.equal(hungerDamage(100), 10);
  assert.equal(hungerDamage(95), 10, 'rounded up');
  assert.equal(hungerDamage(5), 1);
  assert.equal(hungerDamage(undefined), 1);
});

test('crew: berths are checked on water steps only, each in its own vessel', () => {
  const berths = { boat: 1, ship: 6 };
  const berthsFor = (kind) => berths[kind] ?? 0;
  const land = { cls: 'grasslands', sea: false };
  const boat = { cls: 'water', sea: true, vessel: 'boat' };
  const ship = { cls: 'water', sea: true, vessel: 'ship' };
  assert.equal(berthRefusal([land, land], 5, berthsFor), undefined, 'on land the crew walks');
  assert.equal(berthRefusal([land, boat], 1, berthsFor), undefined);
  assert.deepEqual(berthRefusal([land, boat], 2, berthsFor), { at: 1, vessel: 'boat', berths: 1 });
  assert.equal(berthRefusal([ship, ship], 6, berthsFor), undefined);
  assert.deepEqual(berthRefusal([ship, boat], 3, berthsFor), { at: 1, vessel: 'boat', berths: 1 }, 'into the small boat from the ship');
  assert.deepEqual(berthRefusal([{ cls: 'grasslands', hop: 4, vessel: 'boat' }], 2, berthsFor), { at: 0, vessel: 'boat', berths: 1 }, 'a hop is sailed');
  assert.deepEqual(berthRefusal([{ ...boat, free: true }], 2, berthsFor), { at: 0, vessel: 'boat', berths: 1 }, 'a free step still carries them');
  assert.deepEqual(berthRefusal([{ cls: 'water', sea: true }], 2, berthsFor), { at: 0, vessel: 'boat', berths: 1 }, 'no vessel named: the small boat');
  assert.equal(berthRefusal([boat], 0, berthsFor), undefined, 'no crew, no check');
});

test('hungryHexes: full health lives through nine, the tenth kills; a hurt Folk fewer', () => {
  assert.equal(hungryHexes(null, 300), 9);
  assert.equal(hungryHexes(300, 300), 9);
  assert.equal(hungryHexes(31, 300), 1);
  assert.equal(hungryHexes(30, 300), 0);
  assert.equal(hungryHexes(0, 300), 0);
  assert.equal(hungryHexes(1205, 1205), 9);
});

test('food by rank: a Trainee eats half, a Foreman half again; fuel one share each', () => {
  assert.deepEqual(FOOD_SHARE, { Newbie: 0.5, Junior: 0.75, Middle: 1, Senior: 1.25, Expert: 1.5 });
  assert.equal(foodShare('Newbie'), 0.5);
  assert.equal(foodShare('Nobody'), 1);
  assert.deepEqual(crewLoad([{ tier: 'Newbie' }, { tier: 'Expert' }, { tier: 'Middle' }]), { count: 3, food: 3 });
  assert.deepEqual(crewLoad([{ tier: 'Newbie' }, { tier: 'Junior' }]), { count: 2, food: 1.25 });
  assert.deepEqual(crewLoad([]), { count: 0, food: 0 });
  assert.deepEqual(crewLoad(undefined), { count: 0, food: 0 });
});

test('kept job: losing a job keeps it; another job, a new holder or leaving drops it', () => {
  let jobs = jobsAfterAssign({}, { folkId: 'a', previous: 'melvorD:Woodcutting', skillId: null });
  assert.deepEqual(jobs, { a: 'melvorD:Woodcutting' });
  const at = { id: 'a', travel: 'idle', place: { q: 15, r: 9 } };
  assert.equal(keptJob(jobs, at, 'melvorD:Woodcutting'), true);
  assert.equal(keptJob(jobs, at, 'melvorD:Mining'), false);
  assert.equal(keptJob(jobs, { ...at, travel: 'with' }, 'melvorD:Woodcutting'), false);
  assert.equal(keptJob(jobs, { ...at, place: null }, 'melvorD:Woodcutting'), false);
  assert.equal(keptJob(jobs, undefined, 'melvorD:Woodcutting'), false);
  // Another Folk takes Woodcutting: a's is gone.
  assert.deepEqual(jobsAfterAssign(jobs, { folkId: 'b', previous: null, skillId: 'melvorD:Woodcutting' }), {});
  // a gets a job (its own back, or another): nothing kept.
  assert.deepEqual(jobsAfterAssign(jobs, { folkId: 'a', previous: null, skillId: 'melvorD:Mining' }), {});
  // Unassigned with nothing before: nothing to keep.
  assert.deepEqual(jobsAfterAssign({}, { folkId: 'a', previous: null, skillId: null }), {});
  assert.deepEqual(jobsWithout(jobs, 'a'), {});
  assert.equal(jobsWithout(jobs, 'z'), jobs);
});
