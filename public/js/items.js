import * as THREE from 'three';
import { crateTexture, shade } from './util.js';

// Meshes for blocks, towers and traps. Each returns a Group positioned at the
// cell centre (y = 0). `top` (optional) rotates to aim; `anim(t, dt, trig)` animates.
const L = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const shadow = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

const crateMat = () => new THREE.MeshLambertMaterial({ map: crateTexture() });

export function makeItemMesh(type, ownerColor) {
  const g = new THREE.Group();
  const item = { group: g, top: null, trig: 0, anim: null };
  switch (type) {
    case 'block': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.96, 1.96, 1.96), crateMat());
      box.position.y = 0.98;
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.26, 2.0), L(ownerColor));
      band.position.y = 1.4;
      g.add(box, band);
      break;
    }
    case 'snow': {
      const wood = L('#9a6232');
      for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.2, 6), wood);
        leg.position.set(x, 1.1, z);
        g.add(leg);
      }
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), wood);
      brace.position.set(0, 0.9, 0.7);
      brace.rotation.z = 0.6;
      const brace2 = brace.clone();
      brace2.position.z = -0.7;
      brace2.rotation.z = -0.6;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 1.9), L('#c98a4b'));
      plat.position.y = 2.25;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 1.9), L(ownerColor));
      rail.position.y = 2.5;
      rail.scale.set(1, 1, 1);
      g.add(brace, brace2, plat, rail);
      const top = new THREE.Group();
      top.position.y = 2.7;
      const white = L('#ffffff');
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), white);
      body.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), white);
      head.position.y = 1.0;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 8), L('#ff8a1f'));
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.0, 0.45);
      const eyeM = new THREE.MeshBasicMaterial({ color: '#222' });
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeM);
        e.position.set(s * 0.12, 1.1, 0.3);
        top.add(e);
      }
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 12), L(ownerColor));
      hat.position.y = 1.36;
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 14), L(shade(ownerColor, -0.15)));
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 0.75;
      top.add(body, head, nose, hat, scarf);
      g.add(top);
      item.top = top;
      break;
    }
    case 'frost': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.7, 12), L('#cfe3f1'));
      base.position.y = 0.35;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.1, 6, 18), L(ownerColor));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.7;
      g.add(base, ring);
      const top = new THREE.Group();
      top.position.y = 1.3;
      const ice = L('#8fe3ff', { emissive: '#1b6f9a', emissiveIntensity: 0.4 });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), ice);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.1, 10), L('#5fb9e6'));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = 0.65;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), L('#e8fbff', { emissive: '#4fd2ff', emissiveIntensity: 0.6, flatShading: true }));
      crystal.position.y = 0.8;
      crystal.scale.y = 1.6;
      top.add(ball, barrel, crystal);
      g.add(top);
      item.top = top;
      item.anim = (t) => { crystal.rotation.y = t * 1.5; };
      break;
    }
    case 'cactus': {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.95, 0.1, 16), L('#d7b57a'));
      plate.position.y = 0.05;
      g.add(plate);
      const spikes = new THREE.Group();
      const green = L('#3fae4a');
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        const r = n === 0 ? 0 : 0.5;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), green);
        c.position.set(n === 0 ? 0 : Math.sin(a) * r, 0.25, n === 0 ? 0 : Math.cos(a) * r);
        spikes.add(c);
      }
      spikes.scale.y = 0.35;
      g.add(spikes);
      item.anim = (t, dt) => {
        item.trig = Math.max(0, item.trig - dt * 1.5);
        spikes.scale.y = 0.35 + item.trig * 1.6;
      };
      break;
    }
    case 'freeze': {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.1, 6), L('#9ee6ff', { emissive: '#2aa7e0', emissiveIntensity: 0.35 }));
      plate.position.y = 0.05;
      g.add(plate);
      const flake = new THREE.Group();
      const wm = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      for (let n = 0; n < 3; n++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.1), wm);
        bar.rotation.y = (n * Math.PI) / 3;
        flake.add(bar);
      }
      flake.position.y = 0.12;
      g.add(flake);
      item.anim = (t, dt) => {
        item.trig = Math.max(0, item.trig - dt);
        flake.rotation.y = t * 0.6;
        plate.scale.setScalar(1 + item.trig * 0.6);
      };
      break;
    }
    case 'slime': {
      const m = new THREE.MeshPhongMaterial({ color: '#6ee05a', transparent: true, opacity: 0.85, shininess: 80 });
      for (const [x, z, s] of [[0, 0, 0.85], [0.45, 0.35, 0.45], [-0.4, -0.35, 0.5], [-0.35, 0.45, 0.35]]) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 8), m);
        blob.scale.y = 0.18;
        blob.position.set(x, 0.05, z);
        g.add(blob);
      }
      item.anim = (t) => { g.children.forEach((c, n) => { c.scale.x = c.scale.z = 1 + Math.sin(t * 2 + n) * 0.05; }); };
      break;
    }
    case 'boing': {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.35, 12), L('#fff4dc'));
      stem.position.y = 0.17;
      const capG = new THREE.Group();
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), L('#ff4d5e'));
      cap.scale.y = 0.55;
      capG.add(cap);
      const dot = L('#ffffff');
      for (let n = 0; n < 6; n++) {
        const a = (n / 6) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), dot);
        s.position.set(Math.sin(a) * 0.55, 0.3, Math.cos(a) * 0.55);
        s.scale.y = 0.5;
        capG.add(s);
      }
      const center = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), dot);
      center.position.y = 0.5;
      center.scale.y = 0.5;
      capG.add(center);
      capG.position.y = 0.32;
      g.add(stem, capG);
      item.anim = (t, dt) => {
        item.trig = Math.max(0, item.trig - dt * 2.5);
        const k = item.trig;
        capG.scale.set(1 + Math.sin(k * 12) * k * 0.3, 1 - Math.sin(k * 12) * k * 0.4, 1 + Math.sin(k * 12) * k * 0.3);
      };
      break;
    }
  }
  shadow(g);
  return item;
}

// Translucent preview used in build mode.
export function makeGhost() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#5be36b', transparent: true, opacity: 0.45, depthWrite: false });
  const solid = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  solid.position.y = 1;
  const flat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.9), mat);
  flat.position.y = 0.08;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02)), new THREE.LineBasicMaterial({ color: '#ffffff' }));
  edges.position.y = 1;
  g.add(solid, flat, edges);
  g.visible = false;
  return {
    group: g,
    set(kind, ok, removing) {
      solid.visible = edges.visible = kind === 'solid';
      flat.visible = kind !== 'solid';
      mat.color.set(removing ? '#ffae3d' : ok ? '#5be36b' : '#ff5a5a');
    },
  };
}
