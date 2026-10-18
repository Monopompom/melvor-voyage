// Land upgrades and the Crossroads Sign (src/land-model.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepMs, LAND_MS } from '../src/clock-model.mjs';
import { MOUNTS, mountTier, mountAt, nextMount, gpFactor, hexGp, pathGp, SIGN, SIGN_POIS, signAction, signAdds } from '../src/land-model.mjs';

// The shop as data/package.json sells it: the Voyage purchases and a buy that checks their requirements the way the
// game does (SkillLevel on Voyage, ShopPurchase of the one before), then records the purchase.
const pkg = JSON.parse(readFileSync(new URL('../data/package.json', import.meta.url), 'utf8'));
const findPurchases = (o) => {
  if (Array.isArray(o)) { for (const v of o) { const r = findPurchases(v); if (r) return r; } return undefined; }
  if (o !== null && typeof o === 'object') {
    if (Array.isArray(o.shopPurchases)) return o.shopPurchases;
    for (const v of Object.values(o)) { const r = findPurchases(v); if (r) return r; }
  }
  return undefined;
};
const purchases = new Map(findPurchases(pkg).map((p) => [p.id, p]));
const shop = (level) => {
  const bought = new Set();
  const canBuy = (id) => {
    const p = purchases.get(id);
    if (p === undefined || bought.has(id)) return false;
    return (p.purchaseRequirements ?? []).every((r) => (r.type === 'SkillLevel' ? (r.skillID !== 'voyage:Voyage' || level >= r.level)
      : r.type === 'ShopPurchase' ? bought.has(r.purchaseID.replace(/^voyage:/, '')) : false));
  };
  return { canBuy, buy: (id) => { if (!canBuy(id)) return false; bought.add(id); return true; }, owned: (id) => bought.has(id) };
};
// A path with land and sea, at the Voyage 60 discount (x0.7): 100 + 150 GP on land, 200 at sea.
const PATH = [{ gp: 100, land: true }, { gp: 200, land: false }, { gp: 150, land: true }];
const MULT = 0.7;

