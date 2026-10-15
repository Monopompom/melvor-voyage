import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_VERSION, XP_PER_HEX, COMPASS_LEVELS, defaultSave, loadSave, serializeSave, xpForSteps, backfillXP,
  compassDetail, nextCompassStage,
} from '../src/voyage-model.mjs';

test('save round-trips through serialize and load', () => {
  const save = { ...defaultSave(), landHexes: 12, waterHexes: 3, backfilled: true };
  const { save: back, report } = loadSave(serializeSave(save));
  assert.deepEqual(back, save);
  assert.deepEqual(report, { applied: [], corrupt: false, future: false });
});

test('unreadable or shapeless save gives a fresh record marked corrupt', () => {
  for (const json of ['not json', 'null', '42', '{"landHexes":5}', '{"v":0}']) {
    const { save, report } = loadSave(json);
    assert.deepEqual(save, defaultSave(), json);
    assert.equal(report.corrupt, true, json);
  }
});

test('a save from a newer build is flagged, not downgraded', () => {
  const { save, report } = loadSave(JSON.stringify({ v: SAVE_VERSION + 1, landHexes: 99 }));
  assert.equal(report.future, true);
  assert.deepEqual(save, defaultSave());
});

test('bad counters are cleaned on load', () => {
  const { save } = loadSave(JSON.stringify({ v: SAVE_VERSION, landHexes: -4, waterHexes: 2.7, backfilled: 'yes', ship: 'boat' }));
  assert.deepEqual(save, { ...defaultSave(), waterHexes: 2 });
});

test('XP per hex: water worth more, fast-travel hops give nothing', () => {
  const r = xpForSteps([{ water: false }, { water: true }, { water: false, fastTravel: true }, { water: true }]);
  assert.deepEqual(r, { land: 1, water: 2, xp: XP_PER_HEX.land + 2 * XP_PER_HEX.water });
  assert.equal(xpForSteps([]).xp, 0);
});

test('backfill counts every travelled hex as land', () => {
  assert.equal(backfillXP(10), 10 * XP_PER_HEX.land);
  assert.equal(backfillXP(undefined), 0);
  assert.equal(backfillXP(-3), 0);
});

test('compass level 1 keeps today\'s reading; steps and name unlock later', () => {
  assert.deepEqual(compassDetail(1), { steps: false, name: false });
  assert.deepEqual(compassDetail(COMPASS_LEVELS.steps), { steps: true, name: false });
  assert.deepEqual(compassDetail(COMPASS_LEVELS.name), { steps: true, name: true });
  assert.equal(nextCompassStage(1).level, COMPASS_LEVELS.steps);
  assert.equal(nextCompassStage(COMPASS_LEVELS.steps).level, COMPASS_LEVELS.name);
  assert.equal(nextCompassStage(COMPASS_LEVELS.name), undefined);
});

test('skill milestones in data/skill.json match the compass stages', async () => {
  const { readFile } = await import('node:fs/promises');
  const { COMPASS_STAGES } = await import('../src/voyage-model.mjs');
  const pkg = JSON.parse(await readFile(new URL('../data/skill.json', import.meta.url), 'utf8'));
  const levels = pkg.data.skillData[0].data.customMilestones.map((m) => m.level);
  assert.deepEqual(levels, COMPASS_STAGES.map((s) => s.level));
});
