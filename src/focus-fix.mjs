// Coming back to a paused game (user report, 16 Oct 2026, caught by the dev watchdog). In a browser with the game's
// "Pause on unfocus" setting (on by default), hiding the tab stops the main loop (Game.stopMainLoop, which also puts up
// the invisible #interaction-blocker), and the game restarts it from ifvisible's "focus" event (save.js, v1.3.1).
// ifvisible sometimes reports the return as "wakeup" instead of "focus" (its idle timer runs while the tab is hidden),
// so the loop stayed stopped: no clicks, no actions, no error.
//
// This does what the game's focus handler does, when the page is visible and in front again and the loop was
// stopped while the page was hidden or out of focus. A loop stopped for any other reason (an error: Game.showBrokenGame;
// the game's own stops while you look at it) is left alone. Not a Voyage rule: a safety net, cheap and idempotent.

export function install(ctx, { log }) {
  let pausedAway = false; // the last stop happened while the page was hidden or out of focus
  let broken = false;
  ctx.patch(Game, 'stopMainLoop').before(function () {
    if (!this.loopStarted) return;
    pausedAway = document.visibilityState === 'hidden' || !document.hasFocus();
  });
  ctx.patch(Game, 'startMainLoop').after(() => { pausedAway = false; });
  ctx.patch(Game, 'showBrokenGame').before(() => { broken = true; });

  const resume = (why) => {
    try {
      if (!pausedAway || broken || typeof game === 'undefined' || game.loopStarted) return;
      if (document.visibilityState !== 'visible' || game.isGolbinRaid) return;
      // The game's own focus handler (save.js): mark the window focused, catch up on the time away, restart.
      try { inFocus = true; } catch {} // eslint-disable-line no-undef
      game.triggerOfflineLoop();
      game.startMainLoop();
      log(`game loop resumed (${why}): the game's focus event did not arrive`);
    } catch (e) { console.error('[Voyage] resume failed', e); }
  };
  ctx.onInterfaceReady(() => {
    // A beat after each event, so the game's own handler goes first when it does fire.
    const later = (why) => setTimeout(() => resume(why), 300);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later('visible'); });
    window.addEventListener('focus', () => later('focus'));
    // A click on the invisible blocker: the player is plainly back.
    document.addEventListener('pointerdown', () => later('click'), true);
  });
}
