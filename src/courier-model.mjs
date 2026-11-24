// Couriers (round 4, with Worker Folks): a Folk on the Courier job walks a looping route of stops and carries what the
// Folks there hold. Pure: the route, where the courier is on it, and which stop comes next. The goods stay in the
// courier's own Worker Folks room, so nothing here holds an item. Time comes from the job's own ticks (`advance`), so a
// courier on strike or without a Shift Slot simply stands still.

/** The Worker Folks API version with the carry calls. */
export const COURIER_API = 12;
/** The job, as Worker Folks lists it. */
export const COURIER_JOB = 'voyage:Courier';
/** The two shop purchases: carrying to the bank, then carrying inputs out. */
export const LICENCE_ID = 'voyage:Couriers_Licence';
export const CONTRACTS_ID = 'voyage:Supply_Contracts';
/** The Hiring level a carried supply line needs, with Supply Contracts. */
export const CARRIED_LINK_HIRING = 60;
/** A courier's load: three hauls of its tier, bags included. */
export const LOAD_SCALE = 3;
/** How often the job looks, in game time. */
export const LOOK_MS = 5000;
/**
 * A courier whose stops all stand within reach waits this long between rounds. A room holds hours of work, so a round
 * a minute carries all there is, and the stops aren't done again every look for nothing.
 */
export const STANDING_MS = 60000;
/** A stop is reached from this many hexes away, as every order to a Folk is. */
export const STOP_REACH = 1;
export const STOPS_MAX = 12;
export const COURIERS_MAX = 64;
export const ROAD_MAX = 400;
/** A packet boat between two ports: a sea hex at the dinghy's pace, for this share of the game's fare for the hexes sailed. */
export const PACKET_HEX_MS = 5 * 60 * 1000;
export const PACKET_FARE_SHARE = 0.4;
/** A crossing's fare from what the game charges for its hexes: whole GP, at least 1 where the game charges anything. */
export const packetFare = (gameGp) => (Number.isFinite(gameGp) && gameGp > 0 ? Math.max(1, Math.round(gameGp * PACKET_FARE_SHARE)) : 0);

/** The most Folks and tents one round keeps a count for. */
const ROUND_KEYS = 64;
const int = (n) => Number.isInteger(n);
const text = (s) => typeof s === 'string' && s !== '' && s.length <= 80;
const cleanHex = (h) => (h !== null && typeof h === 'object' && int(h.q) && int(h.r) ? { q: h.q, r: h.r } : undefined);
const cleanStep = (s) => {
  const h = cleanHex(s);
  if (h === undefined || typeof s.cls !== 'string' || s.cls === '' || !Number.isFinite(s.ms) || s.ms <= 0) return undefined;
  return { ...h, cls: s.cls, ms: Math.round(s.ms) };
};

/** A crossing under way: `to` the land hex it steps off on, `hexes` the sea sailed, `into` the ms spent of `ms`. */
const cleanCrossing = (x) => {
  if (x === null || typeof x !== 'object' || !Array.isArray(x.hexes) || x.hexes.length === 0 || x.hexes.length > ROAD_MAX) return undefined;
  const to = cleanHex(x.to);
  const hexes = x.hexes.map(cleanHex);
  if (to === undefined || hexes.some((h) => h === undefined) || !Number.isFinite(x.ms) || x.ms <= 0) return undefined;
  const ms = Math.round(x.ms);
  return { to, hexes, ms, into: Number.isFinite(x.into) && x.into > 0 ? Math.min(Math.round(x.into), ms - 1) : 0 };
};
/** What one trip round carried: `carried` ms of goods by Folk or tent, `ms` of the job's time, `fares` paid, `trips` home. */
const cleanRound = (r) => {
  if (r === null || typeof r !== 'object') return undefined;
  const carried = {};
  if (r.carried !== null && typeof r.carried === 'object' && !Array.isArray(r.carried)) {
    for (const [k, v] of Object.entries(r.carried).slice(0, ROUND_KEYS)) {
      if (/^[fd]:/.test(k) && k.length <= 90 && Number.isFinite(v) && v > 0) carried[k] = v;
    }
  }
  const plus = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  return { carried, ms: plus(r.ms), fares: plus(r.fares), trips: int(r.trips) && r.trips > 0 ? r.trips : 0 };
};
/** The food and fuel it carries for the road, or undefined for none. */
const cleanPack = (p) => {
  if (p === null || typeof p !== 'object') return undefined;
  const food = Number.isFinite(p.food) && p.food > 0 ? p.food : 0;
  const fuel = Number.isFinite(p.fuel) && p.fuel > 0 ? p.fuel : 0;
  return food > 0 || fuel > 0 ? { food, fuel } : undefined;
};

