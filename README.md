# Voyage: Far Shores

A mod for **Melvor Idle v1.3.1** that needs **Atlas of Discovery**. Every hex of the world map has a biome
(grasslands, kingslands, beach, desert, badlands, wastelands, highlands, lavalands, mountain, snowlands, swamplands,
cursedlands, shoals and open water) and features such as forest, river or snow, and skills only work where their
terrain is. Woodcutting needs trees. You have to go there.

This is an early build (phase 5 of 8 under way): the map overlay, the "You are here" panel, the full set of location
rules, combat and trade tied to the map, a compass to find your way, boats and ships for the water, provisions, cargo
runs and markets, harbour notices, sea charts and rumours, a Random start, the Captain's Journal, and now timed travel: a voyage takes time, one hex after another.

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
- **Bigger hulls.** You own one small boat and one big ship. At a port a shipwright turns the dinghy into a longboat
  (Voyage 30, rows 4 hexes from land, lands on the Cursed Isle), sells a brig (Voyage 45, a sailing ship for the open
  sea and the Ominous Isle) and turns the brig into a galleon (Voyage 60, any sea, under cloud too). The big ships tie
  up at ports and carry your small boat for every other shore. All of it is in the Ship block's Shipwright row.
- **Provisions.** Every hex costs food from your stores, and fuel for the campfire on land: a little on easy ground,
  more on hills, mountains and wastes, most in snow and lava (Firemaking levels make the fuel go further). Load food
  and fuel from the bank on the Voyage page at a port (everything at full measure), a town or market, or a farm or camp
  (less), standing on it or next to it. The stores hold only so much, and every Voyage level adds room. You start with
  a kit. With empty stores you can still walk easy ground, for no Voyage XP. At sea you always keep the food to get
  back ashore, and fast travel between ports sails your ship, so it has to be waiting at the port.
- **Hull wear.** Every sea hex wears your ship's hull a little. Repair it in the Voyage page's Stores block with logs
  and Pitch, which Firemaking now makes from time to time (more often from better logs): the small boat on a beach,
  the big ship at a port. A worn-out hull can always limp back to the
  coast.
- **The hold.** Each vessel has a hold for bank items: one kind of item a slot, in any amount (dinghy 6, longboat 12,
  brig 18, galleon 24, and a row of six more at Voyage 35 and 55). Stow items from the bank's item panel and take them
  back on the Voyage page, standing on the vessel or next to it. The hold is kept in the mod's save data: take everything out before you remove the mod.
