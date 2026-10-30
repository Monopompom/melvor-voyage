// Encounters (design 4.33): bandits and pirates as a card game. The rules of one fight: the cards, the hidden tricks,
// the bands and their moves, the charms, the fight loop, the plain strategy that Auto-resolve plays and the sims and
// calibration built on it. Pure: no game globals, every random number from a seeded generator, so a fight replays
// exactly from its seed and its actions (a reload mid-fight). Texts are language keys: a log line or a move is
// `{ key, vars }`, where a var is a number, a key, a list of keys (read "a or b") or another `{ key, vars }`.

/** A seeded generator (mulberry32): the same seed gives the same fight. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MAX_ROUNDS = 6;
export const HAND = 5;
export const PLAYS = 3;
export const MAX_HAND = 8;
export const EDGE_MAX = 5;
/** A band's strength by tier when it does not scale to you (the sims' fixed strength). */
export const TIER_F = [0, 0.8, 0.95, 1.1, 1.25];
/** The dials: every band's Nerve and hits; a band's strength reaches each as S^exp. */
export const TUNE = { nerve: 1.4, hit: 2.6, exp: 0.45, combos: true };
export const RESOLVE = 30;
export const FOLK_RESOLVE = 22;
/** Battered: each loss takes this much Resolve from the next fights, up to BATTER_MAX losses. */
export const BATTER = 2;
export const BATTER_MAX = 3;
export const ATTACKS = ['strike', 'charge', 'volley', 'board', 'grab'];
const BLOWS = ['strike', 'charge', 'board'];
export const SUITS = ['steel', 'powder', 'coin', 'wits'];

// ---- keys -----------------------------------------------------------------------------------------------------------
const up = (id) => String(id).toUpperCase();
export const cardKey = (id) => `MOD_VOY_CARD_${up(id)}`;
export const cardTextKey = (id) => `MOD_VOY_CARD_${up(id)}_TEXT`;
export const trickKey = (id) => `MOD_VOY_TRICK_${up(id)}`;
export const trickTextKey = (id) => `MOD_VOY_TRICK_${up(id)}_TEXT`;
export const bandKey = (id) => `MOD_VOY_BAND_${up(id)}`;
export const charmKey = (id) => `MOD_VOY_CHARM_${up(id)}`;
export const charmTextKey = (id) => `MOD_VOY_CHARM_${up(id)}_TEXT`;
export const suitKey = (suit) => `MOD_VOY_SUIT_${up(suit)}`;
/** A suit combo's name (k = 2 or 3) or the mixed one's (suit 'mixed', k = 3 or 4); `_TEXT` after it for what it does. */
export const comboKey = (suit, k) => `MOD_VOY_COMBO_${up(suit)}_${k}`;
export const kindKey = (kind) => `MOD_VOY_ENC_KIND_${up(kind)}`;

const blowAhead = (s) => BLOWS.includes(s.intents[0].kind);

