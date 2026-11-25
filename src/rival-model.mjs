// The rival captain (round 5): Captain Sable Vane of the Gannet, one named pirate met only by you at sea. Pure: when he
// is out, the chance a sea band is him (more on the seas you sail most), his deck (three captain cards, one more each
// time you pay him or run from him, and one each time you beat him), how much stronger it makes him, his bounty, his
// return after each defeat, and his record in the save. The cards
// themselves are in encounter-model.mjs (CAPTAIN_CARDS, RIVAL_START, RIVAL_GAINS), passed in as `E`.

/** He first comes after this many bands met at sea. [BALANCE] */
export const FIRST_AFTER = 10;
/** On your most-sailed sea, this share of the bands met at sea is him (less on a sea sailed less). [BALANCE] */
export const CHANCE = 1 / 6;
/** At most one meeting with him a day of game time. */
export const GAP_MS = 24 * 3600 * 1000;
/** Each captain card he gained makes him this much stronger. [BALANCE] */
export const CARD_STEP = 0.04;
/** His bounty: a base and so much for each card gained. [BALANCE] */
export const BOUNTY_BASE = 20000;
export const BOUNTY_STEP = 5000;
/** Beaten, he sails again after this many more bands met at sea, and each win puts this much more on his head. [BALANCE] */
export const RETURN_AFTER = 10;
export const BOUNTY_WIN = 10000;

const count = (x) => (Number.isInteger(x) && x > 0 ? Math.min(x, 1e9) : 0);
const ms = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

/**
 * The save's `enc.rival`: `seaMet` bands met at sea (counting toward his first meeting), `met`, `paid`, `ran`, `lost`,
 * `drew` (meetings with him and how they ended), `cards` the captain cards he gained, in order, `last` (game ms of the
 * last meeting), `lastSea` (the sea's port key), `beaten` (game ms of the last win, 0 while he sails), `wins` (how often
 * you beat him), `seaAt` (`seaMet` at the last win: he is back RETURN_AFTER sea bands later). A save from before his
 * return (beaten, no `wins`) counts one win and waits RETURN_AFTER bands from its first load.
 */
export function cleanRival(raw, E) {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cards = [];
  for (const id of Array.isArray(r.cards) ? r.cards : []) {
    // Only the gains, in their order: a save can't skip one or hold one twice.
    if (cards.length < E.RIVAL_GAINS.length && id === E.RIVAL_GAINS[cards.length]) cards.push(id);
    else break;
  }
  const seaMet = count(r.seaMet);
  const beaten = ms(r.beaten);
  const wins = beaten > 0 ? Math.max(1, count(r.wins)) : count(r.wins);
  const seaAt = beaten > 0 && Number.isInteger(r.seaAt) && r.seaAt >= 0 ? Math.min(r.seaAt, seaMet) : beaten > 0 ? seaMet : 0;
  return {
    seaMet, met: count(r.met), paid: count(r.paid), ran: count(r.ran), lost: count(r.lost), drew: count(r.drew),
    cards, last: ms(r.last), lastSea: typeof r.lastSea === 'string' && /^\w{1,40}$/.test(r.lastSea) ? r.lastSea : '', beaten, wins, seaAt,
  };
}

/** Whether he sails now: after FIRST_AFTER bands at sea (or once met); beaten, again RETURN_AFTER sea bands later. */
export const isOut = (r) => (r.beaten === 0 ? r.met > 0 || r.seaMet >= FIRST_AFTER : r.seaMet - r.seaAt >= RETURN_AFTER);
/** Beaten and not back yet: how many more bands at sea before he sails again (0 while he sails). */
export const backIn = (r) => (r.beaten === 0 ? 0 : Math.max(0, RETURN_AFTER - (r.seaMet - r.seaAt)));

/**
 * The chance that a band met at sea is him: CHANCE × your hexes on this sea over your most-sailed sea's (Pilotage),
 * 0 before he is out, while he refits after a defeat, or within GAP_MS of the last meeting.
 */
export function chanceOf(r, { hexes = 0, top = 0, now = 0 } = {}) {
  if (!isOut(r)) return 0;
  if (r.last > 0 && now - r.last < GAP_MS && now >= r.last) return 0;
  const w = top > 0 ? Math.min(1, Math.max(0, hexes) / top) : 0;
  return CHANCE * w;
}

/** His deck now: the three he starts with and every card gained. */
export const deckOf = (r, E) => [...E.RIVAL_START, ...r.cards];
/** His strength against the band's usual for the tier: CARD_STEP more a card gained. */
export const strengthMul = (r) => 1 + CARD_STEP * r.cards.length;
/** His bounty in GP: more for each card gained and for each time he was beaten. */
export const bountyOf = (r) => BOUNTY_BASE + BOUNTY_STEP * r.cards.length + BOUNTY_WIN * (r.wins ?? 0);
/** The card he gains next (undefined once he holds them all). */
export const nextCard = (r, E) => E.RIVAL_GAINS[r.cards.length];

/** A meeting with him began on sea `sea` at `now` (the first after a defeat: he is back at sea): a new record. */
export const meeting = (r, sea, now) => ({ ...r, met: r.met + 1, last: ms(now), lastSea: typeof sea === 'string' ? sea : r.lastSea, beaten: 0 });

/**
 * How a meeting ended, `how`: 'pay' or 'run' (he gains his next card), 'lost', 'drew', 'won' (beaten at `now`: he goes
 * to refit, and comes back RETURN_AFTER sea bands later one card up). A new record.
 */
export function ended(r, how, now, E) {
  if (how === 'pay' || how === 'run') {
    const id = nextCard(r, E);
    return { ...r, [how === 'pay' ? 'paid' : 'ran']: r[how === 'pay' ? 'paid' : 'ran'] + 1, cards: id === undefined ? r.cards : [...r.cards, id] };
  }
  if (how === 'lost') return { ...r, lost: r.lost + 1 };
  if (how === 'drew') return { ...r, drew: r.drew + 1 };
  if (how === 'won') {
    const id = nextCard(r, E);
    return { ...r, beaten: ms(now) || 1, wins: (r.wins ?? 0) + 1, seaAt: r.seaMet, cards: id === undefined ? r.cards : [...r.cards, id] };
  }
  return r;
}
