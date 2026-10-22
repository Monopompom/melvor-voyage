// Travel traits (phase 6f): what a Folk learns on the road, Voyage's side of Worker Folks' earned traits. Worker Folks
// keeps the slots, the queue, Forget and the card icons (its API v5); Voyage counts what each Folk does on the map,
// says when a trait is earned or fades, and applies the effects that are about travel. Pure: no game globals. A Folk's
// counts live in the Voyage save as { counts, home }.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Worker Folks keys other mods' traits by namespace. */
export const TRAIT_NS = 'voyage';
export const fullId = (id) => `${TRAIT_NS}:${id}`;
export const shortId = (full) => (typeof full === 'string' && full.startsWith(`${TRAIT_NS}:`) ? full.slice(TRAIT_NS.length + 1) : undefined);

/**
 * Every travel trait in display order (the user, 20 Oct 2026, the canvases "Voyage 6e–6f" and "Worker Folks: earned
 * traits"). `learn.on` names the progress source the game side reports and `learn.target` how much of it teaches the
 * trait; `learn.resetOn` a source that sends the count back to zero (a condition in a row). `fade` is how a bad trait
 * goes, the same way. Effects are percentages: walk (a walk alone, any ground), rough* (on rough, snow or lava
 * ground, on foot), night/day (walking by night or day), roadFood (food on a walk), seaFood (food at sea, its share as crew), sales (your sales at a market within a hex of it), sellAtOutpost (you
 * can sell at the outpost it stands on, at that share of the trader's price). `folks` are the ones Worker Folks
 * applies itself (wage; homeXP is skill XP on the hex it learned Homebody on).
 */
export const TRAITS = [
  { id: 'Seafarer', kind: 'good', icon: 'trait_seafarer', learn: { on: 'seaBerth', target: 200 }, effects: { seaFood: -25 } },
  { id: 'Hardy', kind: 'good', icon: 'trait_hardy', learn: { on: 'roughFoot', target: 50 }, effects: { roughWalk: 25, roughFood: -25 } },
  { id: 'Navigator', kind: 'good', icon: 'trait_navigator', learn: { on: 'walkAlone', target: 150 }, effects: { walk: 25 } },
  { id: 'Merchant', kind: 'good', icon: 'trait_merchant', learn: { on: 'workNearMarket', target: 24 * HOUR }, effects: { sellAtOutpost: 50 } },
  { id: 'Wanderer', kind: 'mixed', icon: 'trait_wanderer', learn: { on: 'travelled', target: 300 }, effects: { walk: 25, roadFood: 25 } },
  { id: 'Homebody', kind: 'mixed', icon: 'trait_homebody', learn: { on: 'workOneHex', target: 7 * DAY, resetOn: 'moved' }, effects: { walk: -25 }, folks: { homeXP: 10 } },
  { id: 'Haggler', kind: 'mixed', icon: 'trait_haggler', learn: { on: 'saleNear', target: 50 }, effects: { sales: 5 }, folks: { wage: 20 } },
  { id: 'Stargazer', kind: 'mixed', icon: 'trait_stargazer', learn: { on: 'nightRoad', target: 24 * HOUR }, effects: { night: 25, day: -10 } },
  { id: 'Seasick', kind: 'bad', icon: 'trait_seasick', learn: { on: 'storm', target: 1 }, effects: { seaFood: 50 }, fade: { on: 'calmSea', target: 100, resetOn: 'storm' } },
  { id: 'Footsore', kind: 'bad', icon: 'trait_footsore', learn: { on: 'hungryLand', target: 10 }, effects: { walk: -25 }, fade: { on: 'oneHexRest', target: 3 * DAY, resetOn: 'moved' } },
];

const BY_ID = new Map(TRAITS.map((t) => [t.id, t]));

export function traitDef(id) {
  return BY_ID.get(id) ?? BY_ID.get(shortId(id));
}

/**
 * The numbers a trait's texts name, from its row, so a balance change can't leave the words behind: each effect as a
 * positive percent (`walk: -25` reads "25% slower"), and `fade` its fade's target, in days when it is time, else hexes.
 */
