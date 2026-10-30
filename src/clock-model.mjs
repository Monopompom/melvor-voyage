// The ship's clock (phase 5a): how long a hex takes and the voyage record in the save. Pure: no game
// objects, tested in tests/clock-model.test.mjs. The game side is src/voyage-clock.mjs.
//
// A voyage is the walk of a route (start first), one hex at a time: each hex is one action of the Voyage skill with
// the hex's time as its timer. Entering a hex is an ordinary one-step Cartography.movePlayer, so it is paid exactly as
// an instant move (GP, stores, wear, light, its Voyage XP).

/** The game's tick (TICK_INTERVAL, v1.3.1). */
export const TICK_MS = 50;
const MIN = 60000;
/** A land hex on foot on easy ground (the user, 18 Oct 2026: the canvas's times, "will do balancing on the go"). */
export const LAND_MS = 6 * MIN;
/** A sea hex by hull. */
export const SEA_MS = { dinghy: 5 * MIN, longboat: 4 * MIN, brig: 3 * MIN, galleon: 2 * MIN };
/** Ground classes by the stores' fuel (4.4): fuel 1 is rough, fuel 2 snow and lava; the rest easy. */
export const ROUGH = ['desert', 'highlands', 'mountain', 'badlands', 'wastelands', 'cursedlands'];
export const HARD = ['snowlands', 'lavalands'];
export const SEA_CLASSES = ['water', 'shoal'];

export const groundFactor = (cls) => (HARD.includes(cls) ? 2 : ROUGH.includes(cls) ? 1.5 : 1);
/** A sea hex in `hull` (an id of ship-model HULLS); without one (the rules off) at the dinghy's pace. */
export const seaMs = (hull) => SEA_MS[hull] ?? SEA_MS.dinghy;

/**
 * Milliseconds for one step of ship.stepsOf ({ sea, cls, fastTravel, hop, vessel, wx }). `hullOf(kind)` names the hull of
 * the vessel kind ('boat' or 'ship'); `mountSpeed` the land speed (4.27). A fast-travel hop takes its straight-line
 * hexes (`hop`, or `dist` when the rules leave it vanilla) at the vessel's speed. `slowOf(kind)` multiplies a sailed
 * step's time (a worn hull, the flat mechanics: ship-model wornTime; 1 when absent).
 */
export function stepMs(step, { hullOf = () => undefined, mountSpeed = 1, slowOf = () => 1, pace = 1 } = {}) {
  if (step == null) return 0;
  const slow = (kind) => { const f = slowOf(kind); return Number.isFinite(f) && f > 0 ? f : 1; };
  // The gear's pace (gear-model.mjs): a factor on every hex, land and sea alike, applied last.
  const p = Number.isFinite(pace) && pace > 0 ? pace : 1;
  if (step.fastTravel) {
    const n = step.hop > 0 ? step.hop : Math.max(1, Math.round(step.dist ?? 1));
    return Math.round(n * seaMs(hullOf(step.vessel ?? 'boat')) * slow(step.vessel ?? 'boat') * p);
  }
  if (step.sea || SEA_CLASSES.includes(step.cls)) return Math.round(seaMs(hullOf(step.vessel ?? 'boat')) * slow(step.vessel ?? 'boat') * p);
  const speed = Number.isFinite(mountSpeed) && mountSpeed > 0 ? mountSpeed : 1;
  // The weather's band (phase 5c): snowdrifts in the bitter cold, resting at noon in the scorching heat.
  const wx = Number.isFinite(step.wx?.time) && step.wx.time > 0 ? step.wx.time : 1;
  return Math.round(LAND_MS * groundFactor(step.cls) * wx * p / speed);
}

/** Whole ticks for `ms`, at least one. */
export const ticksOf = (ms) => Math.max(1, Math.round(ms / TICK_MS));
/** A step sailed (a sea hex or a fast-travel hop): the wind's to time. */
export const isSailed = (step) => step != null && (step.fastTravel === true || step.sea === true || SEA_CLASSES.includes(step.cls));
/**
 * Ticks of each step of a route begun at `t0` (ms of game time), one after another: a sailed step's time is multiplied
 * by the wind blowing as it begins (phase 5c-2; `windOf(step, ms)` its factor, 1 for none; no `windOf`, no wind). So
 * the schedule is fixed when the voyage sets off, and the Set off popup's time is exact.
 * Storms (phase 5c-3): `stormOf(step, ms, i)` for a sailed step `i` entered at `ms` gives { x (its time factor), push }
 * when a storm is on that hex then, else undefined; a push adds one calm sea hex of the step's vessel (sailing back).
 */
