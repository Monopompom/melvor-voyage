// Random start (phase 4): the pure rules. On a character's first load the player picks A New Start
// (the game's own start) or Random start, once. Random start puts them on a land hex they can live and grow from.
// No game objects here: the runtime (start.mjs) hands in the hex table and two questions about a hex.

/** A trading place is at most this many steps away over land (the wandering trader's floor gets you there, 4.18). */
export const TRADE_STEPS = 8;
/** Random start is never this close to the game's own start, so it is really somewhere else. */
export const AWAY = 4;
/** The choice in the save: not asked yet, the game's start, or a random one. */
export const CHOICES = ['', 'game', 'random'];

export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const key = (h) => `${h.q},${h.r}`;
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const isSea = (rec) => rec !== undefined && (rec.t === 'water' || rec.t === 'shoal');
/** Hexes where a fight or a dungeon is, or any named place: never a start. */
const FIGHT = ['combat_area', 'slayer_area', 'stronghold_area', 'dungeon'];
const plain = (rec) => rec.poi === undefined && rec.area === undefined && rec.dungeon === undefined && !(rec.f ?? []).some((f) => FIGHT.includes(f));
const land = (rec) => rec !== undefined && !isSea(rec) && rec.cloud !== true;

/**
 * Where a Random start may put you: land, not under cloud, no place or fight on the hex, on land any hull lands on
 * (`tier(rec)` 1: the mainland and the dinghy's islands), AWAY or more from the game's start, something to gather
 * (`gathers(rec)`), and a trading place (`trades(rec)`) within TRADE_STEPS steps over land.
 */
export function startCandidates(hexes, { start, tier = () => 1, gathers = () => true, trades = () => false }) {
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  const tradeNear = (rec) => {
    const seen = new Set([key(rec)]);
    let frontier = [rec];
    for (let d = 0; d <= TRADE_STEPS && frontier.length > 0; d++) {
      if (frontier.some(trades)) return true;
      const next = [];
      for (const h of frontier) {
        for (const [dq, dr] of NEIGHBOURS) {
          const n = byKey.get(key({ q: h.q + dq, r: h.r + dr }));
          if (!land(n) || seen.has(key(n))) continue;
          seen.add(key(n));
          next.push(n);
        }
      }
      frontier = next;
    }
    return false;
  };
  return hexes.filter((h) => land(h) && plain(h) && tier(h) <= 1 && (start === undefined || hexDist(h, start) >= AWAY) && gathers(h) && tradeNear(h))
    .map((h) => ({ q: h.q, r: h.r }));
}

/** One of the candidates, picked by `r`. */
export const pickStart = (candidates, r) => (candidates.length === 0 ? undefined : candidates[Math.floor(r() * candidates.length) % candidates.length]);
