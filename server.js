import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import * as R from './shared/rules.js';
import { CATEGORIES } from './shared/words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));
app.get('/health', (_req, res) => res.send('ok'));

const server = createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const PORT = process.env.PORT || 3000;

const TICK_MS = 50;
const rooms = new Map();
let nextRoomId = 1;
let nextWordId = 1;
let nextShotId = 1;

// ---------- helpers ----------
const clampInt = (v, lo, hi, def) => {
  v = Number(v);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : def;
};
const cleanText = (s, max, fallback) => {
  s = String(s ?? '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
};
const cleanLook = (l) => ({
  color: clampInt(l?.color, 0, R.COLORS.length - 1, 0),
  hat: clampInt(l?.hat, 0, R.HATS.length - 1, 0),
});
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const ack = (cb, v) => typeof cb === 'function' && cb(v);

function roomSummary(r) {
  return {
    id: r.id, name: r.name, host: r.players.get(r.hostId)?.name ?? '?',
    count: r.players.size, max: r.settings.maxPlayers, state: r.state,
    players: [...r.players.values()].map((p) => ({ name: p.name, look: p.look })),
    members: [...r.players.keys()],
  };
}
function broadcastRooms() {
  io.to('lobby').emit('rooms', [...rooms.values()].map(roomSummary));
}
function roomInfo(r) {
  return {
    id: r.id, name: r.name, hostId: r.hostId, settings: r.settings, state: r.state,
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, online: p.online })),
  };
}
const sendRoom = (r) => io.to(r.id).emit('room', roomInfo(r));
const toPlayer = (pid) => io.to('p:' + pid);
const toast = (id, msg, kind = 'info') => toPlayer(id).emit('toast', { msg, kind });
const feed = (r, msg) => io.to(r.id).emit('feed', { msg });

// ---------- game setup ----------
function startGame(r) {
  const plist = [...r.players.values()];
  const layout = R.BASE_LAYOUT[plist.length];
  const pool = shuffle(r.settings.categories.slice());
  const used = new Set();
  const bases = R.BASES.map((_, k) => ({ index: k, owner: null, ownerName: '', category: -1, closed: true, grid: new Array(R.GRID * R.GRID).fill(null) }));
  const words = [];
  const s = r.settings;

  plist.forEach((p, n) => {
    const k = layout[n];
    const b = bases[k];
    b.owner = p.id;
    b.ownerName = p.name;
    b.closed = false;
    b.category = pool[n % pool.length];
    const choices = shuffle(CATEGORIES[b.category].words.filter((w) => !used.has(w)));
    for (const text of choices.slice(0, s.wordsPerBase)) {
      used.add(text);
      words.push({ id: nextWordId++, text, cat: b.category, base: k, slot: -1, carrier: null, from: k, decoy: false });
    }
    const sp = R.spawnPoint(k, 1.5);
    Object.assign(p, {
      base: k, hp: R.MAX_HP, dead: false, respawnAt: 0,
      x: sp.x, y: 0, z: sp.z, ry: sp.ry, anim: 0, vx: 0, vz: 0, lastState: 0,
      carry: [], coins: s.startCoins, kos: 0, stolen: 0,
      inv: Object.fromEntries(R.ITEM_ORDER.map((t) => [t, t === 'block' ? R.START_BLOCKS : 0])),
      frozenUntil: 0, slowUntil: 0, stunUntil: 0, stunImmuneUntil: 0, lastSwing: 0, lastHurt: 0, lastHurtBy: null, tpSeq: 1,
    });
  });
  // Trick words: words from other categories mixed in with each house's real words.
  for (const b of bases) {
    if (b.closed) continue;
    const others = shuffle(CATEGORIES.flatMap((c, ci) => (ci === b.category ? [] : c.words.map((text) => ({ text, ci })))).filter((w) => !used.has(w.text)));
    for (const { text, ci } of others.slice(0, s.decoysPerBase)) {
      used.add(text);
      words.push({ id: nextWordId++, text, cat: ci, base: b.index, slot: -1, carrier: null, from: b.index, decoy: true });
    }
    const mine = words.filter((w) => w.base === b.index);
    shuffle([...Array(mine.length).keys()]).forEach((slot, n) => { mine[n].slot = slot; });
  }

  const now = Date.now();
  r.state = 'game';
  r.game = { bases, words, shots: [], phase: 'prep', round: 1, phaseEnd: now + s.prepTime * 1000, lastTick: now };

  io.to(r.id).emit('gameStart', gamePayload(r));
  plist.forEach(sendInv);
  feed(r, '🛠️ Prep time! Build your defences.');
  broadcastRooms();
}