export function routeTicks(steps, opts, t0, windOf, stormOf) {
  const out = [];
  let at = Number.isFinite(t0) ? t0 : 0;
  let i = -1;
  for (const s of steps ?? []) {
    i += 1;
    let ms = stepMs(s, opts);
    if (typeof windOf === 'function' && isSailed(s)) {
      const f = windOf(s, at);
      if (Number.isFinite(f) && f > 0) ms *= f;
    }
    if (typeof stormOf === 'function' && isSailed(s)) {
      const st = stormOf(s, at + ms, i);
      if (st !== undefined && Number.isFinite(st.x) && st.x > 0) ms = ms * st.x + (st.push ? seaMs((opts?.hullOf ?? (() => undefined))(s.vessel ?? 'boat')) : 0);
    }
    const ticks = ticksOf(ms);
    out.push(ticks);
    at += ticks * TICK_MS;
  }
  return out;
}
/**
 * Waiting out a storm (the flat mechanics): a route set off now that meets `stormsNow` stormy hexes is tried again every
 * STORM_WAIT_STEP_MS, up to STORM_WAIT_MAX_MS ahead; the first wait whose route meets none (`stormsAfter(waitMs)` counts
 * them) is offered. A wait for the wind alone never paid: each hex takes the wind it is entered in, so going now is
 * always ahead when the wind turns. [BALANCE]
 */
export const STORM_WAIT_STEP_MS = 10 * 60000;
export const STORM_WAIT_MAX_MS = 3 * 60 * 60000;
export function stormWaitMs(stormsNow, stormsAfter) {
  if (!(stormsNow > 0) || typeof stormsAfter !== 'function') return undefined;
  for (let w = STORM_WAIT_STEP_MS; w <= STORM_WAIT_MAX_MS; w += STORM_WAIT_STEP_MS) if (stormsAfter(w) === 0) return w;
  return undefined;
}
/** Milliseconds of a list of steps. */
export const routeMs = (steps, opts) => (steps ?? []).reduce((sum, s) => sum + stepMs(s, opts), 0);

/** { h, m } of a duration, minutes rounded up (a minute and a second reads "2 min"), at least one minute. */
export function durationParts(ms) {
  const total = Math.max(1, Math.ceil(Math.max(0, ms) / MIN));
  return { h: Math.floor(total / 60), m: total % 60 };
}
/** "m:ss" of a duration (the hex in progress). */
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The time a clock reads: the wall clock online; during the game's offline catch-up the moment being replayed
 * (`startTime + timeProcessed` of Game._offlineInfo), so night falls on each hex at its own hour.
 */
export function clockNow({ offline, info, now }) {
  if (offline && info != null && Number.isFinite(info.startTime) && Number.isFinite(info.timeProcessed) && info.startTime > 0) {
    return info.startTime + info.timeProcessed;
  }
  return now;
}

/**
 * The game clock's first reading on a save without one (build .421): where the game's own clock stands, so a stamp
 * taken on the real clock before it goes on as it was. During the offline catch-up the moment being replayed; else
 * the game's last tick (`lastTick`, Game.tickTimestamp: the catch-up still to run starts there), or now.
 */
export function gameClockSeed({ offline, info, lastTick, now }) {
  if (offline) return clockNow({ offline, info, now });
  return Number.isFinite(lastTick) && lastTick > 0 && lastTick <= now ? lastTick : now;
}

// ---- the voyage in the save (v15 `voyage`) --------------------------------------------------------------------------
/** An arrival choice: what the voyage starts on arrival, in order of preference (4.5 "On arrival, do this"). */
export const CHOICE_KINDS = ['skill', 'fight', 'dungeon', 'resume'];
const isId = (s) => typeof s === 'string' && s.length > 0 && s.length < 200;
export function cleanChoice(c) {
  if (c == null || typeof c !== 'object' || !CHOICE_KINDS.includes(c.k)) return undefined;
  switch (c.k) {
    case 'skill': return isId(c.skill) && isId(c.action) ? { k: 'skill', skill: c.skill, action: c.action } : undefined;
    case 'fight': return isId(c.area) && isId(c.monster) ? { k: 'fight', area: c.area, monster: c.monster } : undefined;
    case 'dungeon': return isId(c.area) ? { k: 'dungeon', area: c.area } : undefined;
    case 'resume': {
      // What you were doing at departure: a skill restarted with its own selection, or a fight.
      if (isId(c.area) && isId(c.monster)) return { k: 'resume', area: c.area, monster: c.monster };
      if (isId(c.skill)) return { k: 'resume', skill: c.skill, ...(isId(c.action) ? { action: c.action } : {}) };
      return undefined;
    }
    default: return undefined;
  }
}
export const sameChoice = (a, b) => a != null && b != null && JSON.stringify(cleanChoice(a)) === JSON.stringify(cleanChoice(b));
/** Up to three distinct choices, the empty ones dropped. */
export const cleanChain = (chain) => (Array.isArray(chain) ? chain : []).map(cleanChoice)
  .filter((c, i, all) => c !== undefined && all.findIndex((d) => sameChoice(c, d)) === i).slice(0, 3);