export function traitVars(id) {
  const def = traitDef(id);
  if (def === undefined) return {};
  const vars = {};
  for (const [k, x] of Object.entries({ ...def.effects, ...def.folks })) vars[k] = `${Math.abs(x)}`;
  if (def.fade !== undefined) vars.fade = `${def.fade.target >= DAY ? Math.round(def.fade.target / DAY) : def.fade.target}`;
  return vars;
}

/** The sources the game side reports, each once. */
export const SOURCES = [...new Set(TRAITS.flatMap((t) => [t.learn.on, t.learn.resetOn, t.fade?.on, t.fade?.resetOn]).filter((s) => s !== undefined))];

export function emptyFolkTraits() {
  return { counts: {}, home: '' };
}

const fadeKey = (id) => `${id}.fade`;
const HEX_RE = /^-?\d{1,4},-?\d{1,4}$/;

/**
 * Adds `amount` of a progress source to one Folk's record: the learning count of each trait it lacks, the fade count
 * of each bad trait it has. `has(id)` says whether the Folk holds the trait or waits for a slot for it (Worker Folks
 * knows; short ids). Amounts are hexes, hours in ms or events, as the table's targets.
 */
export function addProgress(rec, source, amount, { has }) {
  const n = Number(amount);
  if (!(n > 0)) return;
  for (const t of TRAITS) {
    if (t.learn.on === source && !has(t.id)) rec.counts[t.id] = (rec.counts[t.id] ?? 0) + n;
    if (t.fade?.on === source && has(t.id)) rec.counts[fadeKey(t.id)] = (rec.counts[fadeKey(t.id)] ?? 0) + n;
  }
}

/** A source that breaks a condition in a row: those counts go back to zero. */
export function resetProgress(rec, source) {
  for (const t of TRAITS) {
    if (t.learn.resetOn === source) delete rec.counts[t.id];
    if (t.fade?.resetOn === source) delete rec.counts[fadeKey(t.id)];
  }
}

/** What has reached its target: { earn: [ids], fade: [ids] } (short ids). The caller asks Worker Folks for each. */
export function due(rec, { has }) {
  const earn = [];
  const fade = [];
  for (const t of TRAITS) {
    if (!has(t.id) && (rec.counts[t.id] ?? 0) >= t.learn.target) earn.push(t.id);
    if (t.fade !== undefined && has(t.id) && (rec.counts[fadeKey(t.id)] ?? 0) >= t.fade.target) fade.push(t.id);
  }
  return { earn, fade };
}

/**
 * Worker Folks took the trait (learned or waiting): its learning count is spent. Homebody remembers the hex it was
 * learned on (`hex` "q,r"), where its XP counts.
 */
export function earned(rec, id, { hex = '' } = {}) {
  delete rec.counts[id];
  delete rec.counts[fadeKey(id)];
  if (id === 'Homebody' && HEX_RE.test(hex)) rec.home = hex;
}

/** The trait faded or was forgotten: both its counts start again, and Homebody forgets its hex. */
export function lost(rec, id) {
  delete rec.counts[id];
  delete rec.counts[fadeKey(id)];
  if (id === 'Homebody') rec.home = '';
}

/**
 * What the travel traits a Folk holds add up to, as factors (1 = no change). `held` are full or short ids; unknown
 * ones add nothing. `on`: { rough, night } for a walk's hex; `night` null when the game has no night (the "Night"
 * setting off), so Stargazer neither gains nor loses. A walk's speed factor multiplies its pace (1.25 = 25% faster);
 * food factors multiply what it eats.
 */
export function travelEffects(held, { rough = false, night = false } = {}) {
  const pct = (key) => (held ?? []).reduce((sum, id) => sum + (traitDef(id)?.effects[key] ?? 0), 0);
  const factor = (p) => Math.max(0.1, 1 + p / 100);
  const walkPct = pct('walk') + (rough ? pct('roughWalk') : 0) + (night === null ? 0 : night ? pct('night') : pct('day'));
  const foodPct = pct('roadFood') + (rough ? pct('roughFood') : 0);
  const sellRate = Math.max(0, ...(held ?? []).map((id) => traitDef(id)?.effects.sellAtOutpost ?? 0));
  return {
    walkSpeed: factor(walkPct),
    roadFood: factor(foodPct),
    seaFood: factor(pct('seaFood')),
    sales: pct('sales'),
    sellAtOutpost: sellRate / 100,
  };
}

