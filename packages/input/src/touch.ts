import { nextStamp, PointerState } from './pointer';
import type { ElementLike } from './pointer';

/** Virtual on-screen stick. Coordinates are in client pixels. */
export class VirtualStick {
  x = 0;
  y = 0;
  active = false;
  /** Pointer/touch identifier currently driving this stick (-1 = none). */
  touchId = -1;
  originX = 0;
  originY = 0;
  /**
   * Absolute mode: deflection is measured from a fixed anchor (client px) rather than from where the touch began.
   * Enable with `setAbsolute()`. Default anchor is the centre of the hit region.
   */
  absolute = false;
  anchorX: number;
  anchorY: number;
  constructor(
    public readonly id: string,
    /** Hit region: left, top, width, height. */
    public left: number, public top: number, public width: number, public height: number,
    /** Pixel radius mapping to full deflection. */
    public radius = 60,
    /** Fraction of radius ignored. */
    public deadzone = 0.1,
  ) {
    this.anchorX = left + width / 2;
    this.anchorY = top + height / 2;
  }
  /** Switch to absolute mode. Anchor defaults to the centre of the hit region (or pass client px). */
  setAbsolute(enabled = true, anchorX?: number, anchorY?: number): this {
    this.absolute = enabled;
    if (anchorX !== undefined) this.anchorX = anchorX;
    if (anchorY !== undefined) this.anchorY = anchorY;
    return this;
  }
  contains(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.width && py >= this.top && py < this.top + this.height;
  }
  begin(touchId: number, px: number, py: number): void {
    this.active = true; this.touchId = touchId; this.x = 0; this.y = 0;
    if (this.absolute) {
      this.originX = this.anchorX; this.originY = this.anchorY;
      this.move(px, py);
    } else { this.originX = px; this.originY = py; }
  }
  move(px: number, py: number): void {
    let dx = (px - this.originX) / this.radius;
    let dy = (py - this.originY) / this.radius;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m > 1) { dx /= m; dy /= m; }
    if (m < this.deadzone) { dx = 0; dy = 0; }
    this.x = dx; this.y = dy;
  }
  end(): void {
    this.active = false; this.touchId = -1; this.x = 0; this.y = 0;
  }
}

export class VirtualButton {
  /** True while held, and also until the next update() if a press started and ended since the previous update. */
  pressed = false;
  touchId = -1;
  /** Down since the last latch(). */
  pending = false;
  /** Down between the previous two latch() calls; keeps `pressed` true until the next latch(). */
  latched = false;
  constructor(public readonly id: string, public left: number, public top: number, public width: number, public height: number) {}
  /** Called by Input.update(). */
  latch(): void {
    this.latched = this.pending; this.pending = false;
    this.pressed = this.touchId !== -1 || this.latched;
  }
  contains(px: number, py: number): boolean {
    return px >= this.left && px < this.left + this.width && py >= this.top && py < this.top + this.height;
  }
}

/** One tracked touch. Pooled: `active` tells whether the slot is in use. Positions are element-relative px and normalized 0..1. */
export class TouchPoint {
  active = false;
  id = -1;
  clientX = 0;
  clientY = 0;
  x = 0;
  y = 0;
  nx = 0;
  ny = 0;
}

export const MAX_TOUCHES = 10;

/** Dispatches touch events to registered virtual sticks/buttons. Iterates without allocating. */
export class TouchControls {
  readonly sticks: VirtualStick[] = [];
  readonly buttons: VirtualButton[] = [];
  readonly detach: () => void;
  /** Fixed pool of touch slots (length MAX_TOUCHES); filter by `active`. Never reallocated. */
  readonly touches: TouchPoint[] = [];
  /** Number of active touches. */
  touchCount = 0;
  /** Most recently touched/moved active touch as an absolute pointer (`active` false when none). */
  readonly pointer = new PointerState();
  private readonly element: ElementLike | undefined;

