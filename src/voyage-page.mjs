// The Voyage skill page: ship, travels and the compass stages, plus "Show map". Phase 3a is the
// shell; the ship block fills in with 3b. The container is inserted on interfaceAvailable because the game calls
// skill.initMenus() right after that hook and SkillHeaderElement looks for <skill-header data-skill-id> then.

export const CONTAINER_ID = 'voyage-container';
export const PAGE_ID = 'voyage:Voyage';
const CARTOGRAPHY_PAGE_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, model, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const part = (name) => document.querySelector(`#${CONTAINER_ID} [data-voyage="${name}"]`);
  const skill = () => { try { return game.skills.getObjectByID(model.SKILL_ID); } catch { return undefined; } };
  const pageOf = (id) => { try { return game.pages.getObjectByID(id); } catch { return undefined; } };

  ctx.onInterfaceAvailable(() => {
    try {
      if (document.getElementById(CONTAINER_ID) !== null) return;
      const template = document.getElementById('voyage-page-template');
      if (template === null) { console.error('[Voyage] page template missing'); return; }
      // Two elements share id="main-container": anchor on a known page container instead.
      const anchor = document.getElementById('township-container') ?? document.getElementById('thieving-container');
      const fragment = document.importNode(template.content, true);
      if (anchor !== null) anchor.after(fragment); else document.querySelector('main')?.append(fragment);
      const button = part('show-map');
      const map = pageOf(CARTOGRAPHY_PAGE_ID);
      if (button !== null) {
        if (map === undefined) button.classList.add('d-none');
        else button.onclick = () => changePage(map);
      }
    } catch (e) { console.error('[Voyage] page insert failed', e); }
  });

  const render = () => {
    const s = skill();
    if (s === undefined || document.getElementById(CONTAINER_ID) === null) return;
    const level = s.level;
    const rec = s.record;

    const ship = part('ship');
    if (ship !== null) {
      ship.innerHTML = '<div>No ship yet.</div><small class="text-muted">You will build a dinghy here and sail the coast. Until then you travel on foot.</small>';
    }

    const travels = part('travels');
    if (travels !== null) {
      const total = rec.landHexes + rec.waterHexes;
      travels.innerHTML =
        `<div>Hexes travelled: <b>${numberWithCommas(total)}</b> <small class="text-muted">(land ${numberWithCommas(rec.landHexes)}, water ${numberWithCommas(rec.waterHexes)})</small></div>` +
        `<small class="text-muted">Every hex you travel gives Voyage XP: ${model.XP_PER_HEX.land} on land, ${model.XP_PER_HEX.water} on water. Fast travel does not count yet.</small>` +
        (s.futureRaw !== undefined ? '<div><small class="text-warning">This save comes from a newer Voyage build: progress is kept but not counted here.</small></div>' : '');
    }

    const compass = part('compass');
    if (compass !== null) {
      const icon = part('compass-icon');
      try { const it = game.items.getObjectByID('voyage:Wayfinder_Compass'); if (icon !== null && it !== undefined) icon.src = it.media; } catch {}
      const rows = model.COMPASS_STAGES.map((stage) => {
        const reached = level >= stage.level;
        const mark = reached ? '<i class="fa fa-check text-success mr-1"></i>' : '<i class="fa fa-lock text-muted mr-1"></i>';
        return `<div class="${reached ? '' : 'text-muted'}">${mark}<small>Level ${stage.level}:</small> ${esc(stage.text)}</div>`;
      });
      const owned = state.compass?.owned?.() === true;
      const note = owned
        ? '<small class="text-muted">It works while it is in your bank. When you try a skill that doesn\'t work where you stand on the map (Mining, Woodcutting, Smithing and the like) and you don\'t know where it works, the compass points toward the nearest place. You see its reading when a skill is refused, and on the map when you hover a locked skill in the "You are here" panel.</small>'
        : '<small class="text-warning">The compass is not in your bank. The shop sells another under Voyage.</small>';
      compass.innerHTML = `<div class="voyage-compass-stages">${rows.join('')}</div><div class="mt-2">${note}</div>`;
    }
  };

  return { render };
}
