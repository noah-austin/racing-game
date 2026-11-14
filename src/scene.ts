import * as THREE from 'three';
import { HALF_WIDTH, RUNOFF, Track } from './track';

/** Build a strip that follows the track between two lateral offsets. */
function ribbon(
  track: Track,
  offA: number,
  offB: number,
  yA: number,
  yB: number,
  include?: (i: number) => boolean,
  color?: (i: number) => THREE.Color,
) {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const n = track.n;
  const at = (i: number, off: number, y: number) => [
    track.x[i] + track.tz[i] * off,
    y,
    track.z[i] - track.tx[i] * off,
  ];
  for (let i = 0; i < n; i++) {
    if (include && !include(i)) continue;
    const j = (i + 1) % n;
    const a0 = at(i, offA, yA);
    const b0 = at(i, offB, yB);
    const a1 = at(j, offA, yA);
    const b1 = at(j, offB, yB);
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    const v0 = (i * track.ds) / 8;
    const v1 = v0 + track.ds / 8;
    const uB = Math.abs(offB - offA) / 8;
    uv.push(0, v0, uB, v0, 0, v1, uB, v0, uB, v1, 0, v1);
    if (color) {
      const c = color(i);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The world is flat, so ground surfaces are drawn in a fixed order without
 * writing depth. That rules out z-fighting between grass, tarmac and paint.
 */
function layer(mesh: THREE.Mesh, order: number) {
  mesh.renderOrder = -10 + order;
  (mesh.material as THREE.Material).depthWrite = false;
  return mesh;
}

function noiseTexture(base: number, spread: number, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function boardTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene: THREE.Scene, track: Track) {
  scene.background = new THREE.Color(0x8fc4ea);
  scene.fog = new THREE.Fog(0xa9d0ec, 250, 1400);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a6a3a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const DS = THREE.DoubleSide;
  const grassTex = noiseTexture(150, 50);
  grassTex.repeat.set(500, 500);
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x4f9a3c, map: grassTex }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(180, -0.02, 280);
  layer(grass, 0);
  scene.add(grass);

  const road = new THREE.Mesh(
    ribbon(track, HALF_WIDTH, -HALF_WIDTH, 0, 0),
    new THREE.MeshLambertMaterial({ color: 0x6a6a70, map: noiseTexture(150, 70), side: DS }),
  );
  layer(road, 1);
  scene.add(road);

  const white = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: DS });
  for (const s of [1, -1]) {
    scene.add(layer(new THREE.Mesh(ribbon(track, s * HALF_WIDTH, s * (HALF_WIDTH - 0.25), 0.01, 0.01), white), 2));
  }

  // Kerbs on both sides wherever the track is turning.
  const red = new THREE.Color(0xd0222a);
  const wht = new THREE.Color(0xf0f0f0);
  const turning = (i: number) => Math.abs(track.kappa[i]) > 1 / 160;
  const stripe = (i: number) => (Math.floor(i / 2) % 2 ? red : wht);
  const kerbMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: DS });
  for (const s of [1, -1]) {
    const kerb = new THREE.Mesh(
      ribbon(track, s * HALF_WIDTH, s * (HALF_WIDTH + 1), 0.015, 0.04, turning, stripe),
      kerbMat,
    );
    scene.add(layer(kerb, 2));
  }

  // Walls.
  const wallOff = HALF_WIDTH + RUNOFF;
  const blue = new THREE.Color(0x2f5fb0);
  const wallCol = (i: number) => (Math.floor(i / 6) % 2 ? blue : wht);
  const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: DS });
  for (const s of [1, -1]) {
    scene.add(new THREE.Mesh(ribbon(track, s * wallOff, s * wallOff, 0, 1.1, undefined, wallCol), wallMat));
  }

  // Start/finish line.
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_WIDTH * 2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(track.tx[0], track.tz[0]);
  line.position.set(track.x[0], 0.012, track.z[0]);
  layer(line, 3);
  scene.add(line);

  // Braking boards on the outside of each corner approach.
  const postMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const boardGeo = new THREE.PlaneGeometry(1.6, 1.0);
  const postGeo = new THREE.BoxGeometry(0.08, 1.4, 0.08);
  const boardMats = new Map<number, THREE.Material>();
  for (const dist of [150, 100, 50]) {
    boardMats.set(dist, new THREE.MeshBasicMaterial({ map: boardTexture(String(dist)), side: DS }));
  }
  for (const corner of track.corners) {
    for (const dist of [150, 100, 50]) {
      const i = track.wrap(corner.startIdx - Math.round(dist / track.ds));
      const off = corner.dir * (HALF_WIDTH + 2.2); // right-hander: board on the left
      const x = track.x[i] + track.tz[i] * off;
      const z = track.z[i] - track.tx[i] * off;
      const board = new THREE.Mesh(boardGeo, boardMats.get(dist)!);
      board.position.set(x, 1.6, z);
      board.rotation.y = Math.atan2(track.tx[i], track.tz[i]) + Math.PI;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.7, z);
      scene.add(board, post);
    }
  }

  // Trees for a sense of speed.
  const COUNT = 1400;
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.35, 0.45, 3, 6),
    new THREE.MeshLambertMaterial({ color: 0x5b4028 }),
    COUNT,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.ConeGeometry(3, 9, 7),
    new THREE.MeshLambertMaterial({ color: 0x2f6e33 }),
    COUNT,
  );
  const m = new THREE.Matrix4();
  let placed = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  while (placed < COUNT) {
    const x = -420 + rnd() * 1200;
    const z = -200 + rnd() * 960;
    if (track.distanceToCentre(x, z) < wallOff + 5) continue;
    const s = 0.7 + rnd() * 0.9;
    m.makeScale(s, s, s).setPosition(x, 1.5 * s, z);
    trunks.setMatrixAt(placed, m);
    m.setPosition(x, 7 * s, z);
    crowns.setMatrixAt(placed, m);
    placed++;
  }
  scene.add(trunks, crowns);
}

export const EYE_HEIGHT = 1.1;

/** The player's car as seen from the driver's seat. */
export function buildCockpit() {
  const car = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xc8202a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x18181b });

  // Low, sloping hood and a shallow dash so the road fills most of the view.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.35), body);
  hood.position.set(0, 0.66, 1.8);
  hood.rotation.x = 0.2;
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.45), dark);
  dash.position.set(0, 0.82, 0.95);
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 2.4), dark);
  tub.position.set(0, 0.4, 0.2);
  car.add(hood, dash, tub);

  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 28), dark));
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), dark);
  const mark = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.05, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffd400 }),
  );
  mark.position.y = 0.15;
  wheel.add(spoke, mark);
  wheel.position.set(0, 0.84, 0.74);
  wheel.rotation.x = -0.25;
  car.add(wheel);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2500);
  camera.position.set(0, EYE_HEIGHT, 0.3);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = Math.PI;
  car.add(camera);

  return { car, wheel, camera };
}
