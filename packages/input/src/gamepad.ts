export const MAX_PADS = 4;
const MAX_BUTTONS = 20;
const MAX_AXES = 8;

/**
 * Standard-mapping gamepad poller. Values are copied into preallocated typed arrays each poll,
 * so reads never allocate. (navigator.getGamepads() itself returns a fresh array in browsers.)
 */
export class Gamepads {
  readonly connected = new Uint8Array(MAX_PADS);
  readonly buttons = new Float32Array(MAX_PADS * MAX_BUTTONS);
  readonly axes = new Float32Array(MAX_PADS * MAX_AXES);
  /** Deadzone-processed sticks: [pad*4 + (left x,y,right x,y)]. */
  readonly sticks = new Float32Array(MAX_PADS * 4);
  onConnect: ((index: number, id: string) => void) | null = null;
  onDisconnect: ((index: number, id: string) => void) | null = null;
  readonly detach: () => void;

  constructor(
    target: EventTarget,
    private readonly getPads: () => ArrayLike<Gamepad | null>,
    public deadzone: number,
  ) {
    const c = (e: Event): void => {
      const g = (e as GamepadEvent).gamepad;
      if (g.index < MAX_PADS) this.onConnect?.(g.index, g.id);
    };
    const d = (e: Event): void => {
      const g = (e as GamepadEvent).gamepad;
      if (g.index < MAX_PADS) {
        this.clearPad(g.index);
        this.onDisconnect?.(g.index, g.id);
      }
    };
    target.addEventListener('gamepadconnected', c);
    target.addEventListener('gamepaddisconnected', d);
    this.detach = () => {
      target.removeEventListener('gamepadconnected', c);
      target.removeEventListener('gamepaddisconnected', d);
    };
  }

  private clearPad(i: number): void {
    this.connected[i] = 0;
    this.buttons.fill(0, i * MAX_BUTTONS, (i + 1) * MAX_BUTTONS);
    this.axes.fill(0, i * MAX_AXES, (i + 1) * MAX_AXES);
    this.sticks.fill(0, i * 4, i * 4 + 4);
  }

  poll(): void {
    const pads = this.getPads();
    for (let i = 0; i < MAX_PADS; i++) {
      const p = pads[i];
      if (!p || !p.connected) {
        if (this.connected[i]) this.clearPad(i);
        continue;
      }
      this.connected[i] = 1;
      const bn = Math.min(p.buttons.length, MAX_BUTTONS);
      for (let b = 0; b < bn; b++) {
        const btn = p.buttons[b] as GamepadButton;
        this.buttons[i * MAX_BUTTONS + b] = btn.value > 0 ? btn.value : btn.pressed ? 1 : 0;
      }
      const an = Math.min(p.axes.length, MAX_AXES);
      for (let a = 0; a < an; a++) this.axes[i * MAX_AXES + a] = p.axes[a] as number;
      this.radial(i, 0, i * 4);
      this.radial(i, 2, i * 4 + 2);
    }
  }

  /** Radial deadzone with rescale so output ramps from 0 at the edge of the deadzone. */
  private radial(pad: number, axis: number, out: number): void {
    const x = this.axes[pad * MAX_AXES + axis] as number;
    const y = this.axes[pad * MAX_AXES + axis + 1] as number;
    const m = Math.sqrt(x * x + y * y);
    if (m <= this.deadzone) { this.sticks[out] = 0; this.sticks[out + 1] = 0; return; }
    const s = Math.min(1, (m - this.deadzone) / (1 - this.deadzone)) / m;
    this.sticks[out] = x * s;
    this.sticks[out + 1] = y * s;
  }

  button(pad: number, index: number): number {
    return pad < MAX_PADS && index < MAX_BUTTONS ? (this.buttons[pad * MAX_BUTTONS + index] as number) : 0;
  }

  /** Single axis with deadzone applied. */
  axis(pad: number, index: number): number {
    if (pad >= MAX_PADS || index >= MAX_AXES) return 0;
    const v = this.axes[pad * MAX_AXES + index] as number;
    const a = Math.abs(v);
    if (a <= this.deadzone) return 0;
    return Math.sign(v) * Math.min(1, (a - this.deadzone) / (1 - this.deadzone));
  }

  stick(pad: number, which: 'left' | 'right'): number {
    return pad * 4 + (which === 'left' ? 0 : 2);
  }
}
