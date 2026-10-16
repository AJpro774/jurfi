// TODO(Input): local stub. Replace with the real input package once its API is final.
// Mirrors the agreed surface: input.action('jump').pressed, input.axis2('move'), input.setContext('ui').
export interface Axis2 { x: number; y: number }
export interface ActionState { readonly pressed: boolean }
export type InputContext = 'game' | 'ui';

const BINDINGS: Record<string, string[]> = { jump: ['Space', 'Enter'] };
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] };

export class InputStub {
  private down = new Set<string>();
  private justPressed = new Set<string>();
  private context: InputContext = 'game';
  /** Touch drag: target in 0..1 of canvas height, or null. */
  touchY: number | null = null;
  private tapped = false;

  constructor(target: HTMLElement, private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    const touch = (e: PointerEvent): void => {
      const r = this.canvas.getBoundingClientRect();
      this.touchY = (e.clientY - r.top) / r.height;
    };
    target.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; this.tapped = true; touch(e); });
    target.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && this.touchY !== null) touch(e); });
    const end = (): void => { this.touchY = null; };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  setContext(c: InputContext): void { this.context = c; }
  getContext(): InputContext { return this.context; }

  action(name: string): ActionState {
    const keys = BINDINGS[name] ?? [];
    const pressed = keys.some((k) => this.justPressed.has(k)) || (name === 'jump' && this.tapped);
    return { pressed };
  }

  axis2(name: string): Axis2 {
    if (name !== 'move' || this.context !== 'game') return { x: 0, y: 0 };
    const any = (ks: string[]): boolean => ks.some((k) => this.down.has(k));
    return {
      x: Number(any(MOVE_KEYS.right)) - Number(any(MOVE_KEYS.left)),
      y: Number(any(MOVE_KEYS.down)) - Number(any(MOVE_KEYS.up)),
    };
  }

  /** Call once at end of each fixed step. */
  endFrame(): void { this.justPressed.clear(); this.tapped = false; }
}
