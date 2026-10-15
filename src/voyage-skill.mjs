// The Voyage skill: a passive skill like Township, with its own page and sidebar entry under Passive.
// Phase 3a is the shell: registration, page, save block, XP per hex travelled, compass levels. No passiveTick yet
// (the ship's clock arrives in phase 5), so Game.registerSkill keeps it out of the passive and active actions.
//
// Save: the game writes every registered skill into the save inside a length-marked region, Creator Toolkit mods
// included (Game.encode walks game.skills; unlike mod settings and characterStorage). A save made with Voyage
// therefore still loads without it, and Voyage's record survives reloads in dev builds too.

export function createVoyageClass({ model, log }) {
  class Voyage extends Skill {
    constructor(namespace, game) {
      super(namespace, 'Voyage', game);
      this._media = 'assets/icon.png';
      this.renderQueue = new SkillRenderQueue();
      this.renderQueue.page = false;
      this.record = model.defaultSave();
      /** A save written by a newer build: kept byte for byte and written back, never downgraded. */
      this.futureRaw = undefined;
      /** Set by setup: renders the page body (src/voyage-page.mjs). */
      this.pageRenderer = undefined;
      /** Set by setup: a string that changes when what the open page shows changes (GP, logs, position). */
      this.pageSignature = undefined;
      this._pageSig = undefined;
    }

    get name() { return getLangString('SKILL_NAME_Voyage'); }
    /**
     * Never greyed in the sidebar. The game dims a skill whose realm options lack the current realm, and a plain Skill
     * has none (Skill.getRealmOptions returns []), so Voyage looked disabled. It works in every realm.
     */
    shouldShowSkillInSidebar() { return true; }

    // ---- persistence ---------------------------------------------------------------------------------
    encode(writer) {
      super.encode(writer);
      writer.writeUint32(model.SAVE_MAGIC);
      writer.writeString(this.futureRaw ?? model.serializeSave(this.record));
      return writer;
    }

    decode(reader, version) {
      super.decode(reader, version);
      if (peekUint32(reader) !== model.SAVE_MAGIC) return;
      reader.getUint32();
      const json = reader.getString();
      const { save, report } = model.loadSave(json);
      if (report.future) {
        this.futureRaw = json;
        console.warn('[Voyage] the Voyage skill save is from a newer build; it is kept unchanged and not counted');
      } else if (report.corrupt) {
        console.warn('[Voyage] the Voyage skill save was unreadable; starting fresh');
      }
      if (report.applied.length > 0) log(`migrated Voyage save from v${report.applied[0]} to v${model.SAVE_VERSION}`);
      this.record = save;
    }

    // ---- unlock --------------------------------------------------------------------------------------
    // Voyage is always unlocked (decided 15 Oct 2026): it holds the ship, so the mod can't play without it. In modes
    // that buy skills (Adventure) it is free, and the next skill's price goes up one step by itself, since the game
    // prices an unlock by (skills unlocked now) - (starting skills). A mode with a fixed list and no unlocks (Ancient
    // Relics) would otherwise lock it forever.
    /** Set when this load unlocked Voyage in a mode that buys skills; src/unlocks.mjs tells the player. */
    freedForMode = false;

    setUnlock(isUnlocked) {
      // Game.setupCurrentGamemode() runs after onLoad on a new character and calls setUnlock(startingSkills.has(skill)).
      if (!isUnlocked && !this._unlocked && this.game.currentGamemode?.allowSkillUnlock === true) this.freedForMode = true;
      super.setUnlock(true);
    }

    onLoad() {
      // A skill added to an existing save starts locked.
      if (!this._unlocked) {
        if (this.game.currentGamemode?.allowSkillUnlock === true) this.freedForMode = true;
        this._unlocked = true;
      }
      super.onLoad();
      this.renderQueue.page = true;
    }

    // ---- travel --------------------------------------------------------------------------------------
    /** Counts a completed move and pays its XP. `steps` as model.xpForSteps. */
    onTravelled(steps) {
      const r = model.xpForSteps(steps);
      if (r.land + r.water === 0) return;
      if (this.futureRaw === undefined) {
        this.record.landHexes += r.land;
        this.record.waterHexes += r.water;
      }
      if (r.xp > 0) this.addXP(r.xp);
      this.renderQueue.page = true;
    }

    /** Once per character: XP for the hexes travelled before the skill existed (the game's HexesTravelled stat). */
    backfill(hexesTravelled) {
      // Locked (a gamemode that has not unlocked it yet): wait, or addXP would drop the XP while the flag is set.
      if (this.record.backfilled || this.futureRaw !== undefined || !this._unlocked) return 0;
      const xp = model.backfillXP(hexesTravelled);
      this.record.backfilled = true;
      if (xp > 0) this.addXP(xp);
      this.renderQueue.page = true;
      return xp;
    }

    // ---- page ----------------------------------------------------------------------------------------
    render() {
      super.render();
      // While the page is open, redraw when its signature moves (the bank and GP have no event the page listens to).
      if (!this.renderQueue.page && this.pageSignature !== undefined && this.game.openPage?.id === model.SKILL_ID) {
        try { const sig = this.pageSignature(); if (sig !== this._pageSig) this.renderQueue.page = true; } catch {}
      }
      if (this.renderQueue.page) {
        this.renderQueue.page = false;
        try { this._pageSig = this.pageSignature?.(); } catch {}
        try { this.pageRenderer?.(); } catch (e) { log('Voyage page render failed', e); }
      }
    }

    getErrorLog() {
      return `Voyage record: ${model.serializeSave(this.record)}${this.futureRaw !== undefined ? ' (newer save kept)' : ''}\n`;
    }
  }

  return { Voyage };
}

/** Reads the next Uint32 without consuming it (undefined when fewer than 4 bytes remain). */
function peekUint32(reader) {
  if (reader.dataView.byteLength - reader.byteOffset < 4) return undefined;
  return reader.dataView.getUint32(reader.byteOffset);
}
