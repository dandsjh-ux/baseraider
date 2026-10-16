// Game rules and map geometry shared by the server (Node) and the browser.
// Everything here must stay free of DOM / Node specific APIs.

// ---------- World layout ----------
export const NUM_BASES = 6;
export const BASE_RING = 74;        // distance of each base centre from the world centre
export const WORLD_RADIUS = 128;    // players can't walk past this
export const POND_RADIUS = 13;      // the lake in the middle of the map

// ---------- Base (compound) layout, in base-local coordinates ----------
// Local +z points from the base towards the world centre (the front gate).
export const HALF = 20;             // compound is 40 x 40
export const CELL = 2;              // build grid cell size
export const GRID = 20;             // 20 x 20 cells
export const HOUSE = { x0: -12, x1: 12, z0: -14, z1: 4 };
export const WALL_H = 3.2;
export const DOOR_HALF = 2;         // doors are 4 wide (front and back)
export const FRONT_GATE_HALF = 4;   // front gate is 8 wide
export const BACK_GATE_HALF = 2;    // back gate is 4 wide
export const SPAWN_LOCAL = [2.4, -4.4]; // between the word rows, so you never spawn on a card

// ---------- Player ----------
export const MAX_HP = 100;
export const PLAYER_RADIUS = 0.45;
export const SPEED_DEFEND = 7;
export const SPEED_RAID = 9.8;       // raiders have no weapon but are faster
export const CARRY_SLOWDOWN = 0.07;  // speed lost per carried word
export const STICK = { range: 2.9, dmg: 20, cooldown: 450, kb: 9, kbUp: 5 };
export const RESPAWN_MS = 3000;
export const PICKUP_RANGE = 1.25;
export const STUN_MS = 1000;         // touching a trick word
export const STUN_IMMUNE_MS = 1200;  // grace period after a stun so you can walk away
export const START_BLOCKS = 20;
export const MAX_TURRETS = 4;
export const POINTS_PER_WORD = 10;
export const POINTS_PER_KO = 2;
export const COINS_PER_WORD = 30;       // bonus for each stolen word brought home
export const COINS_PER_KO = 5;
export const COINS_PER_ROUND = 50;      // round bonus for everyone else
export const COINS_ROUND_WIN = 100;     // round bonus for the round's top scorer(s)

// Which of the six bases are used for a given player count (spread out evenly).
export const BASE_LAYOUT = {
  1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5],
};

// ---------- Characters ----------
export const COLORS = ['#ff4d4d', '#3d8bff', '#38c96a', '#ffc93c', '#a66cff', '#ff9234', '#ff6fb5', '#22c7c7', '#8b5a2b', '#f2f2f2'];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Teal', 'Brown', 'White'];
export const HATS = ['none', 'cap', 'crown', 'party', 'beanie', 'tophat', 'bow', 'viking'];
export const HAT_LABELS = ['None', 'Cap', 'Crown', 'Party', 'Beanie', 'Top Hat', 'Bow', 'Viking'];

// ---------- Defences / buildables ----------
export const ITEMS = {
  block: {
    name: 'Block', icon: '📦', solid: true, cost: 25, buyQty: 5,
    desc: 'Crates for walls & mazes (outside the house). There must always be a way in!',
  },
  snow: {
    name: 'Snowball Tower', icon: '⛄', solid: true, turret: true, cost: 60,
    desc: 'Lobs snowballs at raiders in your compound.', range: 14, cooldown: 1400, dmg: 10, speed: 22,
  },
  frost: {
    name: 'Frost Cannon', icon: '🧊', solid: true, turret: true, cost: 90,
    desc: 'Fires ice blasts that freeze raiders solid.', range: 13, cooldown: 3400, dmg: 5, freeze: 1200, speed: 18,
  },
  cactus: {
    name: 'Cactus Spikes', icon: '🌵', floor: true, cost: 30,
    desc: 'Floor trap. Ouch! Pokes raiders who step on it.', dmg: 25, rearm: 2000,
  },
  freeze: {
    name: 'Freeze Trap', icon: '❄️', floor: true, cost: 40,
    desc: 'Floor trap. Freezes a raider for a few seconds.', freeze: 2500, rearm: 5000,
  },
  slime: {
    name: 'Sticky Slime', icon: '🟢', floor: true, cost: 20,
    desc: 'Floor trap. Gooey puddle that slows raiders right down.', slow: 0.4,
  },
  boing: {
    name: 'Boing Mushroom', icon: '🍄', floor: true, cost: 35,
    desc: 'Floor trap. Bounces raiders away — and knocks a stolen word out of their bag!', rearm: 1500, power: 15,
  },
};
export const ITEM_ORDER = ['block', 'snow', 'frost', 'cactus', 'freeze', 'slime', 'boing'];

