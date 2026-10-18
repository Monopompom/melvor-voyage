# Voyage: Far Shores

A mod for **Melvor Idle v1.3.1** that needs **Atlas of Discovery**. Every hex of the world map has a biome
(grasslands, kingslands, beach, desert, badlands, wastelands, highlands, lavalands, mountain, snowlands, swamplands,
cursedlands, shoals and open water) and features such as forest, river or snow, and skills only work where their
terrain is. Woodcutting needs trees. You have to go there.

This is an early build (phase 3 of 8, in progress): the map overlay, the "You are here" panel, the full set of location rules,
combat and trade tied to the map, a compass to find your way, and a boat for the water. Travel is still instant.
Provisions and the timed voyage come later.

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
- **Trade near people.** Selling and buying work in a town, port or market, or next to one. Township, its trader
  included, works in a town or port.
  The bank is your cargo hold until you get there.
- **The Wayfinder's Compass.** A free item in your bank, with 2,500 GP to reach your first trading place. When a skill
  is locked and you know of nowhere it works, the message tells you how far the nearest place is (Hot, Warm, Cold,
  Freezing) and which way. At first it never names the place: survey in Cartography for that, or level the Voyage skill. Sellable; the shop sells another.
- **Stranded?** Broke, far from any market, and nothing here earns GP: try to sell and a wandering trader turns up. He
  pays half, and only until you can afford the road.
- **The Voyage skill.** A passive skill in the sidebar with its own page. Every hex you travel gives Voyage XP
  (water hexes more), and earlier travels count once when you first load. Levels sharpen the compass: at 10 it says
  how many hexes away, at 25 the name of the place. "Manage voyage" on the map and "Show map" on the page link the
  two.
- **A boat for the water.** On foot you walk on land only. Build a dinghy on the Voyage page (500 GP, 50 Normal
  Logs and an Old Hat from Fishing (not in Adventure until you unlock Fishing), standing on a coast); it goes into the water next to you. Step onto it to board, sail up to 2 hexes from land,
  and step ashore on any coast: the boat waits where you left it, shown on the map with its anchor. Some islands
  need a bigger ship, in step with the dungeons on them: a dinghy can't land on the Cursed or the Ominous Isle. If you were already
  out on the water or on another island when you installed this version, you get a dinghy for free.
- **Provisions.** Every hex costs food from your stores, and fuel for the campfire on land: a little on easy ground,
  more on hills, mountains and wastes, most in snow and lava (Firemaking levels make the fuel go further). Load food
  and fuel from the bank on the Voyage page at a port (everything at full measure), a town or market, or a farm or camp
  (less), standing on it or next to it. The stores hold only so much, and every Voyage level adds room. You start with
  a kit. With empty stores you can still walk easy ground, for no Voyage XP. At sea you always keep the food to get
  back ashore, and fast travel between ports sails your ship, so it has to be waiting at the port.
- **Hull wear.** Every sea hex wears your ship's hull a little. Beach it on a coast and repair it on the Voyage page
  with logs and Pitch, which Firemaking now makes from time to time. A worn-out hull can always limp back to the
  coast.
- **The hold.** Your boat has a hold for bank items: one kind of item a slot, in any amount (6 slots on a dinghy, one
  more every 10 Voyage levels). Stow items from the bank's item panel and take them back on the Voyage page, standing
  on the boat or next to it. The hold is kept in the mod's save data: take everything out before you remove the mod.
- **Cargo runs.** Once a dungeon near a port is cleared, its harbour board (on the map's Here panel at the port)
  posts requests: goods from your bank, packed 50 to a Sack or Crate (made in Crafting), carried in your hold to a
  port at least 12 hexes away by sea. Delivering pays twice what the goods sell for, plus GP and Voyage XP for every
  hex. Boards change every 3 days; you can carry 3 runs at once. Packed cargo stays in the hold until it is delivered.
- **Markets with prices.** Each market pays well for some goods (140 to 180%) and little for others (60 to 80%);
  worked goods fetch 20 points more than raw ones. You learn a market's prices by visiting it: the bank's Sell block
  shows the price here and the best and worst you know, and the journal keeps a ledger.
- **Night.** From 21:00 to 05:00 on your own clock, the fuel a trip leaves over lights the way, and every lit hex gives
  25% more Voyage XP. Light never takes the fuel a trip needs, so playing at night is never worse than by day.
  Astrology levels make the light go further. You can move the night in the settings, or switch it off.
- **Worker Folks.** With Worker Folks loaded, hiring, promoting and firing need a town or port, like Township.

## Settings (Mod Settings, section Voyage)

- **Terrain overlay**: tint on or off.
- **Voyage rules**: off turns every location lock off. The overlay and the panel stay.
- **Strictness**: Strict locks gathering and crafting; Relaxed locks gathering only, and keeps Firemaking and Cooking on dry land.
- **Resource zones**: each ore, tree, fish, crop, thieving target and constellation is found only in its own places (iron and copper
  are in different regions; the panel's skill icons list what is found on your hex). Off: the skill's terrain decides alone.
- **Combat needs its area** and **Trade only near markets**: each can be switched off on its own.
- **Provisions**: off, moves take nothing from your stores and sailing wears nothing.
- **Night** and **Move the night (hours)**: night on or off, and when it falls (−12 to 12 hours from 21:00 to 05:00).

## Languages

Every text of the mod comes from its language files. Only English ships for now; the game's language setting
picks the matching file when one exists.

## Safety

If the game's map ever differs from the mod's terrain table (an expansion update, for example) the mod says
so once and turns the locks off until it is updated. Nothing is written into your save; uninstalling leaves
it exactly as vanilla would.

Built by a developer using assistive AI.