// ---- the cards ------------------------------------------------------------------------------------------------------
// src: starter, milestone (from the skill's level `lvl`), shop, drop, crafted (a supply: used up when played), ship,
// folk, curse. `n` the card's number (its skill tilts it ±1), `gp` a share of the toll in hundredths it costs, `quick`
// costs no play, `where` only at sea or on land. fx does it; ai is what the plain strategy reckons it is worth.
export const CARDS = {
  slash: { suit: 'steel', skill: 'Attack', src: 'starter', n: 4, fx: (s, n, c) => hit(s, n, c), ai: (s, n) => ({ dmg: n }) },
  parry: { suit: 'steel', skill: 'Defence', src: 'starter', n: 3,
    fx: (s, n, c) => { guard(s, n); if (blowAhead(s)) hit(s, 3, c); }, ai: (s, n) => ({ guard: n, dmg: blowAhead(s) ? 3 : 0 }) },
  holdfast: { suit: 'steel', skill: 'Defence', src: 'starter', n: 6, fx: (s, n) => guard(s, n), ai: (s, n) => ({ guard: n }) },
  pistol: { suit: 'powder', skill: 'Ranged', src: 'starter', n: 6,
    fx: (s, n, c) => { if (s.r() < 1 / 6) log(s, 'band', 'MOD_VOY_ENC_LOG_MISFIRE', { by: c.key }); else hit(s, n, c); }, ai: (s, n) => ({ dmg: n * 5 / 6 }) },
  purse: { suit: 'coin', skill: 'Thieving', src: 'starter', n: 4, gp: 2, fx: (s, n) => soften(s, n), ai: (s, n) => ({ soften: n }) },
  haggle: { suit: 'coin', skill: 'Township', src: 'starter', n: 3,
    fx: (s, n) => { coinHit(s, n); if (s.intents[0].kind === 'grab') callOff(s, 'MOD_VOY_ENC_WHY_HAGGLED'); },
    ai: (s, n) => ({ dmg: n * s.band.coinMul, calloff: s.intents[0].kind === 'grab' }) },
  feint: { suit: 'wits', skill: 'Agility', src: 'starter', n: 2, fx: (s, n) => { guard(s, n); draw(s, 1); }, ai: (s, n) => ({ guard: n, draw: 1 }) },
  read: { suit: 'wits', skill: 'Cartography', src: 'starter', n: 1, quick: true, fx: (s, n) => draw(s, n), ai: (s, n) => ({ draw: n }) },

  drive: { suit: 'steel', skill: 'Attack', lvl: 30, src: 'milestone', n: 3, finisher: true,
    fx: (s, n, c) => { const k = spendEdge(s); if (k) hit(s, n * k, c); }, ai: (s, n) => ({ dmg: n * s.edge }) },
  overwall: { suit: 'wits', skill: 'Agility', lvl: 60, src: 'milestone', where: 'land', fx: (s) => evade(s, ['strike']), ai: () => ({ evade: ['strike'] }) },
  cutstrings: { suit: 'coin', skill: 'Thieving', lvl: 60, src: 'milestone', n: 5,
    fx: (s, n) => { coinHit(s, n); s.bonusPct += 10; }, ai: (s, n) => ({ dmg: n * s.band.coinMul }) },
  shoulder: { suit: 'steel', skill: 'Strength', lvl: 30, src: 'milestone', n: 4,
    fx: (s, n, c) => hit(s, n, c, true), ai: (s, n) => ({ dmg: n + Math.min(2, s.band.guard) }) },
  aimed: { suit: 'powder', skill: 'Ranged', lvl: 60, src: 'milestone', n: 3,
    fx: (s, n, c) => hit(s, n + (s.cardsThisRound === 0 ? 3 : 0), c), ai: (s, n) => ({ dmg: n + (s.cardsThisRound === 0 ? 3 : 0) }) },
  standfirm: { suit: 'steel', skill: 'Defence', lvl: 90, src: 'milestone', n: 7,
    fx: (s, n) => { guard(s, n); s.you.carry = true; }, ai: (s, n) => ({ guard: n, keep: true }) },
  starread: { suit: 'wits', skill: 'Astrology', lvl: 30, src: 'milestone', quick: true, gp: 4, fx: (s) => reroll(s), ai: () => ({ reroll: true }) },
  warcry: { suit: 'steel', skill: 'Strength', lvl: 60, src: 'milestone', n: 4,
    fx: (s, n, c) => { hit(s, n, c); s.steelBonus += 1; }, ai: (s, n) => ({ dmg: n + 1 }) },
  silver: { suit: 'coin', skill: 'Voyage', lvl: 30, src: 'milestone', n: 5,
    fx: (s, n) => { coinHit(s, 3); soften(s, n); }, ai: (s, n) => ({ dmg: 3 * s.band.coinMul, soften: n }) },
  // Finishers spend your Edge, the combo points you build over rounds.
  coup: { suit: 'steel', skill: 'Attack', lvl: 90, src: 'milestone', n: 4, finisher: true,
    fx: (s, n, c) => { const k = spendEdge(s); if (k) hit(s, n * k, c, true); }, ai: (s, n) => ({ dmg: n * s.edge + Math.min(s.edge, s.band.guard) }) },
  chainshot: { suit: 'powder', skill: 'Ranged', lvl: 90, src: 'milestone', n: 4, finisher: true,
    fx: (s, n, c) => { const k = spendEdge(s); if (k) { hit(s, n * k, c); s.you.resolve = Math.max(1, s.you.resolve - k); log(s, 'band', 'MOD_VOY_ENC_LOG_RECOIL', { n: k }); } },
    ai: (s, n) => ({ dmg: (n - 0.5) * s.edge }) },
  calldebt: { suit: 'coin', skill: 'Thieving', lvl: 90, src: 'milestone', n: 4, finisher: true,
    fx: (s, n) => { const k = spendEdge(s); if (k) { coinHit(s, n * k); s.bonusPct += 5 * k; } }, ai: (s, n) => ({ dmg: n * s.edge * s.band.coinMul }) },
  masterplan: { suit: 'wits', skill: 'Cartography', lvl: 90, src: 'milestone', finisher: true,
    fx: (s, n, c) => { const k = spendEdge(s); if (k) draw(s, Math.min(3, k)); if (k >= 3) callOff(s, c.key); },
    ai: (s) => ({ draw: Math.min(3, s.edge), calloff: s.edge >= 3 }) },
  rally: { suit: 'steel', skill: 'Voyage', lvl: 60, src: 'milestone', n: 6, fx: (s, n) => heal(s, n), ai: (s, n) => ({ heal: n }) },

  bribe: { suit: 'coin', skill: 'Thieving', src: 'shop', n: 6, gp: 2,
    fx: (s, n) => { coinHit(s, n); if (s.intents[0].kind === 'call') callOff(s, 'MOD_VOY_ENC_WHY_LOOKOUT'); },
    ai: (s, n) => ({ dmg: n * s.band.coinMul, calloff: s.intents[0].kind === 'call' }) },
  keg: { suit: 'powder', skill: 'Firemaking', src: 'shop', n: 7,
    fx: (s, n) => { s.fuse += Math.round(n * suitMul(s.def, 'powder')); log(s, 'you', 'MOD_VOY_ENC_LOG_FUSE_LIT'); }, ai: (s, n) => ({ dmg: s.round < s.maxRounds ? n * 0.8 : 0 }) },
  hook: { suit: 'steel', skill: 'Strength', src: 'shop', where: 'sea', n: 3, fx: (s, n, c) => { hit(s, n, c); draw(s, 1); }, ai: (s, n) => ({ dmg: n, draw: 1 }) },
  hardport: { suit: 'wits', skill: 'Agility', src: 'shop', where: 'sea', n: 3,
    fx: (s, n) => { const k = s.intents[0].kind; guard(s, k === 'volley' || k === 'board' ? 2 * n : n); },
    ai: (s, n) => { const k = s.intents[0].kind; return { guard: k === 'volley' || k === 'board' ? 2 * n : n }; } },

  capcut: { suit: 'steel', skill: 'Attack', src: 'drop', n: 1, double: true, fx: (s, n, c) => hit(s, n, c), ai: (s, n) => ({ dmg: n }) },
  dice: { suit: 'coin', skill: 'Thieving', src: 'drop', quick: true, wild: true, gp: 4, fx: () => {}, ai: (s) => ({ wild: s.lastSuit ? s.suits[s.lastSuit] || 0 : 0 }) },

  hotmeal: { suit: 'steel', skill: 'Cooking', src: 'crafted', n: 12, fx: (s, n) => heal(s, n), ai: (s, n) => ({ heal: n }) },
  grapeshot: { suit: 'powder', skill: 'Smithing', src: 'crafted', n: 8,
    fx: (s, n, c) => { hit(s, n, c); s.you.resolve = Math.max(1, s.you.resolve - 1); }, ai: (s, n) => ({ dmg: n - 0.5 }) },
  smokepot: { suit: 'wits', skill: 'Crafting', src: 'crafted', fx: (s) => evade(s, ['strike', 'charge', 'board']), ai: () => ({ evade: ['strike', 'charge', 'board'] }) },
  bitter: { suit: 'wits', skill: 'Herblore', src: 'crafted', n: 3,
    fx: (s, n) => { s.band.weaken += n; log(s, 'you', 'MOD_VOY_ENC_LOG_BITTER', { n }); },
    ai: (s, n) => ({ soften: n, later: n * (s.maxRounds - s.round) }) },

  broadside: { suit: 'powder', src: 'ship', where: 'sea', n: 9, fx: (s, n, c) => hit(s, n, c), ai: (s, n) => ({ dmg: n }) },
  brace: { suit: 'steel', src: 'ship', where: 'sea', n: 7, fx: (s, n) => guard(s, n), ai: (s, n) => ({ guard: n }) },
  slip: { suit: 'wits', skill: 'Agility', src: 'folk', fx: (s) => evade(s), ai: () => ({ evade: ATTACKS }) },

  dread: { suit: null, src: 'curse', dead: true },
};
for (const [id, c] of Object.entries(CARDS)) { c.id = id; c.key = cardKey(id); }
/** A supply: used up when played (the crafted cards). */
export const SUPPLY = (id) => CARDS[id]?.src === 'crafted';

