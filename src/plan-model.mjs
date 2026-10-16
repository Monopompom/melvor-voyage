// Plan a voyage, the rules (build .119): the Navigator's Charts unlock, what loading at a stop puts
// in the stores, and cutting a route into legs at loading places. Pure: the game side is src/planner.mjs, which hands
// in the leg pricing (stores.mjs) and the loading places (stores-model.mjs loadingAt) as functions. Modules are
// loaded one by one through ctx.loadModule, so stores-model.mjs comes in as the argument `S`, not an import.

/** The unlock (decided 16 Oct 2026; numbers to tune in play): from this Voyage level, bought once at a port. */
export const NAVIGATOR = { level: 50, // voyage-model.mjs NAVIGATOR_LEVEL (the milestone)
  gp: 300000, items: [{ id: 'voyage:Pitch', quantity: 100 }] };

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
export function simulateLoad(S, stores, cap, rates, bank) {
  const out = { food: stores.food, fuel: stores.fuel };
  const left = bank.map((x) => ({ ...x }));
  const used = [];
  for (const x of left) {
    const rate = rates?.[x.kind] ?? 0;
    const n = S.loadCount(x.unit, rate, x.qty, cap[x.kind] - out[x.kind]);
    if (n <= 0) continue;
    const added = S.loadAmount(x.unit, n, rate);
    out[x.kind] = x.kind === 'food' ? Math.min(cap.food, out.food + added) : S.roundFuel(Math.min(cap.fuel, out.fuel + added));
    x.qty -= n;
    used.push({ id: x.id, n, kind: x.kind, added });
  }
  return { stores: out, bank: left, used };
}

/**
 * Cuts a route of `n` steps into legs (hex 0 is where you stand, hex n the destination; step i enters hex i + 1).
 *  - `price(have, from, to)` prices steps from..to-1 starting with `have` (food, fuel and hull condition): a
 *    stores-model planMove result ({ ok, food, fuel, cond, why, at }).
 *  - `loadAt(i, have, bank)` loads at hex i: undefined where nothing can be loaded, else simulateLoad's result plus
 *    `place` (the loading place's id).
 * Greedy: the whole rest of the way when it can be paid, else the farthest loading place it reaches, where the stores
 * are refilled. Loading where you stand comes first when the way can't be paid without it. Returns
 * { ok, legs: [{ from, to, load? }], have (what is left at the end), why, at } with `load` the stop's loading at
 * hex `to`, and `depart` the loading at hex 0 when there is one; on failure `why`/`at` come from the leg that failed.
 */
export function splitLegs(n, have, bank, price, loadAt) {
  const legs = [];
  let from = 0;
  let cur = have;
  let stock = bank;
  let depart;
  if (n <= 0) return { ok: true, legs, have: cur };
  if (!price(cur, 0, n).ok) {
    const l = loadAt(0, cur, stock);
    if (l !== undefined && l.used.length > 0) { depart = l; cur = { ...cur, ...l.stores }; stock = l.bank; }
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
      const l = loadAt(to, after, stock);
      if (l === undefined || l.used.length === 0) continue;
      stop = { to, load: l, after };
      break;
    }
    if (stop === undefined) return { ok: false, legs, depart, have: cur, why: all.why, at: from + (all.at ?? 0) };
    legs.push({ from, to: stop.to, load: stop.load });
    cur = { ...stop.after, ...stop.load.stores };
    stock = stop.load.bank;
    from = stop.to;
  }
  return { ok: true, legs, depart, have: cur };
}
