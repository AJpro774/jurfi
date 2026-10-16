import type { InputOptions } from './types';

/** Mouse state with per-frame accumulated deltas and pointer lock. */
export class Mouse {
  buttons = 0;
  x = 0;
  y = 0;
  /** Accumulated since last endFrame(). */
  dx = 0;
  dy = 0;
  wheel = 0;
  /** Deltas of the last completed frame, readable by bindings. */
  frameDx = 0;
  frameDy = 0;
  frameWheel = 0;
  locked = false;
  private readonly doc: InputOptions['document'];
  private readonly element: InputOptions['element'];
  readonly detach: () => void;

  constructor(element: InputOptions['element'], doc: InputOptions['document'], target: EventTarget) {
    this.element = element;
    this.doc = doc;
    const el = (element ?? target) as EventTarget;
    el.addEventListener('mousedown', this.onDown as EventListener);
    target.addEventListener('mouseup', this.onUp as EventListener);
    el.addEventListener('mousemove', this.onMove as EventListener);
    el.addEventListener('wheel', this.onWheel as EventListener, { passive: true });
    doc?.addEventListener('pointerlockchange', this.onLock);
    this.detach = () => {
      el.removeEventListener('mousedown', this.onDown as EventListener);
      target.removeEventListener('mouseup', this.onUp as EventListener);
      el.removeEventListener('mousemove', this.onMove as EventListener);
      el.removeEventListener('wheel', this.onWheel as EventListener);
      doc?.removeEventListener('pointerlockchange', this.onLock);
    };
  }

  private readonly onDown = (e: MouseEvent): void => { this.buttons |= 1 << e.button; };
  private readonly onUp = (e: MouseEvent): void => { this.buttons &= ~(1 << e.button); };
  private readonly onMove = (e: MouseEvent): void => {
    this.x = e.clientX; this.y = e.clientY;
    this.dx += e.movementX || 0;
    this.dy += e.movementY || 0;
  };
  private readonly onWheel = (e: WheelEvent): void => { this.wheel += e.deltaY; };
  private readonly onLock = (): void => {
    this.locked = !!this.doc && this.doc.pointerLockElement !== null;
  };

  isDown(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  requestPointerLock(): void {
    void this.element?.requestPointerLock?.();
  }

  exitPointerLock(): void {
    this.doc?.exitPointerLock();
  }

  /** Latch accumulated deltas for this frame's polling and reset accumulators. */
  latch(): void {
    this.frameDx = this.dx; this.frameDy = this.dy; this.frameWheel = this.wheel;
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
