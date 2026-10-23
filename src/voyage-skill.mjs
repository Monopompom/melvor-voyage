// The Voyage skill: a passive skill like Township, with its own page and sidebar entry under Passive.
// Registration, page, save block, XP per hex travelled, compass levels. Phase 5a's ship's clock makes it an active
// action: the activeTick method puts it in game.activeActions (Game.registerSkill), so a voyage under way is saved and
// ticked like any skill, offline too. The voyage itself is src/voyage-clock.mjs (set as `clock` by setup); without it
// the skill is never active. No actionTimer on purpose: Worker Folks delegates only actions that have one.
//
// Save: the game writes every registered skill into the save inside a length-marked region, Creator Toolkit mods
// included (Game.encode walks game.skills; unlike mod settings and characterStorage). A save made with Voyage
// therefore still loads without it, and Voyage's record survives reloads in dev builds too.

/** How often the page's signature (the bank, GP, the stores) is compared while the page is open. */
const PAGE_SIG_MS = 250;

export function createVoyageClass({ model, log }) {
  class Voyage extends Skill {
    constructor(namespace, game) {
      super(namespace, 'Voyage', game);
      this._media = 'assets/icon.webp';
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
      /** Set by setup: the ship's clock (src/voyage-clock.mjs). */
      this.clock = undefined;
      /** Set by setup: Adrift at sea (src/adrift.mjs), ticked as a passive action (the drift goes on while fishing). */
      this.adrift = undefined;
      /** Set by setup: the weather (src/weather.mjs); its passive tick notices Township's season changing. */
      this.weather = undefined;
      /** Set by setup: Folks walking alone (src/walks.mjs), on the clock online and offline (phase 6d). */
      this.walks = undefined;
    }

    get name() { return getLangString('SKILL_NAME_Voyage'); }
    /**
     * Never greyed in the sidebar. The game dims a skill whose realm options lack the current realm, and a plain Skill
     * has none (Skill.getRealmOptions returns []), so Voyage looked disabled. It works in every realm.
     */
    shouldShowSkillInSidebar() { return true; }

    // ---- the active action (a voyage under way) ---------------------------------------------------------
    activeTick() { try { this.clock?.tick(); } catch (e) { log('voyage tick failed', e); } }
    /** Every tick, online and offline, whatever runs (Game.tick's passive tickers): the drift while Adrift (5b part two), the season, Folks walking alone (6d), travel traits' minute clock (6f), tents going up (6e, build .396). */
    passiveTick() {
      try { this.weather?.tick(); } catch (e) { log('weather tick failed', e); }
      try { this.adrift?.tick(); } catch (e) { log('adrift tick failed', e); }
      try { this.walks?.tick(); } catch (e) { log('walks tick failed', e); }
      try { this.folkTraits?.tick(); } catch (e) { log('travel traits tick failed', e); }
      try { this.outpostTick?.(); } catch (e) { log('tent tick failed', e); }
      try { this.shipTick?.(); } catch (e) { log('careen tick failed', e); }
      try { this.clock?.waitTick?.(); } catch (e) { log('storm wait tick failed', e); }
      try { this.events?.tick?.(); } catch (e) { log('events tick failed', e); }
    }
    get isActive() { return this.clock?.running?.() === true; }
    get activeSkills() { return this.isActive ? [this] : []; }
    /** The game stopping the action (another action after the question, a gamemode change): the voyage ends here. */
    stop() { try { return this.clock?.stop?.() ?? false; } catch (e) { log('voyage stop failed', e); return false; } }
    /** Lines for the game's offline summary when the catch-up began under way (OfflineProgressElement.setMessages). */
    getOfflineMessages() { try { return this.clock?.offlineMessages?.() ?? []; } catch (e) { log('voyage offline lines failed', e); return []; } }

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
    /**
     * Notes in the save that a mode that buys skills got `what` ('cartography' or 'voyage') for free; src/unlocks.mjs
     * tells the player after the tutorial and clears it. A save from a newer build is left alone.
     */
    markFreed(what) {
      if (this.futureRaw !== undefined || !Array.isArray(this.record.unlockNotice)) return;
      if (!this.record.unlockNotice.includes(what)) this.record.unlockNotice.push(what);
    }

    setUnlock(isUnlocked) {
      // Game.setupCurrentGamemode() runs after onLoad on a new character and calls setUnlock(startingSkills.has(skill)).
      if (!isUnlocked && !this._unlocked && this.game.currentGamemode?.allowSkillUnlock === true) this.markFreed('voyage');
      super.setUnlock(true);
    }

    onLoad() {
      // A skill added to an existing save starts locked.
      if (!this._unlocked) {
        if (this.game.currentGamemode?.allowSkillUnlock === true) this.markFreed('voyage');
        this._unlocked = true;
      }
      super.onLoad();
      this.renderQueue.page = true;
    }

    // ---- travel --------------------------------------------------------------------------------------
    /**
     * Counts a completed move and pays its XP. `steps` as model.xpForSteps; `entered` the hexes stepped onto ({ q, r },
     * cloud left out by the caller): each one never entered before pays model.DISCOVERY_XP (the balance pass), free and hungry steps included. Returns what it paid, for the dev pace counter.
     */
    onTravelled(steps, entered = []) {
      const r = model.xpForSteps(steps);
      let discovered = 0;
      if (this.futureRaw === undefined) {
        this.record.landHexes += r.land;
        this.record.waterHexes += r.water;
        const m = model.markVisited(this.record.visited, entered);
        this.record.visited = m.visited;
        discovered = m.added;
      }
      const discoveryXP = discovered * model.DISCOVERY_XP;
      if (r.xp + discoveryXP > 0) this.addXP(r.xp + discoveryXP);
      if (r.land + r.water + discovered > 0) this.renderQueue.page = true;
      return { land: r.land, water: r.water, hexXP: r.xp, discovered, discoveryXP };
    }

    /** Marks a hex visited without XP: where the character stands when the save loads (it got there somehow). */
    markHere(hex) {
      if (this.futureRaw !== undefined || hex == null) return;
      this.record.visited = model.markVisited(this.record.visited, [hex]).visited;
    }

    // ---- the travel discount (the balance pass) -------------------------------------------------
    /** Each level cuts the game's hex travel cost through its own modifier, so the Cartography numbers show it. */
    addProvidedStats() {
      super.addProvidedStats();
      try {
        const pct = model.travelDiscount(this.level);
        if (pct > 0) this.providedStats.addStatObject(this, { modifiers: this.game.getModifierValuesFromData({ cartographyTravelCost: -pct }) });
      } catch (e) { log('travel discount not applied', e); }
    }

    onLevelUp(oldLevel, newLevel) {
      super.onLevelUp(oldLevel, newLevel);
      this.computeProvidedStats(true);
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
      // The game shows "Game Guide" under every skill page's title; Voyage has no guide page, so the link did nothing
      // (Folks scan C-02, build .311). changePage only calls page.action.onPageChange(), and this page has no action,
      // so the link is hidden here, in the render loop, while the page is open.
      if (this.game.openPage?.id === model.SKILL_ID) {
        const link = document.getElementById('game-guide-header-link');
        if (link !== null && !link.classList.contains('d-none')) link.classList.add('d-none');
      }
      // While the page is open, redraw when its signature moves (the bank and GP have no event the page listens to).
      // Compared four times a second, not every frame (build .401): with GP or logs coming in each tick the signature
      // moved every frame and the page was rebuilt with it. The skill's own events still redraw at once.
      if (!this.renderQueue.page && this.pageSignature !== undefined && this.game.openPage?.id === model.SKILL_ID) {
        const now = performance.now();
        if (now - (this._pageSigAt ?? 0) >= PAGE_SIG_MS) {
          this._pageSigAt = now;
          try { const sig = this.pageSignature(); if (sig !== this._pageSig) this.renderQueue.page = true; } catch {}
        }
      }
      if (this.renderQueue.page) {
        this.renderQueue.page = false;
        try { this._pageSig = this.pageSignature?.(); } catch {}
        try { this.pageRenderer?.(); } catch (e) { log('Voyage page render failed', e); }
      }
      // The Under way block's bars move every frame while the page is open.
      if (this.game.openPage?.id === model.SKILL_ID) { try { this.clock?.render?.(); } catch (e) { log('Under way render failed', e); } }
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
