# Voyage: Far Shores

A mod for **Melvor Idle v1.3.1** that needs **Atlas of Discovery**. Every hex of the world map has a terrain
(grassland, forest, mountain, desert, beach, snow, badlands, cursed, cloud) and skills only work where their
terrain is. Woodcutting needs a forest. You have to go there.

This is an early build (phase 1 of 8): the map overlay, the "You are here" panel and the first locked skill.
Travel is still the vanilla instant travel. Provisions, the ship, markets and the timed voyage come later.

## What it does

- **Terrain overlay.** Surveyed hexes on the Cartography map are tinted by terrain. Fog is untouched: hexes
  you have not surveyed show nothing new.
- **You are here.** A panel on the map shows the terrain under you, the place name, river or swamp if the
  hex has one, which locked skills work here, and for the rest the nearest hex where they do and how far.
- **Locked skills.** Starting a skill where it cannot run shows a message instead of starting. Phase 1
  locks Woodcutting to forest hexes. Nothing else is locked yet.

## Settings (Mod Settings, section Voyage)

- **Terrain overlay**: tint on or off.
- **Voyage rules**: off turns every location lock off. The overlay and the panel stay.

## Safety

If the game's map ever differs from the mod's terrain table (an expansion update, for example) the mod says
so once and turns the locks off until it is updated. Nothing is written into your save; uninstalling leaves
it exactly as vanilla would.

Built by a developer using assistive AI.