/** A stop as a save keeps it: a bank place { kind: 'bank', q, r }, a Folk { kind: 'folk', id }, a tent { kind: 'depot', key }. */
export function cleanStop(s) {
  if (s === null || typeof s !== 'object') return undefined;
  if (s.kind === 'bank') { const h = cleanHex(s); return h === undefined ? undefined : { kind: 'bank', ...h }; }
  if (s.kind === 'folk') return text(s.id) ? { kind: 'folk', id: s.id } : undefined;
  if (s.kind === 'depot') return text(s.key) ? { kind: 'depot', key: s.key } : undefined;
  return undefined;
}

export const sameStop = (a, b) => a?.kind === b?.kind && (a?.kind === 'bank' ? a.q === b.q && a.r === b.r : a?.kind === 'folk' ? a.id === b.id : a?.key === b?.key);

/**
 * What is wrong with a route, or undefined: 'few' (under two stops), 'many', 'noBank' (nowhere to deliver), 'repeat'
 * (the same stop twice in a row, the loop's end and start included), 'unreadable'.
 */
export function routeProblem(stops) {
  if (!Array.isArray(stops) || stops.length < 2) return 'few';
  if (stops.length > STOPS_MAX) return 'many';
  const clean = stops.map(cleanStop);
  if (clean.some((s) => s === undefined)) return 'unreadable';
  if (!clean.some((s) => s.kind === 'bank')) return 'noBank';
  if (clean.some((s, i) => sameStop(s, clean[(i + 1) % clean.length]))) return 'repeat';
  return undefined;
}

/** A new courier on `stops`, standing on `from`, heading for the first stop. */
export function newCourier(stops, from) {
  return { stops: stops.map(cleanStop), next: 0, from: cleanHex(from), road: [], reached: 0, into: 0 };
}

/**
 * One courier as a save keeps it, or undefined when it can't be read. `next` the stop it is heading for, `from` the hex
 * its leg began on, `road` the leg's hexes, `reached` those entered, `into` the ms spent toward the next one. `back` the
 * stop to go back to after a trip home with a full load, `pending` an edited route, taken up at the next bank stop,
 * `retired` true when its route was deleted and it is on its way to unload, `crossing` a packet it is on (its hex stays
 * the land it boarded from), `pack` its road food, `packing` true while it waits at a bank stop for that food. `round` the
 * trip under way, counted from its first bank stop, `last` the last whole one.
 */
export function cleanCourier(c) {
  if (c === null || typeof c !== 'object' || routeProblem(c.stops) !== undefined) return undefined;
  const from = cleanHex(c.from);
  if (from === undefined || !Array.isArray(c.road)) return undefined;
  const road = [];
  for (const s of c.road.slice(0, ROAD_MAX)) {
    const step = cleanStep(s);
    if (step === undefined) return undefined;
    road.push(step);
  }
  const stops = c.stops.map(cleanStop);
  const reached = int(c.reached) && c.reached >= 0 ? Math.min(c.reached, road.length) : 0;
  const room = reached < road.length ? road[reached].ms : 0;
  const into = Number.isFinite(c.into) && c.into > 0 ? Math.min(Math.round(c.into), Math.max(0, room - 1)) : 0;
  const out = { stops, next: int(c.next) && c.next >= 0 && c.next < stops.length ? c.next : 0, from, road, reached, into };
  if (int(c.back) && c.back >= 0 && c.back < stops.length) out.back = c.back;
  if (routeProblem(c.pending) === undefined) out.pending = c.pending.map(cleanStop);
  if (c.retired === true) out.retired = true;
  const crossing = c.crossing === undefined ? undefined : cleanCrossing(c.crossing);
  if (crossing !== undefined) out.crossing = crossing;
  const pack = c.pack === undefined ? undefined : cleanPack(c.pack);
  if (pack !== undefined) out.pack = pack;
  if (c.packing === true) out.packing = true;
  const round = c.round === undefined ? undefined : cleanRound(c.round);
  if (round !== undefined) out.round = round;
  const last = c.last === undefined ? undefined : cleanRound(c.last);
  if (last !== undefined) out.last = last;
  return out;
}

/** The couriers a save keeps: { folkId: courier }, junk dropped. */
export function cleanCouriers(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, c] of Object.entries(raw).slice(0, COURIERS_MAX)) {
    if (id === '') continue;
    const clean = cleanCourier(c);
    if (clean !== undefined) out[id] = clean;
  }
  return out;
}

