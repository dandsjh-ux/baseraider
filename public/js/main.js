import * as THREE from 'three';
import * as R from '/shared/rules.js';
import { CATEGORIES } from '/shared/words.js';
import { Engine } from './engine.js';
import { Game } from './game.js';
import { Stickman } from './stickman.js';
import { initAudio, sfx } from './audio.js';
import { escapeHtml } from './util.js';

const $ = (id) => document.getElementById(id);
const HAT_EMOJI = ['🚫', '🧢', '👑', '🥳', '🧶', '🎩', '🎀', '⚔️'];
const CUTE_NAMES = ['Zippy', 'Bonk', 'Sparky', 'Noodle', 'Pickle', 'Bubbles', 'Rocket', 'Waffles', 'Pebble', 'Jellybean', 'Biscuit', 'Turbo'];

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
const engine = new Engine($('game'));
engine.world.setupDemo();
const socket = io({ transports: ['websocket', 'polling'] });

let game = null;
let currentRoom = null;
let rooms = [];
let screen = 'menu';
let editing = false;

// ---------------- profile ----------------
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('br_profile'));
    if (p && typeof p.name === 'string') return { name: p.name.slice(0, 14), look: { color: p.look?.color | 0, hat: p.look?.hat | 0 } };
  } catch {}
  return {
    name: CUTE_NAMES[Math.floor(Math.random() * CUTE_NAMES.length)] + Math.floor(Math.random() * 90 + 10),
    look: { color: Math.floor(Math.random() * 8), hat: Math.floor(Math.random() * R.HATS.length) },
  };
}
const profile = loadProfile();
function saveProfile() {
  try { localStorage.setItem('br_profile', JSON.stringify(profile)); } catch {}
  socket.emit('profile', profile);
}

// ---------------- character preview ----------------
const preview = (() => {
  const canvas = $('preview');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#a8d98a', 1.8));
  const dl = new THREE.DirectionalLight('#ffffff', 2);
  dl.position.set(3, 5, 4);
  scene.add(dl);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  cam.position.set(0, 1.9, 6.4);
  cam.lookAt(0, 1.25, 0);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.2, 32), new THREE.MeshLambertMaterial({ color: '#8fdc66' }));
  pad.position.y = -0.1;
  scene.add(pad);
  const man = new Stickman(profile.look, { shadows: false });
  scene.add(man.group);
  let t = 0;
  let last = performance.now();
  function size() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    cam.aspect = r.width / r.height;
    cam.updateProjectionMatrix();
  }
  window.addEventListener('resize', size);
  function loop() {
    requestAnimationFrame(loop);
    if (screen !== 'menu') return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    man.group.rotation.y = Math.sin(t * 0.7) * 0.7;
    if (Math.random() < dt * 0.5) man.swing();
    man.update(dt, { speed: 0, time: t });
    renderer.render(scene, cam);
  }
  size();
  loop();
  return { man, size };
})();

