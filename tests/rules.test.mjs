import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_RULES, gatedSkillIds, isGated, allowedAt, ruleNoun } from '../src/rules.mjs';

test('phase 1 gates Woodcutting only', () => {
  assert.deepEqual(gatedSkillIds(), ['melvorD:Woodcutting']);
  assert.ok(isGated('melvorD:Woodcutting'));
  assert.ok(!isGated('melvorD:Mining'));
  assert.equal(ruleNoun('melvorD:Woodcutting'), 'forest');
  assert.ok(Object.values(SKILL_RULES).every((r) => Array.isArray(r.classes) && Array.isArray(r.features)));
});

test('allowedAt fails open and honours classes and features', () => {
  assert.ok(allowedAt('melvorD:Woodcutting', undefined));
  assert.ok(allowedAt('melvorD:Mining', { t: 'grassland' }));
  assert.ok(allowedAt('melvorD:Woodcutting', { t: 'forest' }));
  assert.ok(!allowedAt('melvorD:Woodcutting', { t: 'grassland' }));
  assert.ok(!allowedAt('melvorD:Woodcutting', { t: 'grassland', f: ['river'] }));
  SKILL_RULES['test:Fishing'] = { classes: ['water'], features: ['river'], noun: 'water' };
  assert.ok(allowedAt('test:Fishing', { t: 'grassland', f: ['river'] }));
  assert.ok(!allowedAt('test:Fishing', { t: 'grassland' }));
  delete SKILL_RULES['test:Fishing'];
});
