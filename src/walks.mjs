// Folks walking alone on a travel order (phase 6d). The rules are in walk-model.mjs; this file reads the map for it.
// 6d-1 (build .342) is the groundwork: the road over known land and the walks in the save, with nothing that sends a
// Folk yet. Without Worker Folks API 4 (its travel 'walking') nobody walks.

const SEA = ['water', 'shoal'];

export function install(ctx, { state, W, log }) {
  /** The class of a hex a Folk may walk into: land you know (surveyed or charted). Undefined for sea or unknown. */
  const ground = (q, r) => {
    const rec = state.terrain?.get(q, r);
    if (rec === undefined || typeof rec.t !== 'string' || SEA.includes(rec.t) || rec.cloud === true) return undefined;
    return state.knowledge?.isKnown(rec) === false ? undefined : rec.t;
  };
  /** The quickest road on foot between two hexes { q, r }, or undefined (see walk-model findRoad). */
  const road = (from, to) => {
    try { return W.findRoad(from, to, ground); } catch (e) { log('walk road failed', e); return undefined; }
  };
  /** Worker Folks can send a Folk on its way (API 4). */
  const canWalk = () => (state.folksApi?.()?.version ?? 0) >= 4;
  /** The walks in the save, cleaned. */
  const walks = () => W.cleanWalks(state.voyageSkill?.()?.record?.walks);
  return { ground, road, canWalk, walks };
}