function gamePayload(r) {
  const g = r.game, now = Date.now();
  return {
    settings: r.settings,
    phase: g.phase, round: g.round, timeLeft: g.phaseEnd - now,
    bases: g.bases.map(publicBase),
    words: g.words.map((w) => publicWord(w, g)),
    items: g.bases.map(listItems),
    players: [...r.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, base: p.base, x: p.x, z: p.z, ry: p.ry, seq: p.tpSeq })),
  };
}

const publicBase = (b) => ({ index: b.index, owner: b.owner, ownerName: b.ownerName, category: b.category, closed: b.closed });
const publicWord = (w, g) => ({
  id: w.id, t: w.text, b: w.base, s: w.slot, k: w.carrier,
  c: w.base >= 0 && !R.isLootSlot(w.slot) ? g.bases[w.base].category : w.cat,
});
const sendWords = (r) => io.to(r.id).emit('words', r.game.words.map((w) => publicWord(w, r.game)));
const wordCount = (g, k) => g.words.reduce((n, w) => n + (w.base === k && !w.decoy ? 1 : 0), 0);
const sendInv = (p) => toPlayer(p.id).emit('inv', { coins: p.coins, inv: p.inv });
function listItems(b) {
  const list = [];
  b.grid.forEach((it, n) => it && list.push([n % R.GRID, Math.floor(n / R.GRID), it.type]));
  return list;
}
const sendItems = (r, b) => io.to(r.id).emit('items', { b: b.index, list: listItems(b) });

// A house's own-category words go on the main pedestals; stolen words from
// other categories go on the loot shelf by the door.
function freeSlot(g, k, cat) {
  const taken = new Set(g.words.filter((w) => w.base === k).map((w) => w.slot));
  if (cat === g.bases[k].category) {
    for (let n = 0; n < R.MAIN_SLOTS; n++) if (!taken.has(n)) return n;
  }
  let n = R.MAIN_SLOTS;
  while (taken.has(n)) n++;
  return n;
}

function teleport(p, pos) {
  p.tpSeq++;
  p.x = pos.x; p.y = 0; p.z = pos.z; p.ry = pos.ry; p.vx = p.vz = 0;
  toPlayer(p.id).emit('tp', { seq: p.tpSeq, p: [pos.x, 0, pos.z], ry: pos.ry });
}

// Carried words go back to the house they were taken from.
function dropCarry(r, p) {
  const g = r.game;
  if (!g || !p.carry?.length) return;
  for (const id of p.carry) {
    const w = g.words.find((x) => x.id === id);
    if (!w) continue;
    w.carrier = null;
    w.base = w.from;
    w.slot = freeSlot(g, w.from, w.cat);
  }
  p.carry = [];
  sendWords(r);
}

function bankWords(r, p) {
  const g = r.game;
  const names = [];
  for (const id of p.carry) {
    const w = g.words.find((x) => x.id === id);
    if (!w) continue;
    const fromOwner = g.bases[w.from].ownerName || 'someone';
    w.carrier = null;
    w.base = p.base;
    w.slot = freeSlot(g, p.base, w.cat);
    w.from = p.base;
    names.push(`"${w.text}"`);
    p.stolen++;
    p.coins += R.COINS_PER_WORD;
    feed(r, `💰 ${p.name} stole ${names.at(-1)} from ${fromOwner}!`);
  }
  p.carry = [];
  sendWords(r);
  sendInv(p);
  toPlayer(p.id).emit('banked', { count: names.length });
}

// ---------- combat ----------
function damage(r, v, dmg, byId, kind, kb) {
  if (v.dead) return;
  const now = Date.now();
  v.hp = Math.max(0, v.hp - dmg);
  v.lastHurt = now;
  v.lastHurtBy = byId;
  io.to(r.id).emit('hit', { id: v.id, by: byId, dmg, kind, kb: kb || null });
  if (v.hp <= 0) kill(r, v, byId, kind);
}