const isInt = (n) => Number.isInteger(n);
const cleanMode = (m) => (m != null && typeof m === 'object' ? JSON.parse(JSON.stringify(m)) : undefined);
/**
 * The voyage under way, or null. { walk: [{ q, r, m? }] start first (m: the path's voyageModes entry for the step into
 * that hex, ship.mjs), at (index of the hex you stand on), left (ticks of the step in progress), total (ticks of the
 * whole walk at departure), name, chain, loads (indexes where the route stops to load), began (ms), xp (Voyage XP
 * at departure), gp (GP at departure), spent (ticks run so far), of (ticks of the timer in progress: the step's, or a
 * survey's) }. A voyage into the fog (5b, fog-model.mjs) adds fog: true, side (hexes beside the route to survey) and
 * sv (the hexes still to survey before the next step, in turn; the timer is a survey's while it has any). A tow
 * (5b part two, adrift-model.mjs) adds tow: { kind (TOW_KINDS), port (the port's poi id), find (the port is found on
 * docking: the message in a bottle), gp (what was paid) }: free steps, no Stop here, nothing found on the way.
 */
export function cleanVoyage(v) {
  if (v == null || typeof v !== 'object' || !Array.isArray(v.walk) || v.walk.length < 2) return null;
  const walk = [];
  for (const h of v.walk) {
    if (h == null || !isInt(h.q) || !isInt(h.r)) return null;
    const m = cleanMode(h.m);
    walk.push(m === undefined ? { q: h.q, r: h.r } : { q: h.q, r: h.r, m });
  }
  const at = isInt(v.at) ? v.at : 0;
  if (at < 0 || at >= walk.length - 1) return null;
  return {
    walk,
    at,
    left: isInt(v.left) && v.left > 0 ? v.left : 1,
    total: isInt(v.total) && v.total > 0 ? v.total : 1,
    name: typeof v.name === 'string' ? v.name.slice(0, 200) : '',
    chain: cleanChain(v.chain),
    loads: (Array.isArray(v.loads) ? v.loads : []).filter((i) => isInt(i) && i > 0 && i < walk.length),
    began: Number.isFinite(v.began) ? v.began : 0,
    xp: Number.isFinite(v.xp) ? v.xp : 0,
    gp: Number.isFinite(v.gp) ? v.gp : 0,
    spent: isInt(v.spent) && v.spent >= 0 ? v.spent : 0,
    of: isInt(v.of) && v.of > 0 ? v.of : (isInt(v.left) && v.left > 0 ? v.left : 1),
    ...(v.fog === true ? { fog: true, side: isInt(v.side) && v.side >= 0 && v.side <= 3 ? v.side : 0, sv: cleanQueue(v.sv) } : {}),
    ...(cleanTow(v.tow) === undefined ? {} : { tow: cleanTow(v.tow) }),
    // The vessels worn below 50% when it set off (the flat mechanics): their hexes take longer for the whole voyage.
    worn: (Array.isArray(v.worn) ? v.worn : []).filter((k, i, a) => (k === 'boat' || k === 'ship') && a.indexOf(k) === i),
    // `pir`, the pirates of before version 1.1.0 waiting for an answer, is dropped: bands took their place, and the
    // voyage sails on.
    // A band met holds the voyage (encounters.mjs keeps the fight in the save's enc); 1 while it waits.
    ...(v.enc === 1 ? { enc: 1 } : {}),
    // The walk index where a stowaway climbs out (events-model stowawayAt), until it does.
    ...(isInt(v.stw) && v.stw > at && v.stw < walk.length ? { stw: v.stw } : {}),
  };
}