// ---- what the courier code keeps between looks, for a check after a long Welcome Back -------------------------------

/** Roads kept at most at once: the map search is dear, so a road found is kept a while. */
export const ROADS_KEPT = 512;

/**
 * Counts what the courier code holds between looks: `roads` and `packets` (Map key → road | boat | null), `perCourier`
 * ({ name: Map or Set keyed by Folk id }), `tentCounts` (Map | undefined), `tents` (how many stand), `couriers` (the saved
 * record), `folkIds` (the Folks there are). Every one of these is capped or dies with its Folk; `problems` names any that
 * is not: more roads than ROADS_KEPT, a road or crossing longer than ROAD_MAX, more couriers than COURIERS_MAX, an entry
 * for a Folk that is gone, or more tent counts than tents.
 */
export function keptReport({ roads = new Map(), packets = new Map(), perCourier = {}, tentCounts, tents = 0, couriers = {}, folkIds = [] }) {
  const problems = [];
  const known = new Set(folkIds);
  const lengths = (map, of) => [...map.values()].map((x) => (x == null ? 0 : of(x)));
  const roadLengths = lengths(roads, (r) => r.length);
  const packetLengths = lengths(packets, (b) => b.hexes?.length ?? 0);
  const sum = (list) => list.reduce((s, n) => s + n, 0);
  if (roads.size > ROADS_KEPT) problems.push(`roads: ${roads.size} kept, cap ${ROADS_KEPT}`);
  if (roadLengths.some((n) => n > ROAD_MAX)) problems.push(`roads: one of ${Math.max(...roadLengths)} hexes, cap ${ROAD_MAX}`);
  if (packetLengths.some((n) => n > ROAD_MAX)) problems.push(`packets: one of ${Math.max(...packetLengths)} hexes, cap ${ROAD_MAX}`);
  const out = { roads: roads.size, roadHexes: sum(roadLengths), packets: packets.size, packetHexes: sum(packetLengths) };
  for (const [name, map] of Object.entries(perCourier)) {
    const ids = [...map.keys()];
    out[name] = ids.length;
    if (ids.length > COURIERS_MAX) problems.push(`${name}: ${ids.length} entries, cap ${COURIERS_MAX}`);
    const gone = ids.filter((id) => !known.has(id));
    if (gone.length > 0) problems.push(`${name}: ${gone.length} for Folks that are gone`);
  }
  out.tentCounts = tentCounts?.size ?? 0;
  if (out.tentCounts > Math.max(0, tents)) problems.push(`tentCounts: ${out.tentCounts} for ${tents} tents`);
  const saved = Object.entries(couriers ?? {});
  const keysOf = (r) => Object.keys(r?.carried ?? {}).length;
  out.saved = {
    couriers: saved.length,
    stops: sum(saved.map(([, c]) => (c.stops?.length ?? 0) + (c.pending?.length ?? 0))),
    roadHexes: sum(saved.map(([, c]) => (c.road?.length ?? 0) + (c.crossing?.hexes?.length ?? 0))),
    roundKeys: sum(saved.map(([, c]) => keysOf(c.round) + keysOf(c.last))),
    bytes: JSON.stringify(couriers ?? {}).length,
  };
  if (saved.length > COURIERS_MAX) problems.push(`saved: ${saved.length} couriers, cap ${COURIERS_MAX}`);
  const savedGone = saved.filter(([id]) => !known.has(id)).length;
  if (savedGone > 0) problems.push(`saved: ${savedGone} routes for Folks that are gone`);
  // A round counts by stop, and a new route starts its count afresh: never more keys than a route may have stops.
  const wideRounds = saved.filter(([, c]) => keysOf(c.round) > STOPS_MAX || keysOf(c.last) > STOPS_MAX).length;
  if (wideRounds > 0) problems.push(`saved: ${wideRounds} rounds counting more than ${STOPS_MAX} stops`);
  out.problems = problems;
  return out;
}

/** The hex the courier stands on or last entered. */
export const hexOf = (c) => {
  const at = c.reached > 0 ? c.road[c.reached - 1] : c.from;
  return { q: at.q, r: at.r };
};

/** True when it has no hex left to enter on this leg. */
export const atLegEnd = (c) => c.reached >= c.road.length;

/**
 * `ms` of its time on the road: { courier, entered, arrived, spare }. `entered` the hexes walked into, in order, `arrived`
 * true when this took it to the leg's end, `spare` the time left over then, for the next leg.
 */
