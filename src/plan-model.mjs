// Plan a voyage, the rules (build .119): the Navigator's Charts unlock, what loading at a stop puts
// in the stores, and cutting a route into legs at loading places. Pure: the game side is src/planner.mjs, which hands
// in the leg pricing (stores.mjs) and the loading places (stores-model.mjs loadingAt) as functions. Modules are
// loaded one by one through ctx.loadModule, so stores-model.mjs comes in as the argument `S`, not an import.

/**
 * The unlock (decided 16 Oct 2026): from this Voyage level, bought once at a port. The GP is priced in days of the
 * game's fares since build .399 (the brig's price, five levels before: 300,000 was a token beside them).
 */
export const NAVIGATOR = { level: 50, // voyage-model.mjs NAVIGATOR_LEVEL (the milestone)
  gp: 10000000, items: [{ id: 'voyage:Pitch', quantity: 100 }] };

/**
 * Why Navigator's Charts can't be bought now, or undefined when they can: 'owned', 'level', 'port' (not standing on
 * a port), 'cost' (short of GP or items). `have` = { owned, level, atPort, gp, items: { id: qty } }.
 */
export function navigatorBlocker(have) {
  if (have.owned) return 'owned';
  if (have.level < NAVIGATOR.level) return 'level';
  if (!have.atPort) return 'port';
  if (have.gp < NAVIGATOR.gp || NAVIGATOR.items.some(({ id, quantity }) => (have.items?.[id] ?? 0) < quantity)) return 'cost';
  return undefined;
}

/**
 * What loading at a place does, as the stores block's Load does it item by item: the bank's best food first, then
 * fuel, each up to the stores limit (stores-model.mjs loadCount: the last item may spill over). `bank` is
 * [{ id, kind: 'food' | 'fuel', unit, qty }] in the order to load. Returns { stores, bank (with the quantities left),
 * used: [{ id, n, kind, added }] }; nothing changes at a rate of 0. `S`: stores-model.mjs.
 */
export function simulateLoad(S, stores, cap, rates, bank, planLoad) {
  const out = { food: stores.food, fuel: stores.fuel };
  const left = bank.map((x) => ({ ...x }));
  const used = [];
  // Local supply (4.4a): `rates` may be the places in reach, each with its stock ({ key, place, food, fuel, stock }),
  // loaded through supply-model planLoad (best rate first, each up to its stock), the stocks drawn item by item.
  const sources = Array.isArray(rates) && typeof planLoad === 'function' ? rates.map((s) => ({ ...s, stock: { ...s.stock } })) : undefined;
  // What each place gave, in stores units by key ({ food, fuel }): a later stop of the same trip finds it gone.
  const drawn = {};
  for (const x of left) {
    let n;
    let added;
    if (sources !== undefined) {
      const p = planLoad(S, x.unit, x.qty, cap[x.kind] - out[x.kind], sources, x.kind);
      n = p.n;
      added = p.added;
      for (const part of p.parts) {
        const s = sources.find((y) => y.key === part.key);
        if (s !== undefined) s.stock[x.kind] -= part.added;
        drawn[part.key] ??= { food: 0, fuel: 0 };
        drawn[part.key][x.kind] += part.added;
      }
    } else {
      const rate = rates?.[x.kind] ?? 0;
      n = S.loadCount(x.unit, rate, x.qty, cap[x.kind] - out[x.kind]);
      added = n > 0 ? S.loadAmount(x.unit, n, rate) : 0;
    }
    if (n <= 0) continue;
    out[x.kind] = x.kind === 'food' ? Math.min(cap.food, out.food + added) : S.roundFuel(Math.min(cap.fuel, out.fuel + added));
    x.qty -= n;
    used.push({ id: x.id, n, kind: x.kind, added });
  }
  return { stores: out, bank: left, used, drawn };
}

/** Two `drawn` maps (simulateLoad) added up, key by key: what the stops so far took from each place. */
export function addDrawn(a, b) {
  const out = {};
  for (const m of [a, b]) for (const [k, v] of Object.entries(m ?? {})) {
    out[k] ??= { food: 0, fuel: 0 };
    out[k].food += v?.food ?? 0;
    out[k].fuel += v?.fuel ?? 0;
  }
  return out;
}

