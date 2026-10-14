import * as THREE from 'three';
import * as R from '/shared/rules.js';
import { CATEGORIES } from '/shared/words.js';
import { textTexture, crateTexture, shade } from './util.js';

// Deterministic random so every client grows the same forest (and the same colliders).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GATE_BARRIERS = [
  { x0: -R.FRONT_GATE_HALF, x1: R.FRONT_GATE_HALF, z0: R.HALF - 0.3, z1: R.HALF + 0.3 },
  { x0: -R.BACK_GATE_HALF, x1: R.BACK_GATE_HALF, z0: -R.HALF - 0.3, z1: -R.HALF + 0.3 },
];

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

class InstanceBatch {
  constructor(geometry, material, { shadow = true, receive = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.mats = [];
    this.colors = [];
    this.shadow = shadow;
    this.receive = receive;
  }
  add(matrix, color) {
    this.mats.push(matrix.clone());
    this.colors.push(color ? new THREE.Color(color) : null);
  }
  build(scene) {
    if (!this.mats.length) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.mats.length);
    this.mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (this.colors[i]) mesh.setColorAt(i, this.colors[i]);
    });
    mesh.castShadow = this.shadow;
    mesh.receiveShadow = this.receive;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
function mat(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rand = mulberry32(20240607);
    this.circles = [];
    this.baseBoxes = R.BASES.map(() => []);
    this.itemBoxes = R.BASES.map(() => []);
    this.blocked = R.BASES.map(() => false);
    this.bases = [];
    this.time = 0;

    this.buildSky();
    this.buildGround();
    this.buildPond();
    this.buildMountains();
    this.buildClouds();
    this.buildBases();
    this.buildNature();
  }

  // ---------------- sky & ground ----------------
  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#38a8ff') }, bottom: { value: new THREE.Color('#e4f7ff') } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.45, h)), 1.0);\n#include <colorspace_fragment>\n}',
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  buildGround() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 64), lambert('#7fcf55'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const rand = this.rand;
    const patch = new InstanceBatch(new THREE.CircleGeometry(1, 10), lambert('#ffffff'), { shadow: false, receive: true });
    for (let n = 0; n < 160; n++) {
      const a = rand() * Math.PI * 2, r = 20 + rand() * 160;
      const s = 3 + rand() * 9;
      patch.add(mat(Math.sin(a) * r, 0.006, Math.cos(a) * r, 0, s, s * (0.5 + rand() * 0.5), 1, -Math.PI / 2), rand() < 0.5 ? '#72c24c' : '#8fda5f');
    }
    patch.build(this.scene);

    // Dirt paths: a ring around the lake and spokes to every base's front gate.
    const pathMat = lambert('#e9cf95');
    const ring = new THREE.Mesh(new THREE.RingGeometry(R.POND_RADIUS + 3, R.POND_RADIUS + 8, 64), pathMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    ring.receiveShadow = true;
    this.scene.add(ring);
    for (const B of R.BASES) {
      const len = R.BASE_RING - R.HALF - (R.POND_RADIUS + 5);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(7, len), pathMat);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = B.yaw;
      const mid = R.POND_RADIUS + 5 + len / 2;
      const dirx = B.cx / R.BASE_RING, dirz = B.cz / R.BASE_RING;
      strip.position.set(dirx * mid, 0.011, dirz * mid);
      strip.receiveShadow = true;
      this.scene.add(strip);
    }
  }

  buildPond() {
    const sand = new THREE.Mesh(new THREE.CircleGeometry(R.POND_RADIUS + 2.2, 48), lambert('#f3dca4'));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.015;
    sand.receiveShadow = true;
    this.scene.add(sand);
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(R.POND_RADIUS + 0.4, 48),
      new THREE.MeshPhongMaterial({ color: '#33b5f5', shininess: 90, specular: '#ffffff', emissive: '#0a3a66' })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.03;
    this.scene.add(this.water);
    const pads = new InstanceBatch(new THREE.CircleGeometry(0.7, 12, 0.4, Math.PI * 1.8), lambert('#4caf50'), { shadow: false });
    const rand = this.rand;
    for (let n = 0; n < 14; n++) {
      const a = rand() * Math.PI * 2, r = 2 + rand() * (R.POND_RADIUS - 4);
      pads.add(mat(Math.sin(a) * r, 0.05, Math.cos(a) * r, 0, 1, 1, 1, -Math.PI / 2, rand() * 6));
    }
    pads.build(this.scene);
    // Little fountain island in the middle
    const island = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 16), lambert('#b9c2cc'));
    island.position.y = 0.3;
    island.castShadow = island.receiveShadow = true;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 1.6, 12), lambert('#d5dde5'));
    spout.position.y = 1.2;
    spout.castShadow = true;
    this.fountain = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), new THREE.MeshPhongMaterial({ color: '#bdeaff', transparent: true, opacity: 0.7, shininess: 100 }));
    this.fountain.position.y = 2.4;
    this.scene.add(island, spout, this.fountain);
    this.circles.push({ x: 0, z: 0, r: R.POND_RADIUS + 0.6 });
  }

  buildMountains() {
    const rand = this.rand;
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    const capGeo = new THREE.ConeGeometry(1, 1, 7, 1);
    const mountains = new InstanceBatch(geo, lambert('#ffffff', { flatShading: true }), { shadow: false });
    const caps = new InstanceBatch(capGeo, lambert('#ffffff', { flatShading: true }), { shadow: false });
    const cols = ['#6fae8a', '#5d9c86', '#7ab58f', '#88a9c9', '#7895b8'];
    for (let n = 0; n < 46; n++) {
      const a = (n / 46) * Math.PI * 2 + rand() * 0.1;
      const r = 260 + rand() * 120;
      const w = 45 + rand() * 50, h = 40 + rand() * 70;
      const ry = rand() * 6;
      mountains.add(mat(Math.sin(a) * r, h / 2 - 2, Math.cos(a) * r, ry, w, h, w), cols[n % cols.length]);
      if (h > 80) caps.add(mat(Math.sin(a) * r, h - h * 0.13 - 2, Math.cos(a) * r, ry, w * 0.27, h * 0.27, w * 0.27), '#ffffff');
    }
    mountains.build(this.scene);
    caps.build(this.scene);
  }

  buildClouds() {
    const rand = this.rand;
    this.clouds = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const m = lambert('#ffffff', { emissive: '#dde8f0' });
    for (let n = 0; n < 18; n++) {
      const c = new THREE.Group();
      const a = rand() * Math.PI * 2, r = 60 + rand() * 220;
      c.position.set(Math.sin(a) * r, 55 + rand() * 40, Math.cos(a) * r);
      const puffs = 3 + Math.floor(rand() * 4);
      for (let p = 0; p < puffs; p++) {
        const s = new THREE.Mesh(geo, m);
        const sc = 5 + rand() * 6;
        s.scale.set(sc, sc * 0.7, sc);
        s.position.set((p - puffs / 2) * 6 + rand() * 3, rand() * 3, rand() * 5);
        c.add(s);
      }
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);
  }

  // ---------------- bases ----------------
  buildBases() {
    const posts = new InstanceBatch(new THREE.BoxGeometry(0.28, 1.6, 0.28), lambert('#a86b38'));
    const caps = new InstanceBatch(new THREE.ConeGeometry(0.22, 0.3, 4), lambert('#8a5428'));
    const rails = new InstanceBatch(new THREE.BoxGeometry(1, 0.16, 0.1), lambert('#d29a5c'));
    const pedestals = new InstanceBatch(new THREE.CylinderGeometry(0.55, 0.65, 0.22, 16), lambert('#ffffff'), { shadow: false, receive: true });
    const crates = new InstanceBatch(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshLambertMaterial({ map: crateTexture() }));
    const barrels = new InstanceBatch(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 14), lambert('#ffffff'));
    const bags = new InstanceBatch(new THREE.CapsuleGeometry(0.3, 0.6, 4, 8), lambert('#e8d3a3'));
    const hedge = new InstanceBatch(new THREE.BoxGeometry(0.22, 2.0, 0.22), lambert('#7b6a5a'));

    R.BASES.forEach((B, k) => {
      const base = { k, B, group: new THREE.Group() };
      const g = base.group;
      g.position.set(B.cx, 0, B.cz);
      g.rotation.y = B.yaw;
      g.updateMatrixWorld();
      const W = g.matrixWorld.clone();
      const wm = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => W.clone().multiply(mat(x, y, z, ry, sx, sy, sz, rx, rz));
      const boxes = this.baseBoxes[k];

      // Compound floor
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(R.HALF * 2 + 1, R.HALF * 2 + 1), lambert('#efd39c'));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.02;
      floor.receiveShadow = true;
      g.add(floor);

      // Fence with gaps for the gates
      const sides = [
        { axis: 'x', fixed: R.HALF, gap: R.FRONT_GATE_HALF },
        { axis: 'x', fixed: -R.HALF, gap: R.BACK_GATE_HALF },
        { axis: 'z', fixed: R.HALF, gap: 0 },
        { axis: 'z', fixed: -R.HALF, gap: 0 },
      ];
      for (const s of sides) {
        const runs = s.gap ? [[-R.HALF, -s.gap], [s.gap, R.HALF]] : [[-R.HALF, R.HALF]];
        for (const [a0, a1] of runs) {
          const P = (t) => (s.axis === 'x' ? [t, s.fixed] : [s.fixed, t]);
          for (let t = a0; t <= a1 + 0.01; t += 2) {
            const [x, z] = P(t);
            posts.add(wm(x, 0.8, z));
            caps.add(wm(x, 1.75, z, Math.PI / 4));
          }
          for (let t = a0; t < a1 - 0.01; t += 2) {
            const [x, z] = P(t + 1);
            const ry = s.axis === 'x' ? 0 : Math.PI / 2;
            rails.add(wm(x, 0.55, z, ry, 2, 1, 1));
            rails.add(wm(x, 1.15, z, ry, 2, 1, 1));
          }
          const t = 0.25;
          boxes.push(s.axis === 'x'
            ? { x0: a0 - t, x1: a1 + t, z0: s.fixed - t, z1: s.fixed + t }
            : { x0: s.fixed - t, x1: s.fixed + t, z0: a0 - t, z1: a1 + t });
        }
      }

      // Gate arch + sign at the front, smaller posts at the back
      const archMat = lambert('#8a5428');
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.4, 0.6), archMat);
        p.position.set(sx * (R.FRONT_GATE_HALF + 0.1), 2.2, R.HALF);
        p.castShadow = true;
        g.add(p);
        const bp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.4, 0.45), archMat);
        bp.position.set(sx * (R.BACK_GATE_HALF + 0.1), 1.2, -R.HALF);
        bp.castShadow = true;
        g.add(bp);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(R.FRONT_GATE_HALF * 2 + 1.4, 0.5, 0.5), archMat);
      beam.position.set(0, 4.3, R.HALF);
      beam.castShadow = true;
      g.add(beam);
      base.signMat = new THREE.MeshBasicMaterial({ map: textTexture('Base Raider', { bg: '#ffffff', color: '#333' }), transparent: true });
      const signGeo = new THREE.PlaneGeometry(7.6, 1.9);
      for (const side of [1, -1]) {
        const sign = new THREE.Mesh(signGeo, base.signMat);
        sign.position.set(0, 5.4, R.HALF + side * 0.05);
        if (side < 0) sign.rotation.y = Math.PI;
        g.add(sign);
      }

      this.buildHouse(base, boxes);

      // Pedestals for the word cards
      for (let n = 0; n < R.MAIN_SLOTS; n++) {
        const [x, , z] = R.slotLocal(n);
        pedestals.add(wm(x, 0.13, z), '#ffffff');
      }

      // Flag pole outside the front-left corner
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 8), lambert('#dddddd'));
      pole.position.set(-R.HALF - 2, 3.5, R.HALF + 2);
      pole.castShadow = true;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), lambert('#ffcf33'));
      ball.position.set(-R.HALF - 2, 7.1, R.HALF + 2);
      base.flagMat = lambert('#ff4d4d', { side: THREE.DoubleSide });
      const flagGeo = new THREE.PlaneGeometry(2.4, 1.5, 8, 1);
      flagGeo.translate(1.2, 0, 0);
      base.flag = new THREE.Mesh(flagGeo, base.flagMat);
      base.flag.position.set(-R.HALF - 2, 6.2, R.HALF + 2);
      base.flag.castShadow = true;
      g.add(pole, ball, base.flag);
      this.circles.push(this.worldCircle(B, -R.HALF - 2, R.HALF + 2, 0.4));

      // Decorations outside the fence (like the concept art: crates, barrels, sandbags, spikes)
      const deco = [
        [R.HALF + 4, 10], [-R.HALF - 4, -8], [R.HALF + 4, -14], [-R.HALF - 4, 12],
      ];
      deco.forEach(([x, z], n) => {
        if (n % 2 === 0) {
          crates.add(wm(x, 0.6, z, 0.2));
          crates.add(wm(x + 1.3, 0.6, z + 0.3, -0.1));
          crates.add(wm(x + 0.6, 1.8, z + 0.1, 0.4));
          barrels.add(wm(x - 0.4, 0.6, z + 1.6), n === 0 ? '#3d7bd9' : '#d94a3d');
          this.circles.push(this.worldCircle(B, x + 0.6, z + 0.5, 1.8));
        } else {
          for (let b = 0; b < 4; b++) bags.add(wm(x, 0.3, z - 1.8 + b * 0.95, 0, 1, 1, 1, 0, Math.PI / 2));
          for (let b = 0; b < 3; b++) bags.add(wm(x, 0.82, z - 1.35 + b * 0.95, 0, 1, 1, 1, 0, Math.PI / 2));
          barrels.add(wm(x + (x > 0 ? 1.2 : -1.2), 0.6, z + 2.2), '#6aa84f');
          this.circles.push(this.worldCircle(B, x, z, 2.2));
        }
      });
      // Czech hedgehog spikes either side of the front approach
      for (const [x, z] of [[-11, R.HALF + 6], [11, R.HALF + 7]]) {
        hedge.add(wm(x, 0.8, z, 0, 1, 1, 1, 0.9, 0));
        hedge.add(wm(x, 0.8, z, Math.PI / 2, 1, 1, 1, 0.9, 0));
        hedge.add(wm(x, 0.8, z, 0, 1, 1, 1, 0, 0.9));
        this.circles.push(this.worldCircle(B, x, z, 1.1));
      }

      // "Closed" barricade, shown for bases nobody is using
      base.closedGroup = new THREE.Group();
      const plankMat = lambert('#b5793f');
      for (const [hw, z] of [[R.FRONT_GATE_HALF, R.HALF], [R.BACK_GATE_HALF, -R.HALF]]) {
        for (const [y, rz] of [[0.7, 0.25], [1.3, -0.25], [1.0, 0]]) {
          const pl = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.8, 0.35, 0.15), plankMat);
          pl.position.set(0, y, z + 0.15);
          pl.rotation.z = rz;
          pl.castShadow = true;
          base.closedGroup.add(pl);
        }
      }
      const closedSign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: textTexture('CLOSED', { bg: '#ff5a4d', color: '#fff', w: 384, h: 112 }), side: THREE.DoubleSide }));
      closedSign.position.set(0, 2.4, R.HALF + 0.3);
      base.closedGroup.add(closedSign);
      base.closedGroup.visible = false;
      g.add(base.closedGroup);

      // Force field on the gates while a base is locked during prep
      base.fieldMat = new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      base.fieldGroup = new THREE.Group();
      for (const [hw, z] of [[R.FRONT_GATE_HALF, R.HALF], [R.BACK_GATE_HALF, -R.HALF]]) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 4), base.fieldMat);
        f.position.set(0, 2, z);
        base.fieldGroup.add(f);
      }
      base.fieldGroup.visible = false;
      g.add(base.fieldGroup);

      this.scene.add(g);
      this.bases.push(base);
    });

    for (const b of [posts, caps, rails, crates, barrels, bags, hedge]) b.build(this.scene);
    this.pedestals = pedestals.build(this.scene);
  }

  buildHouse(base, boxes) {
    const g = new THREE.Group();
    const H = R.HOUSE, WH = R.WALL_H, T = 0.3;
    const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2;
    const w = H.x1 - H.x0, d = H.z1 - H.z0;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert('#e3ab6e'));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.04, cz);
    floor.receiveShadow = true;
    g.add(floor);
    // floor boards
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.06), lambert('#c98f55'));
    for (let z = H.z0 + 1; z < H.z1; z += 1) {
      const b = board.clone();
      b.rotation.x = -Math.PI / 2;
      b.position.set(cx, 0.045, z);
      g.add(b);
    }

    base.wallMat = lambert('#fff1d6', { transparent: true });
    const trimMat = lambert('#e2c38f');
    const wall = (x0, x1, z0, z1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, WH, z1 - z0), base.wallMat);
      m.position.set((x0 + x1) / 2, WH / 2, (z0 + z1) / 2);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.06, 0.5, z1 - z0 + 0.06), trimMat);
      trim.position.set((x0 + x1) / 2, 0.25, (z0 + z1) / 2);
      g.add(trim);
      boxes.push({ x0, x1, z0, z1 });
    };
    const D = R.DOOR_HALF;
    wall(H.x0, -D, H.z1 - T, H.z1);
    wall(D, H.x1, H.z1 - T, H.z1);
    wall(H.x0, -D, H.z0, H.z0 + T);
    wall(D, H.x1, H.z0, H.z0 + T);
    wall(H.x0, H.x0 + T, H.z0, H.z1);
    wall(H.x1 - T, H.x1, H.z0, H.z1);

    // Lintels above doors + door frames
    const frameMat = lambert('#8a5428');
    for (const z of [H.z1 - T / 2, H.z0 + T / 2]) {
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(D * 2, 0.7, T), base.wallMat);
      lintel.position.set(0, WH - 0.35, z);
      g.add(lintel);
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.25, WH - 0.6, T + 0.12), frameMat);
        f.position.set(s * D, (WH - 0.6) / 2, z);
        g.add(f);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(D * 2 + 0.3, 0.22, T + 0.12), frameMat);
      top.position.set(0, WH - 0.7, z);
      g.add(top);
    }
    // Front awning over the door (like the concept art)
    base.awningMat = lambert('#d9533d', { transparent: true });
    const awn = new THREE.Mesh(new THREE.BoxGeometry(D * 2 + 1.4, 0.14, 1.5), base.awningMat);
    awn.position.set(0, WH - 0.15, H.z1 + 0.6);
    awn.rotation.x = 0.3;
    awn.castShadow = true;
    g.add(awn);
    // Step
    const step = new THREE.Mesh(new THREE.BoxGeometry(D * 2 + 0.6, 0.12, 1.2), lambert('#c8ccd2'));
    step.position.set(0, 0.06, H.z1 + 0.6);
    step.receiveShadow = true;
    g.add(step);

    // Loot shelf for stolen words (either side of the front door)
    const shelfMat = lambert('#d9a441');
    for (const sx of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 1.0), shelfMat);
      bench.position.set(sx * 6.2, 0.25, R.LOOT_Z);
      bench.castShadow = bench.receiveShadow = true;
      g.add(bench);
    }
    const lootSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: textTexture('🏆 LOOT', { bg: '#ffd23f', color: '#6b4a00', w: 384, h: 96 }) }));
    lootSign.position.set(0, WH - 0.3, H.z1 - T - 0.03);
    lootSign.rotation.y = Math.PI;
    g.add(lootSign);

    // Windows (glowing, cosy)
    const winMat = new THREE.MeshLambertMaterial({ color: '#ffe9a8', emissive: '#ffb84d', emissiveIntensity: 0.6 });
    const winFrame = lambert('#8a5428');
    const addWindow = (x, z, ry) => {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 0.36), winFrame);
      fr.position.set(x, 1.9, z);
      fr.rotation.y = ry;
      const gl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.4), winMat);
      gl.position.set(x, 1.9, z);
      gl.rotation.y = ry;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.44), winFrame);
      bar.position.set(x, 1.9, z);
      bar.rotation.y = ry;
      g.add(fr, gl, bar);
    };
    for (const x of [-7.5, 7.5]) {
      addWindow(x, H.z1 - T / 2, 0);
      addWindow(x, H.z0 + T / 2, 0);
    }
    for (const z of [H.z0 + 3, cz, H.z1 - 3]) {
      addWindow(H.x0 + T / 2, z, Math.PI / 2);
      addWindow(H.x1 - T / 2, z, Math.PI / 2);
    }

    // Roof: two slabs + gables + chimney (fades out when you're inside)
    base.roofMat = lambert('#e0533d', { transparent: true });
    base.gableMat = lambert('#fff1d6', { transparent: true, side: THREE.DoubleSide });
    const roof = new THREE.Group();
    const rise = 4.0, over = 0.7;
    const run = d / 2 + over;
    const ang = Math.atan2(rise + 0.3, run);
    const len = Math.hypot(run, rise + 0.3);
    for (const s of [1, -1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.3, len), base.roofMat);
      slab.position.set(cx, WH + rise / 2 - 0.1, cz + s * run / 2);
      slab.rotation.x = s * ang;
      slab.castShadow = true;
      roof.add(slab);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, w + 1.6, 8), base.roofMat);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.set(cx, WH + rise + 0.05, cz);
    roof.add(ridge);
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, rise); tri.closePath();
    const triGeo = new THREE.ShapeGeometry(tri);
    for (const z of [H.z1 - 0.02, H.z0 + 0.02]) {
      const gab = new THREE.Mesh(triGeo, base.gableMat);
      gab.position.set(cx, WH, z);
      roof.add(gab);
    }
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 1.1), lambert('#b4553f', { transparent: true }));
    chimney.position.set(7, WH + rise * 0.75, cz - 3.5);
    chimney.castShadow = true;
    base.chimneyMat = chimney.material;
    roof.add(chimney);
    // Little dormer window on the front slope
    const dormer = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.4), base.gableMat);
    dormer.position.set(-6, WH + rise * 0.55, cz + run * 0.42);
    roof.add(dormer);
    g.add(roof);
    base.roof = roof;
    base.fade = 1;
    base.house = g;
    base.group.add(g);
  }

  worldCircle(B, lx, lz, r) {
    const [x, z] = R.toWorld(B, lx, lz);
    return { x, z, r };
  }

  // ---------------- trees, rocks, flowers ----------------
  buildNature() {
    const rand = this.rand;
    const ok = (x, z, clear) => {
      if (Math.hypot(x, z) < R.POND_RADIUS + 11) return false;
      for (const B of R.BASES) {
        const [lx, lz] = R.toLocal(B, x, z);
        if (Math.abs(lx) < R.HALF + clear && Math.abs(lz) < R.HALF + clear) return false;
        // keep the front approach path clear
        if (Math.abs(lx) < 7 && lz > 0 && lz < R.BASE_RING) return false;
      }
      return true;
    };
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 7);
    const trunks = new InstanceBatch(trunkGeo, lambert('#8a5a32'));
    const cone = new THREE.ConeGeometry(1, 1, 8);
    const pines = new InstanceBatch(cone, lambert('#ffffff', { flatShading: true }));
    const blobs = new InstanceBatch(new THREE.IcosahedronGeometry(1, 0), lambert('#ffffff', { flatShading: true }));
    const rocks = new InstanceBatch(new THREE.DodecahedronGeometry(1, 0), lambert('#ffffff', { flatShading: true }));
    const bushes = new InstanceBatch(new THREE.IcosahedronGeometry(1, 1), lambert('#ffffff', { flatShading: true }));
    const flowers = new InstanceBatch(new THREE.SphereGeometry(0.13, 6, 5), lambert('#ffffff'), { shadow: false });
    const stems = new InstanceBatch(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 4), lambert('#3f8f3a'), { shadow: false });
    const pineCols = ['#2f8f50', '#3aa05a', '#287a45', '#45ad62'];
    const leafCols = ['#62cc5c', '#7fd95b', '#4fbf6a', '#f2a541', '#9fdc58'];

    const addPine = (x, z, s, collide) => {
      const ry = rand() * 6;
      trunks.add(mat(x, 0.8 * s, z, ry, s, s, s));
      const col = pineCols[Math.floor(rand() * pineCols.length)];
      pines.add(mat(x, 2.4 * s, z, ry, 1.9 * s, 2.6 * s, 1.9 * s), col);
      pines.add(mat(x, 3.6 * s, z, ry, 1.45 * s, 2.2 * s, 1.45 * s), col);
      pines.add(mat(x, 4.7 * s, z, ry, 1.0 * s, 1.8 * s, 1.0 * s), col);
      if (collide) this.circles.push({ x, z, r: 0.55 * s });
    };
    const addRound = (x, z, s) => {
      trunks.add(mat(x, 0.8 * s, z, 0, s, s * 1.4, s));
      blobs.add(mat(x, 3.0 * s, z, rand() * 6, 1.8 * s, 1.6 * s, 1.8 * s), leafCols[Math.floor(rand() * leafCols.length)]);
      this.circles.push({ x, z, r: 0.55 * s });
    };

    // Trees inside the play area
    for (let n = 0, tries = 0; n < 150 && tries < 3000; tries++) {
      const a = rand() * Math.PI * 2, r = 22 + rand() * (R.WORLD_RADIUS - 24);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!ok(x, z, 6)) continue;
      if (this.circles.some((c) => Math.hypot(c.x - x, c.z - z) < 3.5)) continue;
      if (rand() < 0.7) addPine(x, z, 0.85 + rand() * 0.6, true);
      else addRound(x, z, 0.8 + rand() * 0.5);
      n++;
    }
    // Dense forest ring around the edge of the world
    for (let n = 0; n < 420; n++) {
      const a = rand() * Math.PI * 2, r = R.WORLD_RADIUS + 3 + rand() * 70;
      addPine(Math.sin(a) * r, Math.cos(a) * r, 1 + rand() * 0.9, false);
    }
    // Rocks
    const rockCols = ['#a5adb8', '#929ba7', '#b6bcc4'];
    for (let n = 0, tries = 0; n < 45 && tries < 2000; tries++) {
      const a = rand() * Math.PI * 2, r = 22 + rand() * (R.WORLD_RADIUS - 20);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!ok(x, z, 4)) continue;
      const s = 0.7 + rand() * 1.6;
      rocks.add(mat(x, s * 0.35, z, rand() * 6, s * 1.3, s * 0.85, s * 1.1), rockCols[n % 3]);
      if (s > 1.0) this.circles.push({ x, z, r: s * 1.05 });
      n++;
    }
    // Bushes & flowers (no collision)
    const flowerCols = ['#ff7eb6', '#ffe14d', '#ffffff', '#b98cff', '#ff9a4d'];
    for (let n = 0; n < 130; n++) {
      const a = rand() * Math.PI * 2, r = 20 + rand() * (R.WORLD_RADIUS + 10);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!ok(x, z, 2)) continue;
      const s = 0.5 + rand() * 0.6;
      bushes.add(mat(x, s * 0.5, z, rand() * 6, s * 1.3, s, s * 1.3), leafCols[n % 3]);
    }
    for (let n = 0; n < 500; n++) {
      const a = rand() * Math.PI * 2, r = 18 + rand() * (R.WORLD_RADIUS + 5);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (!ok(x, z, 1)) continue;
      stems.add(mat(x, 0.15, z));
      flowers.add(mat(x, 0.32, z), flowerCols[n % flowerCols.length]);
    }
    for (const b of [trunks, pines, blobs, rocks, bushes, flowers, stems]) b.build(this.scene);
  }

  // ---------------- game setup ----------------
  // bases: [{index, owner, ownerName, category, closed}], colorOf(ownerId) -> css colour
  setupBases(bases, colorOf) {
    for (const info of bases) {
      const base = this.bases[info.index];
      base.closed = info.closed;
      base.closedGroup.visible = info.closed;
      const col = info.closed ? '#9aa0a8' : colorOf(info.owner);
      base.roofMat.color.set(info.closed ? '#8f949b' : shade(col, -0.08));
      base.awningMat.color.set(info.closed ? '#8f949b' : col);
      base.flagMat.color.set(col);
      const cat = CATEGORIES[info.category];
      base.signMat.map = info.closed
        ? textTexture('Closed', { bg: '#cfd3d8', color: '#666' })
        : textTexture(`${info.ownerName}'s Base · ${cat.icon} ${cat.name}`, { bg: '#ffffff', color: shade(col, -0.25), size: 54, w: 768 });
      base.signMat.needsUpdate = true;
      for (let n = 0; n < R.MAIN_SLOTS; n++) {
        this.pedestals.setColorAt(info.index * R.MAIN_SLOTS + n, new THREE.Color(info.closed ? '#c8c8c8' : shade(cat.color, 0.28)));
      }
    }
    this.pedestals.instanceColor.needsUpdate = true;
  }

  // Decorative colours for the menu background.
  setupDemo() {
    const cols = R.COLORS;
    this.bases.forEach((base, k) => {
      const col = cols[k];
      base.roofMat.color.set(shade(col, -0.08));
      base.awningMat.color.set(col);
      base.flagMat.color.set(col);
      base.closedGroup.visible = false;
      const cat = CATEGORIES[k * 2];
      base.signMat.map = textTexture(`${cat.icon} ${cat.name}`, { bg: '#ffffff', color: shade(col, -0.25) });
      base.signMat.needsUpdate = true;
      for (let n = 0; n < R.MAIN_SLOTS; n++) this.pedestals.setColorAt(k * R.MAIN_SLOTS + n, new THREE.Color(shade(cat.color, 0.28)));
    });
    this.pedestals.instanceColor.needsUpdate = true;
    this.bases.forEach((b, k) => this.setPedestals(k, new Set([...Array(8).keys()])));
    this.setBlocked(() => false);
    for (const b of this.bases) b.fieldGroup.visible = false;
  }

  // Only show pedestals that have a word on them.
  setPedestals(k, slots) {
    const m = new THREE.Matrix4();
    const B = this.bases[k].group.matrixWorld;
    for (let n = 0; n < R.MAIN_SLOTS; n++) {
      const [x, , z] = R.slotLocal(n);
      const s = slots.has(n) ? 1 : 0.0001;
      m.copy(B).multiply(mat(x, 0.13, z, 0, s, s, s));
      this.pedestals.setMatrixAt(k * R.MAIN_SLOTS + n, m);
    }
    this.pedestals.instanceMatrix.needsUpdate = true;
  }

  setBlocked(fn) {
    this.bases.forEach((b, k) => {
      this.blocked[k] = !!fn(k, b);
    });
  }
  showFields(fn) {
    this.bases.forEach((b, k) => { b.fieldGroup.visible = !!fn(k, b); });
  }

  setItemBoxes(k, cells) {
    this.itemBoxes[k] = cells.map(([i, j]) => {
      const [x, z] = R.cellCenter(i, j);
      const h = R.CELL / 2;
      return { x0: x - h, x1: x + h, z0: z - h, z1: z + h };
    });
  }

  // ---------------- collision ----------------
  collide(p, r = R.PLAYER_RADIUS) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.circles) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const rr = c.r + r;
        if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.001;
          p.x = c.x + (dx / d) * rr;
          p.z = c.z + (dz / d) * rr;
        }
      }
      R.BASES.forEach((B, k) => {
        const dx = p.x - B.cx, dz = p.z - B.cz;
        if (dx * dx + dz * dz > 34 * 34) return;
        const [lx, lz] = R.toLocal(B, p.x, p.z);
        const l = { x: lx, z: lz };
        let moved = false;
        for (const b of this.baseBoxes[k]) moved = pushOut(l, b, r) || moved;
        for (const b of this.itemBoxes[k]) moved = pushOut(l, b, r) || moved;
        if (this.blocked[k]) {
          for (const b of GATE_BARRIERS) moved = pushOut(l, b, r) || moved;
          // Never let anyone stand inside a blocked compound (e.g. after a phase change).
          if (R.inCompound(l.x, l.z)) {
            const ax = R.HALF - Math.abs(l.x), az = R.HALF - Math.abs(l.z);
            if (ax < az) l.x = Math.sign(l.x || 1) * (R.HALF + r + 0.3);
            else l.z = Math.sign(l.z || 1) * (R.HALF + r + 0.3);
            moved = true;
          }
        }
        if (moved) [p.x, p.z] = R.toWorld(B, l.x, l.z);
      });
    }
    const d = Math.hypot(p.x, p.z);
    if (d > R.WORLD_RADIUS) {
      p.x *= R.WORLD_RADIUS / d;
      p.z *= R.WORLD_RADIUS / d;
    }
  }

  // ---------------- per-frame ----------------
  // insideBase: index of the house the camera target is inside (or -1)
  update(dt, insideBase = -1) {
    this.time += dt;
    const t = this.time;
    this.clouds.rotation.y += dt * 0.004;
    if (this.fountain) this.fountain.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    for (const b of this.bases) {
      b.flag.rotation.y = Math.sin(t * 1.7 + b.k) * 0.25;
      const pos = b.flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(t * 5 + x * 2.2 + b.k) * 0.12 * (x / 2.4));
      }
      pos.needsUpdate = true;
      if (b.fieldGroup.visible) b.fieldMat.opacity = 0.25 + Math.sin(t * 4) * 0.1;
      const target = b.k === insideBase ? 0.1 : 1;
      b.fade += (target - b.fade) * (1 - Math.exp(-8 * dt));
      const wallTarget = b.k === insideBase ? 0.45 : 1;
      b.roofMat.opacity = b.gableMat.opacity = b.chimneyMat.opacity = b.fade;
      b.roof.visible = b.fade > 0.12;
      b.wallMat.opacity += (wallTarget - b.wallMat.opacity) * (1 - Math.exp(-8 * dt));
      b.wallMat.depthWrite = b.wallMat.opacity > 0.95;
    }
  }
}

function pushOut(l, b, r) {
  const cx = Math.max(b.x0, Math.min(l.x, b.x1));
  const cz = Math.max(b.z0, Math.min(l.z, b.z1));
  const dx = l.x - cx, dz = l.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    l.x = cx + (dx / d) * r;
    l.z = cz + (dz / d) * r;
  } else {
    const left = l.x - b.x0, right = b.x1 - l.x, back = l.z - b.z0, front = b.z1 - l.z;
    const m = Math.min(left, right, back, front);
    if (m === left) l.x = b.x0 - r;
    else if (m === right) l.x = b.x1 + r;
    else if (m === back) l.z = b.z0 - r;
    else l.z = b.z1 + r;
  }
  return true;
}
