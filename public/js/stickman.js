import * as THREE from 'three';
import { COLORS, HATS } from '/shared/rules.js';
import { NameTag, makeWordSprite, shade } from './util.js';

const geo = {
  head: new THREE.SphereGeometry(0.42, 24, 18),
  torso: new THREE.CapsuleGeometry(0.22, 0.42, 6, 14),
  limb: new THREE.CapsuleGeometry(0.1, 0.42, 4, 10),
  arm: new THREE.CapsuleGeometry(0.085, 0.4, 4, 10),
  hand: new THREE.SphereGeometry(0.115, 12, 10),
  foot: new THREE.SphereGeometry(0.13, 12, 10),
  eye: new THREE.SphereGeometry(0.07, 12, 10),
  shine: new THREE.SphereGeometry(0.022, 6, 6),
  blush: new THREE.CircleGeometry(0.075, 14),
  smile: new THREE.TorusGeometry(0.075, 0.02, 6, 14, Math.PI),
};
const M = {
  black: new THREE.MeshBasicMaterial({ color: 0x1b1b2a }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  blush: new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.75 }),
  wood: new THREE.MeshLambertMaterial({ color: 0xb87333 }),
  tape: new THREE.MeshLambertMaterial({ color: 0xfff1c9 }),
  pack: new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
  packDark: new THREE.MeshLambertMaterial({ color: 0x5a3a1e }),
  gold: new THREE.MeshLambertMaterial({ color: 0xffcf33, emissive: 0x332200 }),
  ice: new THREE.MeshPhongMaterial({ color: 0xaee9ff, transparent: true, opacity: 0.55, shininess: 120, specular: 0xffffff, depthWrite: false }),
};

function hatMesh(kind, color) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const accent = shade(color, -0.22);
  switch (kind) {
    case 'cap': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.43, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(accent));
      dome.position.y = -0.12;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20, 1, false, -Math.PI / 2, Math.PI), mat(accent));
      brim.position.set(0, -0.1, 0.26);
      brim.scale.z = 1.3;
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat('#ffffff'));
      button.position.y = 0.3;
      g.add(dome, brim, button);
      break;
    }
    case 'crown': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16, 1, true), M.gold);
      band.material.side = THREE.DoubleSide;
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), M.gold);
        spike.position.set(Math.sin(a) * 0.28, 0.18, Math.cos(a) * 0.28);
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(['#ff3d6e', '#3dc3ff', '#5bff8a'][i % 3]));
        gem.position.set(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
        g.add(spike, gem);
      }
      g.position.y = 0.05;
      break;
    }
    case 'party': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 18), mat('#ff5fa8'));
      cone.position.y = 0.22;
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 18), mat('#ffe14d'));
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.12;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat('#5bd9ff'));
      pom.position.y = 0.52;
      g.add(cone, stripe, pom);
      g.rotation.z = -0.2;
      break;
    }
    case 'beanie': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#3d8bff'));
      dome.position.y = -0.14;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.14, 20), mat('#ffffff'));
      band.position.y = -0.12;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat('#ffffff'));
      pom.position.y = 0.32;
      g.add(dome, band, pom);
      break;
    }
    case 'tophat': {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), mat('#222233'));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.45, 20), mat('#222233'));
      top.position.y = 0.24;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.09, 20), mat('#ff4d4d'));
      band.position.y = 0.07;
      g.add(brim, top, band);
      g.position.y = -0.02;
      break;
    }
    case 'bow': {
      const m = mat('#ff4d8d');
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 10), m);
      l.rotation.z = Math.PI / 2;
      l.position.x = -0.13;
      const r = l.clone();
      r.rotation.z = -Math.PI / 2;
      r.position.x = 0.13;
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), m);
      g.add(l, r, knot);
      g.position.set(0.2, -0.05, 0.1);
      g.rotation.z = -0.5;
      break;
    }
    case 'viking': {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#a7adb8'));
      dome.position.y = -0.13;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 6, 24), mat('#ffcf33'));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.12;
      g.add(dome, rim);
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.38, 10), mat('#fff6dc'));
        horn.position.set(s * 0.46, 0.08, 0);
        horn.rotation.z = -s * 1.0;
        g.add(horn);
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