  constructor(target: EventTarget, element?: ElementLike) {
    this.element = element;
    for (let i = 0; i < MAX_TOUCHES; i++) this.touches.push(new TouchPoint());
    const s = this.onStart as EventListener, m = this.onMove as EventListener, e = this.onEnd as EventListener;
    target.addEventListener('touchstart', s);
    target.addEventListener('touchmove', m);
    target.addEventListener('touchend', e);
    target.addEventListener('touchcancel', e);
    this.detach = () => {
      target.removeEventListener('touchstart', s);
      target.removeEventListener('touchmove', m);
      target.removeEventListener('touchend', e);
      target.removeEventListener('touchcancel', e);
    };
  }

  /** Called by Input.update(): roll button press latches forward one frame. */
  latch(): void {
    for (let k = 0; k < this.buttons.length; k++) (this.buttons[k] as VirtualButton).latch();
  }

  addStick(stick: VirtualStick): VirtualStick { this.sticks.push(stick); return stick; }
  addButton(button: VirtualButton): VirtualButton { this.buttons.push(button); return button; }
  getStick(id: string): VirtualStick | undefined { return this.sticks.find((s) => s.id === id); }
  getButton(id: string): VirtualButton | undefined { return this.buttons.find((b) => b.id === id); }

  /** Slot for a touch id, or null. */
  getTouch(id: number): TouchPoint | null {
    for (let i = 0; i < MAX_TOUCHES; i++) { const p = this.touches[i] as TouchPoint; if (p.active && p.id === id) return p; }
    return null;
  }

  private track(t: Touch, create: boolean): void {
    let p = this.getTouch(t.identifier);
    if (!p) {
      if (!create) return;
      for (let i = 0; i < MAX_TOUCHES; i++) { const q = this.touches[i] as TouchPoint; if (!q.active) { p = q; break; } }
      if (!p) return;
      p.active = true; p.id = t.identifier; this.touchCount++;
    }
    p.clientX = t.clientX; p.clientY = t.clientY;
    const ptr = this.pointer;
    ptr.setClient(this.element, t.clientX, t.clientY);
    ptr.active = true; ptr.source = 'touch';
    p.x = ptr.x; p.y = ptr.y; p.nx = ptr.nx; p.ny = ptr.ny;
  }

  private untrack(id: number): void {
    const p = this.getTouch(id);
    if (!p) return;
    p.active = false; p.id = -1; this.touchCount--;
    if (this.touchCount === 0) { this.pointer.active = false; this.pointer.stamp = nextStamp(); return; }
    // fall back to another live touch
    for (let i = 0; i < MAX_TOUCHES; i++) {
      const q = this.touches[i] as TouchPoint;
      if (q.active) { const ptr = this.pointer; ptr.x = q.x; ptr.y = q.y; ptr.nx = q.nx; ptr.ny = q.ny; break; }
    }
  }

  private readonly onStart = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      this.track(t, true);
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (!st.active && st.contains(t.clientX, t.clientY)) { st.begin(t.identifier, t.clientX, t.clientY); break; }
      }
      for (let k = 0; k < this.buttons.length; k++) {
        const b = this.buttons[k] as VirtualButton;
        if (b.touchId === -1 && b.contains(t.clientX, t.clientY)) { b.pressed = true; b.pending = true; b.touchId = t.identifier; }
      }
    }
  };
  private readonly onMove = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      this.track(t, false);
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (st.touchId === t.identifier) st.move(t.clientX, t.clientY);
      }
    }
  };
  private readonly onEnd = (ev: TouchEvent): void => {
    const list = ev.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as Touch;
      this.untrack(t.identifier);
      for (let k = 0; k < this.sticks.length; k++) {
        const st = this.sticks[k] as VirtualStick;
        if (st.touchId === t.identifier) st.end();
      }
      for (let k = 0; k < this.buttons.length; k++) {
        const b = this.buttons[k] as VirtualButton;
        if (b.touchId === t.identifier) { b.touchId = -1; b.pressed = b.pending || b.latched; }
      }
    }
  };
}
