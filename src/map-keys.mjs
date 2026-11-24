// Map keys (user request, 16 Oct 2026): a key centres the world map on you, the same as the map's home button
// (Cartography.goToPlayerOnClick, wired in cartographyMenu.js loadWorldMap, v1.3.1). The key is the setting
// `centreKey` (G by default; empty turns it off), matched without case. Only on the Cartography page, never
// while typing in a field, with a modifier held or with a popup open. Not a Voyage rule: a convenience.
// Build .118 (user ask): the setting `journalKey` (J by default; empty turns it off) opens the Captain's Journal from
// any page and closes it again, under the same conditions (typing in the book's search boxes types).
// Build .171 (user ask): the setting `mapKey` (M by default; empty turns it off) opens the Cartography page from any
// other page, closing the journal first if it is open.
// 1.8.1 (a player's ask, the user): the setting `quayKey` (Q by default; empty turns it off) opens the harbour board of
// the port you stand on or next to, from any page, as the Here panel's Quay button does, and closes it again. With no
// port in reach it does nothing.
// 1.8.1 (the user): the setting `placesKey` (P by default; empty turns it off) opens the map's Places card from any
// page, opening the map first (and closing the journal) when it is elsewhere, and on the map closes it again.

const CARTOGRAPHY_PAGE = 'melvorAoD:Cartography';

const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Whether this key press is the setting `raw`. Shift only counts for a key that needs it ("?" or "+"), never for a
 * letter; on a non-Latin layout a Latin letter is matched by the key in that place, so J still opens the Journal.
 */
const hit = (e, raw) => {
  const k = `${raw ?? ''}`.trim();
  if (k === '') return false;
  if (e.shiftKey && /\p{L}/u.test(k)) return false;
  if (e.key.toLowerCase() === k.toLowerCase()) return true;
  return /^[a-z]$/i.test(k) && !/^[a-z]$/i.test(e.key) && e.code === `Key${k.toUpperCase()}`;
};

export function install(ctx, { key, journalKey, mapKey, quayKey, quay, placesKey, places, openPage, journal, log }) {
  ctx.onInterfaceReady(() => {
    document.addEventListener('keydown', (e) => {
      try {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
        if (typing(e.target) || typing(document.activeElement)) return;
        const book = journal?.();
        if (hit(e, journalKey?.()) && book !== undefined) {
          if (book.isOpen()) { e.preventDefault(); book.close(); return; }
          if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
          e.preventDefault();
          book.open();
          return;
        }
        if (hit(e, mapKey?.()) && typeof game !== 'undefined' && game.openPage?.id !== CARTOGRAPHY_PAGE) {
          if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
          const page = game.pages?.getObjectByID(CARTOGRAPHY_PAGE);
          if (page === undefined) return;
          e.preventDefault();
          if (book?.isOpen()) book.close();
          openPage(page);
          return;
        }
        if (hit(e, placesKey?.())) {
          const list = places?.();
          if (list === undefined || list.usable?.() === false || typeof game === 'undefined') return;
          if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
          e.preventDefault();
          if (book?.isOpen()) book.close();
          if (game.openPage?.id === CARTOGRAPHY_PAGE) { list.toggle(); return; }
          const page = game.pages?.getObjectByID(CARTOGRAPHY_PAGE);
          if (page === undefined) return;
          list.open();
          openPage(page);
          return;
        }
        if (hit(e, quayKey?.())) {
          const board = quay?.();
          if (board === undefined) return;
          if ((typeof Swal !== 'undefined' && Swal.isVisible()) || book?.isOpen()) return;
          if (board.open() === true) e.preventDefault();
          return;
        }
        if (!hit(e, key())) return;
        if (typeof game === 'undefined' || game.openPage?.id !== CARTOGRAPHY_PAGE || game.cartography?.activeMap === undefined) return;
        if (typeof Swal !== 'undefined' && Swal.isVisible()) return;
        e.preventDefault();
        game.cartography.goToPlayerOnClick();
      } catch (err) { log('map key failed', err); }
    });
    // The open board is a popup, and a popup keeps its keys to itself (SweetAlert stops them at its edge), so the
    // Quay key that closes it again is heard on the way in, before the popup (seen in game, build .607).
    window.addEventListener('keydown', (e) => {
      try {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || typing(e.target) || !hit(e, quayKey?.())) return;
        const board = quay?.();
        if (board?.isOpen?.() !== true) return;
        e.preventDefault();
        e.stopPropagation();
        board.close();
      } catch (err) { log('quay key failed', err); }
    }, true);
  });
}
