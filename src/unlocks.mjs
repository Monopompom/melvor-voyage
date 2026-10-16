// Cartography in gamemodes that buy skills (Adventure, and its hardcore speedrun): the map is how Voyage plays, so
// Cartography is unlocked for free (decided 15 Oct 2026); so is the Voyage skill (voyage-skill.mjs setUnlock), and
// this module tells the player about both. The price of the next skill still goes up one step for each, as if it
// had been bought: the game prices an unlock by (skills unlocked now) - (the mode's starting skills)
// (Game.getSkillUnlockCount, checked in the built JS), so a free unlock moves the price by itself.
//
// Skill.setUnlock is where the game locks a skill (Game.setupCurrentGamemode on a new character), so the patch keeps
// Cartography unlocked there; an existing save that has it locked is unlocked on load. Modes with a fixed skill list
// and no unlocks (no allowSkillUnlock) are left alone.

const CARTOGRAPHY_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, log }) {
  /** Cartography freed while the Voyage skill was missing (should not happen): told from memory instead of the save. */
  let freed = false;
  const markCarto = () => { const v = state.voyageSkill?.(); if (v?.markFreed) v.markFreed('cartography'); else freed = true; };
  const buysSkills = (game) => { try { return game.currentGamemode?.allowSkillUnlock === true; } catch { return false; } };

  ctx.patch(Cartography, 'setUnlock').before(function (isUnlocked) {
    try {
      if (isUnlocked || !buysSkills(this.game)) return undefined;
      if (!this._unlocked) markCarto();
      return [true];
    } catch (e) { log('Cartography unlock failed', e); return undefined; }
  });

  // The tutorial (user report, 16 Oct 2026: new Adventure characters skipped it). Tutorial.shouldStart wants every
  // unlocked skill to be one of the mode's starting skills, and in Adventure (combat skills only) the free Cartography
  // and Voyage fail that, so the game marked the tutorial complete. Count both as starting skills for that check;
  // the rest of the check is the game's own (tutorialIsland.js, v1.3.1). Standard has no starting list: unaffected.
  const FREE = [CARTOGRAPHY_ID, 'voyage:Voyage'];
  ctx.patch(Tutorial, 'shouldStart').get(function (next) {
    const original = next();
    try {
      const mode = this.game.currentGamemode;
      if (original || this.complete || !mode?.hasTutorial || mode.startingSkills === undefined) return original;
      if (this.currentStage !== undefined) return true;
      const ok = this.game.skills.every((skill) => skill.level <= skill.tutorialLevelCap
        && (mode.startingSkills.has(skill) || !skill.isUnlocked || FREE.includes(skill.id)));
      if (ok) log('tutorial: started despite the free Cartography/Voyage unlocks');
      return ok;
    } catch (e) { log('tutorial check failed', e); return original; }
  });

  ctx.onCharacterLoaded(() => {
    try {
      const carto = game.skills.getObjectByID(CARTOGRAPHY_ID);
      if (carto !== undefined && !carto.isUnlocked && buysSkills(game)) { markCarto(); carto.setUnlock(true); }
    } catch (e) { console.error('[Voyage] Cartography unlock failed', e); }
  });

  // After the tutorial: in Adventure the game sets the mode up (and locks skills) when the tutorial completes, which
  // is when the free unlocks happen on a new character.
  ctx.onInterfaceReady(() => state.afterTutorial(notify));
  function notify() {
    const voyage = state.voyageSkill?.();
    const pending = voyage?.futureRaw === undefined && Array.isArray(voyage?.record?.unlockNotice) ? voyage.record.unlockNotice : [];
    const names = [];
    const freedCarto = freed || pending.includes('cartography');
    if (freedCarto) names.push('Cartography');
    if (pending.includes('voyage')) names.push('the Voyage skill');
    freed = false;
    if (pending.length > 0) voyage.record.unlockNotice = [];
    if (names.length === 0) return;
    log(`${names.join(' and ')} unlocked for free; next skill unlock costs ${game.getSkillUnlockCost?.()} GP`);
    try {
      // Whole sentences per case, so a translation never has to join names and counts (languages/en.json).
      const key = names.length === 2 ? 'MOD_VOY_UNLOCK_BOTH' : freedCarto ? 'MOD_VOY_UNLOCK_CARTOGRAPHY' : 'MOD_VOY_UNLOCK_VOYAGE';
      const media = game.skills.getObjectByID(CARTOGRAPHY_ID)?.media;
      const send = () => { try { game.notifications.createSuccessNotification('voyage:unlocks', getLangString(key), media); } catch {} };
      if (state.whenNoModal) state.whenNoModal(send); else send();
    } catch {}
  }
}
