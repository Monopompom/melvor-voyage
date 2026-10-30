// The deck you carry into encounters (4.33, slice 3): which cards you may put in it and how many, the presets, the
// charm slots, the ship's cards at sea. Pure: no game globals. The encounter model comes in as `E` (game modules can't
// import each other).

/** Copies a deck may hold of a card, by where it comes from; dropped cards up to what you own. */
export const COPIES = { starter: 3, milestone: 2 };
export const PRESETS_MAX = 5;
export const PRESET_NAME_MAX = 30;
export const CHARM_SLOTS = 3;
/** The card groups of the deck builder, in order (shop and crafted cards come with the harbour boards and recipes). */
export const GROUPS = ['starter', 'milestone', 'drop'];

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

/** How many copies of a card a deck may hold now. `owned`: dropped cards { id: count }. */
export function capOf(id, { levels = {}, owned = {} }, E) {
  const c = E.CARDS[id];
  if (c === undefined || !GROUPS.includes(c.src)) return 0;
  if (c.src === 'drop') return Math.max(0, Math.floor(owned[id] ?? 0));
  return unlocked(c, levels) ? COPIES[c.src] : 0;
}

/** The cards of a group, as the builder lists them (milestones by level, then skill). */
export function groupCards(src, E) {
  const ids = Object.keys(E.CARDS).filter((id) => E.CARDS[id].src === src);
  if (src === 'milestone') ids.sort((a, b) => E.CARDS[a].lvl - E.CARDS[b].lvl || String(E.CARDS[a].skill).localeCompare(String(E.CARDS[b].skill)));
  return ids;
}

const countOf = (deck, id) => deck.reduce((n, x) => n + (x === id ? 1 : 0), 0);

/** A deck cut to what you may carry now: each card to its cap, in the order given. */
export function fitDeck(deck, have, E) {
  const left = {};
  const out = [];
  for (const id of Array.isArray(deck) ? deck : []) {
    if (left[id] === undefined) left[id] = capOf(id, have, E);
    if (left[id] > 0) { out.push(id); left[id] -= 1; }
  }
  return out;
}

/** Whether a deck can be carried: 15 to 25 cards, none past its cap. */
export const deckOk = (deck, have, E) => Array.isArray(deck) && deck.length >= E.DECK_MIN && deck.length <= E.DECK_MAX
  && fitDeck(deck, have, E).length === deck.length;

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
