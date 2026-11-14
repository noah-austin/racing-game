import { HALF_WIDTH, RUNOFF, Track, TrackPos } from './track';

export interface Controls {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, positive = right
  analog: boolean; // wheel / stick rather than keys
}

const G = 9.81;
const MU = 1.6; // tyre grip on tarmac
const AERO = 1.2e-4; // downforce: grip multiplier grows with v^2
const POWER = 290; // W per kg
const TRACTION = 9.5; // m/s^2 launch limit
const DRAG = 6.6e-4;
const ROLL = 0.3;
const BRAKE_MAX = 24;
const K_LOCK = 0.18; // curvature at full steering lock (1/m)
const GRASS_GRIP = 0.6;
const CAR_HALF_WIDTH = 0.9;
const GEAR_TOPS = [19, 31, 43, 55, 67, 82];

export class Car {
  x = 0;
  z = 0;
  heading = 0; // forward = (sin h, cos h)
  v = 0; // signed speed along heading, m/s
  steer = 0; // smoothed steering actually applied
  slip = 0; // how far past the grip limit the driver is asking, 0 = none
  onGrass = false;
  wallHit = 0; // impact strength this step, for feedback
  pos: TrackPos;

  lap = 0;
  lapTime = 0;
  lastLap = 0;
  bestLap = 0;
  private nextSector = 1;

  constructor(private track: Track) {
    this.pos = track.locate(0, 0, 0);
    this.reset(0);
  }

  reset(idx: number) {
    const t = this.track;
    this.x = t.x[idx];
    this.z = t.z[idx];
    this.heading = Math.atan2(t.tx[idx], t.tz[idx]);
    this.v = 0;
    this.steer = 0;
    this.pos = t.locate(this.x, this.z, idx);
  }

  grip() {
    return MU * G * (1 + AERO * this.v * this.v) * (this.onGrass ? GRASS_GRIP : 1);
  }

  /** Curvature commanded by full steering lock at the current speed. */
  lockCurvature(analog: boolean) {
    const v2 = Math.max(this.v * this.v, 1);
    // Keys can't be modulated, so full lock sits right on the grip limit.
    // Analog input can ask for more than the tyres have, and gets scrub.
    return Math.min(K_LOCK, ((analog ? 1.25 : 1.0) * this.grip()) / v2);
  }

  get gear() {
    if (this.v < -0.1) return 0;
    const g = GEAR_TOPS.findIndex((top) => this.v < top);
    return g < 0 ? GEAR_TOPS.length : g + 1;
  }

  get rpm() {
    const g = this.gear;
    if (g === 0) return 0.3;
    return 0.3 + 0.7 * Math.min(1, Math.abs(this.v) / GEAR_TOPS[g - 1]);
  }