export class Stickman {
  constructor(look = { color: 0, hat: 0 }, { name = null, shadows = true } = {}) {
    this.group = new THREE.Group();
    this.root = new THREE.Group(); // bobs / squashes
    this.group.add(this.root);
    this.look = { ...look };
    this.color = COLORS[look.color] || COLORS[0];
    this.mat = new THREE.MeshToonMaterial({ color: this.color });
    const mk = (g, m = this.mat) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = shadows;
      return mesh;
    };

    // Legs
    this.legs = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.13, 0.72, 0);
      const leg = mk(geo.limb);
      leg.position.y = -0.33;
      const foot = mk(geo.foot);
      foot.position.set(0, -0.62, 0.05);
      foot.scale.set(1, 0.75, 1.3);
      pivot.add(leg, foot);
      this.root.add(pivot);
      return pivot;
    });

    this.torso = mk(geo.torso);
    this.torso.position.y = 1.0;
    this.root.add(this.torso);

    // Arms
    this.arms = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.29, 1.24, 0);
      const arm = mk(geo.arm);
      arm.position.y = -0.27;
      const hand = mk(geo.hand);
      hand.position.y = -0.53;
      pivot.add(arm, hand);
      this.root.add(pivot);
      return pivot;
    });

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 1.78;
    const skull = mk(geo.head);
    this.head.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(geo.eye, M.black);
      eye.position.set(s * 0.14, 0.05, 0.37);
      eye.scale.set(0.85, 1.15, 0.5);
      const shine = new THREE.Mesh(geo.shine, M.white);
      shine.position.set(s * 0.14 + 0.025, 0.09, 0.405);
      const blush = new THREE.Mesh(geo.blush, M.blush);
      blush.position.set(s * 0.25, -0.08, 0.335);
      blush.rotation.y = s * 0.6;
      this.head.add(eye, shine, blush);
    }
    const smile = new THREE.Mesh(geo.smile, M.black);
    smile.position.set(0, -0.08, 0.39);
    smile.rotation.z = Math.PI;
    this.head.add(smile);
    this.root.add(this.head);
    this.setHat(look.hat);

    // Stick (club), held in the right hand
    this.stick = new THREE.Group();
    const club = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.055, 1.05, 10), M.wood);
    club.position.y = -0.48;
    club.castShadow = shadows;
    const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.18, 10), M.tape);
    tape.position.y = -0.08;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), M.wood);
    knob.position.y = -1.0;
    this.stick.add(club, tape, knob);
    this.stick.position.y = -0.55;
    this.stick.rotation.x = -1.2;
    this.arms[1].add(this.stick);

    // Raider backpack
    this.pack = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.24), M.pack);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.27), M.packDark);
    flap.position.y = 0.18;
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.08), M.packDark);
    pocket.position.set(0, -0.1, -0.14);
    this.pack.add(bag, flap, pocket);
    this.pack.position.set(0, 1.05, -0.3);
    this.pack.traverse((o) => { o.castShadow = shadows; });
    this.root.add(this.pack);

    // Ice cube shown while frozen
    this.ice = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.5, 1.3), M.ice);
    this.ice.position.y = 1.2;
    this.ice.visible = false;
    this.group.add(this.ice);

    // Dizzy stars shown while stunned by a trick word
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: '#ffe14d' });
    const starGeo = new THREE.OctahedronGeometry(0.11, 0);
    for (let n = 0; n < 4; n++) {
      const st = new THREE.Mesh(starGeo, starMat);
      const a = (n / 4) * Math.PI * 2;
      st.position.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
      this.stars.add(st);
    }
    this.stars.position.y = 2.35;
    this.stars.visible = false;
    this.group.add(this.stars);

    // Carried words float above the head
    this.carryGroup = new THREE.Group();
    this.carryGroup.position.y = 3.05;
    this.group.add(this.carryGroup);
    this.carryKey = '';

    if (name) {
      this.tag = new NameTag(name, this.color);
      this.tag.sprite.position.y = 2.6;
      this.group.add(this.tag.sprite);
    }

    this.walk = 0;
    this.swingT = 1;
    this.hitFlash = 0;
    this.mode = 'defend';
    this.setMode('defend');
  }

  setHat(h) {
    if (this.hat) this.head.remove(this.hat);
    this.hat = hatMesh(HATS[h], this.color);
    if (this.hat) {
      this.hat.position.y += 0.4;
      this.hat.traverse((o) => { o.castShadow = true; });
      this.head.add(this.hat);
    }
  }

  setLook(look) {
    this.look = { ...look };
    this.color = COLORS[look.color] || COLORS[0];
    this.mat.color.set(this.color);
    this.setHat(look.hat);
  }

  setMode(mode) {
    this.mode = mode;
    this.stick.visible = mode === 'defend';
    this.pack.visible = mode === 'raid';
  }

  setCarry(words) {
    const key = words.map((w) => w.id).join(',');
    if (key === this.carryKey) return;
    this.carryKey = key;
    this.carryGroup.clear();
    words.forEach((w, n) => {
      const s = makeWordSprite(w.t, w.c, 0.55, 'loot');
      s.position.y = n * 0.5;
      this.carryGroup.add(s);
    });
  }

  swing() { this.swingT = 0; }
  flash() { this.hitFlash = 1; }

  // speed: horizontal speed (units/s); air: airborne; frozen; time: seconds
  update(dt, { speed = 0, air = false, frozen = false, stunned = false, time = 0 } = {}) {
    this.ice.visible = frozen;
    this.stars.visible = stunned;
    if (stunned) {
      this.stars.rotation.y += dt * 6;
      this.head.rotation.z = Math.sin(time * 9) * 0.25;
    } else this.head.rotation.z = 0;
    if (frozen) return;
    const moving = Math.min(1, speed / 7);
    this.walk += dt * (4 + speed * 1.25);
    const s = Math.sin(this.walk);
    const legAmp = 0.9 * moving;
    if (air) {
      this.legs[0].rotation.x = -0.6;
      this.legs[1].rotation.x = 0.4;
    } else {
      this.legs[0].rotation.x = s * legAmp;
      this.legs[1].rotation.x = -s * legAmp;
    }
    this.root.position.y = air ? 0 : Math.abs(Math.cos(this.walk)) * 0.08 * moving + Math.sin(time * 2.4) * 0.015 * (1 - moving);
    this.root.rotation.x = 0.12 * moving;

    // Arms: left swings with walk; right holds stick / swings
    const armAmp = 0.8 * moving;
    this.arms[0].rotation.x = air ? -2.6 : -s * armAmp;
    this.arms[0].rotation.z = -0.15;
    this.arms[1].rotation.z = 0.15;
    if (this.mode === 'defend') {
      if (this.swingT < 1) {
        this.swingT = Math.min(1, this.swingT + dt / 0.32);
        const t = this.swingT;
        // wind up quickly, then whip forward
        const a = t < 0.3 ? THREE.MathUtils.lerp(-0.9, -3.4, t / 0.3) : THREE.MathUtils.lerp(-3.4, -0.3, Math.min(1, (t - 0.3) / 0.35));
        this.arms[1].rotation.x = a;
      } else {
        this.arms[1].rotation.x = -0.9 + s * 0.15 * moving;
      }
    } else {
      this.arms[1].rotation.x = air ? -2.6 : s * armAmp;
    }

    // Hit flash
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      this.mat.emissive.setRGB(this.hitFlash * 0.9, this.hitFlash * 0.9, this.hitFlash * 0.9);
    }
    // Carried words bob
    this.carryGroup.children.forEach((c, n) => { c.position.x = Math.sin(time * 2 + n) * 0.08; });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isSprite && o.material.map && o === this.tag?.sprite) o.material.map.dispose();
    });
  }
}
