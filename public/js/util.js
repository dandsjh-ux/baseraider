import * as THREE from 'three';
import { CATEGORIES } from '/shared/words.js';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return '#' + c.getHexString();
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FONT = '"Lilita One", "Nunito", "Arial Rounded MT Bold", sans-serif';

// A word card: rounded card in the category colour with the word on it.
const cardCache = new Map();
export function wordCardTexture(text, cat) {
  const key = text + '|' + cat;
  if (cardCache.has(key)) return cardCache.get(key);
  const c = CATEGORIES[cat];
  const W = 512, H = 200;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  roundRect(g, 8, 14, W - 16, H - 22, 34);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fill();
  roundRect(g, 8, 6, W - 16, H - 22, 34);
  g.fillStyle = '#ffffff';
  g.fill();
  roundRect(g, 18, 16, W - 36, H - 42, 26);
  g.fillStyle = c.color;
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 84;
  g.font = `${size}px ${FONT}`;
  while (g.measureText(text).width > W - 70 && size > 30) {
    size -= 4;
    g.font = `${size}px ${FONT}`;
  }
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.strokeText(text, W / 2, 86);
  g.fillText(text, W / 2, 86);
  g.font = `30px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText(`${c.icon} ${c.name}`, W / 2, 148);
  const tex = canvasTexture(cv);
  cardCache.set(key, tex);
  return tex;
}

export function makeWordSprite(text, cat, scale = 1) {
  const mat = new THREE.SpriteMaterial({ map: wordCardTexture(text, cat), depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(2.2 * scale, 0.86 * scale, 1);
  return s;
}

// Name tag with an optional health bar; redraw() when hp changes.
export class NameTag {
  constructor(name, color) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256; this.canvas.height = 80;
    this.ctx = this.canvas.getContext('2d');
    this.tex = canvasTexture(this.canvas);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, depthTest: false, transparent: true }));
    this.sprite.scale.set(2.2, 0.69, 1);
    this.sprite.renderOrder = 10;
    this.name = name; this.color = color; this.hp = 100;
    this.redraw();
  }
  set(hp) {
    hp = Math.round(hp);
    if (hp === this.hp) return;
    this.hp = hp;
    this.redraw();
  }
  redraw() {
    const g = this.ctx, W = 256;
    g.clearRect(0, 0, W, 80);
    g.font = `34px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.min(W - 8, g.measureText(this.name).width + 30);
    roundRect(g, (W - w) / 2, 4, w, 42, 20);
    g.fillStyle = 'rgba(20,30,50,0.6)';
    g.fill();
    g.fillStyle = this.color;
    g.fillText(this.name, W / 2, 27);
    if (this.hp < 100) {
      roundRect(g, 48, 54, 160, 18, 9);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fill();
      const f = Math.max(0, this.hp) / 100;
      if (f > 0) {
        roundRect(g, 51, 57, 154 * f, 12, 6);
        g.fillStyle = f > 0.5 ? '#5be36b' : f > 0.25 ? '#ffd23f' : '#ff4d4d';
        g.fill();
      }
    }
    this.tex.needsUpdate = true;
  }
}

// Simple text sprite (used for signs and floating numbers).
const textCache = new Map();
export function textTexture(text, { color = '#fff', bg = null, size = 64, stroke = 'rgba(0,0,0,0.5)', w = 512, h = 128 } = {}) {
  const key = [text, color, bg, size, w, h].join('|');
  if (textCache.has(key)) return textCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (bg) {
    roundRect(g, 4, 4, w - 8, h - 8, 24);
    g.fillStyle = bg;
    g.fill();
  }
  g.font = `${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let s = size;
  while (g.measureText(text).width > w - 30 && s > 16) {
    s -= 4;
    g.font = `${s}px ${FONT}`;
  }
  if (stroke) {
    g.lineWidth = s / 6;
    g.strokeStyle = stroke;
    g.strokeText(text, w / 2, h / 2 + 2);
  }
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = canvasTexture(cv);
  textCache.set(key, tex);
  return tex;
}

// Wooden crate texture shared by all blocks.
let crateTex = null;
export function crateTexture() {
  if (crateTex) return crateTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#c98a4b';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b97a3e';
  for (let y = 0; y < 128; y += 21) g.fillRect(0, y, 128, 3);
  g.strokeStyle = '#8a5428';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 114, 114);
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(10, 10); g.lineTo(118, 118);
  g.stroke();
  g.fillStyle = '#6e4220';
  for (const [x, y] of [[14, 14], [114, 14], [14, 114], [114, 114]]) {
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
  }
  crateTex = canvasTexture(cv);
  return crateTex;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleDamp(a, b, lambda, dt) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
export function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
