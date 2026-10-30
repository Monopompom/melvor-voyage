import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as E from '../src/encounter-model.mjs';
import { SHOP, SHOP_GP, TRADE_KINDS, priceOf, kindsHere, buyWhy, CRAFTED, heldOf, usedItems } from '../src/deck-model.mjs';
import { readFileSync } from 'node:fs';
import { COPIES, GROUPS, CHARM_ITEMS, capOf, groupCards, fitDeck, deckOk, addCard, removeCard, suitCounts, sameDeck, savePreset, cleanPresets, cleanCharms, charmOwned, charmsInPlay, shipKit, trophyArt, PRESETS_MAX } from '../src/deck-model.mjs';

const none = { levels: {}, owned: {} };
const high = { levels: Object.fromEntries(Object.values(E.CARDS).filter((c) => c.skill).map((c) => [c.skill, 99])), owned: {} };

test('copies: starter 3, a milestone 2 once its skill is at its level, dropped cards as owned, others none', () => {
  assert.equal(capOf('slash', none, E), COPIES.starter);
  assert.equal(capOf('drive', none, E), 0);
  assert.equal(capOf('drive', { levels: { Attack: 29 } }, E), 0);
  assert.equal(capOf('drive', { levels: { Attack: 30 } }, E), COPIES.milestone);
  assert.equal(capOf('capcut', { owned: { capcut: 1 } }, E), 1);
  assert.equal(capOf('capcut', none, E), 0);
  for (const id of ['bribe', 'hotmeal', 'broadside', 'brace', 'slip', 'dread', 'nope']) assert.equal(capOf(id, high, E), 0, id);
});

test('every milestone card names a skill and a level of 30, 60 or 90, and the builder lists them by level', () => {
  const ms = groupCards('milestone', E);
  assert.ok(ms.length > 0);
  for (const id of ms) assert.ok([30, 60, 90].includes(E.CARDS[id].lvl) && typeof E.CARDS[id].skill === 'string', id);
  assert.deepEqual(ms.map((id) => E.CARDS[id].lvl), ms.map((id) => E.CARDS[id].lvl).slice().sort((a, b) => a - b));
  for (const g of GROUPS) for (const id of groupCards(g, E)) assert.equal(E.CARDS[id].src, g);
});

test('the starter deck is a deck you can carry; a deck past a cap or out of 15 to 25 is not', () => {
  assert.ok(deckOk(E.STARTER, none, E));
  assert.ok(!deckOk(E.STARTER.slice(1), none, E));
  assert.ok(!deckOk([...E.STARTER, 'slash'], none, E), 'a fourth Cutlass Slash');
  assert.ok(!deckOk([...E.STARTER.slice(1), 'drive'], none, E), 'a locked milestone');
  assert.ok(deckOk([...E.STARTER.slice(1), 'drive'], { levels: { Attack: 30 } }, E));
});

test('fitting a preset keeps each card to its cap, in order', () => {
  const deck = ['capcut', 'capcut', 'drive', ...E.STARTER];
  assert.deepEqual(fitDeck(deck, { owned: { capcut: 1 } }, E), ['capcut', ...E.STARTER]);
});