const KILL_TEXT = {
  stick: 'bonked', snow: 'snowballed', frost: 'iced', cactus: 'spiked',
};
function kill(r, v, byId, kind) {
  v.dead = true;
  v.hp = 0;
  v.respawnAt = Date.now() + R.RESPAWN_MS;
  dropCarry(r, v);
  const killer = r.players.get(byId);
  if (killer && killer !== v) {
    killer.kos++;
    killer.coins += R.COINS_PER_KO;
    sendInv(killer);
  }
  io.to(r.id).emit('died', { id: v.id, by: byId, kind });
  feed(r, killer ? `💥 ${killer.name} ${KILL_TEXT[kind] || 'knocked out'} ${v.name}!` : `💥 ${v.name} was knocked out!`);
}

function freeze(r, p, ms) {
  p.frozenUntil = Math.max(p.frozenUntil, Date.now() + ms);
  io.to(r.id).emit('frozen', { id: p.id, ms });
}

// ---------- tick ----------
function tickRoom(r, now) {
  const g = r.game;
  const dt = Math.min(0.2, (now - g.lastTick) / 1000);
  g.lastTick = now;

  if (now >= g.phaseEnd) advancePhase(r, now);
  if (r.state !== 'game') return;

  for (const p of r.players.values()) {
    if (!p.online) continue;
    if (p.dead) {
      if (now >= p.respawnAt) {
        p.dead = false;
        p.hp = R.MAX_HP;
        p.frozenUntil = p.slowUntil = 0;
        teleport(p, R.spawnPoint(p.base, 1.5));
        io.to(r.id).emit('respawn', { id: p.id });
      }
      continue;
    }
    const [lx, lz] = R.toLocal(R.BASES[p.base], p.x, p.z);
    if (R.inCompound(lx, lz) && now - p.lastHurt > 2500) p.hp = Math.min(R.MAX_HP, p.hp + 10 * dt);
    if (g.phase === 'raid') checkTraps(r, p, now);
  }
  if (g.phase === 'raid') fireTurrets(r, now);
  moveShots(r, dt);

  io.to(r.id).emit('snap', {
    ph: g.phase, rd: g.round, tl: g.phaseEnd - now,
    ps: [...r.players.values()].map((p) => ({
      id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: +p.ry.toFixed(2), a: p.anim,
      hp: Math.round(p.hp), d: p.dead ? 1 : 0,
      fz: Math.max(0, p.frozenUntil - now), sl: p.slowUntil > now ? 1 : 0,
      sn: Math.max(0, p.stunUntil - now), off: p.online ? 0 : 1,
      c: p.coins, k: p.kos, st: p.stolen, w: wordCount(g, p.base),
    })),
  });
}

function advancePhase(r, now) {
  const g = r.game, s = r.settings;
  if (g.phase === 'prep') {
    g.phase = 'raid';
    g.phaseEnd = now + s.raidTime * 1000;
    for (const b of g.bases) for (const it of b.grid) if (it) it.next = now + 1500;
    io.to(r.id).emit('phase', { phase: 'raid', round: g.round, timeLeft: s.raidTime * 1000 });
    feed(r, `⚔️ Round ${g.round}: RAID! Steal words and bring them home!`);
    return;
  }
  for (const p of r.players.values()) dropCarry(r, p);
  g.shots = [];
  if (g.round < s.rounds) {
    g.round++;
    g.phase = 'prep';
    g.phaseEnd = now + s.prepTime * 1000;
    for (const p of r.players.values()) {
      p.coins += R.COINS_PER_ROUND;
      p.dead = false;
      p.hp = R.MAX_HP;
      p.frozenUntil = p.slowUntil = p.stunUntil = 0;
      teleport(p, R.spawnPoint(p.base, 1.5));
      sendInv(p);
    }
    io.to(r.id).emit('phase', { phase: 'prep', round: g.round, timeLeft: s.prepTime * 1000 });
    feed(r, `🛠️ Round ${g.round} prep! Everyone gets +${R.COINS_PER_ROUND} coins.`);
    return;
  }
  endGame(r);
}

function endGame(r) {
  const g = r.game;
  const ranking = [...r.players.values()].map((p) => {
    const words = wordCount(g, p.base);
    return { id: p.id, name: p.name, look: p.look, words, kos: p.kos, stolen: p.stolen, points: R.points(words, p.kos) };
  }).sort((a, b) => b.points - a.points || b.words - a.words || b.stolen - a.stolen);
  io.to(r.id).emit('gameOver', { ranking });
  r.state = 'lobby';
  r.game = null;
  sendRoom(r);
  broadcastRooms();
}

