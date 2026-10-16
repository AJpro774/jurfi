/** Keyboard state keyed by KeyboardEvent.code. */
export class Keyboard {
  private readonly down = new Map<string, boolean>();

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

  private readonly onDown = (e: KeyboardEvent): void => { this.down.set(e.code, true); };
  private readonly onUp = (e: KeyboardEvent): void => { this.down.set(e.code, false); };
  private readonly clear = (): void => { this.down.forEach((_v, k) => this.down.set(k, false)); };

  isDown(code: string): boolean {
    return this.down.get(code) === true;
  }
}
