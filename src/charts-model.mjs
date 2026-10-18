// Sea charts and rumours (phase 4): the pure rules. A sea chart bought at a harbour board clears the
// fog from one port's sea; a rumour (Tavern Tale, Sailor's Rumour), dropped now and then while you work near a trading
// place, clears the fog round one place you have not found. Fog only: surveying stays the player's job. No game
// objects here: the runtime (charts.mjs) hands in plain data, the tests drive everything.

/** A sea chart costs this share of the game's GP travel cost of the hexes still under fog in its sea (the user). */
export const CHART_SHARE = 0.1;
/** Rumours: about one per 6 days of work within a hex of a trading place (the user, 17 Oct 2026). */
export const RUMOUR_HOURS = 144;
/** A Voyage task handed in: this chance of a rumour too (phase 4 canvas "the rest": never a whole chart). */
export const TASK_RUMOUR = 0.1;
/** A cargo delivery: this chance of the delivery port's sea chart, free (rare). */
export const CARGO_CHART = 0.01;
/** The rumours: item local ids in the voyage namespace. A Sailor's Rumour is heard by a port and points at the sea. */
export const RUMOURS = { tavern: 'Tavern_Tale', sailor: 'Sailors_Rumour' };

export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const key = (h) => `${h.q},${h.r}`;
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const isSea = (rec) => rec !== undefined && rec.cloud !== true && (rec.t === 'water' || rec.t === 'shoal');
const isPort = (rec) => rec !== undefined && rec.cloud !== true && Array.isArray(rec.f) && rec.f.includes('port');
const near = (h) => NEIGHBOURS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }));

/**
 * The chance of a drop on one completed action that took `intervalMs`, so fast and slow actions pay out the same per
 * hour of work: `interval / target time` (a 3 s action: a rumour 1 in 172,800; the reveal items use the same rule, journal-model chartChance).
 */
export const perAction = (intervalMs, hours) => (Number.isFinite(intervalMs) && intervalMs > 0 && hours > 0 ? Math.min(1, intervalMs / (hours * 3600000)) : 0);

/**
 * Each port's sea: the sea hexes nearer to it than to any other port, counted in steps over the sea (a tie goes to
 * the port first by name), plus the land hexes on its shore (a shore hex touching two seas goes to the one it touches
 * most). Cloud is never in a sea. A port with no sea next to it (Moonlit Pier, inland) and the ports in `skip` (the
 * Fake Port) have none. Returns { [poi]: [{ q, r }] }, the port's own hex first.
 */
export function seas(hexes, skip = []) {
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  const owner = new Map();
  const ports = hexes.filter((h) => isPort(h) && !skip.includes(h.poi) && near(h).some((n) => isSea(byKey.get(key(n)))))
    .sort((a, b) => (a.poi < b.poi ? -1 : 1));
  let frontier = [];
  for (const p of ports) { owner.set(key(p), p.poi); frontier.push({ q: p.q, r: p.r, poi: p.poi }); }
  while (frontier.length > 0) {
    const next = [];
    for (const h of frontier) {
      for (const n of near(h)) {
        const k = key(n);
        if (owner.has(k) || !isSea(byKey.get(k))) continue;
        owner.set(k, h.poi);
        next.push({ q: n.q, r: n.r, poi: h.poi });
      }
    }
    frontier = next;
  }
  const out = Object.fromEntries(ports.map((p) => [p.poi, [{ q: p.q, r: p.r }]]));
  const portKeys = new Set(ports.map(key));
  for (const [k, poi] of owner) {
    const h = byKey.get(k);
    // A port drawn on the water is already first in its own sea.
    if (isSea(h) && !portKeys.has(k)) out[poi].push({ q: h.q, r: h.r });
  }
  // The shore: land (not cloud, not a port) next to a sea hex.
  for (const h of hexes) {
    if (isSea(h) || h.cloud === true || owner.has(key(h))) continue;
    const count = {};
    for (const n of near(h)) {
      const k = key(n);
      if (isSea(byKey.get(k)) && owner.has(k)) count[owner.get(k)] = (count[owner.get(k)] ?? 0) + 1;
    }
    const best = Object.entries(count).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best !== undefined) out[best[0]].push({ q: h.q, r: h.r });
  }
  return out;
}

/** The seas that touch each sea: { [poi]: [poi, by name] }. */
export function seaNeighbours(seaMap) {
  const owner = new Map();
  for (const [poi, list] of Object.entries(seaMap)) for (const h of list) owner.set(key(h), poi);
  const out = {};
  for (const [poi, list] of Object.entries(seaMap)) {
    const set = new Set();
    for (const h of list) for (const n of near(h)) { const o = owner.get(key(n)); if (o !== undefined && o !== poi) set.add(o); }
    out[poi] = [...set].sort();
  }
  return out;
}

/** The seas a port's board sells: its own first, then the ones next to it. */
export const chartsAt = (poi, seaMap, neighbours) => (seaMap[poi] === undefined ? [] : [poi, ...(neighbours[poi] ?? [])]);

/** A chart's price from the GP travel costs of the hexes still under fog in its sea: CHART_SHARE, rounded up to 100. */
export function chartPrice(costs) {
  const sum = costs.reduce((s, c) => s + (Number.isFinite(c) && c > 0 ? c : 0), 0);
  return Math.ceil((sum * CHART_SHARE) / 100) * 100;
}

/**
 * Where a rumour points: the place you have not found nearest to `from` (`places`: [{ q, r, sea }]); a Sailor's
 * Rumour (`sea` true) takes the nearest place at sea when there is one. Undefined when there is none.
 */
export function rumourTarget(from, places, sea = false) {
  if (from === undefined || places.length === 0) return undefined;
  const pool = sea && places.some((p) => p.sea) ? places.filter((p) => p.sea) : places;
  let best;
  for (const p of pool) {
    const d = hexDist(from, p);
    if (best === undefined || d < best.d || (d === best.d && key(p) < key(best.p))) best = { p, d };
  }
  return best?.p;
}

/** The hexes a rumour clears: the place and its ring, those on the map and not under cloud (7 at most). */
export function ringOf(place, hexes) {
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  return [place, ...near(place)].filter((h) => { const rec = byKey.get(key(h)); return rec !== undefined && rec.cloud !== true; }).map((h) => ({ q: h.q, r: h.r }));
}