/**
 * The effects Worker Folks applies for a held travel trait (registered through its API): Haggler's wage, and
 * Homebody's skill XP while the Folk stands on its own hex (`place` { q, r } against the record's `home`).
 */
export function folksEffects(id, rec, place, { nearMarket = true } = {}) {
  const def = traitDef(id);
  if (def?.folks === undefined) return {};
  const out = {};
  // Haggler's wage only within a hex of a market (build .386; it was for ever, everywhere: a Trainee needed 120,000 GP/h
  // of sales to break even).
  if (def.folks.wage !== undefined && nearMarket) out.wage = def.folks.wage;
  if (def.folks.homeXP !== undefined && place !== null && place !== undefined && rec?.home === `${place.q},${place.r}`) out.xp = def.folks.homeXP;
  return out;
}

/**
 * What one move of yours teaches the Folks with you: [{ reset }] to start a count again and [{ source, amount }] to
 * report, in that order. `steps` are the move's steps (ship.stepsOf, after the stores marked the hungry ones): a hop
 * counts its hexes at sea; `isRough(cls)` says whether a land hex is rough, snow or lava ground. Every hex is
 * travelled (Wanderer); at sea each is a hex in a berth (Seafarer) and a storm (Seasick) or calm (Seasick fades); on
 * land a rough hex is one on foot (Hardy) and a hungry one counts for Footsore. Any move resets the "on one hex"
 * counts. A storm sends the calm count back to zero, so only the calm hexes after the move's last storm count, and
 * they come after the storm (a Folk that learns Seasick there starts its fade with them).
 */
export function moveOps(steps, { isRough = () => false } = {}) {
  const list = Array.isArray(steps) ? steps.filter((st) => st !== null && typeof st === 'object') : [];
  if (list.length === 0) return [];
  const sum = { travelled: 0, seaBerth: 0, roughFoot: 0, hungryLand: 0 };
  let storms = 0;
  let calm = 0;
  for (const st of list) {
    const hexes = st.hop > 0 ? st.hop : 1;
    sum.travelled += hexes;
    if (st.hop > 0 || st.sea === true) {
      sum.seaBerth += hexes;
      if (st.storm !== undefined && st.storm !== null) { storms += 1; calm = 0; } else calm += hexes;
    } else {
      if (isRough(st.cls)) sum.roughFoot += 1;
      if (st.hungry === true) sum.hungryLand += 1;
    }
  }
  const ops = [{ reset: 'moved' }];
  for (const [source, amount] of Object.entries(sum)) if (amount > 0) ops.push({ source, amount });
  if (storms > 0) ops.push({ source: 'storm', amount: storms }, { reset: 'storm' });
  if (calm > 0) ops.push({ source: 'calmSea', amount: calm });
  return ops;
}

/**
 * What a Folk walking alone learns from the hexes it entered since it was last counted: `entered` are road steps
 * { cls, ms } with `night` (true, false, or null with no night in the game) for the moment it set foot on each.
 */
export function walkOps(entered, { isRough = () => false } = {}) {
  const ops = [];
  const list = Array.isArray(entered) ? entered : [];
  if (list.length === 0) return ops;
  const n = list.length;
  const rough = list.filter((st) => isRough(st.cls)).length;
  const nightMs = list.reduce((sum, st) => sum + (st.night === true && Number.isFinite(st.ms) ? st.ms : 0), 0);
  ops.push({ source: 'walkAlone', amount: n }, { source: 'travelled', amount: n });
  if (rough > 0) ops.push({ source: 'roughFoot', amount: rough });
  if (nightMs > 0) ops.push({ source: 'nightRoad', amount: nightMs });
  return ops;
}

/** A walk's road at this Folk's pace: each hex's time divided by `speedOf(step, at)` (`at` the moment it is entered). */
export function pacedRoad(road, start, speedOf) {
  let at = Number.isFinite(start) ? start : 0;
  return (road ?? []).map((st) => {
    const f = speedOf(st, at);
    const ms = Math.max(1, Math.round(st.ms / (Number.isFinite(f) && f > 0 ? f : 1)));
    at += ms;
    return { ...st, ms };
  });
}

