// The map pin moves while a voyage is under way (build .341): the traveller walks, the vessel you are in rolls
// (pin-motion-model.mjs). The pin is the game's `cartographyMap.playerPin` (markers.mjs swaps its texture); this file
// only nudges its y and rotation on the map app's ticker, the one the route line's running light runs on, and takes
// the nudge back before the game moves or rescales the pin. The setting "Motion on the map" and the system's reduced
// motion each keep it still.

export function install(ctx, { state, M, log }) {
  let ticker;
  let failed = false;
  let applied = { dy: 0, rot: 0 };
  let amp = 0;
  let start;
  let last;
  let motionQuery;
  const still = () => { try { motionQuery ??= window.matchMedia?.('(prefers-reduced-motion: reduce)'); return motionQuery?.matches === true; } catch { return false; } };
  const pin = () => (typeof cartographyMap === 'undefined' || cartographyMap === null ? undefined : cartographyMap.playerPin);

  /** Takes the last nudge off the pin. */
  const undo = (p) => {
    if (p !== undefined && !p.destroyed) { p.y -= applied.dy; p.rotation -= applied.rot; }
    applied = { dy: 0, rot: 0 };
  };

  function frame() {
    if (failed) return;
    try {
      const p = pin();
      if (p === undefined || p.destroyed) return;
      const now = performance.now() / 1000;
      const dt = last === undefined ? 0 : Math.min(0.1, now - last);
      last = now;
      const on = state.settings?.mapMotion?.() !== false && !still() && p.visible && state.clock?.running?.() === true;
      amp = M.fadeStep(amp, on, dt);
      undo(p);
      if (amp <= 0) { start = undefined; return; }
      if (start === undefined) start = now;
      const kind = state.ship?.inVessel?.();
      const hull = kind === undefined ? 'land' : state.ship.vessel(kind)?.hull ?? 'dinghy';
      const m = M.pinMotion(hull, now - start);
      const height = (p.texture?.orig?.height ?? 0) * Math.abs(p.scale?.y ?? 0);
      applied = { dy: m.dy * height * amp, rot: m.rot * amp };
      p.y += applied.dy;
      p.rotation += applied.rot;
    } catch (e) { failed = true; log('pin motion failed', e); }
  }

  // The game sets the pin's place and scale afresh; the nudge comes off first, so it is never counted twice.
  const off = function () { try { undo(this.playerPin); } catch (e) { log('pin motion failed', e); } };
  ctx.patch(WorldMapDisplayElement, 'movePlayerMarker').before(off);
  ctx.patch(WorldMapDisplayElement, 'configurePlayerPin').before(off);

  // The map's app may come after the mod loads: look for its ticker until it is there.
  const look = () => {
    try {
      const tk = typeof cartographyMap === 'undefined' ? undefined : cartographyMap?.app?.ticker;
      if (tk === undefined) return false;
      if (tk !== ticker) { tk.add(frame); ticker = tk; }
      return true;
    } catch (e) { log('pin motion ticker failed', e); return true; }
  };
  ctx.onInterfaceReady(() => {
    if (look()) return;
    const id = setInterval(() => { if (look()) clearInterval(id); }, 2000);
  });
  return { debug: () => ({ amp, applied: { ...applied }, ticker: ticker !== undefined, failed }) };
}
