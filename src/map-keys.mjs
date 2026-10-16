// Map keys (user request, 16 Oct 2026): a key centres the world map on you, the same as the map's home button
// (Cartography.goToPlayerOnClick, wired in cartographyMenu.js loadWorldMap, v1.3.1). The key is the setting
// `centreKey` (G by default; empty turns it off), matched without case. Only on the Cartography page, never
// while typing in a field, with a modifier held or with a popup open. Not a Voyage rule: a convenience.

const CARTOGRAPHY_PAGE = 'melvorAoD:Cartography';

const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function install(ctx, { key, log }) {
  ctx.onInterfaceReady(() => {
    document.addEventListener('keydown', (e) => {
      try {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const k = `${key() ?? ''}`.trim();
        if (k === '' || e.key.toLowerCase() !== k.toLowerCase()) return;
        if (typing(e.target) || typing(document.activeElement)) return;
        if (typeof game === 'undefined' || game.openPage?.id !== CARTOGRAPHY_PAGE || game.cartography?.activeMap === undefined) return;
        if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
        e.preventDefault();
        game.cartography.goToPlayerOnClick();
      } catch (err) { log('map key failed', err); }
    });
  });
}
