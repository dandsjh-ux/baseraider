// Tiny synthesised sound effects (no audio files needed).
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('br_muted') === '1'; } catch {}

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.35;
  master.connect(ctx.destination);
}
export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('br_muted', muted ? '1' : '0'); } catch {}
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

function tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur, { vol = 0.4, freq = 1200, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  whoosh: () => noise(0.18, { vol: 0.25, freq: 900 }),
  bonk: () => { tone(220, 0.15, { type: 'square', vol: 0.3, slide: -120 }); noise(0.08, { vol: 0.5, freq: 400 }); },
  hurt: () => tone(400, 0.2, { type: 'triangle', vol: 0.4, slide: -250 }),
  pickup: () => { tone(660, 0.1, { type: 'triangle' }); tone(880, 0.1, { type: 'triangle', delay: 0.08 }); tone(1320, 0.15, { type: 'triangle', delay: 0.16 }); },
  bank: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.4, delay: i * 0.07 })); },
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.15 }); tone(1319, 0.2, { type: 'square', vol: 0.15, delay: 0.07 }); },
  place: () => tone(180, 0.12, { type: 'triangle', vol: 0.5, slide: -60 }),
  remove: () => tone(300, 0.1, { type: 'triangle', vol: 0.4, slide: 200 }),
  error: () => tone(160, 0.18, { type: 'sawtooth', vol: 0.15 }),
  shoot: () => { noise(0.1, { vol: 0.3, freq: 2000 }); tone(500, 0.1, { type: 'sine', vol: 0.2, slide: -200 }); },
  splat: () => noise(0.15, { vol: 0.35, freq: 3000 }),
  freeze: () => { tone(1500, 0.3, { type: 'sine', vol: 0.2, slide: 800 }); tone(2200, 0.3, { type: 'sine', vol: 0.12, delay: 0.05 }); },
  boing: () => tone(150, 0.35, { type: 'sine', vol: 0.5, slide: 600 }),
  spike: () => { noise(0.08, { vol: 0.4, freq: 5000 }); tone(700, 0.1, { type: 'square', vol: 0.15 }); },
  ko: () => { tone(500, 0.5, { type: 'triangle', vol: 0.4, slide: -420 }); },
  tick: () => tone(1000, 0.05, { type: 'square', vol: 0.12 }),
  horn: () => { tone(392, 0.25, { type: 'sawtooth', vol: 0.15 }); tone(523, 0.45, { type: 'sawtooth', vol: 0.15, delay: 0.22 }); },
  alarm: () => { tone(880, 0.12, { type: 'square', vol: 0.12 }); tone(660, 0.12, { type: 'square', vol: 0.12, delay: 0.13 }); },
  click: () => tone(700, 0.05, { type: 'triangle', vol: 0.3 }),
  win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.4, delay: i * 0.12 })); },
};
