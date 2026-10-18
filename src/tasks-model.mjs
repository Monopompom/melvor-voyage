// Voyage tasks (phase 4): the pure rules of the harbour board's Notices. Slayer style: one task at a
// time, posted at the ports. Two kinds: set foot on a place you have not found, or bring goods gathered after you take
// the task to a port you know. No game objects here: the runtime (tasks.mjs) hands in plain data.

/** Notices a port posts each season (with the cargo, every 72 hours). */
export const NOTICES = 3;
/** A place to reach is at least this many hexes from the posting port (the user, 17 Oct 2026), and at most MAX. */
export const REACH_MIN = 10;
export const REACH_MAX = 30;
/** The nearest hex where the goods can be had is at least this many hexes from the hand-in port (the user). */
export const BRING_MIN = 8;
/** Pay (placeholders for the balance rerun): a hex of the way. A Reach task's GP is REACH_SHARE of
 *  what the trip costs by the game's own travel prices (the user, 18 Oct 2026: "150%"; at 150 GP a hex it paid about
 *  0.2% of the trip), never below REACH_PAY.gp a hex; each place pays once, so it can't be farmed. */
export const REACH_PAY = { gp: 150, xp: 30 };
export const REACH_SHARE = 1.5;

/** A Reach task's GP: REACH_SHARE of the trip's cost `routeGp` (unknown: undefined), rounded up to 100, or the floor. */
export function reachGp(routeGp, hexes) {
  const floor = hexes * REACH_PAY.gp;
  if (!Number.isFinite(routeGp) || routeGp <= 0) return floor;
  return Math.max(floor, Math.ceil((routeGp * REACH_SHARE) / 100) * 100);
}
export const BRING_PAY = { gp: 100, xp: 20 };
/** Goods are paid at twice their sell price, as cargo is (4.22). */
export const GOODS_PAY = 2;
/** After a task is dropped, the next Take waits this long. */
export const WAIT_MS = 3600 * 1000;
/** A Bring task asks about this much work: the count is this time over the action's interval. */
export const WORK_MS = 20 * 60 * 1000;
export const BRING_MIN_N = 10;
export const BRING_MAX_N = 500;

export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** How many goods a Bring task asks for: about WORK_MS of work, a round number (5s under 50, then 10s). */
export function bringCount(intervalMs) {
  const raw = Number.isFinite(intervalMs) && intervalMs > 0 ? WORK_MS / intervalMs : BRING_MIN_N;
  const n = Math.min(BRING_MAX_N, Math.max(BRING_MIN_N, raw));
  const step = n < 50 ? 5 : 10;
  return Math.max(BRING_MIN_N, Math.round(n / step) * step);
}

/** The nearest of `zone` ({ q, r }[]) to `at`, in hexes; Infinity for none. */
export const zoneDistance = (at, zone) => zone.reduce((d, h) => Math.min(d, hexDist(at, h)), Infinity);

/**
 * A Reach notice from the port `post` ({ poi, q, r }): one of `places` ({ poi, q, r }: places not found yet that your
 * hulls can reach) between REACH_MIN and REACH_MAX hexes away, picked by `r`. Undefined when none is. `costOf(place)`
 * gives the trip's GP by the game's travel prices, priced by reachGp: null when there is no way for your hulls today
 * (a sea place with no boat yet), and the place is not posted; undefined when unknown, and it pays the floor.
 */
export function makeReach(post, places, r, id, costOf = () => undefined) {
  const pool = places.map((p) => ({ ...p, d: hexDist(post, p) })).filter((p) => p.d >= REACH_MIN && p.d <= REACH_MAX)
    .map((p) => ({ ...p, cost: costOf(p) })).filter((p) => p.cost !== null)
    .sort((a, b) => a.d - b.d || (a.poi < b.poi ? -1 : 1));
  if (pool.length === 0) return undefined;
  const p = pool[Math.floor(r() * pool.length)];
  return { id, k: 'reach', poi: p.poi, q: p.q, r: p.r, hexes: p.d, gp: reachGp(p.cost, p.d), xp: p.d * REACH_PAY.xp };
}

/**
 * A Bring notice: one of `goods` ({ id, price, interval, zone: [{ q, r }] }) to one of `ports` ({ poi, q, r }, the
 * ports you know, `post` among them), where the nearest hex the goods come from is BRING_MIN or more from the hand-in.
 * The posting port takes it in when it can; else another port. `skip`: goods already on this board.
 */