- **Cargo runs.** Once a dungeon near a port is cleared, its harbour board (on the map's Here panel at the port)
  posts requests: goods from your bank, packed 50 to a Sack or Crate (made in Crafting), carried in your hold to a
  port you have found at least 12 hexes away by sea (so a board stays bare until you know a second port). Requests
  grow with your level in their trade, and a big one goes in several loads. Delivering pays twice what the goods sell
  for, plus GP and Voyage XP for every hex. Boards change every 3 days; you can carry 3 runs at once, listed under the
  Hold on the Voyage page. Packed cargo stays in the hold until it is delivered. When the way needs a bigger hull
  than yours (open sea, or an island your boat can't land on), the request says which one.
- **Notices.** Every harbour board posts a few tasks each season: set foot on a place you have not found yet and
  can reach today, or bring goods you gather after taking it to a port you know. One task at a time; it pays GP and Voyage XP, now and
  then a rumour besides.
- **Sea charts and rumours.** A board sells the chart of its port's sea and its neighbours': it clears the fog, and
  the price falls as you clear the fog yourself. Working near a town, port or market, you sometimes hear a Tavern
  Tale or a Sailor's Rumour; read it from the bank to lift the fog round a place you have not found. Surveying stays
  yours.
- **Where you start.** A new character chooses once: the game's own start, or a random start somewhere else you can
  live and grow from. On an island, the boat that brought you there is yours.
- **Markets with prices.** Each market pays well for some goods (140 to 180%) and little for others (60 to 80%);
  worked goods fetch 20 points more than raw ones. You learn a market's prices by visiting it: the bank's Sell block
  shows the price here and the best and worst you know, and the journal keeps a ledger.
- **Into the fog.** On a hex not surveyed yet, Explore there sets off a voyage that surveys its own way: each fog hex
  ahead is surveyed at Cartography's pace (its XP and finds as usual) before you sail in, and you may survey a hex or
  two beside the route as well. A hex your Cartography can't survey, nor will by the time you get there, bars the trip.
  Fog hexes are paid as you reach them.
- **Timed travel.** Travel is the work you are doing, like a skill: a land hex takes 6 minutes on foot (longer on
  rough ground, snow and lava), a sea hex 5 minutes in the dinghy down to 2 in the galleon. Each hex is paid as you
  enter it, and Stop here on the Voyage page keeps the hexes reached. Before setting off, pick up to three things to
  do on arrival; the first that can start, starts. Starting something else under way asks first. The voyage goes on
  while the game is closed, and Welcome Back tells where it ended. It is a setting, on by default; off, travel is
  instant as in the base game.
- **Plan a voyage.** From Voyage 15, Plan voyage (on a journal page, a cargo run or a popup that sends you elsewhere)
  shows the route, the stops to stock up and the cost. With Navigator's Charts (Voyage 50, bought once at a port for
  300,000 GP and 100 Pitch) Set off makes the whole trip in one go (in time, with Timed travel on), and On arrival starts the work you planned.
- **On land.** The shop's Voyage tab sells Sturdy Boots, a Pack Yak, a Riding Horse and a Unicorn, each making land
  hexes quicker to cross (cheaper instead with Timed travel off), and from Voyage 35 a Crossroads Sign that carries a place's gifts with you.
- **The Captain's Journal.** The book button on the Voyage page (or the J key) opens a journal of chapters on every
  rule (notices, charts and rumours too), guide pages that turn up as you meet things, the markets' ledger and maps of where resources are.
  Its Places list where you fought, the ports you used and what you did there, the markets, and the islands you set
  foot on; search them by place, land, monster or what a monster drops.
- **Your page, your panel.** Drag the Voyage page's blocks by their title (hold a moment on a phone) and fold the ones
  you seldom need; Reset layout puts them back. On the map, tap You are here to fold the panel to a strip; on a phone,
  hold its triangle to shrink it to a small square, and tap the square to get it back as it was.
- **Night.** From 21:00 to 05:00 on your own clock, the fuel a trip leaves over lights the way, and every lit hex gives
  25% more Voyage XP. Light never takes the fuel a trip needs, so playing at night is never worse than by day.
  Astrology levels make the light go further. You can move the night in the settings, or switch it off. Very rarely
  a lit hex at sea turns up a Starlit Chart: read it from the bank to clear the fog of the sea you are on.
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
- **Keys**: G centres the map on you, J opens and closes the journal, M opens the map. Each can be changed, or left
  empty to turn it off.

## Themes

The Voyage page, the map panel and the mod's popups follow the game's theme: Light, Dark or Super Dark (Settings).
The Captain's Journal keeps its parchment in all three.

## Languages

Every text of the mod comes from its language files. Only English ships for now; the game's language setting
picks the matching file when one exists.

## Safety

If the game's map ever differs from the mod's terrain table (an expansion update, for example) the mod says
so once and turns the locks off until it is updated. The mod keeps its own data in your save under its own name:
the Voyage skill, your vessels and their holds, cargo, tasks, the fog you have charted, the journal. The game's own data is left as it is. Removing
the mod drops all of its data, so take your items out of the holds first (packed cargo can't come out).

## Credits

The Captain's Journal is set in two open-source typefaces, with thanks to their makers:

- **EB Garamond**, by Georg Duffner and Octavio Pardo (The EB Garamond Project Authors), a revival of Claude
  Garamont's sixteenth-century types: the journal's text and italics.
  [github.com/octaviopardo/EBGaramond12](https://github.com/octaviopardo/EBGaramond12)
- **IM Fell English**, by Igino Marini, a digitisation of the Fell Types that Bishop John Fell gathered for Oxford
  in the seventeenth century: the journal's headings.
  [fonts.google.com/specimen/IM+Fell+English](https://fonts.google.com/specimen/IM+Fell+English)

Both are released under the SIL Open Font License 1.1; their licence texts ship beside the fonts in `assets/fonts/`.
The mod's own code is under the MIT License (`LICENSE`); the fonts keep their own licence.

Built by a developer using assistive AI.