// ---- tricks ---------------------------------------------------------------------------------------------------------
// Set runs of cards, printed on no card: you find them by playing. A trick fires when its last card is played right
// after the others. The run carries over the end of a round; a round with no card played breaks it. An across trick
// needs the round to turn between its two cards: the last card of one round, then the first of the next. v: what the
// plain strategy reckons it is worth.
export const TRICKS = {
  feintcut: { seq: ['feint', 'slash'], suit: 'steel', v: 4, fx: (s, t) => hit(s, 3, t, true) },
  riposte: { seq: ['parry', 'slash'], suit: 'steel', v: 4, fx: (s, t) => hit(s, 4, t) },
  sweetener: { seq: ['purse', 'haggle'], suit: 'coin', v: 4, fx: (s) => coinHit(s, 4) },
  steadyaim: { seq: ['holdfast', 'pistol'], suit: 'powder', v: 3, fx: (s, t) => hit(s, 3, t) },
  smokesteel: { seq: ['pistol', 'slash'], suit: 'steel', v: 3, fx: (s) => guard(s, 3) },
  oldswitch: { seq: ['feint', 'purse', 'pistol'], suit: 'powder', v: 8, fx: (s, t) => callOff(s, t.key) },
  patient: { seq: ['holdfast', 'slash'], across: true, suit: 'steel', v: 4, fx: (s, t) => hit(s, 5, t) },
  shortfuse: { seq: ['keg', 'pistol'], suit: 'powder', v: 5,
    fx: (s) => { if (!s.fuse) return; const f = s.fuse; s.fuse = 0; hitBand(s, f); log(s, 'you', 'MOD_VOY_ENC_LOG_KEG_EARLY', { n: f }); } },
  shieldwall: { seq: ['holdfast', 'standfirm'], suit: 'steel', v: 4, fx: (s) => guard(s, 4) },
  rallycry: { seq: ['warcry', 'rally'], suit: 'steel', v: 4, fx: (s) => guard(s, 5) },
  silversteel: { seq: ['silver', 'shoulder'], suit: 'steel', v: 4, fx: (s, t) => hit(s, 4, t, true) },
  rooftops: { seq: ['overwall', 'aimed'], suit: 'powder', v: 4, fx: (s, t) => hit(s, 4, t) },
  rakedeck: { seq: ['hook', 'broadside'], suit: 'powder', v: 5, fx: (s, t) => hit(s, 5, t) },
  ambush: { seq: ['feint', 'aimed'], across: true, suit: 'powder', v: 5, fx: (s, t) => hit(s, 5, t) },
  lyinglow: { seq: ['standfirm', 'feint'], across: true, suit: 'wits', v: 4, fx: (s) => draw(s, 2) },
};
for (const [id, t] of Object.entries(TRICKS)) { t.id = id; t.key = trickKey(id); }
const TRICK_ORDER = Object.values(TRICKS).sort((a, b) => b.seq.length - a.seq.length);
/** The trick the last cards of a run make, if any. */
export function trickOf(ch) {
  for (const t of TRICK_ORDER) {
    const L = t.seq.length;
    if (ch.length < L) continue;
    const tail = ch.slice(-L);
    if (!tail.every((x, i) => x.id === t.seq[i])) continue;
    const ok = t.across ? tail[1].round === tail[0].round + 1 && tail.every((x, i) => !i || x.round === tail[1].round)
      : tail.every((x) => x.round === tail[0].round);
    if (ok) return t;
  }
  return null;
}
/** The trick playing card `id` now would fire, if any. */
export const trickIf = (s, id) => trickOf([...s.chain, { id, round: s.round }]);

// ---- bands ----------------------------------------------------------------------------------------------------------
// Base numbers at strength 1; every number but a Grab's share scales with the band's strength. `suits`: the matchup
// (×1.5 weak, ×0.6 tough, on damage, or on Nerve for Coin); `rattled`: each Wits card takes 2 Nerve; `flee`: at this
// share of Nerve they break and run (the chase); `hidden`: their move shows only after a Wits card that round.
export const BANDS = {
  highwaymen: {
    where: 'land', nerve: 55, suits: { coin: 0.6 }, rattled: true, flee: 0.2,
    moves: (s) => [
      [4, { kind: 'strike', n: 7 }],
      [3, { kind: 'grab', pct: 25, stop: 6 }],
      [s.band.nerve < s.band.max * 0.7 ? 3 : 0, { kind: 'call', n: 6, stop: 8 }],
      [1, { kind: 'brace', n: 5 }],
      [1, { kind: 'charge', n: 9 }],
    ],
  },
  deserters: {
    where: 'land', nerve: 24, suits: { steel: 0.6, powder: 1.5 },
    moves: (s, last) => (last && last.kind === 'brace' ? [[1, { kind: 'charge', n: 10 }]] : [
      [4, { kind: 'strike', n: 7 }],
      [2, { kind: 'brace', n: 6 }],
      [s.round >= 2 ? 1 : 0, { kind: 'call', n: 7, stop: 9 }],
    ]),
  },
  smugglers: {
    where: 'any', nerve: 33, suits: { coin: 1.5, steel: 0.6 }, startGuard: 4, flee: 0.25, keepGrabs: true,
    moves: () => [
      [3, { kind: 'grab', pct: 30, stop: 6 }],
      [4, { kind: 'strike', n: 8 }],
      [2, { kind: 'brace', n: 4 }],
    ],
  },
  corsairs: {
    where: 'sea', nerve: 30, suits: { steel: 0.6 }, rattled: true,
    moves: (s) => (s.round <= 1 && !s.intents.length ? [[1, { kind: 'volley', n: 7 }]] : [
      [3, { kind: 'volley', n: 7 }],
      [s.you.resolve <= s.you.max / 2 ? 4 : 1, { kind: 'board', n: 7, pct: 20 }],
      [1, { kind: 'call', n: 8, stop: 10 }],
      [2, { kind: 'strike', n: 8 }],
    ]),
  },
  cultists: {
    where: 'land', nerve: 39, suits: { coin: 0, powder: 1.5 },
    moves: (s) => (!s.intents.length ? [[1, { kind: 'hex', n: 2 }]] : [
      [s.hexes < 3 ? 2 : 0, { kind: 'hex', n: 2 }],
      [3, { kind: 'strike', n: 9 }],
      [s.band.nerve < s.band.max * 0.7 ? 2 : 0, { kind: 'taunt', n: 6 }],
      [1, { kind: 'charge', n: 12 }],
    ]),
  },
  wreckers: {
    where: 'any', nerve: 52, suits: { steel: 1.5, powder: 0.6 }, hidden: true, flee: 0.25, keepGrabs: true,
    moves: () => [
      [4, { kind: 'strike', n: 7 }],
      [3, { kind: 'grab', pct: 25, stop: 6 }],
      [2, { kind: 'charge', n: 10 }],
      [1, { kind: 'brace', n: 5 }],
    ],
  },
};
for (const [id, b] of Object.entries(BANDS)) { b.id = id; b.key = bandKey(id); }
export const suitMul = (def, suit) => (def.suits && def.suits[suit] != null ? def.suits[suit] : 1);
/** The bands of a ground ('land' or 'sea'). */
export const bandsOf = (where) => Object.keys(BANDS).filter((k) => BANDS[k].where === 'any' || BANDS[k].where === where);

// ---- charms ---------------------------------------------------------------------------------------------------------
// Passive rule-benders, three slots. Each is read where it bites (scaleMove, startRound, play, incoming, hurt, grabPct,
// bandAct, newFight, cardN). The trophies are one of a kind, a rare find from their band at tier 3 or 4; they work
// against every band, best against their own.
export const CHARMS = {
  albatross: {},
  compass: {},
  cape: {},
  relic: {},
  hat: {},
  mask: { trophy: 'highwaymen' },
  medal: { trophy: 'deserters' },
  ledger: { trophy: 'smugglers' },
  spyglass: { trophy: 'corsairs' },
  censer: { trophy: 'cultists' },
  lantern: { trophy: 'wreckers' },
};
for (const [id, c] of Object.entries(CHARMS)) { c.id = id; c.key = charmKey(id); }

