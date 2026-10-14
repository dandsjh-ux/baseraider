# 🏠 Base Raider

A bright, cute third-person multiplayer game for up to 6 players. You play as a chunky stickman. Raid other players' houses, steal their **word cards** and carry them home, and defend your own base with a stick, blocks and silly traps.

Built with **three.js** in the browser and **Node.js + socket.io** on the server. There are no build steps and no asset files: every model, texture and sound is generated in code.

## How a game works

1. **Main menu:** pick a name, colour and hat. Open rooms are listed and you can join any that are waiting. You can also **Create Room**.
2. **Room lobby:** the host can change the settings and press **Start**. Bases are spread evenly around the map. Houses without a player get boarded up with a *CLOSED* sign. With 2 players, the 4 other houses are closed.
3. **🛠️ Prep phase:** every other base is locked behind a force field. Place your **20 blocks** (crates) in your compound and buy defences in the shop.
4. **⚔️ Raid phase:**
   - Inside your own compound you are **defending**. You hold a stick that does damage with a small knockback.
   - Anywhere else you are **raiding**. You have no weapon but you run about 40% faster. Each word you carry slows you down a little.
   - Touch word cards in another house to pick them up (3 at a time by default). Run back into your own house to bank them.
   - At 0 HP you're knocked out. Any words you were carrying go back to the house they came from, and you respawn at your own house after 3 seconds.
5. More rounds can follow, each with a prep phase. Everyone gets +50 coins at the start of each new round.
6. **Scoring:** 10 points per word in your house plus 2 points per knock-out. The highest score at the end wins, and there's a podium screen.

### Defences (shop)

| Item | Cost | What it does |
|---|---|---|
| 📦 Block ×5 | 25 | Extra crates (everyone starts with 20) |
| ⛄ Snowball Tower | 60 | Turret that lobs snowballs at raiders in your compound (blocks give raiders cover!) |
| 🧊 Frost Cannon | 90 | Turret whose ice blasts freeze raiders |
| 🌵 Cactus Spikes | 30 | Floor trap, 25 damage |
| ❄️ Freeze Trap | 40 | Floor trap, freezes for 2.5 s |
| 🟢 Sticky Slime | 20 | Floor trap, slows raiders right down |
| 🍄 Boing Mushroom | 35 | Floor trap, launches raiders up and out of your base |

You can place up to 4 towers per base. Raiders can **jump over** floor traps.

### Building rules
- Blocks and towers can only go in the compound, **outside** the house. Floor traps can go anywhere in your compound, including inside the house.
- The gate openings and the squares in front of both house doors can never be built on.
- Every placement is checked with a flood fill (`shared/rules.js → keepsPathOpen`). Every open square must stay reachable from the front gate, so nobody can wall off the compound or the house, or trap a player in a sealed pocket.

### Room settings
Max players (2–6), prep time, raid time, number of raid rounds, words per house, how many words a raider can carry, starting coins, and which of the **12 word categories** to use. The categories are Animals, Vehicles, Stationery, Fruit & Veg, Sports, Weather, Music, Jobs, Clothing, Space, Ocean Life and Kitchen, all at a Year 4–6 level. You can edit the lists in `shared/words.js`.

### Controls
| | Keyboard / mouse | Touch |
|---|---|---|
| Move | WASD / arrows | left joystick |
| Look | mouse (click to lock), wheel to zoom | drag right side |
| Jump | Space | ⤒ |
| Whack / place | left click | ✋ |
| Build mode / pick item | B / 1–7 | 🔨 / tap hotbar |
| Remove own item | R or right click | 🗑️ |
| Shop (at home) | Q | 🛒 |
| Scoreboard / help / mute | Tab / H / M | |

In build mode the ghost box appears in front of you. Tilt the camera down or up to aim closer or further.

## Running locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # rule / path-blocking tests
```

To try multiplayer on one computer, open the game in two browser windows.

## Deploying to Render

**Option A, Blueprint:** push this repo to GitHub. In Render choose **New → Blueprint** and pick the repo. `render.yaml` sets everything up.

**Option B, manual web service:**
- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Render provides `PORT` automatically and supports WebSockets out of the box. Game rooms live in memory, so run a **single instance**. On the free plan the service sleeps after a period of inactivity and takes about 30 seconds to wake on the first visit.

## Project layout

```
server.js            Express + socket.io server: rooms, phases, combat, traps, turrets (authoritative)
shared/rules.js      Map geometry, items, settings, build-grid & path-blocking rules (used by server AND browser)
shared/words.js      The 12 word categories
public/index.html    Menus, HUD, shop, help
public/style.css     Bright, chunky UI styling
public/js/main.js    Menu / lobby / end-screen logic and networking glue
public/js/engine.js  Renderer, lights, render loop, menu fly-over
public/js/world.js   Terrain, lake, forest, mountains, the 6 bases (houses, fences, gates) and collision
public/js/game.js    In-game client: movement, camera, building, words, effects, HUD, touch controls
public/js/stickman.js Cute stickman character (colours, hats, stick, backpack, animations)
public/js/items.js   Block / tower / trap models
public/js/audio.js   Synthesised sound effects
```