export function advance(c, ms) {
  let left = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (atLegEnd(c)) return { courier: c, entered: [], arrived: false, spare: left };
  let { reached, into } = c;
  const entered = [];
  while (reached < c.road.length) {
    const need = c.road[reached].ms - into;
    if (left < need) { into += left; left = 0; break; }
    left -= need;
    into = 0;
    entered.push(c.road[reached]);
    reached += 1;
  }
  const arrived = reached >= c.road.length;
  return { courier: { ...c, reached, into }, entered, arrived, spare: arrived ? left : 0 };
}

/** A new leg from `from` along `road` (the hexes entered, in order). */
export const startLeg = (c, from, road) => ({ ...c, from: cleanHex(from), road, reached: 0, into: 0 });

/** Off the packet: it stands on the far shore, with no leg begun. */
export function land(c) {
  if (c.crossing === undefined) return c;
  const { crossing, ...rest } = c;
  return { ...rest, from: crossing.to, road: [], reached: 0, into: 0 };
}

/** `ms` of its time on the packet: { courier, landed, spare }, `spare` the time left over once ashore. */
export function sail(c, ms) {
  const x = c.crossing;
  const left = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const need = x.ms - x.into;
  if (left < need) return { courier: { ...c, crossing: { ...x, into: x.into + left } }, landed: false, spare: 0 };
  return { courier: land(c), landed: true, spare: left - need };
}

/** The sea hex a packet has reached, for the map; undefined when it is not on one. */
export function crossingAt(c) {
  const x = c.crossing;
  if (x === undefined) return undefined;
  return x.hexes[Math.min(x.hexes.length - 1, Math.floor(x.into / (x.ms / x.hexes.length)))];
}

/** The sea hexes still ahead of a packet. */
export function crossingAhead(c) {
  const x = c.crossing;
  if (x === undefined) return [];
  return x.hexes.slice(Math.min(x.hexes.length, Math.floor(x.into / (x.ms / x.hexes.length)) + 1));
}

/** The first stop after index `after`, going round, that `isLive` accepts (the stop itself last), or undefined. */
export function nextLive(stops, after, isLive = () => true) {
  const n = stops.length;
  for (let i = 1; i <= n; i++) {
    const at = (((after + i) % n) + n) % n;
    if (isLive(stops[at], at)) return at;
  }
  return undefined;
}

