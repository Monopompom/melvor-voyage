import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as E from '../src/encounter-model.mjs';
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