function checkTraps(r, p, now) {
  const g = r.game;
  for (const b of g.bases) {
    if (b.closed || b.index === p.base) continue;
    const [lx, lz] = R.toLocal(R.BASES[b.index], p.x, p.z);
    if (!R.inCompound(lx, lz)) continue;
    const [i, j] = R.cellAt(lx, lz);
    if (!R.inGrid(i, j)) continue;
    const it = b.grid[R.cellIndex(i, j)];
    const def = it && R.ITEMS[it.type];
    if (!def?.floor) continue;
    const grounded = p.y < 0.6;
    if (it.type === 'slime') {
      if (grounded) p.slowUntil = now + 300;
      continue;
    }
    if (!grounded || now < (it.rearm || 0)) continue;
    it.rearm = now + def.rearm;
    io.to(r.id).emit('trap', { b: b.index, i, j, type: it.type });
    if (it.type === 'cactus') {
      damage(r, p, def.dmg, b.owner, 'cactus', [0, 7, 0]);
    } else if (it.type === 'freeze') {
      freeze(r, p, def.freeze);
    } else if (it.type === 'boing') {
      // Fling away from the house, back towards the outside.
      let dx = lx - R.SPAWN_LOCAL[0], dz = lz - R.SPAWN_LOCAL[1];
      const d = Math.hypot(dx, dz) || 1;
      const [wx, wz] = R.toWorld(R.BASES[b.index], dx / d, dz / d);
      const B = R.BASES[b.index];
      const ux = wx - B.cx, uz = wz - B.cz;
      damage(r, p, 0, b.owner, 'boing', [ux * def.power, 16, uz * def.power]);
    }
  }
}

function fireTurrets(r, now) {
  const g = r.game;
  for (const b of g.bases) {
    if (b.closed) continue;
    const B = R.BASES[b.index];
    b.grid.forEach((it, n) => {
      const def = it && R.ITEMS[it.type];
      if (!def?.turret || now < (it.next || 0)) return;
      const [cx, cz] = R.cellCenter(n % R.GRID, Math.floor(n / R.GRID));
      const [wx, wz] = R.toWorld(B, cx, cz);
      let best = null, bestD = def.range;
      for (const p of r.players.values()) {
        if (p.dead || !p.online || p.base === b.index) continue;
        const [lx, lz] = R.toLocal(B, p.x, p.z);
        if (!R.inCompound(lx, lz, 1)) continue;
        const d = Math.hypot(p.x - wx, p.z - wz);
        if (d < bestD) { best = p; bestD = d; }
      }
      if (!best) return;
      it.next = now + def.cooldown;
      const sy = 2.9;
      const t = bestD / def.speed;
      const tx = best.x + best.vx * t * 0.6, tz = best.z + best.vz * t * 0.6, ty = best.y + 1.0;
      const dx = tx - wx, dy = ty - sy, dz = tz - wz;
      const len = Math.hypot(dx, dy, dz) || 1;
      const shot = {
        id: nextShotId++, type: it.type, base: b.index, owner: b.owner,
        x: wx, y: sy, z: wz, vx: (dx / len) * def.speed, vy: (dy / len) * def.speed, vz: (dz / len) * def.speed,
        life: (def.range + 4) / def.speed, cell: n,
      };
      g.shots.push(shot);
      io.to(r.id).emit('shot', { id: shot.id, type: shot.type, b: b.index, cell: n, p: [wx, sy, wz], v: [shot.vx, shot.vy, shot.vz] });
    });
  }
}