const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const isHex = (h) => h !== null && typeof h === 'object' && Number.isInteger(h.q) && Number.isInteger(h.r);

/**
 * A sale counts toward Haggler only when it pays at least this much GP: fifty sales of one cheap item each are not
 * fifty bargains struck. [BALANCE]
 */
export const SALE_MIN_GP = 1000;

/**
 * Who buys from you at an outpost (phase 6f-3): among `outposts` (the ones within a hex of you, { q, r, name }), a Folk
 * standing on one (placed there, not on the road, not with you) whose travel traits let it sell (Merchant). The best
 * rate wins: { rate, folk, outpost }, or undefined. `folks` are Worker Folks views ({ place, travel, traits }).
 */
export function outpostSale(outposts, folks) {
  let best;
  for (const o of outposts ?? []) {
    for (const f of folks ?? []) {
      if (f?.travel !== 'idle' || !isHex(f.place) || f.place.q !== o.q || f.place.r !== o.r) continue;
      const rate = travelEffects(f.traits).sellAtOutpost;
      if (rate > 0 && (best === undefined || rate > best.rate)) best = { rate, folk: f, outpost: o };
    }
  }
  return best;
}

/**
 * Haggler at a market (6f-3): the best `sales` percent among the Folks within a hex of you (`hexOf(folk)` its hex: yours
 * for one with you; none on the road). One haggler is enough; two don't add up. { pct, folk } or undefined.
 */
export function haggle(folks, pos, hexOf) {
  if (!isHex(pos)) return undefined;
  let best;
  for (const f of folks ?? []) {
    if (f?.travel === 'walking') continue;
    const h = hexOf(f);
    if (!isHex(h) || hexDistance(h, pos) > 1) continue;
    const pct = travelEffects(f.traits).sales;
    if (pct > 0 && (best === undefined || pct > best.pct)) best = { pct, folk: f };
  }
  return best;
}

/** The Folks within a hex of you while you sell at a market. */
export function nearSale(folks, pos, hexOf) {
  if (!isHex(pos)) return [];
  return (folks ?? []).filter((f) => f?.travel !== 'walking' && isHex(hexOf(f)) && hexDistance(hexOf(f), pos) <= 1);
}
/**
 * The one Folk a sale teaches (build .386; every Folk within a hex learned Haggler from the same fifty sales): the one
 * with you, else the nearest, ties to the first listed. Undefined with none near.
 */
export function saleLearner(folks, pos, hexOf) {
  let best;
  for (const f of nearSale(folks, pos, hexOf)) {
    const d = hexDistance(hexOf(f), pos);
    if (best === undefined || d < best.d) best = { f, d };
  }
  return best?.f;
}

/** The travel traits any of `folks` holds (Worker Folks views), short ids in table order: a trait shows once learned. */
export function knownTraits(folks) {
  const held = new Set((folks ?? []).flatMap((f) => (Array.isArray(f?.traits) ? f.traits : [])).map((id) => traitDef(id)?.id).filter(Boolean));
  return TRAITS.filter((t) => held.has(t.id)).map((t) => t.id);
}

/** Folks the most a save keeps counts for: Worker Folks never hires more than there are skills to hold. */
export const FOLK_TRAITS_MAX = 64;
const COUNT_KEYS = new Set(TRAITS.flatMap((t) => (t.fade === undefined ? [t.id] : [t.id, fadeKey(t.id)])));

/** The save's `folkTraits`: { folkId: { counts, home } }, junk dropped, never thrown on. */
export function cleanFolkTraits(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, rec] of Object.entries(raw)) {
    if (Object.keys(out).length >= FOLK_TRAITS_MAX) break;
    if (id.length === 0 || id.length > 64 || rec === null || typeof rec !== 'object') continue;
    const counts = {};
    if (rec.counts !== null && typeof rec.counts === 'object') {
      for (const [k, v] of Object.entries(rec.counts)) if (COUNT_KEYS.has(k) && typeof v === 'number' && Number.isFinite(v) && v > 0) counts[k] = v;
    }
    const home = typeof rec.home === 'string' && HEX_RE.test(rec.home) ? rec.home : '';
    if (Object.keys(counts).length > 0 || home !== '') out[id] = { counts, home };
  }
  return out;
}
