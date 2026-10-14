// Run with: npm test
import assert from 'assert';
import * as R from '../shared/rules.js';
import { CATEGORIES } from '../shared/words.js';

const empty = () => new Array(R.GRID * R.GRID).fill(null);
const put = (g, i, j, type = 'block') => { g[R.cellIndex(i, j)] = { type }; };

// Geometry round trip
for (const B of R.BASES) {
  const [x, z] = R.toWorld(B, 3.5, -7.25);
  const [lx, lz] = R.toLocal(B, x, z);
  assert(Math.abs(lx - 3.5) < 1e-9 && Math.abs(lz + 7.25) < 1e-9);
  // local +z (front gate) points at the world centre
  const [fx, fz] = R.toWorld(B, 0, R.HALF);
  assert(Math.hypot(fx, fz) < R.BASE_RING - R.HALF + 1e-6);
}

// Empty compound is fine; gates/doors/house are protected
let g = empty();
assert.equal(R.placementError(g, 0, 0, 'block'), null);
assert.match(R.placementError(g, 9, 19, 'block'), /gates/);
assert.match(R.placementError(g, 9, 0, 'block'), /gates/);
const [di, dj] = R.cellAt(0.5, R.HOUSE.z1 + 1); // just outside the front door
assert.match(R.placementError(g, di, dj, 'block'), /doors|gates/);
const [hi, hj] = R.cellAt(0.5, (R.HOUSE.z0 + R.HOUSE.z1) / 2);
assert.match(R.placementError(g, hi, hj, 'block'), /outside the house/);
assert.equal(R.placementError(g, hi, hj, 'cactus'), null, 'floor traps may go in the house');
assert.equal(R.placementError(g, 9, 19, 'slime'), null, 'floor traps may go in gates');

// A full wall across the compound is refused at the last block
g = empty();
let refused = null;
for (let i = 0; i < R.GRID; i++) {
  if (R.isReservedCell(i, 15)) continue;
  const e = R.placementError(g, i, 15, 'block');
  if (e) { refused = i; assert.match(e, /block the way/); break; }
  put(g, i, 15);
}
assert(refused !== null, 'sealing wall must be refused');

// Can't box in the corner (sealed pocket)
g = empty();
put(g, 1, 0);
assert.match(R.placementError(g, 0, 1, 'block'), /block the way/);

// 20 blocks in a sensible zig-zag are allowed
g = empty();
let placed = 0;
for (let i = 0; i < R.GRID && placed < 20; i += 2) for (const j of [14, 15]) { if (!R.placementError(g, i, j, 'block')) { put(g, i, j); placed++; } }
assert(placed >= 10);

// Turret cap
g = empty();
for (let n = 0; n < R.MAX_TURRETS; n++) put(g, n * 2, 2, 'snow');
assert.match(R.placementError(g, 0, 17, 'frost'), /Max/);

// Word slots: main pedestals are well spaced, never overlap the loot shelf, and
// the spawn point isn't on top of a card.
const main = [...Array(R.MAIN_SLOTS).keys()].map(R.slotLocal);
assert.equal(new Set(main.map((p) => p.join())).size, R.MAIN_SLOTS);
for (const a of main) {
  assert(R.inHouse(a[0], a[2]), 'slot inside the house');
  for (const b of main) if (a !== b) assert(Math.hypot(a[0] - b[0], a[2] - b[2]) >= 3, 'cards spaced apart');
  assert(Math.hypot(a[0] - R.SPAWN_LOCAL[0], a[2] - R.SPAWN_LOCAL[1]) > R.PICKUP_RANGE + 1, 'spawn clear of cards');
}
assert(R.MAIN_SLOTS >= R.SETTINGS.wordsPerBase.max + R.SETTINGS.decoysPerBase.max, 'room for all words + trick words');
for (let n = R.MAIN_SLOTS; n < R.MAIN_SLOTS + 30; n++) {
  const [x, , z] = R.slotLocal(n);
  assert(R.isLootSlot(n) && R.inHouse(x, z));
}

// Settings sanitising
const s = R.sanitizeSettings({ maxPlayers: 99, prepTime: 'x', categories: [3, 3, 99] }, CATEGORIES.length);
assert.equal(s.maxPlayers, 6);
assert.equal(s.prepTime, R.SETTINGS.prepTime.def);
assert.deepEqual(s.categories, [3]);

// Word lists
assert.equal(CATEGORIES.length, 12);
for (const c of CATEGORIES) assert(c.words.length >= 12, c.name);

console.log('rules tests passed');