  step(dt: number, c: Controls) {
    const t = this.track;
    this.onGrass = Math.abs(this.pos.lat) > HALF_WIDTH + 1;
    const grip = this.grip();

    // --- steering -----------------------------------------------------------
    const rate = c.analog ? 12 : Math.abs(c.steer) > Math.abs(this.steer) ? 3.5 : 6;
    const ds = c.steer - this.steer;
    this.steer += Math.sign(ds) * Math.min(Math.abs(ds), rate * dt);

    const brakeDecel = c.brake * Math.min(BRAKE_MAX, grip);
    const brakeFrac = this.v > 0.3 ? brakeDecel / grip : 0;
    // Friction circle: braking eats into cornering grip, so trail-braking
    // too deep makes the car push wide.
    const latGrip = grip * Math.sqrt(1 - Math.pow(0.8 * brakeFrac, 2));
    const v2 = Math.max(this.v * this.v, 1);
    const kLimit = latGrip / v2;
    const kCmd = this.steer * this.lockCurvature(c.analog);
    const k = Math.max(-kLimit, Math.min(kLimit, kCmd));
    this.slip = Math.abs(this.v) > 5 ? Math.max(0, Math.abs(kCmd) - kLimit) / kLimit : 0;
    this.heading -= k * this.v * dt;

    // --- longitudinal -------------------------------------------------------
    if (this.v > 0.3 || c.throttle > 0.05) {
      const surf = this.onGrass ? GRASS_GRIP : 1;
      let acc = c.throttle * Math.min(TRACTION * surf, POWER / Math.max(this.v, 5));
      if (this.v < 0) acc += 6; // throttle while rolling backwards
      acc -= DRAG * this.v * Math.abs(this.v) + (this.v > 0 ? ROLL : 0);
      if (c.throttle < 0.05 && this.v > 0) acc -= 1.2; // engine braking
      if (this.onGrass && this.v > 0) acc -= 2 + 0.07 * this.v;
      if (this.v > 0) acc -= brakeDecel + Math.min(6, 5 * this.slip);
      const nv = this.v + acc * dt;
      this.v = this.v > 0 && nv < 0 ? 0 : nv;
    } else if (c.brake > 0.1) {
      this.v = Math.max(-8, this.v - 5 * c.brake * dt); // reverse
    } else {
      this.v = Math.min(0, this.v + 4 * dt); // coast to a stop from reverse
      if (this.v > -0.05) this.v = 0;
    }

    this.x += Math.sin(this.heading) * this.v * dt;
    this.z += Math.cos(this.heading) * this.v * dt;
    const prevIdx = this.pos.idx;
    this.pos = t.locate(this.x, this.z, prevIdx);

    // --- walls: scrub speed and straighten the car, never end the race -------
    this.wallHit = 0;
    const limit = HALF_WIDTH + RUNOFF - CAR_HALF_WIDTH;
    const p = this.pos;
    if (Math.abs(p.lat) > limit) {
      const side = Math.sign(p.lat);
      const over = Math.abs(p.lat) - limit;
      this.x -= side * p.tz * over;
      this.z += side * p.tx * over;
      const dir = Math.sign(this.v) || 1;
      const fx = Math.sin(this.heading) * dir;
      const fz = Math.cos(this.heading) * dir;
      const into = (fx * p.tz - fz * p.tx) * side; // velocity component into the wall
      if (into > 0) {
        this.wallHit = into * Math.abs(this.v);
        this.v *= 1 - 0.6 * Math.min(1, into * 1.5);
        const along = fx * p.tx + fz * p.tz >= 0 ? 1 : -1;
        let target = Math.atan2(p.tx * along, p.tz * along);
        if (dir < 0) target += Math.PI;
        let d = target - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * 0.5;
      }
      this.pos = t.locate(this.x, this.z, p.idx);
    }

    // --- lap timing: three sectors must be crossed in order ------------------
    this.lapTime += dt;
    const sector = Math.floor((this.pos.idx / t.n) * 3);
    if (sector === this.nextSector) {
      if (sector === 0) {
        this.lastLap = this.lapTime;
        if (!this.bestLap || this.lapTime < this.bestLap) this.bestLap = this.lapTime;
        this.lapTime = 0;
        this.lap++;
      }
      this.nextSector = (this.nextSector + 1) % 3;
    }
  }
}

/**
 * Simple centreline-following driver. Used to sanity-check the handling and
 * as the seed for AI opponents.
 */
export function autopilot(car: Car, track: Track): Controls {
  const look = 8 + 0.3 * Math.abs(car.v);
  const ti = track.wrap(car.pos.idx + Math.round(look / track.ds));
  const dx = track.x[ti] - car.x;
  const dz = track.z[ti] - car.z;
  const right = -dx * Math.cos(car.heading) + dz * Math.sin(car.heading);
  const kWant = (2 * right) / (dx * dx + dz * dz);
  const steer = Math.max(-1, Math.min(1, kWant / car.lockCurvature(false)));

  let brake = 0;
  let throttle = 1;
  for (let d = 0; d < 260; d += 4) {
    const i = track.wrap(car.pos.idx + Math.round(d / track.ds));
    const k = Math.abs(track.kappa[i]);
    const denom = k - 0.88 * MU * G * AERO;
    if (denom <= 0) continue;
    const vMax2 = (0.88 * MU * G) / denom;
    if (car.v * car.v > vMax2 + 2 * 13 * d) brake = 1;
    else if (car.v * car.v > vMax2 + 2 * 13 * d - 40) throttle = 0;
  }
  if (brake) throttle = 0;
  return { throttle, brake, steer, analog: false };
}