// ---------- Room settings ----------
export const SETTINGS = {
  maxPlayers: { label: 'Max players', min: 2, max: 6, step: 1, def: 6 },
  prepTime: { label: 'Prep time (seconds)', min: 15, max: 300, step: 15, def: 60 },
  raidTime: { label: 'Raid time (seconds)', min: 30, max: 900, step: 30, def: 180 },
  rounds: { label: 'Raid rounds', min: 1, max: 5, step: 1, def: 2 },
  wordsPerBase: { label: 'Words per house', min: 4, max: 12, step: 1, def: 8 },
  decoysPerBase: { label: 'Trick words per house', min: 0, max: 8, step: 1, def: 4 },
  carryLimit: { label: 'Words a raider can carry', min: 1, max: 5, step: 1, def: 3 },
  startCoins: { label: 'Starting coins', min: 0, max: 1000, step: 50, def: 150 },
};

export function sanitizeSettings(s = {}, numCategories = 12) {
  const out = {};
  for (const [k, d] of Object.entries(SETTINGS)) {
    let v = Number(s?.[k]);
    if (!Number.isFinite(v)) v = d.def;
    v = Math.round(v / d.step) * d.step;
    out[k] = Math.min(d.max, Math.max(d.min, v));
  }
  const cats = Array.isArray(s?.categories) ? s.categories : [];
  out.categories = [...new Set(cats.map(Number).filter((c) => Number.isInteger(c) && c >= 0 && c < numCategories))];
  if (!out.categories.length) out.categories = [...Array(numCategories).keys()];
  return out;
}

// ---------- Geometry helpers ----------
export function baseTransform(k) {
  const a = (k * Math.PI * 2) / NUM_BASES;
  const cx = Math.sin(a) * BASE_RING;
  const cz = Math.cos(a) * BASE_RING;
  const yaw = Math.atan2(-cx, -cz); // local +z faces the world centre
  return { k, cx, cz, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) };
}
export const BASES = [...Array(NUM_BASES).keys()].map(baseTransform);

export function toWorld(b, lx, lz) {
  return [b.cx + lx * b.cos + lz * b.sin, b.cz - lx * b.sin + lz * b.cos];
}
export function toLocal(b, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos];
}
export function inCompound(lx, lz, margin = 0) {
  return Math.abs(lx) < HALF + margin && Math.abs(lz) < HALF + margin;
}
export function inHouse(lx, lz) {
  return lx > HOUSE.x0 && lx < HOUSE.x1 && lz > HOUSE.z0 && lz < HOUSE.z1;
}
export function spawnPoint(k, jitter = 0) {
  const j = () => (Math.random() - 0.5) * jitter;
  const [x, z] = toWorld(BASES[k], SPAWN_LOCAL[0] + j(), SPAWN_LOCAL[1] + j());
  // Face out of the front door (local +z).
  return { x, y: 0, z, ry: BASES[k].yaw };
}

// ---------- Build grid ----------
export const cellIndex = (i, j) => j * GRID + i;
export const inGrid = (i, j) => i >= 0 && j >= 0 && i < GRID && j < GRID;
export function cellCenter(i, j) {
  return [-HALF + CELL * (i + 0.5), -HALF + CELL * (j + 0.5)];
}
export function cellAt(lx, lz) {
  return [Math.floor((lx + HALF) / CELL), Math.floor((lz + HALF) / CELL)];
}
export function isHouseCell(i, j) {
  const [x, z] = cellCenter(i, j);
  return x > HOUSE.x0 && x < HOUSE.x1 && z > HOUSE.z0 && z < HOUSE.z1;
}
// Gate openings and the cells right outside each door can never hold solid things.
export function isReservedCell(i, j) {
  const [x, z] = cellCenter(i, j);
  if (j === GRID - 1 && Math.abs(x) < FRONT_GATE_HALF) return true;
  if (j === 0 && Math.abs(x) < BACK_GATE_HALF) return true;
  if (Math.abs(x) < DOOR_HALF && (z === HOUSE.z1 + CELL / 2 || z === HOUSE.z0 - CELL / 2)) return true;
  return false;
}
export function isSolidCell(grid, i, j) {
  const it = grid[cellIndex(i, j)];
  return !!(it && ITEMS[it.type]?.solid);
}

