# Voyage: Far Shores

A mod for **Melvor Idle v1.3.1** that needs **Atlas of Discovery**. Every hex of the world map has a biome
(grasslands, kingslands, beach, desert, badlands, wastelands, highlands, lavalands, mountain, snowlands, swamplands,
cursedlands, shoals and open water) and features such as forest, river or snow, and skills only work where their
terrain is. Woodcutting needs trees. You have to go there.

This is an early build (phase 2 of 8): the map overlay, the "You are here" panel, the full set of location rules,
combat and trade tied to the map, and a compass to find your way. Travel is still the vanilla instant travel.
Provisions, the ship and the timed voyage come later.

## What it does

- **Terrain overlay.** Surveyed hexes on the Cartography map are tinted by terrain. Fog is untouched: hexes
  you have not surveyed show nothing new.
- **You are here.** A panel on the map shows the biome under you, the place name, the hex's features, which
  locked skills work here, and for the rest the nearest hex where they do and how far.
- **Locked skills.** Starting a skill where it cannot run shows a message with a "Go to map" button instead of
  starting. Gathering needs terrain: Woodcutting wants forest (a small stand of trees cuts at 80%), Mining wants
  mountains, highlands or a mine (or the hex next to one), Fishing wants a river, lake, beach or coast, Farming wants
  grasslands or a farm, Thieving a town, market or port. Crafting skills need a workshop: a town, port, camp, forge,
  temple, magic site or monolith depending on the skill. Firemaking and Cooking work on any land. Astrology,
  Cartography, Agility, Prayer and Archaeology work anywhere. Penalised hexes run slower, never faster.
- **Combat on the map.** Fighting an area, dungeon or stronghold needs you on its hex or next to it. Walking away ends
  the fight.
- **Trade near people.** Selling, buying and the Township trader work in a town, port or market, or next to one.
  The bank is your cargo hold until you get there.
- **The Wayfinder's Compass.** A free item in your bank, with 2,500 GP to reach your first trading place. When a skill
  is locked and you know of nowhere it works, the message tells you how far the nearest place is (Hot, Warm, Cold,
  Freezing) and which way. It never names the place: survey in Cartography for that. Sellable; the shop sells another.
- **Worker Folks.** With Worker Folks loaded, hiring, promoting and firing need a town or port, like Township.

## Settings (Mod Settings, section Voyage)

- **Terrain overlay**: tint on or off.
- **Voyage rules**: off turns every location lock off. The overlay and the panel stay.
- **Strictness**: Strict locks gathering and crafting; Relaxed locks gathering only.
- **Combat needs its area** and **Trade only near markets**: each can be switched off on its own.

## Safety

If the game's map ever differs from the mod's terrain table (an expansion update, for example) the mod says
so once and turns the locks off until it is updated. Nothing is written into your save; uninstalling leaves
it exactly as vanilla would.

Built by a developer using assistive AI.