/** The bank stop nearest `from`, by `distance(a, b)`; the first in the route on a tie. Undefined with none. */
export function nearestBank(stops, from, distance) {
  let best;
  let bestD = Infinity;
  stops.forEach((s, i) => {
    if (s.kind !== 'bank') return;
    const d = distance(from, s);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/**
 * Done at the stop it was heading for: which one comes next. At a bank stop an edited route is taken up, and a courier
 * that came home full goes back to the stop where it filled up. Elsewhere, `full` sends it to the nearest bank stop.
 * A stop `isLive` refuses (a Folk on its way, a tent struck) is skipped; a bank stop never is.
 */
export function afterStop(c, { full = false, isLive = () => true, distance }) {
  const live = (s, i) => s.kind === 'bank' || isLive(s, i);
  const here = c.stops[c.next];
  const { back, pending, ...rest } = c;
  const out = { ...rest, from: hexOf(c), road: [], reached: 0, into: 0 };
  if (c.retired === true) return { ...out, next: c.next };
  if (here?.kind === 'bank') {
    if (pending !== undefined) {
      out.stops = pending;
      out.next = nextLive(pending, pending.findIndex((s) => sameStop(s, here)), live);
      return out;
    }
    out.next = nextLive(c.stops, back === undefined ? c.next : back - 1, live);
    return out;
  }
  if (pending !== undefined) out.pending = pending;
  if (full) {
    out.back = c.next;
    out.next = nearestBank(c.stops, out.from, distance);
    return out;
  }
  if (back !== undefined) out.back = back;
  out.next = nextLive(c.stops, c.next, live);
  return out;
}

/** The stops a courier's route is to serve: a saved edit counts at once, a deleted route serves nobody. */
export const routeOf = (c) => (c?.retired === true ? undefined : c?.pending ?? c?.stops);

/** Does this stop serve the Folk: by its id, or as a member of the tent (`depotOf(id)` is the tent it stands by). */
export const stopServes = (stop, folkId, depotOf) => (stop.kind === 'folk' ? stop.id === folkId : stop.kind === 'depot' && depotOf(folkId) === stop.key);

export const routeServes = (c, folkId, depotOf) => (routeOf(c) ?? []).some((s) => stopServes(s, folkId, depotOf));

/** The ids of the couriers whose routes serve this Folk (never itself). */
export const couriersServing = (couriers, folkId, depotOf) => Object.keys(couriers ?? {})
  .filter((id) => id !== folkId && routeServes(couriers[id], folkId, depotOf));

/** The courier whose one route serves both Folks, undefined when none does. Neither Folk can be its own carrier. */
export const carrierOf = (couriers, a, b, depotOf) => Object.keys(couriers ?? {})
  .find((id) => id !== a && id !== b && routeServes(couriers[id], a, depotOf) && routeServes(couriers[id], b, depotOf));

/** What a bank stop loads inputs for: each Folk and tent on the route once, those standing away left out. */
export function inputStops(stops, { self, isLive = () => true } = {}) {
  const seen = new Set();
  const out = [];
  for (const s of stops ?? []) {
    if (s.kind === 'bank' || (s.kind === 'folk' && s.id === self) || !isLive(s)) continue;
    const key = s.kind === 'folk' ? `f:${s.id}` : `d:${s.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.kind === 'folk' ? { folk: s.id } : { depot: s.key });
  }
  return out;
}

/** The most of any one bank stack a single top-up may take. */
export const INPUT_BANK_SHARE = 0.25;

/**
 * Cuts a bank top-up so no line takes more than `share` of its stack. Every line shrinks by the same factor, so a recipe's
 * inputs stay in step, and each line whose stack holds anything still moves at least one. `take`: [{ itemId, qty, ms }].
 */
export function capInputs(take, bankQty, share = INPUT_BANK_SHARE) {
  const lines = take ?? [];
  const capOf = (line) => Math.ceil(Math.max(0, bankQty(line.itemId)) * share);
  const scale = lines.reduce((low, line) => (line.qty > 0 && capOf(line) > 0 ? Math.min(low, capOf(line) / line.qty) : low), 1);
  if (take !== undefined && scale >= 1 && lines.every((line) => capOf(line) > 0)) return take;
  return lines.map((line) => {
    const qty = Math.min(line.qty, capOf(line), Math.ceil(line.qty * scale));
    return { ...line, qty, ms: line.qty > 0 ? (line.ms * qty) / line.qty : 0 };
  }).filter((line) => line.qty > 0);
}

/** It turns back for the bank only with a full load and no inputs left to hand out on the way. */
export const loadFull = (room) => room != null && room.sizeMs > 0 && room.usedMs >= room.sizeMs && !((room.stock?.length ?? 0) > 0);

/** The route deleted: it stops where it stands (a packet sails on) and makes for the nearest bank stop to unload. */
export function retire(c, distance) {
  const { back, pending, packing, ...rest } = c;
  if (c.crossing !== undefined) return { ...rest, retired: true, next: nearestBank(c.stops, c.crossing.to, distance) };
  const from = hexOf(c);
  return { ...rest, retired: true, from, road: [], reached: 0, into: 0, next: nearestBank(c.stops, from, distance) };
}

// ---- what a round carried, for the net GP/h Worker Folks shows -----------------------------------------------------

export const folkKey = (id) => `f:${id}`;
export const depotKey = (key) => `d:${key}`;
const stopKey = (s) => (s.kind === 'folk' ? folkKey(s.id) : depotKey(s.key));
const newRound = () => ({ carried: {}, ms: 0, fares: 0, trips: 0 });
const firstBank = (stops) => stops.findIndex((s) => s.kind === 'bank');

/** `ms` of the job's time, counted into the round under way. */
export const roundTime = (c, ms) => (c.round === undefined || !(ms > 0) ? c : { ...c, round: { ...c.round, ms: c.round.ms + ms } });
/** A fare paid, counted into the round under way. */
export const roundFare = (c, gp) => (c.round === undefined || !(gp > 0) ? c : { ...c, round: { ...c.round, fares: c.round.fares + gp } });

/**
 * Done at a stop: `before` as it arrived, `after` with its next stop chosen, `carried` [{ key, ms }] what moved there. A
 * round runs from its first bank stop back to it. Home early with a full load it goes back out, so that pass ends the
 * round only once it has been home as often as the route has stops: a Folk that fills every load can't hold it open. A new
 * route starts its count afresh.
 */
export function noteStop(before, after, carried = []) {
  let c = after;
  const swapped = after.stops !== before.stops;
  if (swapped) { const { round, last, ...rest } = after; c = rest; }
  if (c.round !== undefined && carried.some((x) => x.ms > 0)) {
    const tally = { ...c.round.carried };
    for (const { key, ms } of carried) if (ms > 0) tally[key] = (tally[key] ?? 0) + ms;
    c = { ...c, round: { ...c.round, carried: tally } };
  }
  if (swapped || before.next !== firstBank(before.stops)) return c;
  if (c.round === undefined) return { ...c, round: newRound() };
  const trips = c.round.trips + 1;
  if (before.back !== undefined && trips < before.stops.length) return { ...c, round: { ...c.round, trips } };
  // A round that took no time says nothing: the last real one stands.
  return { ...c, ...(c.round.ms > 0 ? { last: c.round } : {}), round: newRound() };
}

/**
 * Each Folk's and tent's part of this courier, 0 to 1, adding up to at most 1: by the hours of goods carried on its last
 * whole round, or evenly over the route's stops before there is one, after a route edit, or when that round carried nothing.
 */
export function routeParts(c) {
  const stops = routeOf(c);
  if (stops === undefined) return {};
  const done = c.pending === undefined ? c.last?.carried ?? {} : {};
  const total = Object.values(done).reduce((sum, ms) => sum + ms, 0);
  const out = {};
  if (total > 0) {
    for (const [k, ms] of Object.entries(done)) out[k] = ms / total;
    return out;
  }
  const calls = stops.filter((s) => s.kind !== 'bank');
  for (const s of calls) out[stopKey(s)] = (out[stopKey(s)] ?? 0) + 1 / calls.length;
  return out;
}

/** One Folk's part: its own, plus an even slice of the tent it stands by (`members` Folks there). */
export function folkPart(parts, folkId, tent, members = 1) {
  const own = parts[folkKey(folkId)] ?? 0;
  const camp = tent === undefined ? 0 : (parts[depotKey(tent)] ?? 0) / Math.max(1, members);
  return Math.min(1, own + camp);
}

/** The courier's whole fares in GP per hour: from its last whole round, else `estimate` ({ ms, fares }, the route's). */
export function faresPerHour(c, estimate) {
  const from = c.last?.ms > 0 ? c.last : estimate;
  return from?.ms > 0 && from.fares > 0 ? (from.fares / from.ms) * 3600000 : 0;
}

/**
 * The quickest road to within a hex of `hex`, ending on land: a port's own hex is often water, and a walk can't end there.
 * [] when already in reach, undefined when no road exists. `ground(q, r)` as a walk's, `findAny(from, ends)` the quickest
 * road to whichever of those hexes comes first, `neighbours` the six offsets.
 */
export function roadToStop(from, hex, { ground, findAny, distance, neighbours }) {
  if (distance(from, hex) <= STOP_REACH) return [];
  const ends = [[0, 0], ...neighbours].map(([dq, dr]) => ({ q: hex.q + dq, r: hex.r + dr })).filter((h) => ground(h.q, h.r) !== undefined);
  return ends.length === 0 ? undefined : findAny(from, ends);
}

/**
 * `ms` of the job's time along the route: { courier, entered, wait, done }. It walks, does each stop it reaches with
 * `visit(stop, here)` (→ { full, carried }), and goes on with the time left, each stop at most once a look. `stopHex(stop)` is
 * where a stop stands now (undefined: it is away and is skipped), `road(from, hex)` the road to it (undefined: none).
 * Where no road goes, `packet(from, hex)` may offer a crossing ({ to, hexes, ms, fare }) and `board(boat)` pays for it
 * (false: it can't). After a bank stop `pack(courier)` packs the road food: the new pack, or undefined when the bank or
 * the place is short, and `eat(pack, step)` takes each hex walked out of it. `wait` is 'noRoad' when no stop can be reached, 'fare' (with `fare`) or 'food' when it stands
 * waiting for those, 'standing' when it did every stop in this look without walking a hex or sailing (all its stops are
 * within reach of where it stands: going round again every look would only redo the same stops); `done` true when a
 * deleted route's courier has unloaded.
 */
export function walkOn(start, ms, options) {
  const total = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const clock = { noted: 0 };
  const out = walkRoute(start, total, options, clock);
  return { ...out, courier: roundTime(out.courier, total - clock.noted) };
}

/** The walk itself. `clock.noted` is how much of `total` is already in a round, so one long tick splits across rounds. */
function walkRoute(start, total, { stopHex, road, visit, distance, packet, board, pack, eat }, clock) {
  const isLive = (s) => stopHex(s) !== undefined;
  const entered = [];
  let c = start;
  let left = total;
  let visits = 0;
  let stuck = 0;
  let sailedAny = false;
  const skipTo = (next) => ({ ...c, next, from: hexOf(c), road: [], reached: 0, into: 0 });
  for (;;) {
    if (c.crossing !== undefined) {
      sailedAny = true;
      const sailed = sail(c, left);
      c = sailed.courier;
      if (!sailed.landed) return { courier: c, entered, wait: '', done: false };
      left = sailed.spare;
    }
    if (c.packing === true) {
      const packed = pack?.(c);
      if (pack !== undefined && packed === undefined) return { courier: c, entered, wait: 'food', done: false };
      const { packing, ...rest } = c;
      c = packed === undefined ? rest : { ...rest, pack: packed };
    }
    const stop = c.stops[c.next];
    const hex = stopHex(stop);
    if (hex === undefined) {
      const next = nextLive(c.stops, c.next, isLive);
      if (next === undefined || next === c.next) return { courier: c, entered, wait: 'noRoad', done: false };
      c = skipTo(next);
      continue;
    }
    if (atLegEnd(c) && distance(hexOf(c), hex) > STOP_REACH) {
      const leg = road(hexOf(c), hex);
      if (leg === undefined || leg.length === 0) {
        const boat = leg === undefined ? packet?.(hexOf(c), hex) : undefined;
        if (boat !== undefined) {
          if (board?.(boat) !== true) return { courier: c, entered, wait: 'fare', fare: boat.fare, done: false };
          c = roundFare({ ...startLeg(c, hexOf(c), []), crossing: { to: boat.to, hexes: boat.hexes, ms: boat.ms, into: 0 } }, boat.fare);
          continue;
        }
        stuck += 1;
        const next = nextLive(c.stops, c.next, isLive);
        if (stuck >= c.stops.length || next === undefined || next === c.next) return { courier: c, entered, wait: 'noRoad', done: false };
        c = skipTo(next);
        continue;
      }
      c = startLeg(c, hexOf(c), leg);
    }
    stuck = 0;
    if (!atLegEnd(c)) {
      const walked = advance(c, left);
      c = walked.courier;
      entered.push(...walked.entered);
      if (eat !== undefined && c.pack !== undefined) c = { ...c, pack: walked.entered.reduce(eat, c.pack) };
      if (!walked.arrived) return { courier: c, entered, wait: '', done: false };
      left = walked.spare;
      // The Folk it was heading for has moved on meanwhile: a new road from here.
      if (distance(hexOf(c), hex) > STOP_REACH) { c = startLeg(c, hexOf(c), []); continue; }
    }
    if (visits >= c.stops.length) {
      const standing = entered.length === 0 && !sailedAny;
      return { courier: { ...c, from: hexOf(c), road: [], reached: 0, into: 0 }, entered, wait: standing ? 'standing' : '', done: false };
    }
    visits += 1;
    c = roundTime(c, total - left - clock.noted);
    clock.noted = total - left;
    const { full = false, carried } = visit(stop, hexOf(c)) ?? {};
    if (c.retired === true) return { courier: c, entered, wait: '', done: true };
    c = noteStop(c, afterStop(c, { full, isLive, distance }), carried);
    if (stop.kind === 'bank' && pack !== undefined) c = { ...c, packing: true };
  }
}

/**
 * The land hexes it will walk from where it stands to its next bank stop, in order: what its road food has to cover.
 * A packet's hexes are not in it (the fare feeds you), and a stop that stands nowhere is passed over.
 */
export function stretchSteps(c, { stopHex, road, packet, distance }) {
  const out = [];
  const n = c.stops.length;
  let at = hexOf(c);
  for (let i = 0; i < n; i++) {
    const stop = c.stops[(c.next + i) % n];
    const hex = stopHex(stop);
    // A stop within reach is done from where it stands: no walk.
    if (hex !== undefined && !(distance?.(at, hex) <= STOP_REACH)) {
      const leg = road(at, hex);
      if (leg !== undefined) {
        out.push(...leg);
        if (leg.length > 0) at = { q: leg[leg.length - 1].q, r: leg[leg.length - 1].r };
      } else {
        const boat = packet?.(at, hex);
        if (boat !== undefined) at = boat.to;
      }
    }
    if (stop.kind === 'bank') break;
  }
  return out;
}

// ---- editing a route ------------------------------------------------------------------------------------------------

/**
 * The stops a tapped hex offers, Folks first: a Folk standing there (not the courier itself, nor another courier), a tent
 * there, and the hex itself when `isBank(hex)`.
 */
export function stopsAt(hex, { folks = [], tents = [], isBank = () => false, self }) {
  const here = (h) => h != null && h.q === hex.q && h.r === hex.r;
  const out = [];
  for (const f of folks) if (f.id !== self && f.job !== COURIER_JOB && f.travel === 'idle' && here(f.place)) out.push({ kind: 'folk', id: f.id });
  for (const tent of tents) if (here(tent)) out.push({ kind: 'depot', key: tent.key });
  if (isBank(hex)) out.push({ kind: 'bank', q: hex.q, r: hex.r });
  return out;
}

/** `stop` added at the end: { stops }, or the same stops with `why` ('many', 'repeat', 'unreadable'). */
export function addStop(stops, stop) {
  const clean = cleanStop(stop);
  if (clean === undefined) return { stops, why: 'unreadable' };
  if (stops.length >= STOPS_MAX) return { stops, why: 'many' };
  if (stops.length > 0 && sameStop(stops[stops.length - 1], clean)) return { stops, why: 'repeat' };
  return { stops: [...stops, clean] };
}

export const removeStop = (stops, at) => stops.filter((_, i) => i !== at);

/** The stop at `at` moved `by` places; the same stops when that would leave the list. */
export function moveStop(stops, at, by) {
  const to = at + by;
  if (!int(at) || !int(to) || at < 0 || at >= stops.length || to < 0 || to >= stops.length) return stops;
  const out = [...stops];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/** How far a finger goes on the route sheet's grip: past the first it is no longer a tap, past the second it is a swipe. */
export const SHEET_TAP_MOVE = 10;
export const SHEET_SWIPE_MIN = 24;

/** A finger's move on the sheet's grip: { moved, folded }. Down folds, up opens; a short or mostly sideways move changes nothing. */
export function sheetSwipe(dx, dy, folded) {
  const moved = Math.hypot(dx, dy) >= SHEET_TAP_MOVE;
  if (Math.abs(dy) < SHEET_SWIPE_MIN || Math.abs(dy) <= Math.abs(dx)) return { moved, folded };
  return { moved, folded: dy > 0 };
}

/**
 * The route as it would go, once round: { legs, ms, fares, noRoad, lines }. A leg is { from, to, state, ms, hexes }, its
 * state 'ok', 'packet' (with its `fare`), 'noRoad', or 'away' (a stop that stands nowhere now, skipped until it does).
 * `lines` the legs as hex lists, for the map. `stopHex(stop)` where a stop stands, `standOn(hex)` the land hex a courier
 * stands on for it (a port's own hex is often water), `road(from, hex)` as `roadToStop`, `packet(from, hex)` a crossing
 * where no road goes.
 */
export function previewRoute(stops, { stopHex, standOn, road, packet }) {
  const n = stops.length;
  if (n < 2) return { legs: [], ms: 0, fares: 0, noRoad: false, lines: [] };
  const first = stopHex(stops[0]);
  let at = first === undefined ? undefined : standOn(first);
  const legs = [];
  const lines = [];
  let total = 0;
  let fares = 0;
  for (let from = 0; from < n; from++) {
    const to = (from + 1) % n;
    const hex = stopHex(stops[to]);
    if (hex === undefined || at === undefined) {
      legs.push({ from, to, state: 'away', ms: 0, hexes: 0 });
      if (hex !== undefined) at = standOn(hex);
      continue;
    }
    const leg = road(at, hex);
    if (leg === undefined) {
      const boat = packet?.(at, hex);
      if (boat !== undefined) {
        total += boat.ms;
        fares += boat.fare;
        legs.push({ from, to, state: 'packet', ms: boat.ms, hexes: boat.hexes.length, fare: boat.fare });
        lines.push([at, ...boat.hexes].map((h) => ({ q: h.q, r: h.r })));
        at = { q: boat.to.q, r: boat.to.r };
        continue;
      }
      legs.push({ from, to, state: 'noRoad', ms: 0, hexes: 0 });
      at = standOn(hex) ?? at;
      continue;
    }
    const ms = leg.reduce((sum, s) => sum + s.ms, 0);
    total += ms;
    legs.push({ from, to, state: 'ok', ms, hexes: leg.length });
    if (leg.length > 0) {
      lines.push([at, ...leg].map((h) => ({ q: h.q, r: h.r })));
      at = { q: leg[leg.length - 1].q, r: leg[leg.length - 1].r };
    }
  }
  return { legs, ms: total, fares, noRoad: legs.some((l) => l.state === 'noRoad'), lines };
}