function moveShots(r, dt) {
  const g = r.game;
  g.shots = g.shots.filter((s) => {
    const ox = s.x, oy = s.y, oz = s.z;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    s.life -= dt;
    // Hit a player?
    for (const p of r.players.values()) {
      if (p.dead || !p.online || p.base === s.base) continue;
      if (segPointDist(ox, oy, oz, s.x, s.y, s.z, p.x, p.y + 1, p.z) < 0.8) {
        const def = R.ITEMS[s.type];
        const sp = Math.hypot(s.vx, s.vz) || 1;
        damage(r, p, def.dmg, s.owner, s.type, [(s.vx / sp) * 4, 3, (s.vz / sp) * 4]);
        if (def.freeze && !p.dead) freeze(r, p, def.freeze);
        io.to(r.id).emit('shotEnd', { id: s.id, p: [s.x, s.y, s.z], hit: p.id });
        return false;
      }
    }
    // Blocks give raiders cover.
    const [lx, lz] = R.toLocal(R.BASES[s.base], s.x, s.z);
    const [i, j] = R.cellAt(lx, lz);
    const hitsBlock = s.y < 2 && R.inGrid(i, j) && R.cellIndex(i, j) !== s.cell && R.isSolidCell(g.bases[s.base].grid, i, j);
    if (s.life <= 0 || s.y < 0 || hitsBlock) {
      io.to(r.id).emit('shotEnd', { id: s.id, p: [s.x, Math.max(0.2, s.y), s.z] });
      return false;
    }
    return true;
  });
}

function segPointDist(ax, ay, az, bx, by, bz, px, py, pz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const l2 = abx * abx + aby * aby + abz * abz || 1;
  let t = ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + abx * t - px, ay + aby * t - py, az + abz * t - pz);
}

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.state !== 'game') continue;
    try {
      tickRoom(r, now);
    } catch (e) {
      console.error('tick error', r.id, e);
    }
  }
}, TICK_MS);

// ---------- players, sessions & rooms ----------
// Each browser keeps a secret token (localStorage), so refreshing, closing the
// tab or a Wi-Fi blip puts you straight back into your room / game.
const sessions = new Map(); // token -> { pid, socketId, roomId, lastSeen }
let nextPid = 1;
const LOBBY_GRACE_MS = 45_000;       // offline players are dropped from a lobby after this
const EMPTY_GAME_ROOM_MS = 5 * 60_000; // a game nobody is connected to is closed after this

function removePlayer(r, pid) {
  const p = r.players.get(pid);
  if (!p) return;
  if (r.game) {
    dropCarry(r, p);
    feed(r, `👋 ${p.name} left the game. Their house is still open for raiding!`);
  }
  r.players.delete(pid);
  for (const s of sessions.values()) if (s.pid === pid && s.roomId === r.id) s.roomId = null;
  if (r.players.size === 0) {
    rooms.delete(r.id);
  } else if (r.hostId === pid) {
    const online = [...r.players.values()].find((q) => q.online);
    r.hostId = (online || r.players.values().next().value).id;
  }
  if (rooms.has(r.id)) sendRoom(r);
  broadcastRooms();
}

function leaveRoom(socket) {
  const sess = socket.data.session;
  const r = rooms.get(sess.roomId);
  sess.roomId = null;
  socket.join('lobby');
  if (!r) return;
  socket.leave(r.id);
  removePlayer(r, sess.pid);
}

function joinRoom(socket, r) {
  const sess = socket.data.session;
  socket.leave('lobby');
  socket.join(r.id);
  sess.roomId = r.id;
  const pr = socket.data.profile;
  r.players.set(sess.pid, { id: sess.pid, name: pr.name, look: pr.look, online: true, offlineSince: 0 });
  sendRoom(r);
  broadcastRooms();
}

// Put a returning player back where they were.
function rejoin(socket, r, p) {
  const sess = socket.data.session;
  sess.roomId = r.id;
  socket.leave('lobby');
  socket.join(r.id);
  const wasOffline = !p.online;
  p.online = true;
  p.offlineSince = 0;
  socket.data.profile = { name: p.name, look: p.look };
  sendRoom(r);
  if (r.state === 'game' && r.game) {
    p.tpSeq++; // ignore any stale positions from the old connection
    p.y = 0;
    socket.emit('gameStart', gamePayload(r));
    sendInv(p);
    if (wasOffline) feed(r, `🔌 ${p.name} is back!`);
  }
  broadcastRooms();
}

function ctx(socket) {
  const sess = socket.data.session;
  const r = rooms.get(sess?.roomId);
  const p = r?.players.get(sess.pid);
  return r && p ? { r, p, g: r.game } : null;
}