// ---- effects --------------------------------------------------------------------------------------------------------
function log(s, t, key, vars = {}) { s.log.push({ t, key, vars, r: s.round }); }
function hitBand(s, n, pierce) {
  const b = s.band;
  let rest = n;
  if (!pierce && b.guard > 0) { const a = Math.min(b.guard, rest); b.guard -= a; rest -= a; }
  b.nerve = Math.max(0, b.nerve - rest);
  s.dealt += n;
  return rest;
}
/** Damage from a card, a combo or a trick (`c`: its suit and key); Steel's War Cry bonus and the matchup apply. */
function hit(s, n, c, pierce) {
  if (c && c.suit === 'steel') n += s.steelBonus;
  if (c && c.suit) n = Math.round(n * suitMul(s.def, c.suit));
  const got = hitBand(s, n, pierce);
  if (got < n) log(s, 'you', 'MOD_VOY_ENC_LOG_HIT_GUARD', { by: c.key, n, soak: n - got });
  else log(s, 'you', 'MOD_VOY_ENC_LOG_HIT', { by: c.key, n });
}
function coinHit(s, n) {
  const m = Math.round(n * s.band.coinMul);
  if (!m) { log(s, 'you', 'MOD_VOY_ENC_LOG_COIN_NONE'); return; }
  const got = hitBand(s, m);
  if (got < m) log(s, 'you', 'MOD_VOY_ENC_LOG_COIN_GUARD', { n: m, soak: m - got });
  else log(s, 'you', 'MOD_VOY_ENC_LOG_COIN', { n: m });
}
function gainEdge(s, k) {
  if (!s.hasFinisher) return; // no finisher to spend it: no Edge kept
  const was = s.edge;
  s.edge = Math.min(EDGE_MAX, s.edge + k);
  if (s.edge > was) log(s, 'you', 'MOD_VOY_ENC_LOG_EDGE', { n: s.edge });
}
function spendEdge(s) {
  const k = s.edge;
  s.edge = 0;
  if (k) log(s, 'you', 'MOD_VOY_ENC_LOG_EDGE_SPEND', { n: k });
  else log(s, 'you', 'MOD_VOY_ENC_LOG_EDGE_NONE');
  return k;
}
function guard(s, n) { s.you.guard += n; log(s, 'you', 'MOD_VOY_ENC_LOG_GUARD', { n, total: s.you.guard }); }
function soften(s, n) { s.soften.push(n); log(s, 'you', 'MOD_VOY_ENC_LOG_SOFTEN', { n }); }
function heal(s, n) { const h = Math.min(n, s.you.max - s.you.resolve); s.you.resolve += h; log(s, 'you', 'MOD_VOY_ENC_LOG_HEAL', { n: h }); }
function evade(s, kinds) {
  // dodges add up: a second one this round widens what misses, never narrows it
  s.evadeKinds = [...new Set([...(s.evade ? s.evadeKinds : []), ...(kinds || ATTACKS)])];
  s.evade = true;
  if (kinds) log(s, 'you', 'MOD_VOY_ENC_LOG_EVADE', { kinds: kinds.map(kindKey) });
  else log(s, 'you', 'MOD_VOY_ENC_LOG_EVADE_ANY');
}
const evades = (s) => s.evade && s.evadeKinds.includes(s.intents[0].kind);
/** What you can see of their move: null while a hidden band's move is unread this round. */
export const seen = (s) => (s.def.hidden && !s.revealed && s.phase === 'fight' ? null : s.intents[0]);
function callOff(s, why) { s.calledOff = true; log(s, 'you', 'MOD_VOY_ENC_LOG_CALLOFF', { by: why }); }
function draw(s, k) {
  for (let i = 0; i < k; i++) {
    if (s.hand.length >= MAX_HAND) break;
    if (!s.drawPile.length) {
      if (!s.discard.length) break;
      s.drawPile = shuffle(s, s.discard); s.discard = [];
      log(s, 'sys', 'MOD_VOY_ENC_LOG_RESHUFFLE');
    }
    s.hand.push(s.drawPile.pop());
  }
}
function shuffle(s, a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(s.r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function reroll(s) {
  const cur = s.intents[0];
  const opts = s.def.moves(s, s.prevIntent).filter(([w, m]) => w > 0 && m.kind !== cur.kind);
  if (!opts.length) { log(s, 'you', 'MOD_VOY_ENC_LOG_NO_OTHER_MOVE'); return; }
  s.intents[0] = scaleMove(s, pick(s, opts));
  log(s, 'you', 'MOD_VOY_ENC_LOG_READ_NEXT', { move: moveText(s, s.intents[0]).head });
}

// ---- the band's moves -----------------------------------------------------------------------------------------------
function pick(s, opts) {
  const tot = opts.reduce((a, [w]) => a + w, 0);
  let x = s.r() * tot;
  for (const [w, m] of opts) { if ((x -= w) < 0) return m; }
  return opts[opts.length - 1][1];
}
function scaleMove(s, m) {
  const sc = (v) => Math.max(1, Math.round(v * Math.pow(s.S, TUNE.exp)));
  const o = { ...m };
  if (o.n != null && o.kind !== 'hex') o.n = Math.max(1, Math.round(o.n * Math.pow(s.S, TUNE.exp) * (o.kind === 'taunt' || o.kind === 'call' ? TUNE.nerve : TUNE.hit)));
  if (o.stop != null) o.stop = sc(o.stop);
  if (o.kind === 'hex' && s.charms.has('censer')) o.n = Math.max(1, o.n - 1);
  if (o.kind === 'taunt' && s.charms.has('censer')) o.n = Math.max(1, Math.ceil(o.n / 2));
  return o;
}
function nextMove(s) {
  const last = s.intents.length ? s.intents[s.intents.length - 1] : s.prevIntent;
  let opts = s.def.moves(s, last).filter(([w]) => w > 0);
  // no Brace, Call or Hex twice in a row
  if (last && ['brace', 'call', 'hex'].includes(last.kind) && opts.length > 1) {
    const f = opts.filter(([, m]) => m.kind !== last.kind);
    if (f.length) opts = f;
  }
  return scaleMove(s, pick(s, opts));
}
/** A move as the fight shows it: `{ head, sub }`, each `{ key, vars }`. */
export function moveText(s, m) {
  const b = s.band;
  const plus = b.bonus - b.weaken;
  const pn = (n) => Math.max(0, n + plus);
  const k = (key, vars = {}) => ({ key, vars });
  switch (m.kind) {
    case 'strike': return { head: k('MOD_VOY_ENC_MOVE_STRIKE', { n: pn(m.n) }), sub: k('MOD_VOY_ENC_MOVE_STRIKE_SUB') };
    case 'charge': return { head: k('MOD_VOY_ENC_MOVE_CHARGE', { n: pn(m.n) }), sub: k('MOD_VOY_ENC_MOVE_CHARGE_SUB') };
    case 'volley': return { head: k('MOD_VOY_ENC_MOVE_VOLLEY', { n: pn(m.n) }), sub: k(s.charms.has('spyglass') ? 'MOD_VOY_ENC_MOVE_VOLLEY_SUB_SPYGLASS' : 'MOD_VOY_ENC_MOVE_VOLLEY_SUB') };
    case 'board': return { head: k('MOD_VOY_ENC_MOVE_BOARD', { n: pn(m.n), gp: grabAmt(s, m.pct) }), sub: k('MOD_VOY_ENC_MOVE_BOARD_SUB', { pct: grabPct(s, m.pct) }) };
    case 'grab': return { head: k('MOD_VOY_ENC_MOVE_GRAB', { gp: grabAmt(s, m.pct) }), sub: k('MOD_VOY_ENC_MOVE_GRAB_SUB', { pct: grabPct(s, m.pct), stop: m.stop }) };
    case 'call': return { head: k(m.n >= 8 ? 'MOD_VOY_ENC_MOVE_CALL_THREE' : 'MOD_VOY_ENC_MOVE_CALL_TWO'), sub: k('MOD_VOY_ENC_MOVE_CALL_SUB', { n: m.n, stop: m.stop }) };
    case 'brace': return { head: k('MOD_VOY_ENC_MOVE_BRACE', { n: m.n }), sub: k('MOD_VOY_ENC_MOVE_BRACE_SUB') };
    case 'hex': return { head: k('MOD_VOY_ENC_MOVE_HEX', { n: m.n }), sub: k('MOD_VOY_ENC_MOVE_HEX_SUB') };
    case 'taunt': return { head: k('MOD_VOY_ENC_MOVE_TAUNT', { n: m.n }), sub: k('MOD_VOY_ENC_MOVE_TAUNT_SUB') };
    case 'flee': return { head: k('MOD_VOY_ENC_MOVE_FLEE'), sub: k('MOD_VOY_ENC_MOVE_FLEE_SUB') };
    default: return { head: k('MOD_VOY_ENC_MOVE_STRIKE', { n: m.n ?? 0 }), sub: k('MOD_VOY_ENC_MOVE_STRIKE_SUB') };
  }
}

// ---- a fight --------------------------------------------------------------------------------------------------------
/**
 * opt: { band, tier, seed, strength?, deck: [card ids], where: 'land'|'sea', cannons, hull, charms: [ids], tilt:
 * { skill: ±1 }, gp, toll, battered, folk, know: [trick ids] or 'all', learn }. Without `strength` the band has the
 * tier's fixed strength × a random 0.8 to 1.2.
 */
export function newFight(opt) {
  const r = rng(opt.seed || 1);
  const def = BANDS[opt.band];
  const S = opt.strength || TIER_F[opt.tier] * (0.8 + 0.4 * r());
  const charms = new Set(opt.charms || []);
  const max = (opt.folk ? FOLK_RESOLVE : RESOLVE) + (charms.has('hat') ? 3 : 0) - BATTER * Math.min(BATTER_MAX, opt.battered || 0);
  const s = {
    r, opt, def, S, charms, uid: 0,
    band: { key: def.key, nerve: 0, max: 0, guard: def.startGuard ? Math.round(def.startGuard * S) : 0, bonus: 0, weaken: 0, coinMul: suitMul(def, 'coin') },
    you: { resolve: max, max, guard: charms.has('relic') ? 5 : 0, carry: false },
    drawPile: [], hand: [], discard: [], gone: [],
    round: 0, maxRounds: MAX_ROUNDS, plays: PLAYS, suits: {}, cardsThisRound: 0, dealt: 0,
    soften: [], evade: false, evadeKinds: [], calledOff: false, outfoxed: false, steelBonus: 0, fuse: 0,
    gp: opt.gp || 0, toll: opt.toll || 0, grabbed: 0, spent: 0, bonusPct: 0, used: {}, hexes: 0,
    intents: [], prevIntent: null, log: [], over: null, phase: 'fight',
    edge: 0, chain: [], found: [], lastTrick: null, learn: !!opt.learn,
    know: new Set(opt.know === 'all' ? Object.keys(TRICKS) : opt.know || []),
  };
  s.band.nerve = s.band.max = Math.round(def.nerve * Math.pow(S, TUNE.exp) * TUNE.nerve);
  const ids = (opt.deck || []).filter((id) => CARDS[id] !== undefined);
  if (opt.where === 'sea') {
    for (let i = 0; i < (opt.cannons || 0); i++) ids.push('broadside');
    if (opt.hull) ids.push('brace');
  }
  s.hasFinisher = ids.some((id) => CARDS[id].finisher);
  s.drawPile = shuffle(s, ids.map((id) => ({ uid: ++s.uid, id })));
  s.intents.push(nextMove(s));
  s.intents.push(nextMove(s));
  startRound(s);
  return s;
}

/** How much a card's skill tilts it (±1 against your average level). */
export function tiltOf(s, id) {
  const d = CARDS[id];
  return (d.skill && s?.opt?.tilt?.[d.skill]) || 0;
}
/** A card's number in this fight, or null for a card without one. */
export function cardN(s, c) {
  const d = CARDS[c.id];
  if (d.n == null) return null;
  let n = d.n + tiltOf(s, c.id);
  if (d.skill === 'Defence' && s.charms.has('cape')) n += 1;
  return Math.max(1, n);
}

function startRound(s) {
  if (s.round > 0 && !s.cardsThisRound) s.chain = [];
  s.round += 1;
  s.plays = PLAYS; s.suits = {}; s.cardsThisRound = 0; s.dealt = 0;
  s.evade = false; s.calledOff = false; s.outfoxed = false; s.steelBonus = 0; s.lastSuit = null;
  s.mixed = 0; s.tossed = false; s.revealed = s.charms.has('lantern');
  log(s, 'sys', 'MOD_VOY_ENC_LOG_ROUND', { n: s.round, of: s.maxRounds });
  if (s.fuse) {
    const f = s.fuse; s.fuse = 0;
    hitBand(s, f);
    s.dealt -= f; // the keg belongs to last round
    log(s, 'you', 'MOD_VOY_ENC_LOG_KEG', { n: f });
    if (checkWin(s)) return;
  }
  draw(s, Math.max(0, (s.round === 1 && s.charms.has('albatross') ? HAND + 1 : HAND) - s.hand.length));
}

/** Whether the card at hand index `i` can be played: `{ ok }` or `{ ok: false, why: key }`. */
export function canPlay(s, i) {
  if (s.over) return { ok: false, why: 'MOD_VOY_ENC_WHY_OVER' };
  const c = s.hand[i];
  if (c === undefined) return { ok: false, why: 'MOD_VOY_ENC_WHY_OVER' };
  const d = CARDS[c.id];
  if (d.dead) return { ok: false, why: 'MOD_VOY_ENC_WHY_DREAD' };
  if (d.where && d.where !== s.opt.where) return { ok: false, why: d.where === 'sea' ? 'MOD_VOY_ENC_WHY_SEA' : 'MOD_VOY_ENC_WHY_LAND' };
  if (!d.quick && s.plays < 1) return { ok: false, why: 'MOD_VOY_ENC_WHY_PLAYS' };
  return { ok: true };
}

/** The GP a card costs now (Coin cards: a share of the toll, never more than you carry; nothing with the Ledger). */
export function cardCost(s, id) {
  const d = CARDS[id];
  if (!d.gp || s.charms.has('ledger')) return 0;
  return Math.min(s.gp, Math.round(s.toll * d.gp / 100));
}

/** Plays the card at hand index `i`. */
export function play(s, i) {
  const chk = canPlay(s, i);
  if (!chk.ok) return chk;
  const c = s.hand.splice(i, 1)[0];
  const d = CARDS[c.id];
  if (!d.quick) s.plays -= 1;
  const cost = cardCost(s, c.id);
  if (cost) { s.gp -= cost; s.spent += cost; log(s, 'you', 'MOD_VOY_ENC_LOG_COST', { by: d.key, gp: cost }); }
  d.fx(s, cardN(s, c), d);
  s.cardsThisRound += 1;
  if (SUPPLY(c.id)) { s.gone.push(c); s.used[c.id] = (s.used[c.id] || 0) + 1; } else s.discard.push(c);
  if (d.suit === 'wits') {
    if (s.def.hidden && !s.revealed) { s.revealed = true; log(s, 'you', 'MOD_VOY_ENC_LOG_READ_HIDDEN', { move: moveText(s, s.intents[0]).head }); }
    if (s.def.rattled && s.phase !== 'press') { hitBand(s, 2); log(s, 'you', 'MOD_VOY_ENC_LOG_RATTLED', { n: 2 }); }
    const k = s.hand.findIndex((h) => h.id === 'dread');
    if (k >= 0) { s.gone.push(s.hand.splice(k, 1)[0]); log(s, 'you', 'MOD_VOY_ENC_LOG_DREAD_SHAKE'); }
  }
  const lucky = d.wild && s.r() < 0.5;
  if (d.wild) log(s, 'you', lucky ? 'MOD_VOY_ENC_LOG_DICE_EVEN' : 'MOD_VOY_ENC_LOG_DICE_ODD');
  const suit = d.wild ? (lucky && s.lastSuit) || d.suit : d.suit;
  const prev = s.suits[suit] || 0;
  const now = prev + (d.double ? 2 : 1);
  s.suits[suit] = now;
  s.lastSuit = suit;
  if (TUNE.combos) {
    for (const k of [2, 3]) if (prev < k && now >= k) combo(s, suit, k);
    const kinds = Object.keys(s.suits).filter((k) => SUITS.includes(k) && s.suits[k] > 0).length;
    if (kinds >= 3 && s.mixed < 3) mixedCombo(s, 3);
    if (kinds >= 4 && s.mixed < 4) mixedCombo(s, 4);
  }
  s.chain.push({ id: c.id, round: s.round });
  if (s.chain.length > 3) s.chain.shift();
  const tr = trickOf(s.chain);
  if (tr) {
    const first = !s.know.has(tr.id) && !s.found.includes(tr.id);
    if (first) s.found.push(tr.id);
    if (s.learn) s.know.add(tr.id);
    log(s, 'combo', first ? 'MOD_VOY_ENC_LOG_TRICK_NEW' : 'MOD_VOY_ENC_LOG_TRICK', { by: tr.key, text: trickTextKey(tr.id) });
    s.lastTrick = { id: tr.id, round: s.round, first };
    tr.fx(s, tr);
    gainEdge(s, tr.seq.length - 1);
  }
  checkWin(s);
  return { ok: true };
}

function combo(s, suit, k) {
  const key = comboKey(suit, k);
  log(s, 'combo', 'MOD_VOY_ENC_LOG_COMBO', { suit: suitKey(suit), k, by: key });
  const src = { key, suit };
  if (suit === 'steel') hit(s, k === 2 ? 2 : 6, src);
  else if (suit === 'powder') {
    hit(s, k === 2 ? 3 : 8, src);
    if (k === 3) { s.you.resolve = Math.max(1, s.you.resolve - 2); log(s, 'band', 'MOD_VOY_ENC_LOG_BARRAGE', { n: 2 }); }
  } else if (suit === 'coin') { if (k === 2) soften(s, 3); else callOff(s, key); }
  else if (suit === 'wits') { if (k === 2) draw(s, 1); else { s.outfoxed = true; log(s, 'you', 'MOD_VOY_ENC_LOG_OUTFOX_SET'); } }
  gainEdge(s, 1);
}

function mixedCombo(s, k) {
  s.mixed = k;
  const key = comboKey('mixed', k);
  log(s, 'combo', 'MOD_VOY_ENC_LOG_MIXED', { k, by: key });
  if (k === 3) { hit(s, 2, { key }); guard(s, 2); } else { hit(s, 4, { key }); draw(s, 1); }
  gainEdge(s, 1);
}

/** Once a round, a card from your hand to the discards (not Dread). */
export function toss(s, i) {
  const c = s.hand[i];
  if (s.over || s.tossed || !c || CARDS[c.id].dead) return { ok: false };
  s.hand.splice(i, 1); s.discard.push(c); s.tossed = true;
  log(s, 'you', 'MOD_VOY_ENC_LOG_TOSS', { by: CARDS[c.id].key });
  return { ok: true };
}

function checkWin(s) {
  if (s.band.nerve <= 0 && !s.over) {
    log(s, 'end', s.phase === 'press' ? 'MOD_VOY_ENC_LOG_WIN_PRESS' : s.phase === 'chase' ? 'MOD_VOY_ENC_LOG_WIN_CHASE' : 'MOD_VOY_ENC_LOG_WIN');
    s.over = s.phase === 'press' ? 'presswin' : 'win';
    return true;
  }
  return false;
}

/** What a blow would take off your Resolve, as things stand now. */
export function incoming(s, m, guardNow) {
  const b = s.band;
  let n = m.n + b.bonus - b.weaken - (s.soften[0] || 0);
  n = Math.max(0, n);
  const g = m.kind === 'volley' && !s.charms.has('spyglass') ? Math.floor(guardNow / 2) : guardNow;
  return Math.max(0, n - g);
}

function hurt(s, m) {
  const b = s.band;
  let n = m.n + b.bonus - b.weaken;
  if (s.soften.length) n -= s.soften.shift();
  n = Math.max(0, n);
  const eff = m.kind === 'volley' && !s.charms.has('spyglass') ? Math.floor(s.you.guard / 2) : s.you.guard;
  const a = Math.min(eff, n);
  s.you.guard -= a;
  const got = n - a;
  s.you.resolve = Math.max(0, s.you.resolve - got);
  if (a) log(s, 'band', 'MOD_VOY_ENC_LOG_HURT_GUARD', { move: kindKey(m.kind), n, blocked: a, got });
  else log(s, 'band', 'MOD_VOY_ENC_LOG_HURT', { move: kindKey(m.kind), n, got });
  if (got > 0 && s.edge) { s.edge = Math.floor(s.edge / 2); log(s, 'band', 'MOD_VOY_ENC_LOG_EDGE_KNOCK', { n: s.edge }); }
  return got;
}
/** A Grab's share of the toll (the Mask halves it), and the GP it takes now (never more than you carry). */
export const grabPct = (s, pct) => (s.charms.has('mask') ? pct / 2 : pct);
export const grabAmt = (s, pct) => Math.min(s.gp, Math.round(s.toll * grabPct(s, pct) / 100));
function grab(s, pct) {
  const amt = grabAmt(s, pct);
  s.gp -= amt; s.grabbed += amt;
  log(s, 'band', 'MOD_VOY_ENC_LOG_GRAB', { gp: amt });
}

function bandAct(s) {
  const m = s.intents[0];
  const b = s.band;
  if (m.kind === 'flee') { log(s, 'band', 'MOD_VOY_ENC_LOG_FLEE_RUN'); return; }
  if (s.calledOff) { log(s, 'band', 'MOD_VOY_ENC_LOG_HOLD_BACK'); return; }
  if (m.stop && m.kind === 'call' && s.dealt >= m.stop) { log(s, 'band', 'MOD_VOY_ENC_LOG_CALL_CUT'); return; }
  const attack = ATTACKS.includes(m.kind);
  if (attack && s.outfoxed) {
    if (m.n) { const got = hitBand(s, m.n + b.bonus); log(s, 'you', 'MOD_VOY_ENC_LOG_OUTFOX_HIT', { move: kindKey(m.kind), n: got }); checkWin(s); }
    else log(s, 'you', 'MOD_VOY_ENC_LOG_OUTFOX_EMPTY');
    return;
  }
  if (attack && evades(s)) { log(s, 'band', 'MOD_VOY_ENC_LOG_MISS'); return; }
  switch (m.kind) {
    case 'strike': case 'charge': case 'volley': hurt(s, m); break;
    case 'board': if (hurt(s, m) > 0) grab(s, m.pct); else log(s, 'band', 'MOD_VOY_ENC_LOG_THROWN_BACK'); break;
    case 'grab':
      if (s.you.guard >= m.stop) log(s, 'band', 'MOD_VOY_ENC_LOG_GRAB_HELD', { n: s.you.guard });
      else grab(s, m.pct);
      break;
    case 'call': b.nerve += m.n; b.max += m.n; b.bonus += 1; log(s, 'band', 'MOD_VOY_ENC_LOG_CALL', { n: m.n }); break;
    case 'brace':
      b.guard += m.n; log(s, 'band', 'MOD_VOY_ENC_LOG_BRACE', { n: b.guard });
      if (s.charms.has('medal') && s.you.guard > 0) { s.you.carry = true; log(s, 'you', 'MOD_VOY_ENC_LOG_MEDAL', { by: charmKey('medal'), n: s.you.guard }); }
      break;
    case 'hex':
      for (let i = 0; i < m.n; i++) s.discard.push({ uid: ++s.uid, id: 'dread' });
      s.hexes += 1;
      log(s, 'band', 'MOD_VOY_ENC_LOG_HEX', { n: m.n });
      break;
    case 'taunt': { const h = Math.min(m.n, b.max - b.nerve); b.nerve += h; log(s, 'band', 'MOD_VOY_ENC_LOG_PRAY', { n: h }); break; }
    default: break;
  }
}

/** Ends the round: the band acts, then the chase check, the round limit and the next round. */
export function endRound(s) {
  if (s.over) return;
  bandAct(s);
  if (s.over) return;
  if (s.you.resolve <= 0) {
    s.over = s.phase === 'press' ? 'presslose' : 'lose';
    log(s, 'end', 'MOD_VOY_ENC_LOG_LOSE');
    return;
  }
  // Beaten low, they break and run: one more round to run them down. They don't fight back.
  if (s.def.flee && s.phase === 'fight' && s.band.nerve <= s.def.flee * s.band.max) {
    s.phase = 'chase'; s.chaseFrom = s.round;
    s.band.guard = 0; s.you.guard = 0; s.you.carry = false;
    s.intents = [{ kind: 'flee' }, { kind: 'flee' }];
    s.maxRounds = s.round + 1;
    log(s, 'end', 'MOD_VOY_ENC_LOG_CHASE', { n: s.band.nerve });
    startRound(s);
    return;
  }
  if (s.you.carry) s.you.carry = false; else s.you.guard = 0;
  if (s.round >= s.maxRounds) {
    s.over = s.phase === 'press' ? 'presslose' : s.phase === 'chase' ? 'fled' : 'draw';
    log(s, 'end', s.phase === 'press' ? 'MOD_VOY_ENC_LOG_PRESS_LOSE'
      : s.phase === 'chase' ? (s.def.keepGrabs ? 'MOD_VOY_ENC_LOG_AWAY_GRABS' : 'MOD_VOY_ENC_LOG_AWAY')
        : 'MOD_VOY_ENC_LOG_DRAW');
    return;
  }
  s.prevIntent = s.intents.shift();
  s.intents.push(nextMove(s));
  startRound(s);
}

/** Press on: one more round against their captain (after a win). */
export function pressOn(s) {
  const sc = (v) => Math.max(1, Math.round(v * s.S));
  s.phase = 'press';
  s.over = null;
  s.band = { key: `${s.def.key}_CAPTAIN`, nerve: sc(13), max: sc(13), guard: 0, bonus: 0, weaken: 0, coinMul: suitMul(s.def, 'coin') };
  s.intents = [{ kind: 'charge', n: sc(12) }, { kind: 'charge', n: sc(12) }];
  s.soften = [];
  s.maxRounds = s.round + 1;
  log(s, 'sys', 'MOD_VOY_ENC_LOG_PRESS');
  startRound(s);
}

/**
 * A fight replayed from its options and the actions taken so far (a reload mid-fight): each action is
 * `['p', handIndex]` (play), `['t', handIndex]` (toss), `['e']` (end round) or `['o']` (press on).
 */
export function replay(opt, actions = []) {
  const s = newFight(opt);
  for (const [a, i] of actions) {
    if (a === 'p') play(s, i);
    else if (a === 't') toss(s, i);
    else if (a === 'e') endRound(s);
    else if (a === 'o') pressOn(s);
  }
  return s;
}

// ---- the plain strategy (Auto-resolve, the Hint and the sims) -------------------------------------------------------
/** What the plain strategy reckons playing hand card `i` is worth now. */
export function aiValue(s, i) {
  const c = s.hand[i];
  const d = CARDS[c.id];
  const n = cardN(s, c);
  const m = seen(s) || scaleMove(s, { kind: 'strike', n: 8 });
  const b = s.band;
  const e = d.ai ? d.ai(s, n) : {};
  if (d.finisher) {
    const kills = e.dmg && e.dmg >= b.nerve + b.guard;
    if (!s.edge || !(s.edge >= 3 || kills || s.round >= s.maxRounds || s.phase === 'press')) return 0;
  }
  const attack = ATTACKS.includes(m.kind) && !s.calledOff && !evades(s);
  const threat = attack && m.n ? incoming(s, m, s.you.guard) : 0;
  let v = 0;
  if (e.dmg) {
    const nerveLeft = b.nerve + b.guard;
    v += e.dmg + (e.dmg >= nerveLeft ? 40 : 0);
    if (m.kind === 'call' && !s.calledOff && s.dealt < m.stop && s.dealt + e.dmg >= m.stop) v += 6;
  }
  if (e.guard) {
    if (m.kind === 'grab' && !s.calledOff && s.you.guard < m.stop) v += s.you.guard + e.guard >= m.stop ? 6 : 1;
    v += Math.min(e.guard, threat) * 1.1 + (e.keep ? 1 : 0);
  }
  if (e.soften) v += attack ? Math.min(e.soften, threat) : e.soften * 0.4;
  if (e.later) v += e.later * 0.3;
  if (e.heal) v += Math.min(e.heal, s.you.max - s.you.resolve) * (s.you.resolve < s.you.max * 0.6 ? 1 : 0.3);
  if (e.draw) v += e.draw * 2;
  if (e.evade && e.evade.includes(m.kind)) v += attack ? threat * 1.2 + (m.kind === 'grab' ? 6 : 0) : 0;
  if (e.calloff) v += 8;
  if (e.wild === 1 || e.wild === 2) v += e.wild === 1 ? 2 : 3.5;
  if (e.reroll) v += threat >= 6 || m.kind === 'call' ? 5 : 0;
  if (d.gp && !s.charms.has('ledger')) v -= 1;
  if (d.suit === 'wits' && s.def.hidden && !s.revealed) v += 3;
  if (d.suit === 'wits' && s.def.rattled) v += 2;
  if (e.dmg && (d.suit === 'steel' || d.suit === 'powder')) v += e.dmg * (suitMul(s.def, d.suit) - 1);
  const kinds = Object.keys(s.suits).filter((k) => SUITS.includes(k) && s.suits[k] > 0);
  if (d.suit && !kinds.includes(d.suit) && kinds.length >= 2 && kinds.length <= 3) v += kinds.length === 2 ? 3.5 : 4;
  const had = s.suits[d.suit] || 0;
  if (!d.quick && (had === 1 || had === 2)) v += had * 2.5;
  if (d.quick && v > 0) v += 1;
  // keep your Edge: a blow that lands halves it
  if (s.edge >= 2 && threat > 0 && ((e.guard || 0) >= threat || (e.evade && e.evade.includes(m.kind)))) v += s.edge * 0.6;
  v += trickValue(s, c, d);
  return v;
}
/** The tricks the strategy knows: one this card fires, or one it starts with the rest in hand. */
function trickValue(s, c, d) {
  const tr = trickIf(s, c.id);
  if (tr) return s.know.has(tr.id) ? tr.v + 1.5 * (tr.seq.length - 1) : 0;
  let v = 0;
  const rest = s.hand.filter((h) => h !== c).map((h) => h.id);
  const left = s.plays - (d.quick ? 0 : 1);
  for (const t of TRICK_ORDER) {
    if (!s.know.has(t.id)) continue;
    if (t.across) { if (t.seq[0] === c.id && !d.quick && left === 0) v = Math.max(v, rest.includes(t.seq[1]) ? 2.5 : 1.5); continue; }
    for (let p = 0; p < t.seq.length - 1; p++) {
      if (t.seq[p] !== c.id) continue;
      const pre = s.chain.slice(s.chain.length - p);
      if (p && !(pre.length === p && pre.every((x, i) => x.id === t.seq[i] && x.round === s.round))) continue;
      const need = t.seq.slice(p + 1);
      const pool = rest.slice();
      if (!need.every((id) => { const k = pool.indexOf(id); if (k < 0) return false; pool.splice(k, 1); return true; })) continue;
      if (need.filter((id) => !CARDS[id].quick).length > left) continue;
      v = Math.max(v, 2 + p);
    }
  }
  return v;
}
/** The card the plain strategy would play next (a hand index), or -1 when it would end the round. */
export function aiPick(s) {
  let best = 0.5;
  let bi = -1;
  for (let i = 0; i < s.hand.length; i++) {
    if (!canPlay(s, i).ok) continue;
    const v = aiValue(s, i);
    if (v > best) { best = v; bi = i; }
  }
  return bi;
}
/** The card the plain strategy would toss (a hand index), or -1. */
export function aiToss(s) {
  if (s.over || s.tossed || !s.hand.length) return -1;
  let wi = -1;
  let wv = 1;
  s.hand.forEach((c, i) => {
    const d = CARDS[c.id];
    if (d.dead || d.finisher) return;
    const v = d.where && d.where !== s.opt.where ? -1 : aiValue(s, i);
    if (v < wv) { wv = v; wi = i; }
  });
  return wi;
}
/** Plays the rest of a round the plain way; `act(a, i)` hears each action (to record it). */
export function aiRound(s, act = () => {}) {
  for (let guardLoop = 0; guardLoop < 20 && !s.over; guardLoop++) {
    const bi = aiPick(s);
    if (bi < 0) break;
    act('p', bi);
    play(s, bi);
  }
  // toss a dead card, else the weakest one if it is worth little
  const wi = aiToss(s);
  if (wi >= 0) { act('t', wi); toss(s, wi); }
}
export function autoFight(opt) {
  const s = newFight(opt);
  while (!s.over) { aiRound(s); endRound(s); }
  return s;
}
/**
 * Win chance of the plain strategy against a band of a known strength, over `n` seeded fights. left: for each loss,
 * the share of their Nerve still standing (what they take is the stake times it); drawLeft the same for draws.
 */
export function odds(opt, n) {
  let win = 0;
  let draw = 0;
  let lose = 0;
  let fled = 0;
  let chased = 0;
  const left = [];
  const drawLeft = [];
  for (let k = 0; k < n; k++) {
    const s = autoFight({ ...opt, seed: (opt.seed || 7) * 7919 + k * 104729 });
    if (s.chaseFrom) chased++;
    if (s.over === 'win') win++; else if (s.over === 'fled') fled++;
    else if (s.over === 'draw') { draw++; drawLeft.push(s.band.nerve / s.band.max); }
    else { lose++; left.push(s.band.nerve / s.band.max); }
  }
  return { win: win / n, fled: fled / n, draw: draw / n, lose: lose / n, left, drawLeft, chased: chased / n };
}

/** What the plain strategy wins at each tier when the bands scale to you. */
export const TARGET = [0, 0.65, 0.47, 0.31, 0.19];
/**
 * The band scales with you: the strength at which the plain strategy wins the tier's share with this deck, charms
 * and skills, against every band of that ground (so a band your deck is good against stays easier). Supplies and
 * Battered are left out, so they still count. A generator: each `next()` runs one band's fights at one step of the
 * search, so the game can spread the work over frames; the return value is the strength.
 */
export function* calibration(opt, n = 400, bands = undefined, steps = 9) {
  const base = { ...opt, deck: (opt.deck || []).filter((id) => !SUPPLY(id)), battered: 0, folk: null };
  const list = bands || [opt.band];
  let lo = 0.2;
  let hi = 5;
  for (let i = 0; i < steps; i++) {
    const mid = Math.sqrt(lo * hi);
    let w = 0;
    for (const band of list) {
      const o = odds({ ...base, band, strength: mid }, Math.ceil(n / list.length));
      w += o.win + o.fled; // a band that gets away is beaten: you lose nothing and pick up half their purse
      yield;
    }
    if (w / list.length > TARGET[opt.tier]) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
/** calibration run to its end at once (the sims and tests). */
export function calibrate(opt, n, bands, steps) {
  const it = calibration(opt, n, bands, steps);
  for (;;) { const x = it.next(); if (x.done) return x.value; }
}

/** The plain starter deck (15) and a Folk's own small deck before its traits. */
export const STARTER = ['slash', 'slash', 'slash', 'parry', 'parry', 'holdfast', 'holdfast', 'pistol', 'pistol',
  'purse', 'purse', 'haggle', 'feint', 'feint', 'read'];
export const FOLK_DECK = ['slash', 'slash', 'slash', 'holdfast', 'holdfast', 'pistol', 'feint', 'feint', 'purse'];
export const DECK_MIN = 15;
export const DECK_MAX = 25;
