import * as THREE from 'three';

// Track data only (no meshes) so the simulation can run without a renderer.

export const HALF_WIDTH = 6.5; // metres of tarmac either side of the centreline
export const RUNOFF = 9; // grass between tarmac edge and the wall

const CONTROL_POINTS: [number, number][] = [
  [0, 0], [200, 0], [400, 0], [520, 30], [580, 120], [540, 220], [440, 260],
  [380, 340], [420, 440], [380, 540], [260, 560], [180, 480], [100, 440],
  [-20, 480], [-140, 460], [-200, 360], [-160, 260], [-220, 160], [-200, 60],
  [-120, 0],
];

export interface TrackPos {
  idx: number; // nearest sample index
  lat: number; // lateral offset from centreline, positive = left
  tx: number; // unit tangent
  tz: number;
}

export interface Corner {
  startIdx: number;
  dir: number; // +1 = right-hander, -1 = left-hander
}

export class Track {
  readonly n: number;
  readonly ds: number;
  readonly length: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Signed curvature (1/m), positive = turning right. */
  readonly kappa: Float32Array;
  readonly corners: Corner[] = [];

  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    this.n = Math.round(this.length / 2);
    this.ds = this.length / this.n;
    const pts = curve.getSpacedPoints(this.n);
    const n = this.n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i].x;
      this.z[i] = pts[i].z;
    }
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const b = (i + 1) % n;
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz);
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const b = (i + 1) % n;
      // Heading is atan2(tx, tz); it decreases when turning right.
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      raw[i] = -Math.asin(Math.max(-1, Math.min(1, cross))) / (2 * this.ds);
    }
    const W = 3;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += raw[(i + k + n) % n];
      this.kappa[i] = s / (2 * W + 1);
    }
    this.findCorners();
  }

  private findCorners() {
    const n = this.n;
    let inCorner = Math.abs(this.kappa[0]) > 1 / 250;
    let straightM = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.kappa[i]);
      if (inCorner) {
        if (k < 1 / 250) {
          inCorner = false;
          straightM = 0;
        }
      } else {
        straightM += this.ds;
        if (k > 1 / 90) {
          if (straightM > 70) this.corners.push({ startIdx: i, dir: Math.sign(this.kappa[i]) });
          inCorner = true;
        }
      }
    }
  }

  wrap(i: number) {
    return ((i % this.n) + this.n) % this.n;
  }

  /** Locate a world position on the track, searching near a previous index. */
  locate(px: number, pz: number, hint: number, range = 30): TrackPos {
    let best = hint;
    let bestD = Infinity;
    for (let k = -range; k <= range; k++) {
      const i = this.wrap(hint + k);
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const tx = this.tx[best];
    const tz = this.tz[best];
    // Left normal of the tangent is (tz, -tx).
    const lat = (px - this.x[best]) * tz - (pz - this.z[best]) * tx;
    return { idx: best, lat, tx, tz };
  }

  /** Slow global search, for scenery placement. */
  distanceToCentre(px: number, pz: number) {
    let bestD = Infinity;
    for (let i = 0; i < this.n; i += 3) {
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
  }
}