// Flood fill from the front gate. Every walkable cell in the compound (which
// includes both gates and the cells outside both house doors) must still be
// reachable after placing a solid thing at (pi, pj). This guarantees nobody can
// wall off the compound, the house, or trap someone in a sealed pocket.
export function keepsPathOpen(grid, pi, pj) {
  const blocked = (i, j) => isHouseCell(i, j) || (i === pi && j === pj) || isSolidCell(grid, i, j);
  let total = 0;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) if (!blocked(i, j)) total++;
  const start = cellAt(0.5, HALF - 1);
  if (blocked(start[0], start[1])) return false;
  const seen = new Uint8Array(GRID * GRID);
  const stack = [start];
  seen[cellIndex(start[0], start[1])] = 1;
  let reached = 0;
  while (stack.length) {
    const [i, j] = stack.pop();
    reached++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (!inGrid(ni, nj) || blocked(ni, nj)) continue;
      const id = cellIndex(ni, nj);
      if (seen[id]) continue;
      seen[id] = 1;
      stack.push([ni, nj]);
    }
  }
  return reached === total;
}

export function countTurrets(grid) {
  let n = 0;
  for (const it of grid) if (it && ITEMS[it.type]?.turret) n++;
  return n;
}

// Returns null when the item can be placed, otherwise a friendly reason.
export function placementError(grid, i, j, type) {
  const def = ITEMS[type];
  if (!def) return 'Unknown item';
  if (!inGrid(i, j)) return 'You can only build inside your compound';
  if (grid[cellIndex(i, j)]) return 'Something is already there';
  if (def.solid) {
    if (isHouseCell(i, j)) return 'Blocks and towers must go outside the house';
    if (isReservedCell(i, j)) return 'Keep the gates and doors clear!';
    if (def.turret && countTurrets(grid) >= MAX_TURRETS) return `Max ${MAX_TURRETS} towers per base`;
    if (!keepsPathOpen(grid, i, j)) return 'That would block the way in!';
  }
  return null;
}

// ---------- Word display slots inside a house ----------
// Slots 0..MAIN_SLOTS-1: the house's own words mixed with trick words, spread
// out on pedestals so raiders can weave between them.
// Slots MAIN_SLOTS+: the gold "loot shelf" by the front door for stolen words.
export const MAIN_COLS = 5, MAIN_ROWS = 4, MAIN_SLOTS = MAIN_COLS * MAIN_ROWS;
export const MAIN_DX = 4.8, MAIN_DZ = 3.2;
export const LOOT_COLS = 11, LOOT_Z = 1.4;
const mainGrid = (k) => [(k % MAIN_COLS - (MAIN_COLS - 1) / 2) * MAIN_DX, -12.4 + Math.floor(k / MAIN_COLS) * MAIN_DZ];
// Fill from the middle of the room outwards so a few words still look like a display.
const MAIN_ORDER = [...Array(MAIN_SLOTS).keys()].sort((a, b) => {
  const [ax, az] = mainGrid(a), [bx, bz] = mainGrid(b);
  return Math.hypot(ax, (az + 7.6) * 1.4) - Math.hypot(bx, (bz + 7.6) * 1.4) || a - b;
});
export const isLootSlot = (n) => n >= MAIN_SLOTS;
export function slotLocal(n) {
  if (n < MAIN_SLOTS) {
    const [x, z] = mainGrid(MAIN_ORDER[n]);
    return [x, 1.35, z];
  }
  const m = n - MAIN_SLOTS;
  return [-10 + (m % LOOT_COLS) * 2, 1.2 + Math.floor(m / LOOT_COLS) * 0.8, LOOT_Z];
}

export function points(words, kos) {
  return words * POINTS_PER_WORD + kos * POINTS_PER_KO;
}