function renderLookPickers() {
  $('colorPicks').innerHTML = R.COLORS.map((c, n) =>
    `<button class="swatch ${profile.look.color === n ? 'sel' : ''}" style="background:${c}" data-c="${n}" title="${R.COLOR_NAMES[n]}"></button>`).join('');
  $('hatPicks').innerHTML = R.HATS.map((h, n) =>
    `<button class="hatpick ${profile.look.hat === n ? 'sel' : ''}" data-h="${n}" title="${R.HAT_LABELS[n]}">${HAT_EMOJI[n]}<span>${R.HAT_LABELS[n]}</span></button>`).join('');
  $('colorPicks').querySelectorAll('button').forEach((b) => b.onclick = () => {
    profile.look.color = +b.dataset.c;
    preview.man.setLook(profile.look);
    sfx.click();
    saveProfile();
    renderLookPickers();
  });
  $('hatPicks').querySelectorAll('button').forEach((b) => b.onclick = () => {
    profile.look.hat = +b.dataset.h;
    preview.man.setLook(profile.look);
    sfx.click();
    saveProfile();
    renderLookPickers();
  });
}
$('nameInput').value = profile.name;
$('nameInput').addEventListener('input', () => {
  profile.name = $('nameInput').value.replace(/[<>&"'`]/g, '').slice(0, 14);
  clearTimeout(saveProfile.t);
  saveProfile.t = setTimeout(saveProfile, 300);
});
$('randomBtn').onclick = () => {
  profile.look = { color: Math.floor(Math.random() * R.COLORS.length), hat: Math.floor(Math.random() * R.HATS.length) };
  profile.name = CUTE_NAMES[Math.floor(Math.random() * CUTE_NAMES.length)] + Math.floor(Math.random() * 90 + 10);
  $('nameInput').value = profile.name;
  preview.man.setLook(profile.look);
  sfx.click();
  saveProfile();
  renderLookPickers();
};
renderLookPickers();

// ---------------- screens ----------------
function show(name) {
  screen = name;
  for (const s of ['menu', 'roomScreen', 'endScreen']) $(s).classList.toggle('hidden', s !== name);
  engine.setCrowdVisible(name !== 'game');
  if (name === 'menu') {
    preview.size();
    socket.emit('listRooms');
  }
}

function menuToast(msg) {
  const el = $('menuToast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(menuToast.t);
  menuToast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ---------------- room list ----------------
function avatarDots(players) {
  return players.map((p) => `<span class="mini-av" style="background:${R.COLORS[p.look.color]}" title="${escapeHtml(p.name)}">${HAT_EMOJI[p.look.hat] === '🚫' ? '' : HAT_EMOJI[p.look.hat]}</span>`).join('');
}
function renderRooms() {
  const el = $('roomList');
  if (!rooms.length) {
    el.innerHTML = `<div class="empty">No rooms yet — create one and invite your friends! 🎉</div>`;
    return;
  }
  el.innerHTML = rooms.map((r) => {
    const full = r.count >= r.max;
    const playing = r.state !== 'lobby';
    return `<div class="room-card">
      <div class="rc-main"><div class="rc-name">${escapeHtml(r.name)}</div>
      <div class="rc-sub">Host: ${escapeHtml(r.host)} · ${avatarDots(r.players)}</div></div>
      <div class="rc-count">${r.count}/${r.max}</div>
      <button class="btn ${playing || full ? 'grey' : 'blue'}" data-id="${r.id}" ${playing || full ? 'disabled' : ''}>${playing ? 'Playing' : full ? 'Full' : 'Join'}</button>
    </div>`;
  }).join('');
  el.querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => {
    initAudio();
    sfx.click();
    socket.emit('joinRoom', { id: b.dataset.id }, (res) => {
      if (!res?.ok) menuToast(res?.msg || 'Could not join.');
    });
  });
}

// ---------------- create / edit room ----------------
function settingsForm(values) {
  $('settingsFields').innerHTML = Object.entries(R.SETTINGS).map(([k, d]) => `
    <label class="field"><span>${d.label}</span>
      <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${values[k] ?? d.def}" data-k="${k}">
      <output>${values[k] ?? d.def}</output></label>`).join('');
  $('settingsFields').querySelectorAll('input[type=range]').forEach((inp) => {
    inp.oninput = () => { inp.nextElementSibling.textContent = inp.value; };
  });
  const sel = new Set(values.categories ?? CATEGORIES.map((_, i) => i));
  $('catPicks').innerHTML = CATEGORIES.map((c, i) =>
    `<button type="button" class="cat ${sel.has(i) ? 'sel' : ''}" data-i="${i}" style="--cc:${c.color}">${c.icon} ${c.name}</button>`).join('');
  $('catPicks').querySelectorAll('.cat').forEach((b) => b.onclick = () => b.classList.toggle('sel'));
}
function readSettings() {
  const s = {};
  $('settingsFields').querySelectorAll('input[type=range]').forEach((inp) => { s[inp.dataset.k] = +inp.value; });
  s.categories = [...$('catPicks').querySelectorAll('.cat.sel')].map((b) => +b.dataset.i);
  return s;
}
function openCreate(edit = false) {
  editing = edit;
  $('createTitle').textContent = edit ? 'Room Settings' : 'Create a Room';
  $('createGo').textContent = edit ? 'Save' : 'Create Room';
  $('roomName').value = edit ? currentRoom.name : `${profile.name}'s Room`;
  settingsForm(edit ? currentRoom.settings : {});
  $('createModal').classList.remove('hidden');
}
$('createBtn').onclick = () => { initAudio(); sfx.click(); openCreate(false); };
$('createCancel').onclick = () => $('createModal').classList.add('hidden');
$('catAll').onclick = () => $('catPicks').querySelectorAll('.cat').forEach((b) => b.classList.add('sel'));
$('catNone').onclick = () => $('catPicks').querySelectorAll('.cat').forEach((b) => b.classList.remove('sel'));
$('createGo').onclick = () => {
  sfx.click();
  const settings = readSettings();
  if (!settings.categories.length) return menuToast('Pick at least one word category!');
  const name = $('roomName').value;
  $('createModal').classList.add('hidden');
  if (editing) socket.emit('updateSettings', { name, settings });
  else {
    saveProfile();
    socket.emit('createRoom', { name, settings }, (res) => { if (!res?.ok) menuToast('Could not create room.'); });
  }
};

// ---------------- room screen ----------------
function renderRoom() {
  const r = currentRoom;
  if (!r) return;
  const host = r.hostId === socket.id;
  $('roomTitle').textContent = r.name;
  $('roomPlayers').innerHTML = r.players.map((p) => `
    <div class="pcard ${p.id === socket.id ? 'me' : ''}">
      <div class="pav" style="background:${R.COLORS[p.look.color]}"><span>${HAT_EMOJI[p.look.hat] === '🚫' ? '🙂' : HAT_EMOJI[p.look.hat]}</span></div>
      <div class="pname">${escapeHtml(p.name)}${p.id === r.hostId ? ' 👑' : ''}${p.id === socket.id ? ' <small>(you)</small>' : ''}</div>
    </div>`).join('') +
    Array.from({ length: Math.max(0, r.settings.maxPlayers - r.players.length) }, () => `<div class="pcard empty"><div class="pav">?</div><div class="pname">Waiting…</div></div>`).join('');
  const s = r.settings;
  $('roomSettings').innerHTML = `
    <div>🛠️ Prep: <b>${s.prepTime}s</b></div><div>⚔️ Raid: <b>${s.raidTime}s</b></div>
    <div>🔁 Rounds: <b>${s.rounds}</b></div><div>📝 Words/house: <b>${s.wordsPerBase}</b></div>
    <div>🎒 Carry: <b>${s.carryLimit}</b></div><div>🪙 Coins: <b>${s.startCoins}</b></div>
    <div class="cats">${s.categories.map((i) => `<span class="chip" style="background:${CATEGORIES[i].color}">${CATEGORIES[i].icon} ${CATEGORIES[i].name}</span>`).join(' ')}</div>`;
  $('editSettings').classList.toggle('hidden', !host);
  $('startBtn').classList.toggle('hidden', !host);
  $('startBtn').textContent = r.players.length < 2 ? '▶ Start Practice (solo)' : '▶ Start Game!';
  $('waitHost').classList.toggle('hidden', host);
  $('closedNote').textContent = r.players.length < 6
    ? `With ${r.players.length} player${r.players.length > 1 ? 's' : ''}, ${6 - r.players.length} house${6 - r.players.length > 1 ? 's are' : ' is'} closed off.`
    : 'All 6 houses are in play!';
}
$('editSettings').onclick = () => { sfx.click(); openCreate(true); };
$('startBtn').onclick = () => {
  initAudio();
  sfx.click();
  socket.emit('startGame', {}, (res) => { if (!res?.ok) menuToast(res?.msg || 'Could not start.'); });
};
$('leaveBtn').onclick = () => {
  sfx.click();
  socket.emit('leaveRoom');
  currentRoom = null;
  show('menu');
};

// ---------------- end screen ----------------
function renderEnd(ranking) {
  const medals = ['🥇', '🥈', '🥉'];
  const top = ranking.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]);
  $('podium').innerHTML = order.map((i) => {
    const p = top[i];
    return `<div class="pod pod${i + 1}">
      <div class="pav big" style="background:${R.COLORS[p.look.color]}"><span>${HAT_EMOJI[p.look.hat] === '🚫' ? '😄' : HAT_EMOJI[p.look.hat]}</span></div>
      <div class="pod-name">${escapeHtml(p.name)}</div><div class="pod-pts">${p.points} pts</div>
      <div class="pod-block">${medals[i]}</div></div>`;
  }).join('');
  $('results').innerHTML = `<tr><th>#</th><th>Player</th><th>📝 Words</th><th>💰 Stolen</th><th>💥 KOs</th><th>Points</th></tr>` +
    ranking.map((p, n) => `<tr class="${p.id === socket.id ? 'me' : ''}"><td>${n + 1}</td><td><span class="dot" style="background:${R.COLORS[p.look.color]}"></span> ${escapeHtml(p.name)}</td>
      <td>${p.words}</td><td>${p.stolen}</td><td>${p.kos}</td><td><b>${p.points}</b></td></tr>`).join('');
  const winner = ranking[0];
  $('winnerText').textContent = winner ? (winner.id === socket.id ? '🎉 You win! 🎉' : `🏆 ${winner.name} wins!`) : 'Game over';
}
$('backToRoom').onclick = () => {
  sfx.click();
  if (currentRoom) { renderRoom(); show('roomScreen'); } else show('menu');
};
$('backToMenu').onclick = () => {
  sfx.click();
  socket.emit('leaveRoom');
  currentRoom = null;
  show('menu');
};

// ---------------- socket ----------------
socket.on('connect', () => {
  $('conn').classList.add('hidden');
  socket.emit('profile', profile);
  if (game || currentRoom) {
    // The server forgets us when we drop, so start again from the menu.
    if (game) { game.destroy(); game = null; engine.mode = null; engine.world.setupDemo(); }
    currentRoom = null;
    show('menu');
    menuToast('Reconnected — please rejoin a room.');
  }
});
socket.on('disconnect', () => $('conn').classList.remove('hidden'));
socket.on('rooms', (list) => { rooms = list; renderRooms(); });
socket.on('room', (r) => {
  currentRoom = r;
  if (screen === 'menu') show('roomScreen');
  if (screen === 'roomScreen') renderRoom();
});
socket.on('gameStart', (d) => {
  $('createModal').classList.add('hidden');
  if (game) game.destroy();
  show('game');
  game = new Game(engine, socket, d);
  engine.mode = game;
});
socket.on('gameOver', (d) => {
  if (game) { game.destroy(); game = null; }
  engine.mode = null;
  engine.world.setupDemo();
  renderEnd(d.ranking);
  show('endScreen');
  if (d.ranking[0]?.id === socket.id) sfx.win(); else sfx.horn();
});

document.addEventListener('pointerdown', () => initAudio(), { once: true });
// Handy for debugging from the browser console.
window.BR = { engine, socket, get game() { return game; } };
show('menu');
