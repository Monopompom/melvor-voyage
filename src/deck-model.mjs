// The deck you carry into encounters (4.33, slice 3): which cards you may put in it and how many, the presets, the
// charm slots, the ship's cards at sea. Pure: no game globals. The encounter model comes in as `E` (game modules can't
// import each other).

/**
 * Copies a deck may hold of a card, by where it comes from; shop and dropped cards up to what you own, crafted cards up
 * to what the bank holds.
 */
export const COPIES = { starter: 3, milestone: 2, shop: 2, crafted: 3 };
export const PRESETS_MAX = 5;
export const PRESET_NAME_MAX = 30;
export const CHARM_SLOTS = 3;
/** The card groups of the deck builder, in order. */
export const GROUPS = ['starter', 'milestone', 'shop', 'crafted', 'drop'];

/**
 * Shop cards: bought one copy at a time in the deck builder, up to COPIES.shop, each at its own kind of trade place
 * (`at`, a trade feature of the hex you stand on or a known neighbour, as trade itself works). The price grows with
 * your grade g (1 to 5, as the loot's): SHOP_GP[g] GP and each of `goods` × g. [BALANCE]
 */
export const SHOP = {
  hardport: { at: 'port', goods: [['voyage:Pitch', 10]] },
  hook: { at: 'market', goods: [['voyage:Sack', 1], ['voyage:Pitch', 5]] },
  keg: { at: 'city', goods: [['voyage:Crate', 1], ['voyage:Pitch', 10]] },
  bribe: { at: 'capital', goods: [['voyage:Sack', 2]] },
};
export const SHOP_GP = [0, 10000, 50000, 250000, 1000000, 5000000];
/**
 * Crafted cards: Voyage items made by a skill's own recipe (`skill` at `lvl`). The bank's count is the stock: a deck
 * holds up to COPIES.crafted of what the bank holds, and a copy played is used up. Bitter Draught comes in Herblore's
 * four tiers (the recipe's mastery picks the tier: `mastery`). Cooking's perfect cook is a setting a player can turn
 * off, so a perfect Hot Meal is the plain one.
 */
export const CRAFTED = {
  grapeshot: { item: 'voyage:Grapeshot', skill: 'Smithing', lvl: 35 },
  smokepot: { item: 'voyage:Smoke_Pot', skill: 'Crafting', lvl: 40 },
  hotmeal: { item: 'voyage:Hot_Meal', skill: 'Cooking', lvl: 45 },
  bitter: { item: 'voyage:Bitter_Draught_I', skill: 'Herblore', lvl: 30, mastery: 1 },
  bitter2: { item: 'voyage:Bitter_Draught_II', skill: 'Herblore', lvl: 30, mastery: 20 },
  bitter3: { item: 'voyage:Bitter_Draught_III', skill: 'Herblore', lvl: 30, mastery: 50 },
  bitter4: { item: 'voyage:Bitter_Draught_IV', skill: 'Herblore', lvl: 30, mastery: 90 },
};
/** How many copies of a crafted card the bank holds (`qty(itemId)`); 0 for any other card. */
export const heldOf = (id, qty = () => 0) => (CRAFTED[id] === undefined ? 0 : Math.max(0, Math.floor(Number(qty(CRAFTED[id].item)) || 0)));
/** The supplies a fight used ({ card: count }) as the items to take from the bank, each no more than it holds. */
export function usedItems(used, qty = () => 0) {
  const out = [];
  for (const [id, n] of Object.entries(used ?? {})) {
    const k = Math.min(Math.max(0, Math.floor(n)), heldOf(id, qty));
    if (CRAFTED[id] !== undefined && k > 0) out.push({ card: id, id: CRAFTED[id].item, qty: k });
  }
  return out;
}

/** The trade places' kinds, as the map's features name them. */
export const TRADE_KINDS = ['port', 'market', 'city', 'capital'];
const gradeIn = (g) => Math.min(5, Math.max(1, Number.isInteger(g) ? g : 1));
/** A shop card's price at your grade: `{ gp, items: [{ id, qty }] }`, undefined for a card not sold. */
export function priceOf(id, grade) {
  const sh = SHOP[id];
  if (sh === undefined) return undefined;
  const g = gradeIn(grade);
  return { gp: SHOP_GP[g], items: sh.goods.map(([item, q]) => ({ id: item, qty: q * g })) };
}
/** The kinds of trade place in reach: the hex's own and its known neighbours' (records with `f`, the features). */
export function kindsHere(rec, neighbours = []) {
  const out = new Set();
  for (const r of [rec, ...neighbours]) for (const f of Array.isArray(r?.f) ? r.f : []) if (TRADE_KINDS.includes(f)) out.add(f);
  return TRADE_KINDS.filter((k) => out.has(k));
}
/**
 * Why a copy of a shop card can't be bought now, or '' when it can: 'none' (not sold), 'max' (you hold the most a deck
 * may carry), 'band' (a band waits), 'place' (not sold here), 'gp', 'goods'. `qty(itemId)`: what the bank holds.
 */
