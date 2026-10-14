import * as THREE from 'three';
import * as R from '/shared/rules.js';
import { CATEGORIES } from '/shared/words.js';
import { Stickman } from './stickman.js';
import { makeItemMesh, makeGhost } from './items.js';
import { makeWordSprite, textTexture, damp, angleDamp, fmtTime, escapeHtml } from './util.js';
import { sfx, toggleMute, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
let IS_TOUCH = matchMedia('(pointer: coarse)').matches; // primary input is a finger (tablets / phones)
const GRAVITY = 30, JUMP_V = 10.5;

export class Game {
  constructor(engine, socket, init) {
    this.engine = engine;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.world = engine.world;
    this.socket = socket;
    this.me = socket.id;
    this.settings = init.settings;
    this.phase = init.phase;
    this.round = init.round;
    this.phaseEndAt = performance.now() + init.timeLeft;
    this.bases = init.bases;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.time = 0;

    this.players = new Map();
    for (const p of init.players) this.addPlayer(p);
    const meInit = init.players.find((p) => p.id === this.me);
    this.myBase = meInit.base;
    this.myB = R.BASES[this.myBase];
    this.local = {
      pos: new THREE.Vector3(meInit.x, 0, meInit.z), vel: new THREE.Vector3(), kb: new THREE.Vector3(),
      vy: 0, grounded: true, ry: meInit.ry, seq: meInit.seq, lastSend: 0, lastSwing: 0,
    };
    this.camYaw = meInit.ry + Math.PI;
    this.camPitch = 0.42;
    this.camDist = 8.5;

    this.world.setupBases(this.bases, (id) => this.colorOf(id));
    this.updateBlocked();

    // words & items
    this.wordSprites = new Map();
    this.words = [];
    this.grids = R.BASES.map(() => new Array(R.GRID * R.GRID).fill(null));
    this.itemMeshes = R.BASES.map(() => new Map());
    this.setWords(init.words);
    this.inv = {};
    this.coins = 0;
    this.selected = 'block';
    this.buildMode = false;
    this.ghost = makeGhost();
    this.group.add(this.ghost.group);
    this.buildGridOverlay();

    this.shots = new Map();
    this.particles = [];
    this.floaters = [];
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.pickupCooldown = new Map();
    this.lastHudUpdate = 0;
    this.raiderAlert = false;
    this.lastTickSec = -1;
    this.lastRaiderToast = 0;
    this.locked = false;

    this.bindSocket();
    this.bindInput();
    this.setupHud();
    this.showBanner(this.phase === 'prep' ? '🛠️ PREP TIME!' : '⚔️ RAID!', this.phase === 'prep' ? 'Build defences around your house' : 'Steal words!');
  }

  // ---------------- players ----------------
  addPlayer(p) {
    const isMe = p.id === this.me;
    const model = new Stickman(p.look, { name: isMe ? null : p.name });
    model.group.position.set(p.x, 0, p.z);
    model.group.rotation.y = p.ry;
    this.group.add(model.group);
    this.players.set(p.id, {
      id: p.id, name: p.name, look: p.look, base: p.base, model,
      pos: new THREE.Vector3(p.x, 0, p.z), target: new THREE.Vector3(p.x, 0, p.z), ry: p.ry, tRy: p.ry,
      hp: R.MAX_HP, dead: false, frozenUntil: 0, slowed: false, coins: 0, kos: 0, stolen: 0, speed: 0, present: true,
    });
  }
  colorOf(id) {
    const p = this.players.get(id);
    return p ? R.COLORS[p.look.color] : '#aaaaaa';
  }
  get mePlayer() { return this.players.get(this.me); }

  updateBlocked() {
    const locked = (k) => this.bases[k].closed || (this.phase === 'prep' && k !== this.myBase);
    this.world.setBlocked(locked);
    this.world.showFields((k) => !this.bases[k].closed && this.phase === 'prep' && k !== this.myBase);
  }

  // ---------------- words ----------------
  setWords(list) {
    const before = this.words.filter((w) => w.k === this.me).length;
    this.words = list;
    for (const w of list) {
      let s = this.wordSprites.get(w.id);
      if (!s) {
        s = makeWordSprite(w.t, w.c);
        this.wordSprites.set(w.id, s);
        this.group.add(s);
      }
      if (w.k || w.b < 0) {
        s.visible = false;
      } else {
        s.visible = true;
        const [lx, ly, lz] = R.slotLocal(w.s);
        const [x, z] = R.toWorld(R.BASES[w.b], lx, lz);
        s.position.set(x, ly, z);
        s.userData.baseY = ly;
        s.userData.phase = w.id * 1.7;
      }
    }
    for (const p of this.players.values()) p.model.setCarry(list.filter((w) => w.k === p.id));
    R.BASES.forEach((_, k) => this.world.setPedestals(k, new Set(list.filter((w) => w.b === k && !w.k && w.s < R.SLOTS_PER_LAYER).map((w) => w.s))));
    const after = list.filter((w) => w.k === this.me);
    if (after.length > before) {
      sfx.pickup();
      const w = after.at(-1);
      this.toast(`Got "${w.t}"! Run it back to your house! 🏃`, 'good');
    }
  }
  wordsIn(k) {
    let n = 0;
    for (const w of this.words) if (w.b === k && !w.k) n++;
    return n;
  }

  // ---------------- items ----------------
  setItems(b, list) {
    const grid = new Array(R.GRID * R.GRID).fill(null);
    const meshes = this.itemMeshes[b];
    const seen = new Set();
    const B = R.BASES[b];
    const color = this.colorOf(this.bases[b].owner);
    for (const [i, j, type] of list) {
      const n = R.cellIndex(i, j);
      grid[n] = { type };
      seen.add(n);
      const cur = meshes.get(n);
      if (cur && cur.type === type) continue;
      if (cur) this.group.remove(cur.group);
      const item = makeItemMesh(type, color);
      item.type = type;
      const [lx, lz] = R.cellCenter(i, j);
      const [x, z] = R.toWorld(B, lx, lz);
      item.group.position.set(x, 0, z);
      item.group.rotation.y = B.yaw;
      item.group.scale.setScalar(0.01);
      item.pop = 0;
      this.group.add(item.group);
      meshes.set(n, item);
      if (b === this.myBase) this.burst(new THREE.Vector3(x, 0.5, z), '#fff3c4', 8, 4, 0.18);
    }
    for (const [n, item] of meshes) {
      if (!seen.has(n)) {
        this.group.remove(item.group);
        meshes.delete(n);
      }
    }
    this.grids[b] = grid;
    this.world.setItemBoxes(b, list.filter(([, , t]) => R.ITEMS[t].solid));
  }

  buildGridOverlay() {
    const pts = [];
    for (let n = -R.HALF; n <= R.HALF; n += R.CELL) {
      pts.push(n, 0.07, -R.HALF, n, 0.07, R.HALF);
      pts.push(-R.HALF, 0.07, n, R.HALF, 0.07, n);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.gridLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    this.gridLines.position.set(this.myB.cx, 0, this.myB.cz);
    this.gridLines.rotation.y = this.myB.yaw;
    this.gridLines.visible = false;
    this.group.add(this.gridLines);
  }

  // ---------------- networking ----------------
  bindSocket() {
    const s = this.socket;
    this.handlers = {
      snap: (d) => this.onSnap(d),
      words: (list) => this.setWords(list),
      items: (d) => this.setItems(d.b, d.list),
      inv: (d) => {
        if (this.coins && d.coins > this.coins) sfx.coin();
        this.coins = d.coins;
        this.inv = d.inv;
        this.renderHotbar();
        this.renderShop();
      },
      hit: (d) => this.onHit(d),
      swing: (d) => {
        const p = this.players.get(d.id);
        if (!p || d.id === this.me) return;
        p.model.swing();
        if (p.pos.distanceTo(this.local.pos) < 25) sfx.whoosh();
      },
      died: (d) => this.onDied(d),
      respawn: (d) => {
        const p = this.players.get(d.id);
        if (p) { p.dead = false; p.model.group.visible = true; }
      },
      tp: (d) => {
        const L = this.local;
        L.seq = d.seq;
        L.pos.set(d.p[0], d.p[1], d.p[2]);
        L.vel.set(0, 0, 0);
        L.kb.set(0, 0, 0);
        L.vy = 0;
        L.ry = d.ry;
        this.camYaw = d.ry + Math.PI;
        const me = this.mePlayer;
        me.dead = false;
        me.model.group.visible = true;
      },
      frozen: (d) => {
        const p = this.players.get(d.id);
        if (p) p.frozenUntil = performance.now() + d.ms;
        if (d.id === this.me || (p && p.pos.distanceTo(this.local.pos) < 25)) sfx.freeze();
        if (d.id === this.me) this.toast('🥶 You got frozen!', 'bad');
      },
      shot: (d) => this.onShot(d),
      shotEnd: (d) => this.onShotEnd(d),
      trap: (d) => {
        const item = this.itemMeshes[d.b].get(R.cellIndex(d.i, d.j));
        if (item) item.trig = 1;
        const [lx, lz] = R.cellCenter(d.i, d.j);
        const [x, z] = R.toWorld(R.BASES[d.b], lx, lz);
        const near = Math.hypot(x - this.local.pos.x, z - this.local.pos.z) < 25;
        const fx = { cactus: ['#4caf50', sfx.spike], freeze: ['#bdf0ff', sfx.freeze], boing: ['#ff4d5e', sfx.boing] }[d.type];
        if (fx) {
          this.burst(new THREE.Vector3(x, 0.6, z), fx[0], 14, 6, 0.2);
          if (near) fx[1]();
        }
      },
      phase: (d) => {
        this.phase = d.phase;
        this.round = d.round;
        this.phaseEndAt = performance.now() + d.timeLeft;
        this.updateBlocked();
        sfx.horn();
        if (d.phase === 'raid') this.showBanner('⚔️ RAID!', 'Steal words & bring them home!');
        else this.showBanner(`🛠️ ROUND ${d.round} PREP`, `+${R.COINS_PER_ROUND} coins! Fix up your defences.`);
      },
      toast: (d) => {
        this.toast(d.msg, d.kind);
        if (d.kind === 'bad') sfx.error();
      },
      feed: (d) => this.addFeed(d.msg),
      banked: (d) => {
        sfx.bank();
        this.showBanner(`+${d.count} WORD${d.count > 1 ? 'S' : ''}!`, `+${d.count * R.COINS_PER_WORD} coins`, true);
        this.burst(this.local.pos.clone().setY(2), '#ffd23f', 30, 8, 0.2);
      },
    };
    for (const [ev, fn] of Object.entries(this.handlers)) s.on(ev, fn);
  }

  onSnap(d) {
    const now = performance.now();
    if (d.ph !== this.phase) {
      this.phase = d.ph;
      this.updateBlocked();
    }
    this.round = d.rd;
    this.phaseEndAt = now + d.tl;
    const ids = new Set();
    for (const s of d.ps) {
      const p = this.players.get(s.id);
      if (!p) continue;
      ids.add(s.id);
      p.hp = s.hp;
      p.frozenUntil = now + s.fz;
      p.slowed = !!s.sl;
      p.coins = s.c;
      p.kos = s.k;
      p.stolen = s.st;
      if (s.d && !p.dead) {
        p.dead = true;
        p.model.group.visible = false;
      }
      if (s.id === this.me) {
        if (!s.d && p.dead) { p.dead = false; p.model.group.visible = true; }
        continue;
      }
      p.target.set(s.x, s.y, s.z);
      p.tRy = s.r;
      if (!s.d && p.dead) {
        p.dead = false;
        p.pos.copy(p.target);
        p.model.group.visible = true;
      }
    }
    // Players who left
    for (const p of this.players.values()) {
      if (!ids.has(p.id) && p.present && p.id !== this.me) {
        p.present = false;
        p.model.group.visible = false;
      }
    }
  }

  onHit(d) {
    const p = this.players.get(d.id);
    if (!p) return;
    const pos = d.id === this.me ? this.local.pos : p.pos;
    p.model.flash();
    const near = pos.distanceTo(this.local.pos) < 25;
    if (d.dmg > 0) {
      this.floater(`-${d.dmg}`, pos.clone().setY(pos.y + 2.4), d.id === this.me ? '#ff5a5a' : '#ffe14d');
      this.burst(pos.clone().setY(pos.y + 1.4), d.kind === 'stick' ? '#ffe14d' : '#ffffff', 10, 5, 0.15);
    }
    if (near && d.kind === 'stick') sfx.bonk();
    if (d.id === this.me) {
      if (d.kb) {
        this.local.kb.set(d.kb[0], 0, d.kb[2]);
        this.local.vy = d.kb[1];
        this.local.grounded = false;
      }
      if (d.dmg > 0) {
        sfx.hurt();
        const f = $('hurtFlash');
        f.classList.remove('on');
        void f.offsetWidth;
        f.classList.add('on');
      }
    }
    if (d.by === this.me && d.id !== this.me && d.kind === 'stick') this.burst(pos.clone().setY(1.6), '#ffffff', 6, 3, 0.12);
  }

  onDied(d) {
    const p = this.players.get(d.id);
    if (!p) return;
    const pos = d.id === this.me ? this.local.pos : p.pos;
    p.dead = true;
    p.model.group.visible = false;
    this.burst(pos.clone().setY(1), R.COLORS[p.look.color], 26, 7, 0.22);
    this.burst(pos.clone().setY(1), '#ffffff', 14, 5, 0.3);
    if (pos.distanceTo(this.local.pos) < 30) sfx.ko();
    if (d.id === this.me) this.deathAt = performance.now();
    if (d.by === this.me && d.id !== this.me) this.toast(`💥 You knocked out ${p.name}! +${R.COINS_PER_KO} coins`, 'good');
  }

  onShot(d) {
    const def = R.ITEMS[d.type];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(d.type === 'frost' ? 0.32 : 0.26, 10, 8),
      d.type === 'frost' ? new THREE.MeshBasicMaterial({ color: '#7fe0ff' }) : new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#555555' })
    );
    mesh.position.set(d.p[0], d.p[1], d.p[2]);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.shots.set(d.id, { mesh, v: new THREE.Vector3(d.v[0], d.v[1], d.v[2]), life: (def.range + 4) / def.speed + 0.3, type: d.type });
    const item = this.itemMeshes[d.b].get(d.cell);
    if (item?.top) item.targetYaw = Math.atan2(d.v[0], d.v[2]) - R.BASES[d.b].yaw;
    if (Math.hypot(d.p[0] - this.local.pos.x, d.p[2] - this.local.pos.z) < 22) sfx.shoot();
  }

  onShotEnd(d) {
    const s = this.shots.get(d.id);
    if (s) {
      this.group.remove(s.mesh);
      this.shots.delete(d.id);
    }
    const pos = new THREE.Vector3(d.p[0], d.p[1], d.p[2]);
    this.burst(pos, s?.type === 'frost' ? '#9be7ff' : '#ffffff', 10, 4, 0.16);
    if (pos.distanceTo(this.local.pos) < 20) sfx.splat();
  }

  // ---------------- effects ----------------
  burst(pos, color, n, speed, size) {
    const geo = this.particleGeo || (this.particleGeo = new THREE.IcosahedronGeometry(1, 0));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.group.add(m);
      this.particles.push({ m, v, life: 0.6 + Math.random() * 0.4, max: 1 });
    }
  }
  floater(text, pos, color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, { color, size: 80, w: 256, h: 128 }), transparent: true, depthTest: false }));
    s.scale.set(1.6, 0.8, 1);
    s.position.copy(pos);
    s.renderOrder = 20;
    this.group.add(s);
    this.floaters.push({ s, life: 1 });
  }

  // ---------------- input ----------------
  bindInput() {
    const canvas = this.engine.renderer.domElement;
    this.listeners = [];
    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      this.listeners.push([el, ev, fn, opts]);
    };
    on(window, 'keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyB': this.toggleBuild(); break;
        case 'KeyQ': case 'KeyE': this.toggleShop(); break;
        case 'KeyR': case 'KeyX': this.removeAtGhost(); break;
        case 'KeyH': $('helpPanel').classList.toggle('hidden'); break;
        case 'KeyM': this.toggleMute(); break;
        case 'Tab': e.preventDefault(); $('scoreboard').classList.add('big'); break;
        case 'Escape': this.closePanels(); break;
        default:
          if (/^Digit[1-7]$/.test(e.code)) this.selectItem(R.ITEM_ORDER[+e.code.slice(5) - 1]);
      }
      if (e.code === 'Space') e.preventDefault();
    });
    on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') $('scoreboard').classList.remove('big');
    });
    on(window, 'blur', () => this.keys.clear());
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.updateClickToPlay();
    });
    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!this.locked) {
        if (!this.panelOpen()) canvas.requestPointerLock?.();
        this.dragging = true;
        this.dragX = e.clientX; this.dragY = e.clientY;
        return;
      }
      if (e.button === 0) this.action();
      else if (e.button === 2) this.removeAtGhost();
    });
    on(window, 'mouseup', () => { this.dragging = false; });
    on(window, 'mousemove', (e) => {
      if (this.locked) this.look(e.movementX, e.movementY);
      else if (this.dragging) {
        this.look(e.clientX - this.dragX, e.clientY - this.dragY);
        this.dragX = e.clientX; this.dragY = e.clientY;
      }
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => {
      this.camDist = Math.max(4, Math.min(16, this.camDist + Math.sign(e.deltaY) * 0.8));
    }, { passive: true });

    // Touch controls: shown on tablets/phones, or as soon as someone touches a touchscreen laptop.
    const enableTouch = () => {
      if (this.touchOn) return;
      this.touchOn = true;
      IS_TOUCH = true;
      document.body.classList.add('touch');
      $('touch').classList.remove('hidden');
      this.updateClickToPlay();
      const joy = $('joyZone'), knob = $('joyKnob');
      let joyId = null, ox = 0, oy = 0;
      on(joy, 'pointerdown', (e) => {
        joyId = e.pointerId; ox = e.clientX; oy = e.clientY;
        joy.setPointerCapture(e.pointerId);
      });
      on(joy, 'pointermove', (e) => {
        if (e.pointerId !== joyId) return;
        let dx = e.clientX - ox, dy = e.clientY - oy;
        const d = Math.hypot(dx, dy), max = 55;
        if (d > max) { dx *= max / d; dy *= max / d; }
        this.joy.x = dx / max; this.joy.y = -dy / max;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      const end = (e) => {
        if (e.pointerId !== joyId) return;
        joyId = null;
        this.joy.x = this.joy.y = 0;
        knob.style.transform = '';
      };
      on(joy, 'pointerup', end);
      on(joy, 'pointercancel', end);
      const lookZone = $('lookZone');
      let lookId = null, lx = 0, ly = 0;
      on(lookZone, 'pointerdown', (e) => { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; lookZone.setPointerCapture(e.pointerId); });
      on(lookZone, 'pointermove', (e) => {
        if (e.pointerId !== lookId) return;
        this.look((e.clientX - lx) * 1.6, (e.clientY - ly) * 1.6);
        lx = e.clientX; ly = e.clientY;
      });
      on(lookZone, 'pointerup', () => { lookId = null; });
      const btn = (id, fn) => on($(id), 'pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
      btn('tJump', () => { this.touchJump = true; });
      btn('tAction', () => this.action());
      btn('tBuild', () => this.toggleBuild());
      btn('tShop', () => this.toggleShop());
      btn('tRemove', () => this.removeAtGhost());
    };
    if (IS_TOUCH) enableTouch();
    else on(window, 'touchstart', enableTouch, { passive: true });

    // HUD buttons
    on($('shopBtn'), 'click', () => this.toggleShop());
    on($('buildBtn'), 'click', () => this.toggleBuild());
    on($('helpBtn'), 'click', () => $('helpPanel').classList.toggle('hidden'));
    on($('scoreBtn'), 'click', () => $('scoreboard').classList.toggle('open'));
    on($('muteBtn'), 'click', () => this.toggleMute());
    on($('shopClose'), 'click', () => this.toggleShop(false));
    on($('helpClose'), 'click', () => $('helpPanel').classList.add('hidden'));
    on($('clickToPlay'), 'click', () => canvas.requestPointerLock?.());
  }

  look(dx, dy) {
    this.camYaw -= dx * 0.0032;
    this.camPitch = Math.max(-0.15, Math.min(1.3, this.camPitch + dy * 0.0028));
  }
  panelOpen() {
    return !$('shopPanel').classList.contains('hidden') || !$('helpPanel').classList.contains('hidden');
  }
  closePanels() {
    $('shopPanel').classList.add('hidden');
    $('helpPanel').classList.add('hidden');
    this.updateClickToPlay();
  }
  updateClickToPlay() {
    $('clickToPlay').classList.toggle('hidden', IS_TOUCH || this.locked || this.panelOpen());
  }
  toggleMute() {
    const m = toggleMute();
    $('muteBtn').textContent = m ? '🔇' : '🔊';
  }

  atHome() {
    const [lx, lz] = R.toLocal(this.myB, this.local.pos.x, this.local.pos.z);
    return R.inCompound(lx, lz);
  }

  toggleBuild(force) {
    const want = force ?? !this.buildMode;
    if (want && !this.atHome()) {
      this.toast('🏠 Go back to your own compound to build.', 'bad');
      sfx.error();
      return;
    }
    this.buildMode = want;
    sfx.click();
    this.renderHotbar();
  }
  selectItem(type) {
    if (!type) return;
    this.selected = type;
    if (!this.buildMode) this.toggleBuild(true);
    this.renderHotbar();
  }
  toggleShop(force) {
    const panel = $('shopPanel');
    const open = force ?? panel.classList.contains('hidden');
    if (open && !this.atHome()) {
      this.toast('🏠 The shop only opens at your own base.', 'bad');
      sfx.error();
      return;
    }
    panel.classList.toggle('hidden', !open);
    if (open) {
      document.exitPointerLock?.();
      this.renderShop();
    }
    this.updateClickToPlay();
  }

  action() {
    const me = this.mePlayer;
    const now = performance.now();
    if (me.dead || me.frozenUntil > now) return;
    if (this.buildMode) {
      this.updateGhost(this.atHome());
      const g = this.ghostCell;
      if (!g) return;
      if (g.error) {
        this.toast(g.error, 'bad');
        sfx.error();
        return;
      }
      this.socket.emit('place', { type: this.selected, i: g.i, j: g.j });
      sfx.place();
      return;
    }
    if (!this.atHome()) {
      if (now - this.lastRaiderToast > 3000) {
        this.lastRaiderToast = now;
        this.toast("🏃 Raiders can't fight — grab words and run! (Your stick works at home.)");
      }
      return;
    }
    const L = this.local;
    if (now - L.lastSwing < R.STICK.cooldown) return;
    L.lastSwing = now;
    L.ry = Math.atan2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
    me.model.swing();
    sfx.whoosh();
    this.socket.emit('swing', { r: L.ry });
  }

  removeAtGhost() {
    if (!this.buildMode) return;
    this.updateGhost(this.atHome());
    if (!this.ghostCell) return;
    const { i, j } = this.ghostCell;
    if (!this.grids[this.myBase][R.cellIndex(i, j)]) return;
    this.socket.emit('remove', { i, j });
    sfx.remove();
  }

  // ---------------- HUD ----------------
  setupHud() {
    $('hud').classList.remove('hidden');
    $('muteBtn').textContent = isMuted() ? '🔇' : '🔊';
    this.minimap = $('minimap').getContext('2d');
    this.renderHotbar();
    this.updateClickToPlay();
    $('feed').innerHTML = '';
    $('toasts').innerHTML = '';
    $('shopPanel').classList.add('hidden');
    $('helpPanel').classList.add('hidden');
    const cat = CATEGORIES[this.bases[this.myBase].category];
    $('myCategory').textContent = `Your words: ${cat.icon} ${cat.name}`;
  }

  renderHotbar() {
    const el = $('hotbar');
    el.innerHTML = R.ITEM_ORDER.map((t, n) => {
      const d = R.ITEMS[t];
      const c = this.inv[t] | 0;
      return `<div class="slot ${this.buildMode && this.selected === t ? 'sel' : ''} ${c ? '' : 'empty'}" data-t="${t}" title="${d.name}">
        <span class="key">${n + 1}</span><span class="ic">${d.icon}</span><span class="ct">${c}</span></div>`;
    }).join('');
    el.querySelectorAll('.slot').forEach((s) => s.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.selectItem(s.dataset.t); }));
    $('buildBtn').classList.toggle('on', this.buildMode);
    $('buildHint').classList.toggle('hidden', !this.buildMode);
    if (this.buildMode) {
      const d = R.ITEMS[this.selected];
      $('buildHint').innerHTML = `<b>${d.icon} ${d.name}</b> — ${IS_TOUCH ? 'tap ✋ to place, 🗑️ to remove' : 'click to place · right-click/R to remove · B to exit'}<br><small>${d.solid ? 'Outside the house only' : 'Floor trap: anywhere in your compound or house'} · tilt camera to aim closer/further</small>`;
    }
  }

  renderShop() {
    if ($('shopPanel').classList.contains('hidden')) return;
    $('shopCoins').textContent = this.coins;
    const list = $('shopList');
    list.innerHTML = R.ITEM_ORDER.map((t) => {
      const d = R.ITEMS[t];
      const can = this.coins >= d.cost;
      return `<div class="shop-item">
        <div class="si-icon">${d.icon}</div>
        <div class="si-body"><div class="si-name">${d.name}${d.buyQty ? ` <small>x${d.buyQty}</small>` : ''} <span class="si-own">own: ${this.inv[t] | 0}</span></div>
        <div class="si-desc">${d.desc}</div></div>
        <button class="btn ${can ? 'green' : 'grey'}" data-t="${t}" ${can ? '' : 'disabled'}>🪙 ${d.cost}</button></div>`;
    }).join('');
    list.querySelectorAll('button[data-t]').forEach((b) => b.addEventListener('click', () => {
      this.socket.emit('buy', { type: b.dataset.t });
      sfx.click();
    }));
  }

  toast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('toasts').prepend(el);
    while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3200);
  }
  addFeed(msg) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    el.textContent = msg;
    $('feed').prepend(el);
    while ($('feed').children.length > 6) $('feed').lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 9000);
    setTimeout(() => el.remove(), 10000);
  }
  showBanner(title, sub, small = false) {
    const b = $('banner');
    b.innerHTML = `<div class="b-title">${escapeHtml(title)}</div><div class="b-sub">${escapeHtml(sub)}</div>`;
    b.className = small ? 'show small' : 'show';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.className = ''; }, small ? 1600 : 2600);
  }

  updateHud(now) {
    const me = this.mePlayer;
    const left = this.phaseEndAt - now;
    $('phaseName').textContent = this.phase === 'prep' ? '🛠️ PREP' : '⚔️ RAID';
    $('phaseBar').className = this.phase;
    $('phaseTimer').textContent = fmtTime(left);
    $('roundInfo').textContent = `Round ${this.round}/${this.settings.rounds}`;
    $('phaseHint').textContent = this.phase === 'prep'
      ? 'Build defences! Other bases are locked.'
      : 'Steal words from other houses & bring them home!';
    const sec = Math.ceil(left / 1000);
    if (sec <= 5 && sec > 0 && sec !== this.lastTickSec) {
      this.lastTickSec = sec;
      sfx.tick();
    }

    // Status panel
    const hp = Math.max(0, Math.round(me.hp));
    $('hpFill').style.width = hp + '%';
    $('hpFill').className = hp > 50 ? 'ok' : hp > 25 ? 'mid' : 'low';
    $('hpText').textContent = `${hp} HP`;
    $('coins').textContent = this.coins;
    const home = this.atHome();
    $('role').className = home ? 'defend' : 'raid';
    $('role').innerHTML = home
      ? '🛡️ <b>DEFENDING</b> — whack raiders with your stick!'
      : '🏃 <b>RAIDING</b> — super speed! No weapon.';
    const carry = this.words.filter((w) => w.k === this.me);
    $('carry').innerHTML = carry.length
      ? `🎒 Carrying (${carry.length}/${this.settings.carryLimit}): ${carry.map((w) => `<span class="chip" style="background:${CATEGORIES[w.c].color}">${escapeHtml(w.t)}</span>`).join(' ')}`
      : `🎒 Carrying 0/${this.settings.carryLimit}`;
    $('myWords').textContent = `🏠 ${this.wordsIn(this.myBase)} words at home`;

    // Death overlay
    const dead = me.dead;
    $('deathOverlay').classList.toggle('hidden', !dead);
    if (dead) {
      const t = Math.max(0, R.RESPAWN_MS - (now - (this.deathAt || now)));
      $('deathCount').textContent = Math.ceil(t / 1000) || '...';
    }
    $('frozenOverlay').classList.toggle('hidden', !(me.frozenUntil > now) || dead);

    // Scoreboard
    const rows = [...this.players.values()].filter((p) => p.present).map((p) => {
      const words = this.wordsIn(p.base);
      return { p, words, pts: R.points(words, p.kos) };
    }).sort((a, b) => b.pts - a.pts);
    $('scoreboard').innerHTML = `<div class="sb-head"><span></span><span>Player</span><span title="Words in house">📝</span><span title="Knock-outs">💥</span><span>Pts</span></div>` +
      rows.map(({ p, words, pts }, n) => `<div class="sb-row ${p.id === this.me ? 'me' : ''}">
        <span class="dot" style="background:${R.COLORS[p.look.color]}"></span>
        <span class="nm">${n === 0 ? '👑 ' : ''}${escapeHtml(p.name)}<small>${CATEGORIES[this.bases[p.base].category].icon}</small></span>
        <span>${words}</span><span>${p.kos}</span><span class="pts">${pts}</span></div>`).join('');

    // Raider alert
    let raiders = 0;
    if (this.phase === 'raid') {
      for (const p of this.players.values()) {
        if (p.id === this.me || p.dead || !p.present) continue;
        const [lx, lz] = R.toLocal(this.myB, p.pos.x, p.pos.z);
        if (R.inCompound(lx, lz)) raiders++;
      }
    }
    $('alert').classList.toggle('hidden', !raiders);
    if (raiders && !this.raiderAlert) sfx.alarm();
    this.raiderAlert = raiders > 0;

    this.drawMinimap();
  }

  drawMinimap() {
    const g = this.minimap, S = 170, C = S / 2, k = (C - 6) / (R.WORLD_RADIUS + 8);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(C, C, C - 2, 0, Math.PI * 2);
    g.fillStyle = '#86d45f';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.clip();
    // map is drawn with north = camera forward
    g.translate(C, C);
    g.rotate(this.camYaw);
    g.fillStyle = '#3fb7f0';
    g.beginPath();
    g.arc(0, 0, R.POND_RADIUS * k, 0, Math.PI * 2);
    g.fill();
    for (const b of this.bases) {
      const B = R.BASES[b.index];
      g.save();
      g.translate(B.cx * k, B.cz * k);
      g.rotate(-B.yaw);
      g.fillStyle = b.closed ? '#b8b8b8' : '#f0d39b';
      g.fillRect(-R.HALF * k, -R.HALF * k, R.HALF * 2 * k, R.HALF * 2 * k);
      g.fillStyle = b.closed ? '#8f949b' : this.colorOf(b.owner);
      g.fillRect(R.HOUSE.x0 * k, R.HOUSE.z0 * k, (R.HOUSE.x1 - R.HOUSE.x0) * k, (R.HOUSE.z1 - R.HOUSE.z0) * k);
      if (b.index === this.myBase) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        g.strokeRect(-R.HALF * k, -R.HALF * k, R.HALF * 2 * k, R.HALF * 2 * k);
      }
      g.restore();
    }
    for (const p of this.players.values()) {
      if (p.dead || !p.present || p.id === this.me) continue;
      g.fillStyle = R.COLORS[p.look.color];
      g.strokeStyle = '#222';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(p.pos.x * k, p.pos.z * k, 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // me (arrow)
    const L = this.local;
    g.save();
    g.translate(L.pos.x * k, L.pos.z * k);
    g.rotate(-L.ry + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.restore();
  }

  // ---------------- per-frame ----------------
  update(dt) {
    this.time += dt;
    const now = performance.now();
    const me = this.mePlayer;
    const L = this.local;
    const frozen = me.frozenUntil > now;
    const dead = me.dead;
    const home = this.atHome();
    me.model.setMode(home ? 'defend' : 'raid');
    if (this.buildMode && !home) this.toggleBuild(false);
    if (!home && !$('shopPanel').classList.contains('hidden')) this.toggleShop(false);

    // ---- movement ----
    const k = this.keys;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.joy.x;
    let iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.joy.y;
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw), rz = -Math.sin(this.camYaw);
    let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const carrying = this.words.filter((w) => w.k === this.me).length;
    let speed = home ? R.SPEED_DEFEND : R.SPEED_RAID;
    speed *= 1 - R.CARRY_SLOWDOWN * carrying;
    if (me.slowed) speed *= R.ITEMS.slime.slow;
    if (frozen || dead) speed = 0;
    L.vel.x = damp(L.vel.x, mx * speed, 14, dt);
    L.vel.z = damp(L.vel.z, mz * speed, 14, dt);
    L.kb.multiplyScalar(Math.exp(-3.5 * dt));
    if (!dead) {
      L.pos.x += (L.vel.x + L.kb.x) * dt;
      L.pos.z += (L.vel.z + L.kb.z) * dt;
      const wantJump = k.has('Space') || this.touchJump;
      this.touchJump = false;
      if (wantJump && L.grounded && !frozen) {
        L.vy = me.slowed ? JUMP_V * 0.6 : JUMP_V;
        L.grounded = false;
      }
      L.vy -= GRAVITY * dt;
      L.pos.y += L.vy * dt;
      if (L.pos.y <= 0) {
        L.pos.y = 0;
        L.vy = 0;
        L.grounded = true;
      }
      this.world.collide(L.pos);
      if (ml > 0.1 && !frozen) L.ry = angleDamp(L.ry, Math.atan2(mx, mz), 14, dt);
    }
    me.pos.copy(L.pos);
    me.model.group.position.copy(L.pos);
    me.model.group.rotation.y = L.ry;
    const hspeed = Math.hypot(L.vel.x, L.vel.z);
    me.model.update(dt, { speed: hspeed, air: !L.grounded, frozen, time: this.time });

    if (!dead && now - L.lastSend > 50) {
      L.lastSend = now;
      this.socket.emit('st', {
        p: [+L.pos.x.toFixed(2), +L.pos.y.toFixed(2), +L.pos.z.toFixed(2)],
        r: +L.ry.toFixed(2), a: hspeed > 0.5 ? 1 : 0, s: L.seq,
      });
    }

    // ---- word pickup ----
    if (this.phase === 'raid' && !dead && !frozen && carrying < this.settings.carryLimit) {
      for (const w of this.words) {
        if (w.k || w.b < 0 || w.b === this.myBase) continue;
        const s = this.wordSprites.get(w.id);
        if (Math.hypot(s.position.x - L.pos.x, s.position.z - L.pos.z) > R.PICKUP_RANGE) continue;
        if ((this.pickupCooldown.get(w.id) || 0) > now) continue;
        this.pickupCooldown.set(w.id, now + 600);
        this.socket.emit('pickup', { id: w.id });
        break;
      }
    }

    // ---- remote players ----
    for (const p of this.players.values()) {
      if (p.id === this.me || !p.present) continue;
      const prev = p.pos.clone();
      p.pos.x = damp(p.pos.x, p.target.x, 14, dt);
      p.pos.y = damp(p.pos.y, p.target.y, 14, dt);
      p.pos.z = damp(p.pos.z, p.target.z, 14, dt);
      if (p.pos.distanceTo(p.target) > 12) p.pos.copy(p.target);
      p.ry = angleDamp(p.ry, p.tRy, 14, dt);
      const sp = Math.hypot(p.pos.x - prev.x, p.pos.z - prev.z) / Math.max(dt, 0.001);
      p.speed = damp(p.speed, sp, 10, dt);
      p.model.group.position.copy(p.pos);
      p.model.group.rotation.y = p.ry;
      const [lx, lz] = R.toLocal(R.BASES[p.base], p.pos.x, p.pos.z);
      p.model.setMode(R.inCompound(lx, lz) ? 'defend' : 'raid');
      p.model.update(dt, { speed: p.speed, air: p.pos.y > 0.15, frozen: p.frozenUntil > now, time: this.time });
      p.model.tag?.set(p.hp);
    }

    // ---- words bob ----
    for (const s of this.wordSprites.values()) {
      if (s.visible) s.position.y = s.userData.baseY + Math.sin(this.time * 2 + s.userData.phase) * 0.12;
    }

    // ---- items ----
    for (const meshes of this.itemMeshes) {
      for (const item of meshes.values()) {
        if (item.pop < 1) {
          item.pop = Math.min(1, item.pop + dt * 4);
          const t = item.pop - 1; // ease-out-back
          item.group.scale.setScalar(1 + 2.70158 * t * t * t + 1.70158 * t * t);
        }
        if (item.top && item.targetYaw !== undefined) item.top.rotation.y = angleDamp(item.top.rotation.y, item.targetYaw, 10, dt);
        item.anim?.(this.time, dt);
      }
    }

    // ---- shots & particles ----
    for (const [id, s] of this.shots) {
      s.mesh.position.addScaledVector(s.v, dt);
      s.life -= dt;
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        this.shots.delete(id);
      }
    }
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.v.y -= 14 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.multiplyScalar(0.5); }
      p.m.material.opacity = Math.min(1, p.life * 2);
      if (p.life <= 0) { this.group.remove(p.m); return false; }
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      f.life -= dt;
      f.s.position.y += dt * 1.5;
      f.s.material.opacity = Math.min(1, f.life * 2);
      if (f.life <= 0) { this.group.remove(f.s); return false; }
      return true;
    });

    // ---- build ghost ----
    this.updateGhost(home && !dead);

    // ---- camera ----
    const target = new THREE.Vector3(L.pos.x, L.pos.y + 1.7, L.pos.z);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const cam = this.camera;
    cam.position.set(
      target.x + Math.sin(this.camYaw) * cp * this.camDist,
      Math.max(0.6, target.y + sp * this.camDist),
      target.z + Math.cos(this.camYaw) * cp * this.camDist
    );
    cam.lookAt(target.x, target.y + 0.5, target.z);
    this.engine.followSun(L.pos);

    // Fade the roof of whichever house you're in
    let inside = -1;
    R.BASES.forEach((B, k2) => {
      const [lx, lz] = R.toLocal(B, L.pos.x, L.pos.z);
      if (R.inHouse(lx, lz)) inside = k2;
      const [cx, cz] = R.toLocal(B, cam.position.x, cam.position.z);
      if (inside < 0 && R.inHouse(cx, cz) && cam.position.y < R.WALL_H + 3.5) inside = k2;
    });
    this.world.update(dt, inside);

    if (now - this.lastHudUpdate > 100) {
      this.lastHudUpdate = now;
      this.updateHud(now);
    }
  }

  updateGhost(canBuild) {
    this.gridLines.visible = this.buildMode;
    if (!this.buildMode || !canBuild) {
      this.ghost.group.visible = false;
      this.ghostCell = null;
      return;
    }
    const L = this.local;
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const dist = Math.max(2.4, Math.min(9, 2.4 + (1.15 - this.camPitch) * 6));
    const px = L.pos.x + fx * dist, pz = L.pos.z + fz * dist;
    const [lx, lz] = R.toLocal(this.myB, px, pz);
    const [i, j] = R.cellAt(lx, lz);
    if (!R.inGrid(i, j)) {
      this.ghost.group.visible = false;
      this.ghostCell = null;
      return;
    }
    const grid = this.grids[this.myBase];
    const type = this.selected;
    const def = R.ITEMS[type];
    const existing = grid[R.cellIndex(i, j)];
    let error = existing ? 'Something is already there (right-click / R removes it)' : null;
    if (!error && !(this.inv[type] > 0)) error = `No ${def.name}s left — buy more in the shop (Q)!`;
    if (!error) error = R.placementError(grid, i, j, type);
    const [cx, cz] = R.cellCenter(i, j);
    if (!error && def.solid) {
      const m = R.CELL / 2 + R.PLAYER_RADIUS;
      for (const p of this.players.values()) {
        if (p.dead || !p.present) continue;
        const [qx, qz] = R.toLocal(this.myB, p.pos.x, p.pos.z);
        if (Math.abs(qx - cx) < m && Math.abs(qz - cz) < m) { error = p.id === this.me ? "You're standing there — step back!" : 'Someone is standing there'; break; }
      }
    }
    this.ghostCell = { i, j, error };
    const [x, z] = R.toWorld(this.myB, cx, cz);
    this.ghost.group.position.set(x, 0, z);
    this.ghost.group.rotation.y = this.myB.yaw;
    this.ghost.group.visible = true;
    this.ghost.set(existing ? (R.ITEMS[existing.type].solid ? 'solid' : 'flat') : def.solid ? 'solid' : 'flat', !error, !!existing);
  }

  destroy() {
    for (const [ev, fn] of Object.entries(this.handlers)) this.socket.off(ev, fn);
    for (const [el, ev, fn, opts] of this.listeners) el.removeEventListener(ev, fn, opts);
    document.exitPointerLock?.();
    this.scene.remove(this.group);
    for (const k of R.BASES.keys()) this.world.setItemBoxes(k, []);
    $('hud').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('shopPanel').classList.add('hidden');
    $('helpPanel').classList.add('hidden');
  }
}
