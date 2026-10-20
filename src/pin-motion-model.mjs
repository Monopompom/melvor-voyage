// How the map pin moves while a voyage is under way (build .341, the user: "lightweight animations for the character
// figurine and for the vessels"): the traveller steps along with a small hop and a sway, a vessel rolls on the swell,
// a small boat quicker and further than a big ship. Pure: pin-motion.mjs applies it to the game's pin.

/** On land: a hop every stride (seconds), the sway one way per step; hop as a share of the pin's height, sway in radians. */
export const WALK = { stride: 0.45, hop: 0.035, sway: 0.05 };
/** At sea: one roll each way per period (seconds), the bob twice as fast; roll in radians, bob as a share of the height. */
export const SAIL = {
  small: { period: 2.4, roll: 0.07, bob: 0.015 },
  big: { period: 3.6, roll: 0.045, bob: 0.01 },
};
const BIG = ['brig', 'galleon'];
/** Seconds the motion takes to fade in when the voyage starts, and out when it ends. */
export const FADE = 0.4;

/**
 * The pin's offset `t` seconds into the motion: `dy` a share of the pin's height (negative is up) and `rot` in
 * radians. `kind` is 'land' for the traveller on foot or mounted, or the hull you are in ('dinghy', 'brig', ...).
 */
export function pinMotion(kind, t) {
  if (!Number.isFinite(t) || t < 0) return { dy: 0, rot: 0 };
  if (kind === 'land') {
    const step = (Math.PI * t) / WALK.stride;
    return { dy: -WALK.hop * Math.abs(Math.sin(step)), rot: WALK.sway * Math.sin(step) };
  }
  const s = BIG.includes(kind) ? SAIL.big : SAIL.small;
  const turn = (2 * Math.PI * t) / s.period;
  return { dy: -s.bob * Math.abs(Math.sin(turn)), rot: s.roll * Math.sin(turn) };
}

/** The fade after `dt` seconds: up toward 1 while the motion is on, down toward 0 once it is off. */
export function fadeStep(amp, on, dt) {
  const a = Number.isFinite(amp) ? Math.min(1, Math.max(0, amp)) : 0;
  const d = Number.isFinite(dt) && dt > 0 ? dt / FADE : 0;
  return on ? Math.min(1, a + d) : Math.max(0, a - d);
}