/**
 * Cuts a route of `n` steps into legs (hex 0 is where you stand, hex n the destination; step i enters hex i + 1).
 *  - `price(have, from, to)` prices steps from..to-1 starting with `have` (food, fuel and hull condition): a
 *    stores-model planMove result ({ ok, food, fuel, cond, why, at }).
 *  - `loadAt(i, have, bank, taken)` loads at hex i: undefined where nothing can be loaded, else simulateLoad's result
 *    plus `place` (the loading place's id). `taken`: what the stops before it drew from each place (addDrawn of their
 *    `drawn`), so two stops in reach of one place share its stock instead of both counting all of it.
 * Greedy: the whole rest of the way when it can be paid, else the farthest loading place it reaches, where the stores
 * are refilled. Loading where you stand comes first when the way can't be paid without it. Returns
 * { ok, legs: [{ from, to, load? }], have (what is left at the end), why, at } with `load` the stop's loading at
 * hex `to`, and `depart` the loading at hex 0 when there is one; on failure `why`/`at` come from the leg that failed.
 */
/** A loading worth a stop: at least one whole unit of food or fuel goes in (build .386; "Stock up (+0.06 fuel)" at a nearly full tank). */
export const worthLoading = (l) => l !== undefined && l.used.some((u) => (u.added ?? u.n ?? 0) >= 1);
export function splitLegs(n, have, bank, price, loadAt) {
  const legs = [];
  let from = 0;
  let cur = have;
  let stock = bank;
  let taken = {};
  let depart;
  if (n <= 0) return { ok: true, legs, have: cur };
  if (!price(cur, 0, n).ok) {
    const l = loadAt(0, cur, stock, taken);
    if (worthLoading(l)) { depart = l; cur = { ...cur, ...l.stores }; stock = l.bank; taken = addDrawn(taken, l.drawn); }
  }
  while (from < n) {
    const all = price(cur, from, n);
    if (all.ok) {
      legs.push({ from, to: n });
      return { ok: true, legs, depart, have: { ...cur, food: all.food, fuel: all.fuel, ...(all.cond === undefined ? {} : { cond: all.cond }), ...(all.conds === undefined ? {} : { conds: all.conds }) } };
    }
    let stop;
    for (let to = n - 1; to > from; to--) {
      const p = price(cur, from, to);
      if (!p.ok) continue;
      const after = { ...cur, food: p.food, fuel: p.fuel, ...(p.cond === undefined ? {} : { cond: p.cond }), ...(p.conds === undefined ? {} : { conds: p.conds }) };
      const l = loadAt(to, after, stock, taken);
      if (!worthLoading(l)) continue;
      stop = { to, load: l, after };
      break;
    }
    if (stop === undefined) return { ok: false, legs, depart, have: cur, why: all.why, at: from + (all.at ?? 0) };
    legs.push({ from, to: stop.to, load: stop.load });
    cur = { ...stop.after, ...stop.load.stores };
    stock = stop.load.bank;
    taken = addDrawn(taken, stop.load.drawn);
    from = stop.to;
  }
  return { ok: true, legs, depart, have: cur };
}

/**
 * A leg's game path (destination first) for the steps from..to-1 of `walk` (start first). `modes` is the whole route's
 * `voyageModes` (ship.mjs computePath, destination first, one per step): the leg keeps its own share, so each step is
 * sailed, priced and worn in its own vessel (build .313: without them every sea step went to the small boat).
 */
export function legPath(walk, from, to, modes) {
  const path = walk.slice(from, to + 1).reverse();
  if (Array.isArray(modes)) {
    const n = walk.length - 1;
    path.voyageModes = modes.slice(n - to, n - from);
  }
  return path;
}

/**
 * What a trip set off with the map's Travel takes from the plan (build .420, the user: "inherit those actions"):
 * 'none' when it doesn't end on one of the plan's hexes, 'route' when it is the plan's own route (its stops apply
 * too), else 'pick' (the On arrival pick only). `planHexes` [{ q, r }]; `path` and `planPath` in the game's order,
 * destination first, each hex with q and r.
 */
export function travelHandover(planHexes, path, planPath) {
  const dest = Array.isArray(path) ? path[0] : undefined;
  if (dest === undefined || !planHexes.some((h) => h.q === dest.q && h.r === dest.r)) return 'none';
  const same = Array.isArray(planPath) && planPath.length === path.length && planPath.every((h, i) => h.q === path[i].q && h.r === path[i].r);
  return same ? 'route' : 'pick';
}
