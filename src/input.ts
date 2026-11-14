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
  return {
    steer: (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0),
    throttle: down('ArrowUp', 'KeyW') ? 1 : 0,
    brake: down('ArrowDown', 'KeyS', 'Space') ? 1 : 0,
    analog: false,
  };
}
