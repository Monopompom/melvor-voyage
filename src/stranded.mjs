// Pure helpers for the wandering trader. No game globals: the game side (src/trader.mjs) passes the
// map in as functions, so the route search and the verdict are covered by Node tests.

/**
 * Cheapest route from `start` to the nearest hex passing `isGoal`, by `stepCost(hex)` paid on entering each hex
 * (vanilla travel charges the hex you step onto). Dijkstra with a binary heap; `key(hex)` must be unique per hex.
 * Returns { path, cost } with path ordered like vanilla Cartography paths (destination first, start last), or
 * undefined when no goal is reachable. The start itself is never a goal: the player already stands there.
 */
export function cheapestRoute(start, { neighbours, stepCost, isGoal, key }) {
  const dist = new Map([[key(start), 0]]);
  const prev = new Map();
  const nodes = new Map([[key(start), start]]);
  const heap = [[0, key(start)]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, k] = pop();
    if (d > dist.get(k)) continue;
    const hex = nodes.get(k);
    if (k !== key(start) && isGoal(hex)) {
      const path = [hex];
      let cur = k;
      while (prev.has(cur)) { cur = prev.get(cur); path.push(nodes.get(cur)); }
      return { path, cost: d };
    }
    for (const n of neighbours(hex)) {
      const nk = key(n);
      const nd = d + stepCost(n);
      if (!dist.has(nk) || nd < dist.get(nk)) {
        dist.set(nk, nd);
        prev.set(nk, k);
        nodes.set(nk, n);
        push([nd, nk]);
      }
    }
  }
  return undefined;
}

/**
 * The stranded verdict. A player is stranded when no way to earn GP works for them here (`gpSources`, by name), they
 * can't afford the road to a place where combat pays (`combatRoute`; arriving with 0 GP is fine, the fighting pays),
 * and trading can't get them out: either they have nothing to sell (`canSell` false, e.g. Adventure with every
 * skill locked) or trade is refused here and the cheapest road to a trading spot is not affordable (it would leave
 * 0 GP or less, or needs items they lack; no route at all counts as unaffordable).
 */
export function strandedVerdict({ tradeLocked, route, gp, gpSources = [], canSell = true, combatRoute }) {
  if (gpSources.length > 0) return { stranded: false, reason: `earns GP: ${gpSources.join(', ')}` };
  if (combatRoute !== undefined && combatRoute.itemsOwned !== false && gp >= combatRoute.gp) {
    return { stranded: false, reason: `can afford the road to combat (${combatRoute.gp} GP)` };
  }
  if (canSell) {
    if (!tradeLocked) return { stranded: false, reason: 'can trade here' };
    if (route !== undefined && route.itemsOwned !== false && gp - route.gp > 0) return { stranded: false, reason: `can afford the road (${route.gp} GP)` };
  }
  const why = !canSell ? 'nothing to sell' : route === undefined ? 'no route to trade' : `the road costs ${route.gp} GP, has ${gp}`;
  return { stranded: true, reason: combatRoute === undefined ? why : `${why}; the road to combat costs ${combatRoute.gp} GP` };
}