export function makeBring(post, goods, ports, r, id, skip = []) {
  const pool = [];
  for (const g of goods) {
    if (skip.includes(g.id) || !Array.isArray(g.zone) || g.zone.length === 0) continue;
    const here = zoneDistance(post, g.zone);
    if (here >= BRING_MIN) { pool.push({ g, to: post, d: here }); continue; }
    const far = ports.filter((p) => p.poi !== post.poi).map((p) => ({ p, d: zoneDistance(p, g.zone) })).filter((x) => x.d >= BRING_MIN && Number.isFinite(x.d))
      .sort((a, b) => (a.p.poi < b.p.poi ? -1 : 1));
    if (far.length > 0) { const x = far[Math.floor(r() * far.length)]; pool.push({ g, to: x.p, d: x.d + hexDist(post, x.p) }); }
  }
  if (pool.length === 0) return undefined;
  pool.sort((a, b) => (a.g.id < b.g.id ? -1 : 1));
  const pick = pool[Math.floor(r() * pool.length)];
  const n = bringCount(pick.g.interval);
  const hexes = Math.max(1, Math.round(pick.d));
  return {
    id, k: 'bring', item: pick.g.id, n, to: pick.to.poi, hexes,
    gp: Math.round(n * (pick.g.price ?? 0) * GOODS_PAY) + hexes * BRING_PAY.gp, xp: hexes * BRING_PAY.xp,
  };
}

/** A port's notices for a season: one Reach (when a place qualifies), the rest Bring; NOTICES at most. */
export function makeNotices(post, season, { places = [], goods = [], ports = [], costOf }, r) {
  const out = [];
  const id = (i) => `${post.poi}.${season}.t${i}`;
  const reach = makeReach(post, places, r, id(0), costOf);
  if (reach !== undefined) out.push(reach);
  for (let i = 1; out.length < NOTICES && i <= NOTICES; i++) {
    const b = makeBring(post, goods, ports, r, id(i), out.filter((x) => x.k === 'bring').map((x) => x.item));
    if (b === undefined) break;
    out.push(b);
  }
  return out;
}

/** Taking a notice: the task, with the count of its goods found so far (`base`) and the port it was taken at. */
export const takeTask = (notice, from, base = 0, at = 0) => ({ ...notice, from, base: Math.max(0, Math.floor(base) || 0), at });

/** A Bring task's progress: goods found since it was taken, never above its count. */
export const progressOf = (task, foundNow) => (task?.k !== 'bring' ? 0 : Math.min(task.n, Math.max(0, (Math.floor(foundNow) || 0) - task.base)));

/** A Bring task can be handed in at its port: enough found since taken, and that many in the bank. */
export const canHandIn = (task, foundNow, inBank, atPoi) => task?.k === 'bring' && atPoi === task.to && progressOf(task, foundNow) >= task.n && inBank >= task.n;

/** Ms until the next Take after a drop (0: now). */
export const waitLeft = (wait, now) => Math.max(0, (Number.isFinite(wait) ? wait : 0) - now);

// ---- the save --------------------------------------------------------------------------------------------------
const whole = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const str = (v) => typeof v === 'string' && v !== '';
function cleanNotice(x) {
  if (x === null || typeof x !== 'object' || !str(x.id)) return undefined;
  const base = { id: x.id, hexes: whole(x.hexes), gp: whole(x.gp), xp: whole(x.xp) };
  if (x.k === 'reach' && str(x.poi) && Number.isInteger(x.q) && Number.isInteger(x.r)) return { ...base, k: 'reach', poi: x.poi, q: x.q, r: x.r };
  if (x.k === 'bring' && str(x.item) && str(x.to) && whole(x.n) > 0) return { ...base, k: 'bring', item: x.item, n: whole(x.n), to: x.to };
  return undefined;
}
/** The tasks record (save v14): { boards: { [poi]: { s, list } }, cur, wait }, anything unreadable dropped. */
export function cleanTasks(t) {
  const out = { boards: {}, cur: null, wait: 0 };
  if (t === null || typeof t !== 'object') return out;
  for (const [poi, b] of Object.entries(t.boards ?? {})) {
    if (b === null || typeof b !== 'object' || !Number.isInteger(b.s) || !Array.isArray(b.list)) continue;
    out.boards[poi] = { s: b.s, list: b.list.map(cleanNotice).filter(Boolean) };
  }
  const cur = t.cur === null ? undefined : cleanNotice(t.cur);
  if (cur !== undefined && str(t.cur.from)) out.cur = { ...cur, from: t.cur.from, base: whole(t.cur.base), at: whole(t.cur.at) };
  out.wait = whole(t.wait);
  return out;
}