export function buyWhy(id, { owned = {}, kinds = [], gp = 0, qty = () => 0, grade = 1, busy = false } = {}) {
  if (SHOP[id] === undefined) return 'none';
  if ((owned[id] ?? 0) >= COPIES.shop) return 'max';
  if (busy) return 'band';
  if (!kinds.includes(SHOP[id].at)) return 'place';
  const price = priceOf(id, grade);
  if (!(gp >= price.gp)) return 'gp';
  if (price.items.some((x) => !(qty(x.id) >= x.qty))) return 'goods';
  return '';
}

/**
 * The game items that make a charm yours: owned (in the bank or worn), not necessarily worn. Ancient Relics' items are
 * left out, so every game mode has the same charms. Trophy charms come from bands (the save), not from items.
 */
export const CHARM_ITEMS = {
  albatross: ['voyage:Summoning_Familiar_Albatross'],
  compass: ['voyage:Wayfinder_Compass'],
  cape: ['melvorD:Defence_Skillcape', 'melvorTotH:Superior_Defence_Skillcape', 'melvorF:Max_Skillcape', 'melvorTotH:Superior_Max_Skillcape',
    'melvorF:Cape_of_Completion', 'melvorTotH:Superior_Cape_Of_Completion', 'melvorAoD:Cape_of_Completion_AoD', 'melvorItA:Cape_of_Completion_ItA'],
  relic: ['voyage:Seafarers_Coat'],
  hat: ['voyage:Seafarers_Hat'],
};

/** A trophy charm's picture, shipped with the mod (a path for `ctx.getResourceUrl`); undefined for the other charms. */
export const trophyArt = (id, E) => (E.CHARMS[id]?.trophy !== undefined ? `assets/trophy_${id}.webp` : undefined);

/** Whether a milestone card is yours: its skill at its level (`levels`: skill local id to level). */
export const unlocked = (c, levels) => c?.src !== 'milestone' || (levels[c.skill] ?? 0) >= c.lvl;

/**
 * How many copies of a card a deck may hold now. `owned`: dropped and shop cards { id: count }; `qty`: the bank's.
 * `keep`: the deck you keep, whose crafted cards may stay past what the bank holds (up to COPIES.crafted), so they come
 * back into play once you craft more; a fight takes only what the bank holds.
 */
export function capOf(id, { levels = {}, owned = {}, qty }, E, keep = false) {
  const c = E.CARDS[id];
  if (c === undefined || !GROUPS.includes(c.src)) return 0;
  if (c.src === 'drop') return Math.max(0, Math.floor(owned[id] ?? 0));
  if (c.src === 'shop') return Math.min(COPIES.shop, Math.max(0, Math.floor(owned[id] ?? 0)));
  if (c.src === 'crafted') return keep ? COPIES.crafted : Math.min(COPIES.crafted, heldOf(id, qty));
  return unlocked(c, levels) ? COPIES[c.src] : 0;
}

/** The cards of a group, as the builder lists them (milestones by level, then skill). */
export function groupCards(src, E) {
  const ids = Object.keys(E.CARDS).filter((id) => E.CARDS[id].src === src);
  if (src === 'milestone') ids.sort((a, b) => E.CARDS[a].lvl - E.CARDS[b].lvl || String(E.CARDS[a].skill).localeCompare(String(E.CARDS[b].skill)));
  return ids;
}

const countOf = (deck, id) => deck.reduce((n, x) => n + (x === id ? 1 : 0), 0);

/** A deck cut to what you may carry now: each card to its cap, in the order given (`keep`: as capOf). */
export function fitDeck(deck, have, E, keep = false) {
  const left = {};
  const out = [];
  for (const id of Array.isArray(deck) ? deck : []) {
    if (left[id] === undefined) left[id] = capOf(id, have, E, keep);
    if (left[id] > 0) { out.push(id); left[id] -= 1; }
  }
  return out;
}

