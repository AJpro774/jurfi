/** Keyboard state keyed by KeyboardEvent.code. */
export class Keyboard {
  private readonly down = new Map<string, boolean>();
  /** Fresh (non-repeat) keydowns since the last latch(). */
  private readonly pending = new Map<string, boolean>();
  /** Keys that went down between the previous two latch() calls; readable until the next latch(). */
  private readonly latched = new Map<string, boolean>();

  constructor(target: EventTarget) {
    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    target.addEventListener('blur', this.clear);
    this.detach = () => {
      target.removeEventListener('keydown', this.onDown as EventListener);
      target.removeEventListener('keyup', this.onUp as EventListener);
      target.removeEventListener('blur', this.clear);
    };
  }
  readonly detach: () => void;

  /** Key codes whose keydown gets preventDefault(). null = off (default). */
  preventKeys: ReadonlySet<string> | null = null;

  private readonly onDown = (e: KeyboardEvent): void => {
    this.down.set(e.code, true);
    if (!e.repeat) this.pending.set(e.code, true);
    if (this.preventKeys !== null && this.preventKeys.has(e.code)) e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent): void => { this.down.set(e.code, false); };
  private readonly clear = (): void => {
    this.down.forEach((_v, k) => this.down.set(k, false));
    this.pending.forEach((_v, k) => this.pending.set(k, false));
  };
  private readonly dropLatched = (_v: boolean, k: string): void => { this.latched.set(k, false); };
  private readonly promote = (v: boolean, k: string): void => { if (v) { this.latched.set(k, true); this.pending.set(k, false); } };

  /** Called by Input.update(): downs since the last call become readable via wasPressed() until the next call. */
  latch(): void {
    this.latched.forEach(this.dropLatched);
    this.pending.forEach(this.promote);
  }
  /** True if the key went down since the previous update, even if already released. */
  wasPressed(code: string): boolean {
    return this.latched.get(code) === true;
  }

  isDown(code: string): boolean {
    return this.down.get(code) === true;
  }
}
