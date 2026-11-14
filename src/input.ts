import { Controls } from './car';

const keys = new Set<string>();
export let resetRequested = false;
export let muteToggled = false;

export function clearRequests() {
  resetRequested = false;
  muteToggled = false;
}

window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyR') resetRequested = true;
  if (e.code === 'KeyM') muteToggled = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// --- touch: drag on the left half to steer, pedal buttons on the right ----------
const STEER_TRAVEL = 70; // px of thumb travel for full lock
let steerTouch: { id: number; x0: number } | null = null;
let touchSteer = 0;
let gasId = -1;
let brakeId = -1;

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  document.body.classList.add('touch');
  const id = (e.target as HTMLElement).id;
  if (id === 'tgas') gasId = e.pointerId;
  else if (id === 'tbrake') brakeId = e.pointerId;
  else if (e.clientX < innerWidth / 2 && !steerTouch) steerTouch = { id: e.pointerId, x0: e.clientX };
});
window.addEventListener('pointermove', (e) => {
  if (steerTouch?.id !== e.pointerId) return;
  touchSteer = Math.max(-1, Math.min(1, (e.clientX - steerTouch.x0) / STEER_TRAVEL));
});
function release(e: PointerEvent) {
  if (e.pointerId === gasId) gasId = -1;
  if (e.pointerId === brakeId) brakeId = -1;
  if (steerTouch?.id === e.pointerId) {
    steerTouch = null;
    touchSteer = 0;
  }
}
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);

const down = (...codes: string[]) => codes.some((c) => keys.has(c));

export function readControls(): Controls {
  // Gamepad: left stick steers, triggers are the pedals.
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad || pad.mapping !== 'standard') continue;
    const raw = pad.axes[0] ?? 0;
    const dead = 0.08;
    const steer = Math.abs(raw) < dead ? 0 : (raw - Math.sign(raw) * dead) / (1 - dead);
    const throttle = pad.buttons[7]?.value ?? 0;
    const brake = pad.buttons[6]?.value ?? 0;
    if (Math.abs(steer) > 0 || throttle > 0.02 || brake > 0.02) {
      return { steer, throttle, brake, analog: true };
    }
  }
  if (steerTouch || gasId >= 0 || brakeId >= 0) {
    return { steer: touchSteer, throttle: gasId >= 0 ? 1 : 0, brake: brakeId >= 0 ? 1 : 0, analog: true };
  }
  return {
    steer: (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0),
    throttle: down('ArrowUp', 'KeyW') ? 1 : 0,
    brake: down('ArrowDown', 'KeyS', 'Space') ? 1 : 0,
    analog: false,
  };
}