/**
 * Whether a deck can be kept: at most 25 cards, none past its cap (crafted ones as kept), and at least 15 a band would
 * meet with what the bank holds now.
 */
export const deckOk = (deck, have, E) => Array.isArray(deck) && deck.length <= E.DECK_MAX
  && fitDeck(deck, have, E, true).length === deck.length && fitDeck(deck, have, E).length >= E.DECK_MIN;

/** One more copy of a card in a draft, if the cap and the size allow; the draft unchanged otherwise. */
export function addCard(deck, id, have, E) {
  return deck.length < E.DECK_MAX && countOf(deck, id) < capOf(id, have, E) ? [...deck, id] : deck;
}
/** One copy fewer (the last one). */
export function removeCard(deck, id) {
  const i = deck.lastIndexOf(id);
  return i < 0 ? deck : [...deck.slice(0, i), ...deck.slice(i + 1)];
}

/** Each suit's count in a deck, in the suits' order (no zero counts). */
export function suitCounts(deck, E) {
  const by = {};
  for (const id of deck) { const s = E.CARDS[id]?.suit; if (s) by[s] = (by[s] ?? 0) + 1; }
  return E.SUITS.filter((s) => by[s]).map((s) => [s, by[s]]);
}

/** Two decks hold the same cards (order aside). */
export const sameDeck = (a, b) => a.length === b.length && a.slice().sort().join() === b.slice().sort().join();

/** A preset name as kept: trimmed, single spaces, at most 30 characters. */
export const presetName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX);

/**
 * Saves a deck under a name: a name already there (any case) is saved over, else a new one if a slot is free.
 * Returns { presets, ok, why } with why 'name' (empty), 'size' (not 15 to 25 cards) or 'full'.
 */
export function savePreset(presets, rawName, deck, E) {
  const name = presetName(rawName);
  if (name === '') return { presets, ok: false, why: 'name' };
  if (deck.length < E.DECK_MIN || deck.length > E.DECK_MAX) return { presets, ok: false, why: 'size' };
  const i = presets.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) return { presets: presets.map((p, k) => (k === i ? { name: p.name, deck: deck.slice() } : p)), ok: true };
  if (presets.length >= PRESETS_MAX) return { presets, ok: false, why: 'full' };
  return { presets: [...presets, { name, deck: deck.slice() }], ok: true };
}

/** The save's presets made safe: up to 5, each a name and a deck of 15 to 25 deck cards, names unique. */
export function cleanPresets(raw, E) {
  const out = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    if (out.length >= PRESETS_MAX || p === null || typeof p !== 'object') continue;
    const name = presetName(p.name);
    const deck = Array.isArray(p.deck) ? p.deck.filter((id) => typeof id === 'string' && E.CARDS[id] !== undefined && !['ship', 'folk', 'curse'].includes(E.CARDS[id].src)) : [];
    if (name === '' || deck.length !== (p.deck?.length ?? -1) || deck.length < E.DECK_MIN || deck.length > E.DECK_MAX) continue;
    if (out.some((q) => q.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, deck });
  }
  return out;
}

/** The save's charm slots made safe: up to 3 known charms, each once. */
export const cleanCharms = (raw, E) => (Array.isArray(raw) ? raw : [])
  .filter((id, i, a) => typeof id === 'string' && E.CHARMS[id] !== undefined && a.indexOf(id) === i).slice(0, CHARM_SLOTS);

/** Whether a charm is yours: a trophy you won, or one of its items you own (`ownsItem(id)`). */
export const charmOwned = (id, { trophies = {}, ownsItem = () => false }, E) => (E.CHARMS[id]?.trophy !== undefined
  ? trophies[id] === true
  : (CHARM_ITEMS[id] ?? []).some((item) => ownsItem(item)));

/** The charms that work in a fight: the slotted ones you still own. */
export const charmsInPlay = (slots, have, E) => slots.filter((id) => charmOwned(id, have, E));

/**
 * The ship's own cards at sea, by its hull: a Broadside per cannon (a brig carries 2, a galleon 4) and a Brace for the
 * hull. Placeholder counts for the balance pass (30 Oct 2026); the dinghy and the longboat never sail where bands meet.
 */
export const SHIP_CANNONS = { brig: 2, galleon: 4 };
export const shipKit = (hull) => (SHIP_CANNONS[hull] !== undefined ? { cannons: SHIP_CANNONS[hull], hull: true } : { cannons: 0, hull: false });