test('adding stops at the cap and at 25 cards; removing takes one copy', () => {
  let d = E.STARTER.slice();
  d = addCard(d, 'slash', none, E);
  assert.equal(d.length, E.STARTER.length, 'three Slashes already');
  d = addCard(d, 'parry', none, E);
  assert.equal(d.length, E.STARTER.length + 1);
  const full = Array.from({ length: E.DECK_MAX }, () => 'x');
  assert.equal(addCard(full, 'parry', none, E), full);
  assert.deepEqual(removeCard(['a', 'b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(removeCard(['a'], 'z'), ['a']);
});

test('suit counts and the same deck in another order', () => {
  assert.deepEqual(suitCounts(E.STARTER, E), [['steel', 7], ['powder', 2], ['coin', 3], ['wits', 3]]);
  assert.ok(sameDeck(E.STARTER, E.STARTER.slice().reverse()));
  assert.ok(!sameDeck(E.STARTER, E.STARTER.slice(1)));
});

test('presets: save, save over by name in any case, at most five, only 15 to 25 cards', () => {
  let r = savePreset([], '  Against   Deserters ', E.STARTER, E);
  assert.ok(r.ok);
  assert.deepEqual(r.presets.map((p) => p.name), ['Against Deserters']);
  const other = [...E.STARTER.slice(1), 'parry'];
  r = savePreset(r.presets, 'against deserters', other, E);
  assert.equal(r.presets.length, 1);
  assert.deepEqual(r.presets[0].deck, other);
  assert.equal(r.presets[0].name, 'Against Deserters');
  assert.equal(savePreset([], '', E.STARTER, E).why, 'name');
  assert.equal(savePreset([], 'Small', E.STARTER.slice(2), E).why, 'size');
  let p = [];
  for (let i = 0; i < PRESETS_MAX; i++) p = savePreset(p, `P${i}`, E.STARTER, E).presets;
  assert.equal(savePreset(p, 'One more', E.STARTER, E).why, 'full');
  assert.ok(savePreset(p, 'p0', E.STARTER, E).ok, 'saving over still works when full');
});

test('the save: presets and charm slots made safe', () => {
  const raw = [{ name: 'A', deck: E.STARTER }, { name: 'a', deck: E.STARTER }, { name: 'B', deck: ['slash'] }, { name: 'C', deck: [...E.STARTER.slice(1), 'broadside'] }, null, 'x', { name: 'D'.repeat(50), deck: E.STARTER }];
  const out = cleanPresets(raw, E);
  assert.deepEqual(out.map((q) => q.name), ['A', 'D'.repeat(30)]);
  assert.deepEqual(cleanPresets(undefined, E), []);
  assert.deepEqual(cleanCharms(['hat', 'hat', 'nope', 'cape', 'compass', 'mask'], E), ['hat', 'cape', 'compass']);
  assert.deepEqual(cleanCharms('hat', E), []);
});

test('charms: an item you own makes one yours, a trophy only when won; slotted ones you lost sit out', () => {
  assert.deepEqual(Object.keys(CHARM_ITEMS).sort(), Object.keys(E.CHARMS).filter((id) => E.CHARMS[id].trophy === undefined).sort());
  for (const ids of Object.values(CHARM_ITEMS)) for (const id of ids) assert.match(id, /^(melvor(D|F|TotH|AoD|ItA)|voyage):[A-Za-z_]+$/);
  assert.ok(!Object.values(CHARM_ITEMS).flat().some((id) => /Relic/.test(id)), 'no Ancient Relics item');
  const ownsItem = (id) => id === 'voyage:Seafarers_Hat' || id === 'melvorTotH:Superior_Max_Skillcape';
  assert.ok(charmOwned('hat', { ownsItem }, E));
  assert.ok(charmOwned('cape', { ownsItem }, E));
  assert.ok(!charmOwned('compass', { ownsItem }, E));
  assert.ok(charmOwned('mask', { trophies: { mask: true } }, E));
  assert.ok(!charmOwned('mask', { ownsItem: () => true }, E));
  assert.deepEqual(charmsInPlay(['hat', 'compass', 'mask'], { ownsItem, trophies: { mask: true } }, E), ['hat', 'mask']);
});

test('every trophy charm has its own picture in the mod, the other charms none', () => {
  const trophies = Object.keys(E.CHARMS).filter((id) => E.CHARMS[id].trophy !== undefined);
  assert.equal(trophies.length, 6);
  for (const id of trophies) assert.ok(existsSync(new URL(`../${trophyArt(id, E)}`, import.meta.url)), id);
  for (const id of Object.keys(CHARM_ITEMS)) assert.equal(trophyArt(id, E), undefined, id);
});

test("the ship's cards: a brig 2 Broadsides and a Brace, a galleon 4, small boats none", () => {
  assert.deepEqual(shipKit('brig'), { cannons: 2, hull: true });
  assert.deepEqual(shipKit('galleon'), { cannons: 4, hull: true });
  assert.deepEqual(shipKit('longboat'), { cannons: 0, hull: false });
  assert.deepEqual(shipKit(undefined), { cannons: 0, hull: false });
});

test('shop cards: each shop card is sold at its own kind of trade place, a copy at a time up to two', () => {
  const shopCards = groupCards('shop', E);
  assert.deepEqual(shopCards.slice().sort(), Object.keys(SHOP).sort(), 'every shop card has a seller, and only they');
  const places = Object.values(SHOP).map((x) => x.at);
  assert.equal(new Set(places).size, places.length, 'no two sold at the same kind of place');
  for (const at of places) assert.ok(TRADE_KINDS.includes(at), at);
  assert.equal(capOf('bribe', { owned: { bribe: 1 } }, E), 1);
  assert.equal(capOf('bribe', { owned: { bribe: 7 } }, E), COPIES.shop, 'never past the cap');
  // The goods are Voyage's own items.
  const pkg = JSON.parse(readFileSync(new URL('../data/package.json', import.meta.url), 'utf8'));
  const ids = new Set(pkg.data.items.map((it) => `voyage:${it.id}`));
  for (const sh of Object.values(SHOP)) for (const [item] of sh.goods) assert.ok(ids.has(item), item);
});

test('a shop card\'s price grows with your grade; buying asks the place, the GP and the goods', () => {
  assert.deepEqual(priceOf('keg', 1), { gp: SHOP_GP[1], items: [{ id: 'voyage:Crate', qty: 1 }, { id: 'voyage:Pitch', qty: 10 }] });
  assert.deepEqual(priceOf('keg', 4).items, [{ id: 'voyage:Crate', qty: 4 }, { id: 'voyage:Pitch', qty: 40 }]);
  assert.equal(priceOf('keg', 9).gp, SHOP_GP[5], 'grade 1 to 5');
  for (let g = 2; g <= 5; g++) assert.ok(SHOP_GP[g] > SHOP_GP[g - 1]);
  assert.equal(priceOf('slash', 1), undefined);
  assert.deepEqual(kindsHere({ f: ['building', 'city'] }, [{ f: ['port'] }, { f: ['tree'] }, undefined]), ['port', 'city']);
  assert.deepEqual(kindsHere(undefined), []);
  const rich = { kinds: ['city'], gp: 1e9, qty: () => 1e6, grade: 1 };
  assert.equal(buyWhy('keg', rich), '');
  assert.equal(buyWhy('keg', { ...rich, owned: { keg: 2 } }), 'max');
  assert.equal(buyWhy('keg', { ...rich, busy: true }), 'band');
  assert.equal(buyWhy('keg', { ...rich, kinds: ['port'] }), 'place');
  assert.equal(buyWhy('keg', { ...rich, gp: 9999 }), 'gp');
  assert.equal(buyWhy('keg', { ...rich, qty: (id) => (id === 'voyage:Crate' ? 0 : 99) }), 'goods');
  assert.equal(buyWhy('slash', rich), 'none');
});

test('crafted cards: each is a Voyage item made by its skill\'s recipe at its level; Bitter Draught in its four tiers', () => {
  const crafted = groupCards('crafted', E);
  assert.deepEqual(crafted.slice().sort(), Object.keys(CRAFTED).sort(), 'every crafted card has an item, and only they');
  const pkg = JSON.parse(readFileSync(new URL('../data/package.json', import.meta.url), 'utf8'));
  const ids = new Set(pkg.data.items.map((it) => `voyage:${it.id}`));
  const recipes = pkg.data.skillData.flatMap((s) => (s.data.recipes ?? []).map((r) => ({ ...r, skill: s.skillID.split(':')[1] })));
  for (const [id, c] of Object.entries(CRAFTED)) {
    assert.ok(ids.has(c.item), c.item);
    assert.equal(E.CARDS[id].skill, c.skill, id);
    const r = recipes.find((x) => x.productID === c.item || x.potionIDs?.includes(c.item));
    assert.ok(r !== undefined, `a recipe makes ${c.item}`);
    assert.equal(r.skill, c.skill, id);
    assert.equal(r.level, c.lvl, id);
    // Each recipe asks for another skill's goods too, never only its own.
    assert.ok(r.itemCosts.length >= 2, id);
  }
  const tiers = recipes.find((r) => r.potionIDs !== undefined).potionIDs;
  assert.deepEqual(tiers, ['bitter', 'bitter2', 'bitter3', 'bitter4'].map((id) => CRAFTED[id].item));
  assert.deepEqual(['bitter', 'bitter2', 'bitter3', 'bitter4'].map((id) => CRAFTED[id].mastery), [1, 20, 50, 90]);
  assert.deepEqual(['bitter', 'bitter2', 'bitter3', 'bitter4'].map((id) => E.CARDS[id].n), [3, 4, 5, 6]);
  // A Cooking recipe makes only its plain meal: a perfect cook is a setting a player can turn off.
  for (const r of recipes.filter((x) => x.perfectCookID !== undefined)) assert.equal(r.perfectCookID, r.productID);
});

test('crafted cards: the bank holds the stock; a kept deck keeps its copies, a band meets what the bank holds', () => {
  const held = (n) => ({ levels: {}, owned: {}, qty: (id) => (id === CRAFTED.hotmeal.item ? n : 0) });
  assert.equal(heldOf('hotmeal', held(5).qty), 5);
  assert.equal(heldOf('slash', held(5).qty), 0);
  assert.equal(capOf('hotmeal', held(1), E), 1);
  assert.equal(capOf('hotmeal', held(50), E), COPIES.crafted, 'never past the cap');
  assert.equal(capOf('hotmeal', held(0), E), 0);
  assert.equal(capOf('hotmeal', held(0), E, true), COPIES.crafted, 'the kept deck keeps its copies');
  const deck = [...E.STARTER.slice(0, 13), 'hotmeal', 'hotmeal', 'hotmeal'];
  assert.deepEqual(fitDeck(deck, held(1), E), [...E.STARTER.slice(0, 13), 'hotmeal'], 'a band meets one');
  assert.equal(fitDeck(deck, held(0), E, true).length, 16);
  assert.ok(deckOk(deck, held(2), E), '15 met with two in the bank');
  assert.ok(!deckOk(deck, held(1), E), 'only 14 would be met');
  assert.deepEqual(addCard(E.STARTER, 'hotmeal', held(0), E), E.STARTER, 'none to add without one in the bank');
  assert.deepEqual(usedItems({ hotmeal: 2, slash: 4, grapeshot: 1 }, held(1).qty), [{ card: 'hotmeal', id: CRAFTED.hotmeal.item, qty: 1 }]);
  assert.deepEqual(usedItems(undefined, held(1).qty), []);
});
