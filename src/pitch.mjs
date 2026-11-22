// Pitch (phase 3d): a mod item Firemaking makes as a by-product, used with logs to repair a ship's
// hull. Pine burned slowly for tar, with charcoal left over, was the real "naval stores" trade.
//
// Pitch is a real Firemaking primary product (data/package.json skillData: 10% base, on the default product list
// every Melvor-realm log uses), so the game rolls it with Coal and Ash, applies its own product modifiers, and shows
// it under "Produces" and "You Have" (user report, build .70: it dropped with no word of it anywhere). The chance per
// log follows ship-model.mjs pitchChance (better logs give more): the data's 10% is replaced by it here, keeping any
// modifier bonus the game adds on top.
//
// A log with its own product list (Magic Logs, and any mod's log that sets one) skips the default list, so Pitch is
// added to those too once every mod's data is in: any log burned in the Melvor realm can make it, Abyssal logs never.

export function install(ctx, { shipModel, log }) {
  const BASE = 10; // the chance in data/package.json
  ctx.onCharacterSelectionLoaded(() => {
    try {
      const pitch = game.items.getObjectByID('voyage:Pitch');
      if (pitch === undefined) return;
      const n = shipModel.addPitchToLogs(game.firemaking.actions.allObjects, game.defaultRealm, pitch);
      log(`pitch: added to ${n} log(s) with their own product list`);
    } catch (e) { log('pitch: logs not updated', e); }
  });
  ctx.patch(Firemaking, 'getPrimaryProductInfo').after(function (info, item, action) {
    try {
      if (info === undefined || item?.id !== 'voyage:Pitch' || action === undefined) return info;
      const chance = Math.min(100, Math.max(0, info.chance - BASE + shipModel.pitchChance(action.level)));
      return { ...info, chance };
    } catch (e) { log('pitch chance failed', e); return info; }
  });
}