// Tidy up players who never came back, and rooms nobody is in.
setInterval(() => {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    for (const p of [...r.players.values()]) {
      if (!p.online && r.state === 'lobby' && now - p.offlineSince > LOBBY_GRACE_MS) removePlayer(r, p.id);
    }
    if (!rooms.has(r.id)) continue;
    const anyOnline = [...r.players.values()].some((p) => p.online);
    if (anyOnline) r.emptySince = 0;
    else {
      r.emptySince ||= now;
      if (now - r.emptySince > (r.state === 'game' ? EMPTY_GAME_ROOM_MS : LOBBY_GRACE_MS)) {
        rooms.delete(r.id);
        for (const s of sessions.values()) if (s.roomId === r.id) s.roomId = null;
        broadcastRooms();
      }
    }
  }
  for (const [token, s] of sessions) {
    if (!s.socketId && !s.roomId && now - s.lastSeen > 6 * 3600_000) sessions.delete(token);
  }
}, 5000);

io.use((socket, next) => {
  const t = socket.handshake.auth?.token;
  socket.data.token = typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t)
    ? t
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  next();
});

io.on('connection', (socket) => {
  const token = socket.data.token;
  let sess = sessions.get(token);
  if (!sess) {
    sess = { pid: 'u' + (nextPid++).toString(36) + Math.random().toString(36).slice(2, 6), socketId: null, roomId: null, lastSeen: Date.now() };
    sessions.set(token, sess);
  }
  // Same player in a newer tab (or a refresh that beat the old disconnect): the newest wins.
  if (sess.socketId && sess.socketId !== socket.id) {
    const old = io.sockets.sockets.get(sess.socketId);
    if (old) {
      old.emit('replaced');
      old.disconnect(true);
    }
  }
  sess.socketId = socket.id;
  sess.lastSeen = Date.now();
  socket.data.session = sess;
  socket.data.profile = { name: 'Player', look: { color: 0, hat: 0 } };
  socket.join('p:' + sess.pid);

  const r = rooms.get(sess.roomId);
  const p = r?.players.get(sess.pid);
  socket.emit('hello', { pid: sess.pid, token, inRoom: !!p });
  if (p) rejoin(socket, r, p);
  else {
    sess.roomId = null;
    socket.join('lobby');
    socket.emit('rooms', [...rooms.values()].map(roomSummary));
  }

  socket.on('profile', (d) => {
    socket.data.profile = { name: cleanText(d?.name, 14, 'Player'), look: cleanLook(d?.look) };
    const c = ctx(socket);
    if (c && c.r.state === 'lobby') {
      c.p.name = socket.data.profile.name;
      c.p.look = socket.data.profile.look;
      sendRoom(c.r);
      broadcastRooms();
    }
  });

  socket.on('listRooms', () => socket.emit('rooms', [...rooms.values()].map(roomSummary)));

  socket.on('createRoom', (d, cb) => {
    if (sess.roomId) leaveRoom(socket);
    const id = 'r' + nextRoomId++;
    const r = {
      id, name: cleanText(d?.name, 24, `${socket.data.profile.name}'s room`),
      hostId: sess.pid, settings: R.sanitizeSettings(d?.settings, CATEGORIES.length),
      players: new Map(), state: 'lobby', game: null, emptySince: 0,
    };
    rooms.set(id, r);
    joinRoom(socket, r);
    ack(cb, { ok: true, id });
  });

  socket.on('joinRoom', (d, cb) => {
    const r = rooms.get(d?.id);
    if (!r) return ack(cb, { ok: false, msg: 'That room no longer exists.' });
    const existing = r.players.get(sess.pid);
    if (existing) {
      rejoin(socket, r, existing);
      return ack(cb, { ok: true });
    }
    if (r.state !== 'lobby') return ack(cb, { ok: false, msg: 'That game has already started.' });
    if (r.players.size >= r.settings.maxPlayers) return ack(cb, { ok: false, msg: 'That room is full.' });
    if (sess.roomId) leaveRoom(socket);
    joinRoom(socket, r);
    ack(cb, { ok: true });
  });

  socket.on('leaveRoom', () => leaveRoom(socket));

  socket.on('updateSettings', (d) => {
    const c = ctx(socket);
    if (!c || c.r.hostId !== sess.pid || c.r.state !== 'lobby') return;
    c.r.settings = R.sanitizeSettings(d?.settings, CATEGORIES.length);
    if (typeof d?.name === 'string') c.r.name = cleanText(d.name, 24, c.r.name);
    if (c.r.settings.maxPlayers < c.r.players.size) c.r.settings.maxPlayers = c.r.players.size;
    sendRoom(c.r);
    broadcastRooms();
  });

  socket.on('startGame', (_d, cb) => {
    const c = ctx(socket);
    if (!c || c.r.hostId !== sess.pid) return ack(cb, { ok: false, msg: 'Only the host can start.' });
    if (c.r.state !== 'lobby') return ack(cb, { ok: false, msg: 'Already started.' });
    startGame(c.r);
    ack(cb, { ok: true });
  });

  // ----- in-game -----
  socket.on('st', (d) => {
    const c = ctx(socket);
    if (!c?.g || c.p.dead || d?.s !== c.p.tpSeq || !Array.isArray(d.p)) return;
    const [x, y, z] = d.p.map(Number);
    if (![x, y, z].every(Number.isFinite)) return;
    const p = c.p, now = Date.now();
    const rr = Math.hypot(x, z);
    const k = rr > R.WORLD_RADIUS ? R.WORLD_RADIUS / rr : 1;
    const nx = x * k, nz = z * k;
    const dts = (now - p.lastState) / 1000;
    if (p.lastState && dts > 0.01 && dts < 0.5) {
      p.vx = p.vx * 0.5 + ((nx - p.x) / dts) * 0.5;
      p.vz = p.vz * 0.5 + ((nz - p.z) / dts) * 0.5;
    }
    p.lastState = now;
    p.x = nx; p.y = Math.max(0, Math.min(30, y)); p.z = nz;
    if (Number.isFinite(+d.r)) p.ry = +d.r;
    p.anim = clampInt(d.a, 0, 3, 0);
    if (p.carry.length) {
      const [lx, lz] = R.toLocal(R.BASES[p.base], p.x, p.z);
      if (R.inHouse(lx, lz)) bankWords(c.r, p);
    }
  });

  socket.on('pickup', (d) => {
    const c = ctx(socket);
    if (!c?.g || c.g.phase !== 'raid' || c.p.dead) return;
    const p = c.p, now = Date.now();
    if (p.frozenUntil > now || p.stunUntil > now) return;
    const w = c.g.words.find((x) => x.id === d?.id);
    if (!w || w.carrier || w.base < 0 || w.base === p.base) return;
    const [sx, , sz] = R.slotLocal(w.slot);
    const [wx, wz] = R.toWorld(R.BASES[w.base], sx, sz);
    if (Math.hypot(wx - p.x, wz - p.z) > R.PICKUP_RANGE + 1.2) return;
    if (w.decoy) {
      // Trick word! Short stun and a little bounce away from the card.
      if (now < p.stunImmuneUntil) return;
      p.stunUntil = now + R.STUN_MS;
      p.stunImmuneUntil = now + R.STUN_MS + R.STUN_IMMUNE_MS;
      let dx = p.x - wx, dz = p.z - wz;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      damage(c.r, p, 0, null, 'stun', [dx * 5, 4, dz * 5]);
      io.to(c.r.id).emit('stunned', { id: p.id, ms: R.STUN_MS });
      const cat = CATEGORIES[c.g.bases[w.base].category];
      toast(p.id, `😵 "${w.text}" isn't ${cat.icon} ${cat.name}! It was a trick word.`, 'bad');
      return;
    }
    if (p.carry.length >= c.r.settings.carryLimit) return;
    const victim = c.g.bases[w.base];
    w.from = w.base;
    w.base = -1;
    w.slot = -1;
    w.carrier = p.id;
    p.carry.push(w.id);
    sendWords(c.r);
    if (victim.owner) toast(victim.owner, `⚠️ ${p.name} grabbed "${w.text}" from your house!`, 'bad');
  });

  socket.on('swing', (d) => {
    const c = ctx(socket);
    if (!c?.g || c.p.dead) return;
    const p = c.p, now = Date.now();
    if (now - p.lastSwing < R.STICK.cooldown || p.frozenUntil > now || p.stunUntil > now) return;
    const B = R.BASES[p.base];
    const [lx, lz] = R.toLocal(B, p.x, p.z);
    if (!R.inCompound(lx, lz, 1)) return; // the stick only comes out at home
    p.lastSwing = now;
    if (Number.isFinite(+d?.r)) p.ry = +d.r;
    const fx = Math.sin(p.ry), fz = Math.cos(p.ry);
    io.to(c.r.id).emit('swing', { id: p.id });
    for (const q of c.r.players.values()) {
      if (q === p || q.dead || !q.online) continue;
      const [qx, qz] = R.toLocal(B, q.x, q.z);
      if (!R.inCompound(qx, qz, 1.5)) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > R.STICK.range || Math.abs(q.y - p.y) > 2.2) continue;
      if (dist > 1.0 && (dx * fx + dz * fz) / dist < 0.25) continue;
      const kx = dist > 0.01 ? dx / dist : fx, kz = dist > 0.01 ? dz / dist : fz;
      damage(c.r, q, R.STICK.dmg, p.id, 'stick', [kx * R.STICK.kb, R.STICK.kbUp, kz * R.STICK.kb]);
    }
  });

  socket.on('place', (d) => {
    const c = ctx(socket);
    if (!c?.g || c.p.dead) return;
    const p = c.p, type = String(d?.type);
    const def = R.ITEMS[type];
    const i = d?.i | 0, j = d?.j | 0;
    if (!def) return;
    if ((p.inv[type] | 0) <= 0) return toast(p.id, `No ${def.name}s left — buy more in the shop!`, 'bad');
    const b = c.g.bases[p.base], B = R.BASES[p.base];
    const [lx, lz] = R.toLocal(B, p.x, p.z);
    if (!R.inCompound(lx, lz, 1)) return toast(p.id, 'You can only build in your own compound.', 'bad');
    const err = R.placementError(b.grid, i, j, type);
    if (err) return toast(p.id, err, 'bad');
    const [cx, cz] = R.cellCenter(i, j);
    if (Math.hypot(cx - lx, cz - lz) > 20) return toast(p.id, 'Too far away.', 'bad');
    if (def.solid) {
      const m = R.CELL / 2 + R.PLAYER_RADIUS;
      for (const q of c.r.players.values()) {
        if (q.dead || !q.online) continue;
        const [qx, qz] = R.toLocal(B, q.x, q.z);
        if (Math.abs(qx - cx) < m && Math.abs(qz - cz) < m) return toast(p.id, 'Someone is standing there.', 'bad');
      }
    }
    b.grid[R.cellIndex(i, j)] = { type, owner: p.id, rearm: 0, next: 0 };
    p.inv[type]--;
    sendItems(c.r, b);
    sendInv(p);
  });

  socket.on('remove', (d) => {
    const c = ctx(socket);
    if (!c?.g || c.p.dead) return;
    const p = c.p, i = d?.i | 0, j = d?.j | 0;
    if (!R.inGrid(i, j)) return;
    const b = c.g.bases[p.base];
    const [lx, lz] = R.toLocal(R.BASES[p.base], p.x, p.z);
    if (!R.inCompound(lx, lz, 1)) return;
    const it = b.grid[R.cellIndex(i, j)];
    if (!it) return;
    b.grid[R.cellIndex(i, j)] = null;
    p.inv[it.type] = (p.inv[it.type] | 0) + 1;
    sendItems(c.r, b);
    sendInv(p);
  });

  socket.on('buy', (d) => {
    const c = ctx(socket);
    if (!c?.g) return;
    const p = c.p, type = String(d?.type);
    const def = R.ITEMS[type];
    if (!def) return;
    const [lx, lz] = R.toLocal(R.BASES[p.base], p.x, p.z);
    if (!R.inCompound(lx, lz, 1)) return toast(p.id, 'The shop only works at your own base.', 'bad');
    if (p.coins < def.cost) return toast(p.id, 'Not enough coins!', 'bad');
    p.coins -= def.cost;
    p.inv[type] = (p.inv[type] | 0) + (def.buyQty || 1);
    sendInv(p);
    toast(p.id, `Bought ${def.buyQty ? def.buyQty + ' x ' : ''}${def.name}! ${def.icon}`, 'good');
  });

  socket.on('disconnect', () => {
    if (sess.socketId !== socket.id) return; // replaced by a newer connection
    sess.socketId = null;
    sess.lastSeen = Date.now();
    const c = ctx(socket);
    if (!c) return;
    c.p.online = false;
    c.p.offlineSince = Date.now();
    if (c.g) {
      dropCarry(c.r, c.p);
      feed(c.r, `🔌 ${c.p.name} disconnected — they can rejoin any time.`);
    }
    sendRoom(c.r);
    broadcastRooms();
  });
});

server.listen(PORT, () => console.log(`Base Raider running on http://localhost:${PORT}`));
