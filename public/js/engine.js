import * as THREE from 'three';
import * as R from '/shared/rules.js';
import { World } from './world.js';
import { Stickman } from './stickman.js';

export class Engine {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#bfe9ff');
    scene.fog = new THREE.Fog('#cdeeff', 130, 430);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

    const hemi = new THREE.HemisphereLight('#ffffff', '#a8d98a', 1.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -48;
    sc.right = sc.top = 48;
    sc.near = 1;
    sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.followSun(new THREE.Vector3(0, 0, 0));

    this.world = new World(scene);
    this.mode = null; // the active Game, or null for the menu fly-over
    this.menuTime = 0;
    this.makeDemoCrowd();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 75 : 60;
    this.camera.updateProjectionMatrix();
  }

  followSun(pos) {
    this.sun.position.set(pos.x + 45, 80, pos.z + 30);
    this.sun.target.position.set(pos.x, 0, pos.z);
    this.sun.target.updateMatrixWorld();
  }

  // A handful of stickmen running around for the menu background.
  makeDemoCrowd() {
    this.crowd = [];
    for (let n = 0; n < 8; n++) {
      const s = new Stickman({ color: n % R.COLORS.length, hat: n % R.HATS.length });
      s.setMode(n % 2 ? 'raid' : 'defend');
      this.scene.add(s.group);
      this.crowd.push({ s, a: (n / 8) * Math.PI * 2, r: R.POND_RADIUS + 5.5 + (n % 3) * 0.8, sp: 0.22 + (n % 3) * 0.04, jump: n * 0.7 });
    }
  }
  setCrowdVisible(v) {
    for (const c of this.crowd) c.s.group.visible = v;
  }

  menuUpdate(dt) {
    this.menuTime += dt;
    const t = this.menuTime;
    const a = t * 0.05;
    this.camera.position.set(Math.sin(a) * 58, 26, Math.cos(a) * 58);
    this.camera.lookAt(Math.sin(a + 0.6) * 10, 2, Math.cos(a + 0.6) * 10);
    this.followSun(new THREE.Vector3(Math.sin(a) * 30, 0, Math.cos(a) * 30));
    for (const c of this.crowd) {
      c.a += c.sp * dt;
      const x = Math.sin(c.a) * c.r, z = Math.cos(c.a) * c.r;
      const y = Math.max(0, Math.sin(t * 2.5 + c.jump) * 2.2 - 1.2);
      c.s.group.position.set(x, y, z);
      c.s.group.rotation.y = c.a + Math.PI / 2;
      if (c.s.mode === 'defend' && Math.random() < dt * 0.4) c.s.swing();
      c.s.update(dt, { speed: c.sp * c.r, air: y > 0.05, time: t });
    }
    this.world.update(dt, -1);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    try {
      if (this.mode) this.mode.update(dt);
      else this.menuUpdate(dt);
    } catch (e) {
      console.error(e);
    }
    this.world.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
