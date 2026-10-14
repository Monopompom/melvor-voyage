// The start gate. Game.idleChecker(action) runs in Skill.start, GatheringSkill.start and
// CombatManager.preSelection; returning true refuses the start. Everything here fails open: any error,
// unknown hex, dormant or relaxed mode, or the "Voyage rules" switch off means vanilla behaviour.
// Worker Folks patches the same method; the loader chains the patches, so a Folk delegated by Worker
// Folks may bypass this gate until phase 6 gives Folks a location of their own.

export function install(ctx, { state, rules, terrainMod, log }) {
  const describeNearest = (skillId, from) => {
    const near = terrainMod.nearest(state.terrain, from, (rec) => rules.allowedAt(skillId, rec));
    if (near === undefined) return '';
    const dir = terrainMod.directionLabel(from, near.hex);
    const poi = near.hex.poi ? ` (${poiName(near.hex)})` : '';
    return ` Nearest ${rules.ruleNoun(skillId)}: ${near.distance} hex${near.distance === 1 ? '' : 'es'} ${dir}${poi}.`;
  };

  /** Human name of the POI on a table hex, via the live map when it is discovered; the raw id otherwise. */
  const poiName = (rec) => {
    try {
      const map = game.cartography?.activeMap;
      const hex = map?.getHex(new HexCoords(rec.q, rec.r));
      const poi = hex?.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
    } catch {}
    return rec.poi.replace(/([a-z])([A-Z])/g, '$1 $2');
  };

  ctx.patch(Game, 'idleChecker').replace(function (original, action) {
    try {
      if (state.mode !== 'strict' || !state.settings.rules() || this.isGolbinRaid) return original(action);
      const skillId = action?.id;
      if (typeof skillId !== 'string' || !rules.isGated(skillId)) return original(action);
      const pos = state.position();
      if (pos === undefined) return original(action);
      const rec = state.recordAt(pos);
      if (rules.allowedAt(skillId, rec)) return original(action);
      const here = terrainMod.CLASS_INFO[rec.t]?.label ?? rec.t;
      const skillName = action.name ?? skillId;
      this.notifications.createErrorNotification(
        'voyage:locked',
        `${skillName} needs ${rules.ruleNoun(skillId)}. You are on ${here.toLowerCase()}.${describeNearest(skillId, pos)}`,
      );
      log(`refused ${skillId} at (${pos.q},${pos.r}) ${rec.t}`);
      return true;
    } catch (e) {
      console.error('[Voyage] gate failed open', e);
      return original(action);
    }
  });
}
