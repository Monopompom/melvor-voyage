// Map keys (user request, 16 Oct 2026): a key centres the world map on you, the same as the map's home button
// (Cartography.goToPlayerOnClick, wired in cartographyMenu.js loadWorldMap, v1.3.1). The key is the setting
// `centreKey` (G by default; empty turns it off), matched without case. Only on the Cartography page, never
// while typing in a field, with a modifier held or with a popup open. Not a Voyage rule: a convenience.
// Build .118 (user ask): the setting `journalKey` (J by default; empty turns it off) opens the Captain's Journal from
// any page and closes it again, under the same conditions (typing in the book's search boxes types).
// Build .171 (user ask): the setting `mapKey` (M by default; empty turns it off) opens the Cartography page from any
// other page, closing the journal first if it is open.

const CARTOGRAPHY_PAGE = 'melvorAoD:Cartography';

const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function install(ctx, { key, journalKey, mapKey, openPage, journal, log }) {
  ctx.onInterfaceReady(() => {
    document.addEventListener('keydown', (e) => {
      try {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (typing(e.target) || typing(document.activeElement)) return;
        const book = journal?.();
        const j = `${journalKey?.() ?? ''}`.trim();
        if (j !== '' && e.key.toLowerCase() === j.toLowerCase() && book !== undefined) {
          if (book.isOpen()) { e.preventDefault(); book.close(); return; }
          if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
          e.preventDefault();
          book.open();
          return;
        }
        const m = `${mapKey?.() ?? ''}`.trim();
        if (m !== '' && e.key.toLowerCase() === m.toLowerCase() && typeof game !== 'undefined' && game.openPage?.id !== CARTOGRAPHY_PAGE) {
          if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
          const page = game.pages?.getObjectByID(CARTOGRAPHY_PAGE);
          if (page === undefined) return;
          e.preventDefault();
          if (book?.isOpen()) book.close();
          openPage(page);
          return;
        }
        const k = `${key() ?? ''}`.trim();
        if (k === '' || e.key.toLowerCase() !== k.toLowerCase()) return;
        if (typeof game === 'undefined' || game.openPage?.id !== CARTOGRAPHY_PAGE || game.cartography?.activeMap === undefined) return;
        if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
        e.preventDefault();
        game.cartography.goToPlayerOnClick();
      } catch (err) { log('map key failed', err); }
    });
  });
}