test('the ladder matches DESIGN 4.27: levels 5/25/45/60, cuts 10-40%, speeds 1.25-3', () => {
  assert.deepEqual(MOUNTS.map((m) => m.level), [5, 25, 45, 60]);
  assert.deepEqual(MOUNTS.map((m) => m.cut), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(MOUNTS.map((m) => m.speed), [1.25, 1.5, 2, 3]);
});

test('tier counts upgrades owned in order; a gap stops it', () => {
  assert.equal(mountTier(() => false), 0);
  assert.equal(mountTier((id) => id === 'Sturdy_Boots'), 1);
  assert.equal(mountTier((id) => ['Sturdy_Boots', 'Pack_Yak', 'Riding_Horse'].includes(id)), 3);
  assert.equal(mountTier(() => true), 4);
  assert.equal(mountTier((id) => id !== 'Pack_Yak'), 1);
});

test('mountAt and nextMount', () => {
  assert.equal(mountAt(0).cut, 0);
  assert.equal(mountAt(2).id, 'Pack_Yak');
  assert.equal(mountAt(9).id, 'Unicorn');
  assert.equal(nextMount(0).id, 'Sturdy_Boots');
  assert.equal(nextMount(4), undefined);
});

test('the cut applies to land hexes only', () => {
  assert.equal(gpFactor(0, true), 1);
  assert.equal(gpFactor(1, true), 0.9);
  assert.ok(Math.abs(gpFactor(4, true) - 0.6) < 1e-9);
  assert.equal(gpFactor(4, false), 1);
});

test('14 sign POIs', () => {
  assert.equal(SIGN_POIS.length, 14);
  assert.equal(new Set(SIGN_POIS).size, 14);
});

test('sign actions', () => {
  const buffed = { id: 'Monolith', buffs: true, discovered: true };
  assert.equal(signAction({ owned: false, placed: '', here: buffed }), 'not-owned');
  assert.equal(signAction({ owned: true, placed: '', here: buffed }), 'place');
  assert.equal(signAction({ owned: true, placed: '', here: undefined }), 'no-poi');
  assert.equal(signAction({ owned: true, placed: '', here: { ...buffed, buffs: false } }), 'no-buffs');
  assert.equal(signAction({ owned: true, placed: '', here: { ...buffed, discovered: false } }), 'undiscovered');
  assert.equal(signAction({ owned: true, placed: 'Monolith', here: buffed }), 'pickup');
  assert.equal(signAction({ owned: true, placed: 'DarkWaters', here: buffed }), 'elsewhere');
  assert.equal(signAction({ owned: true, placed: 'DarkWaters', here: undefined }), 'elsewhere');
});

test('the sign never doubles the POI underfoot', () => {
  assert.equal(signAdds('', 'Monolith'), false);
  assert.equal(signAdds('Monolith', 'Monolith'), false);
  assert.equal(signAdds('Monolith', undefined), true);
  assert.equal(signAdds('Monolith', 'DarkWaters'), true);
});

test('each mount is a recorded one-time purchase at its level (the game records only with contains.modifiers)', () => {
  for (const m of MOUNTS) {
    const p = purchases.get(m.id);
    assert.ok(p !== undefined, m.id);
    assert.equal(p.media, m.media);
    assert.deepEqual(p.contains.modifiers, {});
    assert.equal(p.defaultBuyLimit, 1);
    assert.ok(p.purchaseRequirements.some((r) => r.type === 'SkillLevel' && r.level === m.level), m.id);
  }
  const sign = purchases.get(SIGN.id);
  assert.deepEqual(sign.contains.modifiers, {});
  assert.ok(sign.purchaseRequirements.some((r) => r.type === 'SkillLevel' && r.level === SIGN.level));
});

test('the shop sells the mounts one by one: none ahead of the one before, none below its level', () => {
  const low = shop(4);
  assert.equal(low.buy('Sturdy_Boots'), false, 'level 4: no boots');
  const s = shop(60);
  assert.equal(s.buy('Pack_Yak'), false, 'the yak needs the boots');
  assert.equal(s.buy('Unicorn'), false, 'the unicorn needs the horse');
  const mid = shop(44);
  assert.ok(mid.buy('Sturdy_Boots') && mid.buy('Pack_Yak'));
  assert.equal(mid.buy('Riding_Horse'), false, 'level 44: no horse');
});

test('buying one by one: after each, the land GP drops by the new cut and the sea GP stays', () => {
  const s = shop(60);
  const sea = PATH.filter((h) => !h.land);
  const land = PATH.filter((h) => h.land);
  const full = pathGp(PATH, MULT, 0);
  assert.equal(full, 70 + 140 + 105);
  let before = full;
  for (const [i, m] of MOUNTS.entries()) {
    assert.ok(s.buy(m.id), `buy ${m.id}`);
    const tier = mountTier(s.owned);
    assert.equal(tier, i + 1, `tier after ${m.id}`);
    const now = pathGp(PATH, MULT, tier);
    assert.ok(now < before, `${m.id} makes the path cheaper`);
    assert.equal(pathGp(sea, MULT, tier), pathGp(sea, MULT, 0), `${m.id}: sea unchanged`);
    assert.equal(pathGp(land, MULT, tier), land.reduce((sum, h) => sum + Math.floor(h.gp * MULT * (1 - m.cut)), 0), `${m.id}: land cut ${m.cut}`);
    before = now;
  }
  // Boots 10%, yak 20%, horse 30%, unicorn 40% off the 175 GP of land: 157, 140, 122, 105 (each hex rounded down).
  assert.deepEqual([1, 2, 3, 4].map((t) => pathGp(land, MULT, t)), [63 + 94, 56 + 84, 49 + 73, 42 + 63]);
  assert.equal(s.buy('Unicorn'), false, 'one of each');
});

test('buying one by one: the land speed rises with each mount (phase 5 data)', () => {
  const s = shop(60);
  let speed = mountAt(mountTier(s.owned)).speed;
  assert.equal(speed, 1, 'on foot');
  for (const m of MOUNTS) {
    s.buy(m.id);
    const now = mountAt(mountTier(s.owned)).speed;
    assert.ok(now > speed, `${m.id} is faster`);
    speed = now;
  }
});

test('phase 5: after each mount bought, a land hex takes 1 / speed of the on-foot travel time (the cut gives way to speed)', () => {
  const s = shop(99);
  const onFoot = stepMs({ cls: 'grasslands' }, { mountSpeed: mountAt(mountTier(s.owned)).speed });
  assert.equal(onFoot, LAND_MS);
  for (const m of MOUNTS) {
    s.buy(m.id);
    const ms = stepMs({ cls: 'grasslands' }, { mountSpeed: mountAt(mountTier(s.owned)).speed });
    assert.equal(ms, Math.round(LAND_MS / m.speed), m.id);
  }
});

test('hexGp rounds each hex down, as the game does', () => {
  assert.equal(hexGp(33, 0.7, 1, true), Math.floor(33 * 0.7 * 0.9));
  assert.equal(hexGp(33, 0.7, 4, false), Math.floor(33 * 0.7));
});
