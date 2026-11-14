/** Minimal synthesised engine note so speed and gear are audible. */
export class EngineSound {
  private ctx?: AudioContext;
  private oscs: OscillatorNode[] = [];
  private gain?: GainNode;
  muted = false;

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    filter.connect(this.gain).connect(ctx.destination);
    for (const type of ['sawtooth', 'square'] as OscillatorType[]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.connect(filter);
      o.start();
      this.oscs.push(o);
    }
  }

  update(rpm: number, throttle: number) {
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    const f = 45 + rpm * 190;
    this.oscs[0].frequency.setTargetAtTime(f, t, 0.03);
    this.oscs[1].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.gain.gain.setTargetAtTime(this.muted ? 0 : 0.035 + 0.045 * throttle, t, 0.05);
  }
}