/** What may tow you (adrift-model.mjs TOW_KINDS; modules here can't import each other). */
export const TOW_KINDS = ['pay', 'fisherman', 'bottle', 'pushy'];
function cleanTow(t) {
  if (t == null || typeof t !== 'object' || !TOW_KINDS.includes(t.kind)) return undefined;
  return { kind: t.kind, port: typeof t.port === 'string' ? t.port.slice(0, 200) : '', find: t.find === true, gp: Number.isFinite(t.gp) && t.gp > 0 ? Math.floor(t.gp) : 0 };
}
function cleanQueue(sv) {
  if (!Array.isArray(sv)) return [];
  return sv.filter((h) => h != null && isInt(h.q) && isInt(h.r)).slice(0, 64).map((h) => ({ q: h.q, r: h.r }));
}

/**
 * The last voyage's ending, for the Voyage page and the offline summary, or null: { name, hexes, ms, xp, at (ms of
 * arrival or stop), how: 'arrived' | 'stopped' | 'refused' | 'adrift' (5b part two: the next hex could not be paid
 * out at sea; `why` 'food', 'gp' or 'hull'), tow (the kind of tow it was, '' none), started (label of what started, '' none), failed: [labels
 * that could not start, with their reason], seen (the offline summary told it), closed (dismissed on the page) }.
 */
export function cleanEnding(e) {
  if (e == null || typeof e !== 'object') return null;
  const how = ['arrived', 'stopped', 'refused', 'adrift'].includes(e.how) ? e.how : 'arrived';
  const str = (s) => (typeof s === 'string' ? s.slice(0, 300) : '');
  return {
    name: str(e.name),
    hexes: isInt(e.hexes) && e.hexes >= 0 ? e.hexes : 0,
    ms: Number.isFinite(e.ms) && e.ms >= 0 ? e.ms : 0,
    xp: Number.isFinite(e.xp) && e.xp >= 0 ? Math.floor(e.xp) : 0,
    at: Number.isFinite(e.at) ? e.at : 0,
    how,
    tow: TOW_KINDS.includes(e.tow) ? e.tow : '',
    started: str(e.started),
    // Why a refused voyage stopped, when it was not the GP (build .227: a fog hex it could not survey); '' the GP.
    why: str(e.why),
    // Something was set for the arrival (build .227); old endings say yes, as they read before.
    asked: e.asked !== false,
    failed: (Array.isArray(e.failed) ? e.failed : []).filter((f) => f != null && typeof f === 'object').slice(0, 3)
      .map((f) => ({ name: str(f.name), why: str(f.why) })),
    seen: e.seen === true,
    closed: e.closed === true,
  };
}

/** Ticks still to sail: the step in progress plus the steps after it (`stepTicks` per step, walking order). */
export function ticksLeft(v, stepTicks) {
  if (v == null) return 0;
  let n = v.left;
  for (let i = v.at + 1; i < v.walk.length - 1; i++) n += stepTicks[i] ?? 0;
  return n;
}

// ---- the route line on the map (build .272) ------------------------------------------------------------------------
/** A running voyage's walk split at the hex you are on: `behind` (walked, drawn dim) and `ahead`; both hold walk[at]. */
export function routeParts(v) {
  if (v == null || !Array.isArray(v.walk) || v.walk.length < 2) return null;
  const at = Math.min(Math.max(0, Math.trunc(v.at) || 0), v.walk.length - 1);
  const pt = ({ q, r }) => ({ q, r });
  return { behind: v.walk.slice(0, at + 1).map(pt), ahead: v.walk.slice(at).map(pt) };
}

/** Length of a polyline of { x, y } points. */
export function polyLength(pts) {
  let n = 0;
  for (let i = 1; i < (pts?.length ?? 0); i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}

/** The piece of a polyline from distance `a` to `b` along it (clamped to its ends), as points; [] when empty. */
export function polySlice(pts, a, b) {
  const len = polyLength(pts);
  const from = Math.max(0, Math.min(a, len));
  const to = Math.max(0, Math.min(b, len));
  if (!(to > from)) return [];
  const out = [];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    const at = (d) => ({ x: p.x + (q.x - p.x) * ((d - walked) / seg), y: p.y + (q.y - p.y) * ((d - walked) / seg) });
    if (seg > 0 && walked + seg >= from && walked <= to) {
      if (out.length === 0) out.push(at(Math.max(from, walked)));
      out.push(at(Math.min(to, walked + seg)));
    }
    walked += seg;
    if (walked >= to) break;
  }
  return out;
}
