// Travel traits, game side (phase 6f). The table and the counting rules are in folk-traits-model.mjs. Worker Folks
// (API 5) keeps each Folk's slots, the queue, Forget, the card icons and the notices; this file registers Voyage's ten
// traits there, keeps the counts in the Voyage save and asks Worker Folks to teach or fade a trait when its count is
// reached. Without API 5 nothing is counted and no travel trait exists.
//
// What counts (6f-2): your moves for the Folks with you (`moved`, from the movePlayer patch), each hex a Folk walks
// alone (`walked`, from walks.mjs), each work action a Folk finishes (Worker Folks' folkActionDone: time on one hex,
// time within a hex of a market), and a minute clock for a Footsore Folk standing on one hex. Any change of a Folk's
// place or travel (folkMoved) starts its "on one hex" counts again.

/** Game time between two counts of a Folk standing still (Footsore's fade); the passive tick adds 50 ms a call. */
const STILL_EVERY_MS = 60 * 1000;
const TICK_MS = 50;

export function install(ctx, { state, FT, S, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  /** The effect after a notice's colon reads lower case where it starts with a plain word (the colon rule). */
  const after = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  const canTraits = () => (state.folksApi?.()?.version ?? 0) >= 5;
  const api = () => (state.folksGuarded && canTraits() ? state.folksApi?.() : undefined);
  const record = () => { const s = state.voyageSkill?.(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  /** One Folk's counts, cleaned once per load and kept on the save record from then on. */
  let cleaned = false;
  const all = () => {
    const r = record();
    if (r === undefined) return undefined;
    if (!cleaned) { r.folkTraits = FT.cleanFolkTraits(r.folkTraits); cleaned = true; }
    return r.folkTraits;
  };
  const recordOf = (folkId, create = false) => {
    const map = all();
    if (map === undefined) return undefined;
    if (map[folkId] === undefined && create) map[folkId] = FT.emptyFolkTraits();
    return map[folkId];
  };
  /** Whether the Folk holds the trait or waits for a slot for it (short id), as Worker Folks says. */
  const hasOf = (folkId) => {
    const ids = api()?.traitsOf?.(folkId);
    const set = new Set([...(ids?.held ?? []), ...(ids?.waiting ?? [])]);
    return (id) => set.has(FT.fullId(id));
  };
  const hexKey = (place) => (place === null || place === undefined ? '' : `${place.q},${place.r}`);

  /** Asks Worker Folks for every trait whose count is reached, and spends the count of each one it takes. */
  const settle = (folkId, has = hasOf(folkId)) => {
    const a = api();
    const rec = recordOf(folkId);
    if (a === undefined || rec === undefined) return;
    const { earn, fade } = FT.due(rec, { has });
    for (const id of earn) {
      if (a.earnTrait(folkId, FT.fullId(id))) {
        FT.earned(rec, id, { hex: hexKey(a.folkById(folkId)?.place) });
        log(`trait ${id} earned by ${folkId}`);
      } else delete rec.counts[id];
    }
    for (const id of fade) {
      if (a.dropTrait(folkId, FT.fullId(id))) log(`trait ${id} faded for ${folkId}`);
      FT.lost(rec, id);
    }
  };

  const isRough = (cls) => S.ROUGH_GROUND.includes(cls);
  /** Runs moveOps/walkOps output for one Folk: resets, then reports (each settles). */
  const apply = (folkId, ops) => {
    for (const op of ops) {
      if (op.reset !== undefined) folkTraits.reset(folkId, op.reset);
      else folkTraits.report(folkId, op.source, op.amount);
    }
  };
  /** A hex is within a hex of a market (a trading place: city, capital, port, market). */
  const nearMarket = (hex) => {
    const m = state.market;
    if (m?.marketAt === undefined || hex == null) return false;
    if (m.marketAt(hex.q, hex.r) !== undefined) return true;
    try { return (state.terrain?.neighbours?.(hex.q, hex.r) ?? []).some((n) => m.marketAt(n.q, n.r) !== undefined); } catch { return false; }
  };
  /** The hex a Folk stands on: yours for a Folk with you, its own otherwise. */
  const hexOf = (f) => (f?.travel === 'with' ? state.position?.() : f?.place);

  const folkTraits = {
    /** API 5 is there and the save can hold counts. */
    usable: () => api() !== undefined && record() !== undefined,
    /** Adds progress of a source for one Folk (folk-traits-model SOURCES), then settles it. */
    report(folkId, source, amount = 1) {
      if (!folkTraits.usable() || typeof folkId !== 'string') return;
      const rec = recordOf(folkId, true);
      const has = hasOf(folkId);
      FT.addProgress(rec, source, amount, { has });
      settle(folkId, has);
    },
    /** A condition in a row is broken for one Folk (moved, a storm). */
    reset(folkId, source) {
      const rec = folkTraits.usable() ? recordOf(folkId) : undefined;
      if (rec !== undefined) FT.resetProgress(rec, source);
    },
    /** What the Folk's held travel traits add up to (folk-traits-model travelEffects). */
    effectsOf(folk, on) {
      return FT.travelEffects(canTraits() ? folk?.traits : [], on);
    },
    /** A move of yours landed (not a drift or a tow): what it teaches each Folk with you. */
    moved(steps) {
      if (!folkTraits.usable()) return;
      const ops = FT.moveOps(steps, { isRough });
      if (ops.length === 0) return;
      for (const f of state.crew?.list?.() ?? []) apply(f.id, ops);
    },
    /** A road (walk-model findRoad) at this Folk's pace from `start`: its walk speed on each hex, night or day. */
    pace(road, folk, start) {
      const held = canTraits() ? folk?.traits ?? [] : [];
      if (held.length === 0) return road;
      return FT.pacedRoad(road, start, (st, at) => FT.travelEffects(held, { rough: isRough(st.cls), night: state.stores?.nightAt?.(state.realAt?.(at) ?? at) ?? null }).walkSpeed);
    },
    /** A Folk walking alone entered these road hexes ({ cls, ms, night }). */
    walked(folkId, entered) {
      if (folkTraits.usable()) apply(folkId, FT.walkOps(entered, { isRough }));
    },
    /** Every passive tick: once a game minute, a Footsore Folk not on the road counts that minute on its hex. */
    tick() {
      still += TICK_MS;
      if (still < STILL_EVERY_MS) return;
      const ms = still;
      still = 0;
      const a = api();
      if (a === undefined || record() === undefined) return;
      for (const f of a.folks()) {
        if (f.travel !== 'walking' && (f.traits ?? []).includes(FT.fullId('Footsore'))) folkTraits.report(f.id, 'oneHexRest', ms);
      }
    },
    nearMarket,
    /** A Merchant on an outpost within a hex of you buys at its rate: { rate, folk, outpost } or undefined. */
    outpostSale() {
      const a = api();
      if (a === undefined) return undefined;
      return FT.outpostSale(state.outposts?.near?.() ?? [], a.folks());
    },
    /** The travel traits any of your Folks holds, in table order: [{ id, kind, fades }] (the Crew help lists only those). */
    known() {
      const a = api();
      return a === undefined ? [] : FT.knownTraits(a.folks()).map((id) => ({ id, kind: FT.traitDef(id).kind, fades: FT.traitDef(id).fade !== undefined }));
    },
    /** The numbers trait `id`'s texts name (folk-traits-model traitVars). */
    vars: (id) => FT.traitVars(id),
    /** Haggler within a hex of you at a market: { pct, folk } or undefined. */
    haggle() {
      const a = api();
      if (a === undefined || state.market?.here?.() === undefined) return undefined;
      return FT.haggle(a.folks(), state.position?.(), hexOf);
    },
  };
  let still = 0;
  /** A market within a hex of where the Folk stands (with you: where you stand; on the road: none). */
  const marketNear = (folk) => {
    try {
      if (folk?.travel === 'walking') return false;
      const h = hexOf(folk);
      if (h === undefined || h === null || !Number.isInteger(h.q)) return false;
      const m = state.market;
      if (m?.marketAt === undefined) return false;
      if (m.marketAt(h.q, h.r) !== undefined) return true;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) if (m.marketAt(h.q + dq, h.r + dr) !== undefined) return true;
      return false;
    } catch { return false; }
  };

  // A sale at a market (GP gained, and enough of it) counts for each Folk within a hex of you (Haggler's 50 sales).
  let gpBefore;
  ctx.patch(Bank, 'processItemSale').before(() => { try { gpBefore = game.gp.amount; } catch { gpBefore = undefined; } return undefined; });
  ctx.patch(Bank, 'processItemSale').after(() => {
    try {
      const gained = gpBefore === undefined ? 0 : game.gp.amount - gpBefore;
      gpBefore = undefined;
      const a = api();
      if (gained < FT.SALE_MIN_GP || a === undefined || state.market?.here?.() === undefined) return;
      const learner = FT.saleLearner(a.folks(), state.position?.(), hexOf);
      if (learner !== undefined) folkTraits.report(learner.id, 'saleNear', 1);
    } catch (e) { log('sale count failed', e); }
  });
  // At an outpost with a Merchant, a sale pays its rate of the usual price (the trader's half: Merchant's 50%): applied
  // in the one sale-price patch (src/market.mjs, build .386) through `outpostSale` below.

  ctx.onModsLoaded(() => {
    const a = state.folksApi?.();
    if (a === undefined || (a.version ?? 0) < 5) { log('travel traits: Worker Folks API 5 not there'); return; }
    try {
      for (const def of FT.TRAITS) {
        const key = `MOD_VOY_TRAIT_${def.id}`;
        a.registerTrait({
          id: FT.fullId(def.id),
          kind: def.kind,
          media: ctx.getResourceUrl(`assets/${def.icon}.webp`),
          name: () => t(key),
          effect: () => t(`${key}_DESC`, FT.traitVars(def.id)),
          effectAfter: () => after(t(`${key}_DESC`, FT.traitVars(def.id))),
          lasts: () => t(def.fade === undefined ? 'MOD_VOY_TRAIT_FOR_GOOD' : `${key}_FADES`, FT.traitVars(def.id)),
          // Haggler's wage and Homebody's XP on its own hex are Worker Folks' to apply.
          effects: def.folks === undefined ? undefined : (folk) => FT.folksEffects(def.id, recordOf(folk.id), folk.place, { nearMarket: marketNear(folk) }),
        });
      }
      // A trait gone (faded by Worker Folks' side, or forgotten) starts its count again; a Folk gone takes its counts.
      a.on('folkTrait', ({ folk, type, trait }) => {
        // A Folk on the road walks the rest of it at its new pace (Navigator is learned walking).
        if (folk?.id !== undefined && ['learned', 'slotted', 'faded', 'forgotten'].includes(type)) {
          try { state.walks?.repace?.(folk.id); } catch (e) { log('walk pace failed', e); }
        }
        const id = FT.shortId(trait?.id);
        if (id === undefined || (type !== 'forgotten' && type !== 'faded')) return;
        const rec = recordOf(folk.id);
        if (rec !== undefined) FT.lost(rec, id);
      });
      for (const name of ['folkFired', 'folkDied']) {
        a.on(name, ({ folk }) => { const map = all(); if (map !== undefined && folk?.id !== undefined) delete map[folk.id]; });
      }
      // A Folk's place or travel changed: the "on one hex" counts (Homebody, Footsore's fade) start again.
      a.on('folkMoved', ({ folk }) => { if (folk?.id !== undefined) folkTraits.reset(folk.id, 'moved'); });
      // Work done (online and in the catch-up): its time on one hex, and near a market when there is one.
      a.on('folkActionDone', ({ folk, intervalMs }) => {
        if (folk?.id === undefined || !(intervalMs > 0)) return;
        folkTraits.report(folk.id, 'workOneHex', intervalMs);
        if (nearMarket(hexOf(a.folkById(folk.id)))) folkTraits.report(folk.id, 'workNearMarket', intervalMs);
      });
      state.folkTraits = folkTraits;
      log(`travel traits: ${FT.TRAITS.length} registered with Worker Folks`);
    } catch (e) { console.error('[Voyage] travel traits failed to register', e); }
  });
  ctx.onCharacterLoaded(() => { cleaned = false; });
  return folkTraits;
}
