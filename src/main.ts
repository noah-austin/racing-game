import * as THREE from 'three';
import { Car, Controls, autopilot } from './car';
import { Track } from './track';
import { EYE_HEIGHT, buildCockpit, buildWorld } from './scene';
import { clearRequests, muteToggled, readControls, resetRequested } from './input';
import { EngineSound } from './audio';

const DT = 1 / 120;
const auto = new URLSearchParams(location.search).has('auto');

const track = new Track();
const car = new Car(track);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
buildWorld(scene, track);
const cockpit = buildCockpit();
scene.add(cockpit.car);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  cockpit.camera.aspect = innerWidth / innerHeight;
  cockpit.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const sound = new EngineSound();
const overlay = document.getElementById('start')!;
let started = auto;
if (auto) overlay.remove();
function begin() {
  if (started) return;
  started = true;
  overlay.remove();
  sound.start();
  car.lapTime = 0;
}
addEventListener('keydown', begin);
addEventListener('pointerdown', begin);

// --- HUD ---------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const fmt = (s: number) => {
  if (!s) return '--:--.---';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
const map = $('map') as HTMLCanvasElement;
const mctx = map.getContext('2d')!;
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < track.n; i++) {
  minX = Math.min(minX, track.x[i]);
  maxX = Math.max(maxX, track.x[i]);
  minZ = Math.min(minZ, track.z[i]);
  maxZ = Math.max(maxZ, track.z[i]);
}
const mScale = (map.width - 20) / Math.max(maxX - minX, maxZ - minZ);
// Flip x so the map matches what the driver sees (left is left).
const mx = (x: number) => map.width - 10 - (x - minX) * mScale;
const mz = (z: number) => 10 + (z - minZ) * mScale;

function drawHud(c: Controls) {
  $('speed').textContent = String(Math.round(Math.abs(car.v) * 3.6));
  $('gear').textContent = car.gear === 0 ? 'R' : String(car.gear);
  $('lap').textContent = String(car.lap + 1);
  $('time').textContent = fmt(car.lapTime);
  $('last').textContent = fmt(car.lastLap);
  $('best').textContent = fmt(car.bestLap);
  $('thr').style.height = `${c.throttle * 100}%`;
  $('brk').style.height = `${c.brake * 100}%`;
  $('grip').style.opacity = car.slip > 0.05 || car.onGrass ? '1' : '0';
  $('grip').textContent = car.onGrass ? 'OFF TRACK' : 'SLIDING';

  mctx.clearRect(0, 0, map.width, map.height);
  mctx.beginPath();
  for (let i = 0; i < track.n; i += 2) mctx.lineTo(mx(track.x[i]), mz(track.z[i]));
  mctx.closePath();
  mctx.strokeStyle = 'rgba(255,255,255,0.85)';
  mctx.lineWidth = 3;
  mctx.stroke();
  mctx.fillStyle = '#ff3b3b';
  mctx.beginPath();
  mctx.arc(mx(car.x), mz(car.z), 4.5, 0, Math.PI * 2);
  mctx.fill();
}

// --- main loop ---------------------------------------------------------------
let controls: Controls = { throttle: 0, brake: 0, steer: 0, analog: false };
let shake = 0;
let lookYaw = 0;

function physics() {
  controls = auto ? autopilot(car, track) : readControls();
  if (resetRequested) car.reset(car.pos.idx);
  if (muteToggled) sound.muted = !sound.muted;
  clearRequests();
  car.step(DT, controls);
  shake = Math.max(shake * 0.9, Math.min(1, car.wallHit / 15));
}

let last = performance.now();
let acc = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) {
    if (started) physics();
    acc -= DT;
  }

  cockpit.car.position.set(car.x, 0, car.z);
  cockpit.car.rotation.y = car.heading;
  cockpit.wheel.rotation.z = car.steer * 1.7;
  // Glance into the corner, plus rumble off-track and on impacts.
  lookYaw += (-car.steer * 0.14 - lookYaw) * 0.08;
  const rumble = (car.onGrass ? Math.min(1, Math.abs(car.v) / 30) * 0.012 : 0) + shake * 0.04;
  cockpit.camera.rotation.y = Math.PI + lookYaw;
  cockpit.camera.rotation.x = (Math.random() - 0.5) * rumble;
  cockpit.camera.position.y = EYE_HEIGHT + (Math.random() - 0.5) * rumble;
  cockpit.camera.fov = 72 + Math.min(10, Math.abs(car.v) * 0.12);
  cockpit.camera.updateProjectionMatrix();

  sound.update(car.rpm, controls.throttle);
  drawHud(controls);
  renderer.render(scene, cockpit.camera);
}
requestAnimationFrame(frame);

// Debug/testing hook: run the simulation headlessly at full speed.
(window as any).__game = {
  car,
  track,
  simulate(seconds: number, driver: 'auto' | Controls = 'auto') {
    for (let i = 0; i < seconds / DT; i++) {
      car.step(DT, driver === 'auto' ? autopilot(car, track) : driver);
    }
    return { lap: car.lap, last: car.lastLap, best: car.bestLap, v: car.v, idx: car.pos.idx };
  },
};
